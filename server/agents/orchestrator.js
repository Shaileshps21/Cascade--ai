/**
 * orchestrator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point for the 15-agent planning pipeline. Builds a shared
 * PlanningContext, runs each agent in sequence (with a Planning ⇄ Review
 * reflection loop and a scheduler quality gate), persists the result, and
 * streams progress over SSE.
 *
 * Preserves the pre-existing entry point signatures so routes/tasks.js does
 * not need to change how it calls into this module:
 *   orchestrateTask(processId, rawInput, userId, explicitDeadline)
 *   replanTask(taskId, userId, processId)
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/firebase.js';
import { emit, close, closeWithError } from '../rag/sseManager.js';
import { createClients, defaultClients, isQuotaError, getModelLabel } from '../config/Llm.js';
import { decryptSecret } from '../config/secrets.js';
import { addEntry } from '../rag/vectorStore.js';

import {
  createContext,
  toFirestoreDocument,
  fromFirestoreDocument,
  toClientTask,
  toTaskHistoryEntry,
  shrinkContextForWrite,
} from './contextManager.js';
import { eventBus } from './eventBus.js';

import { runMemoryAgent } from './memory_agent/agent.js';
import { loadUserBenchmarkContext, recordBenchmarkSnapshot } from './evaluation_benchmark_agent/agent.js';
import { runIntentContextAgent } from './intent_context_agent/agent.js';
import { runKnowledgeAcquisitionAgent } from './knowledge_acquisition_agent/agent.js';
import { runPrioritizationAgent } from './prioritization_agent/agent.js';
import { runPlanningAgent } from './planning_agent/agent.js';
import { runReviewAgent } from './review_agent/agent.js';
import { runDependencyAnalysisAgent } from './dependency_analysis_agent/agent.js';
import { runTimeEstimationAgent } from './time_estimation_agent/agent.js';
import { runDeadlineFeasibilityAgent } from './deadline_feasibility_agent/agent.js';
import { runSchedulerAgent } from './scheduler_agent/agent.js';
import { getFreeBusy, syncScheduleToCalendar } from './google_calendar_agent/agent.js';
import { reassessTask, runProgressCron } from './progress_tracking_agent/agent.js';
import { runReplanningAgent } from './replanning_agent/agent.js';
import { getCrossProjectBusySlots } from './shared/crossProjectBusySlots.js';

const MAX_PLANNING_REVISIONS = 2;
const REVIEW_QUALITY_THRESHOLD = 80;
const SCHEDULING_SCORE_THRESHOLD = 70;
const DEFAULT_HORIZON_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, used only if no deadline exists yet

function makeEmitter(pid) {
  return (event) => emit(pid, { ...event, ts: Date.now() });
}

function makeSseEmit(emitter) {
  return (agent, status, message, data = null) => emitter({ agent, status, message, data });
}

async function getUserClients(userId) {
  try {
    const doc = await db
      .collection('users').doc(userId)
      .collection('settings').doc('llm_key')
      .get();
    if (doc.exists && doc.data()?.key && doc.data()?.keyType) {
      const { key, keyType, model } = doc.data();
      // Stored encrypted (config/secrets.js); decryptSecret passes through any
      // key written before encryption existed, so old records keep working.
      return { clients: createClients(keyType, decryptSecret(key), {}, model || null), isPersonal: true };
    }
  } catch (err) {
    console.warn('[Orchestrator] Could not load user key:', err.message);
  }
  return { clients: defaultClients, isPersonal: false };
}

async function loadUserPreferences(userId) {
  try {
    const doc = await db
      .collection('users').doc(userId)
      .collection('settings').doc('preferences')
      .get();
    return doc.exists ? doc.data() : {};
  } catch (err) {
    console.warn('[Orchestrator] Could not load user preferences:', err.message);
    return {};
  }
}

async function getCalendarBusySlots(userId, fromISO, toISO) {
  try {
    return await getFreeBusy(userId, fromISO, toISO);
  } catch (err) {
    console.warn('[Orchestrator] Calendar busy-slot fetch skipped:', err.message);
    return [];
  }
}

/**
 * Write a PlanningContext to `tasks/{taskId}`, shedding optional fields first if
 * it would exceed Firestore's per-document ceiling. Returns the context actually
 * stored, so the caller keeps working with what a later read will see.
 */
async function persistContext(taskId, context, sseEmit = null) {
  const { context: toStore, bytes, droppedFields, stillTooLarge } = shrinkContextForWrite(context);

  if (droppedFields.length > 0) {
    const summary = `Project too large to store in full — dropped ${droppedFields.join(', ')} (${Math.round(bytes / 1024)}KB)`;
    console.warn(`[Orchestrator] ${summary}`);
    sseEmit?.('system', 'warning', `⚠️ ${summary}`, { droppedFields });
  }
  if (stillTooLarge) {
    // Nothing optional left to drop: the required planning/schedule data alone
    // exceeds the limit. Fail loudly here rather than letting Firestore reject
    // the write with an opaque error after the whole pipeline has already run.
    throw new Error(
      `Planned project is too large to store (${Math.round(bytes / 1024)}KB after trimming). Try a narrower goal or a shorter deadline.`
    );
  }

  await db.collection('tasks').doc(taskId).set(toFirestoreDocument(toStore));
  return toStore;
}

/**
 * Save mid-pipeline progress so a later failure doesn't discard everything spent
 * so far.
 *
 * A run makes a dozen-plus LLM calls and previously wrote nothing until the very
 * last step, so a failure at the Scheduler threw away the Planning, Dependency
 * and Estimation work — and the user paid for all of it again on retry. These
 * checkpoints sit after the expensive stages only: three extra writes, not
 * fifteen, because Firestore writes cost money too and the cheap stages aren't
 * worth protecting.
 *
 * Always best-effort. A checkpoint failing must never be the thing that breaks a
 * run that would otherwise have succeeded.
 */
async function checkpoint(taskId, context, stage) {
  try {
    context.metadata = context.metadata ?? {};
    context.metadata.pipelineStage = stage;
    context.metadata.checkpointedAt = new Date().toISOString();
    const { context: toStore } = shrinkContextForWrite(context);
    await db.collection('tasks').doc(taskId).set(toFirestoreDocument(toStore), { merge: true });
  } catch (err) {
    console.warn(`[Orchestrator] Checkpoint at "${stage}" failed (non-fatal):`, err.message);
  }
}

/** Finds the most-overrun, not-yet-completed, non-buffer/review task in a schedule. */
function findOverrunTask(context) {
  const now = Date.now();
  const scheduled = context.schedule?.scheduledTasks ?? [];
  const tasksById = new Map((context.planning?.tasks ?? []).map((t) => [t.taskId, t]));

  let worst = null;
  for (const slot of scheduled) {
    if (slot.isBuffer || slot.isReview) continue;
    const task = tasksById.get(slot.taskId);
    if (!task || task.progress?.status === 'completed') continue;

    const end = new Date(slot.endTime).getTime();
    if (Number.isNaN(end) || end >= now) continue;

    const overrunMinutes = Math.round((now - end) / 60000);
    if (!worst || overrunMinutes > worst.overrunMinutes) {
      worst = { taskId: slot.taskId, overrunMinutes };
    }
  }
  return worst;
}

/**
 * @param {string} processId
 * @param {string} rawInput
 * @param {string} userId
 * @param {string|null} [explicitDeadline]
 * @param {{resumeContext?: object, resumeTaskId?: string}} [opts]
 *   resumeContext/resumeTaskId are supplied by resumeTask() to continue a run
 *   that failed part-way; stages whose output is already present are skipped.
 */
export async function orchestrateTask(processId, rawInput, userId, explicitDeadline = null, opts = {}) {
  const emitter = makeEmitter(processId);
  const sseEmit = makeSseEmit(emitter);
  const taskId = opts.resumeTaskId ?? uuidv4();

  try {
    emitter({ agent: 'system', status: 'start', message: '🚀 Cascade activated — launching 15-agent pipeline...' });

    const { clients, isPersonal } = await getUserClients(userId);
    if (!clients) throw new Error('NO_CLIENTS');

    const providerLabel = `${clients.keyType === 'groq' ? 'Groq' : 'Gemini'} (${clients.modelLabel ?? getModelLabel(clients.keyType)})`;
    const keyLabel = isPersonal ? `🔑 Your personal ${providerLabel} key` : `🌐 Shared ${providerLabel} quota`;
    emitter({ agent: 'system', status: 'thinking', message: keyLabel });

    // Declared outside the try so the failure handler can still reach whatever
    // the run completed before it died. `let`, not `const`, because
    // persistContext() may return a trimmed copy when the planned project would
    // exceed Firestore's per-document limit, and the steps after the write must
    // operate on what was actually stored.
    let context = null;

    try {
      context = opts.resumeContext
        ?? createContext(taskId, userId, rawInput, 'standard', explicitDeadline);

      // ── 0. Scheduling preferences + 1. Intent, concurrently ───────────────
      // The preferences read is an independent Firestore lookup; nothing before
      // the Scheduler consumes it, so it need not block intent extraction.
      //
      // Intent MUST come first among the agents. It used to run third, after
      // Memory — but the Memory Agent reads context.intent?.category and
      // ?.complexity, which were still null at that point, so it silently
      // profiled every project as category 'other' / complexity 'medium'. That
      // quietly degraded exactly the personalisation it exists to provide:
      // history matching and the LLM starting-profile fallback were both run
      // against the wrong project shape. Ordering fixed here.
      const [preferences] = await Promise.all([
        loadUserPreferences(userId),
        context.intent ? Promise.resolve() : runIntentContextAgent(context, clients, eventBus, sseEmit),
      ]);
      // Preferences are always re-read, never resumed: a day/night change made
      // between the failed run and the retry should take effect immediately.
      context.preferences = preferences;
      // Per-task calendar sync flag (default true). Stored in metadata so the
      // calendar guard at step 12 and the PATCH /calendar-sync endpoint both
      // read from the same place.
      if (opts.calendarSync === false) {
        context.metadata = context.metadata ?? {};
        context.metadata.calendarSync = false;
      }

      // ── 2·3·4. Memory · Benchmark · Knowledge, concurrently ───────────────
      // All three depend only on context.intent (or on nothing but userId), and
      // none reads what another writes — memory, benchmark and knowledge are
      // separate namespaces. Running them together removes two round trips of
      // LLM latency from every submission.
      //
      // allSettled, not all: the benchmark load is explicitly non-fatal, while a
      // Memory or Knowledge failure was fatal before this change and stays fatal.
      // Promise.all would have let a benchmark hiccup abort the whole pipeline.
      sseEmit('benchmark', 'thinking', 'Loading your performance history...', null);
      const [memoryOutcome, benchmarkOutcome, knowledgeOutcome] = await Promise.allSettled([
        context.memory ? Promise.resolve() : runMemoryAgent(context, clients, eventBus, sseEmit),
        loadUserBenchmarkContext(userId),
        context.knowledge ? Promise.resolve() : runKnowledgeAcquisitionAgent(context, clients, eventBus, sseEmit),
      ]);

      if (benchmarkOutcome.status === 'fulfilled') {
        context.benchmark = benchmarkOutcome.value;
        sseEmit('benchmark', 'done', 'Historical benchmarks loaded', null);
      } else {
        console.warn('[Orchestrator] Benchmark load failed (non-fatal):', benchmarkOutcome.reason?.message);
        sseEmit('benchmark', 'warning', 'No historical benchmarks available yet', null);
      }
      if (memoryOutcome.status === 'rejected') throw memoryOutcome.reason;
      if (knowledgeOutcome.status === 'rejected') throw knowledgeOutcome.reason;

      // ── 5. Prioritization Agent ──────────────────────────────────────────
      // Each stage from here on is skipped when its output is already present.
      // On a fresh run every namespace is null, so this changes nothing; on a
      // resumed run it is what lets the pipeline pick up where it failed instead
      // of re-paying for work already done.
      if (!context.priority) await runPrioritizationAgent(context, clients, eventBus, sseEmit);

      // ── 6·7. Planning Agent ⇄ Review Agent (quality gate, max 2 revisions) ─
      if (!context.planning) {
        await runPlanningAgent(context, clients, eventBus, sseEmit);

        let reviewResult = await runReviewAgent(context, clients, eventBus, sseEmit, 'planning');
        let revisions = 0;
        while (reviewResult.qualityScore < REVIEW_QUALITY_THRESHOLD && revisions < MAX_PLANNING_REVISIONS) {
          revisions++;
          context.metadata.revisionCount = (context.metadata.revisionCount || 0) + 1;
          emitter({
            agent: 'review', status: 'thinking',
            message: `Quality score ${reviewResult.qualityScore}/100 — revising plan (attempt ${revisions})...`,
          });
          await runPlanningAgent(context, clients, eventBus, sseEmit, reviewResult);
          reviewResult = await runReviewAgent(context, clients, eventBus, sseEmit, 'planning');
        }
      }
      // Most expensive stage in the pipeline — up to three planning runs plus
      // three reviews. Worth a checkpoint above all others.
      await checkpoint(taskId, context, 'planning');

      // ── 8. Dependency Analysis Agent ─────────────────────────────────────
      if (!context.dependency) await runDependencyAnalysisAgent(context, clients, eventBus, sseEmit);

      // ── 9. Time Estimation Agent ──────────────────────────────────────────
      if (!context.estimation) await runTimeEstimationAgent(context, clients, eventBus, sseEmit);
      await checkpoint(taskId, context, 'estimation');

      // ── 10. Deadline Feasibility Agent ────────────────────────────────────
      const feasibility = context.feasibility
        ?? await runDeadlineFeasibilityAgent(context, clients, eventBus, sseEmit);
      if (!feasibility.isFeasible) {
        emitter({
          agent: 'feasibility', status: 'warning',
          message: '⚠️ Deadline may not be achievable as scoped',
          data: feasibility.reconciliationSuggestions,
        });
      }

      // ── 11. Scheduler Agent (LLM-assisted) ───────────────────────────────
      const deadlineForBusy = context.intent?.deadline
        ?? context.explicitDeadline
        ?? new Date(Date.now() + DEFAULT_HORIZON_MS).toISOString();
      if (!context.schedule) {
        // Cross-Project Conflict Detection (suggestions.md #25): other active
        // Cascade projects' already-scheduled tasks are treated as opaque
        // busy blocks alongside real Google Calendar events, so two
        // concurrent projects can't silently book the same slot.
        const [busySlots, crossProjectBusySlots] = await Promise.all([
          getCalendarBusySlots(userId, new Date().toISOString(), deadlineForBusy),
          getCrossProjectBusySlots(userId, taskId),
        ]);
        if (crossProjectBusySlots.length > 0) {
          sseEmit('scheduler', 'thinking', `🔍 Found ${crossProjectBusySlots.length} busy slot(s) from your other active projects — avoiding overlaps`, null);
        }
        await runSchedulerAgent(context, clients, eventBus, sseEmit, [...busySlots, ...crossProjectBusySlots]);

        if ((context.schedule?.schedulingScore ?? 100) < SCHEDULING_SCORE_THRESHOLD) {
          await runReviewAgent(context, clients, eventBus, sseEmit, 'schedule');
        }
      }
      await checkpoint(taskId, context, 'schedule');

      // ── 12. Google Calendar Agent — sync (if connected + enabled for task) ─
      // `calendarSync` defaults to true for all tasks. Users can set it to
      // false per-task via PATCH /api/tasks/:taskId/calendar-sync before or
      // after submission. The flag is stored in context.metadata.calendarSync.
      const calendarSyncEnabled = context.metadata?.calendarSync !== false;
      try {
        if (calendarSyncEnabled) {
          const syncResult = await syncScheduleToCalendar(context, userId);
          context.schedule.scheduledTasks = syncResult.scheduledTasks;
          context.metadata.calendarConnected = syncResult.calendarConnected;
          sseEmit(
            'calendar', 'done',
            syncResult.calendarConnected ? '📅 Synced to Google Calendar' : 'Calendar not connected — skipped sync',
            null
          );
        } else {
          sseEmit('calendar', 'done', '📅 Calendar sync disabled for this project — skipped', null);
        }
      } catch (err) {
        console.warn('[Orchestrator] Calendar sync skipped:', err.message);
        sseEmit('calendar', 'warning', 'Calendar sync skipped', null);
      }

      // ── 13. Progress Tracking Agent — initial state ──────────────────────
      try {
        reassessTask(context);
        sseEmit('monitor', 'done', 'Initial progress state recorded', null);
      } catch (err) {
        console.warn('[Orchestrator] Initial progress assessment failed (non-fatal):', err.message);
      }

      // ── 14. Persist PlanningContext ───────────────────────────────────────
      emitter({ agent: 'system', status: 'thinking', message: '💾 Saving your task...' });
      context.llmProvider = clients.keyType;
      context.llmModel = clients.modelId ?? null;
      context.usedPersonalKey = isPersonal;
      context.metadata.pipelineStage = 'complete';
      context.metadata.pipelineFailed = false;
      context = await persistContext(taskId, context, sseEmit);

      // ── 15. task_history entry (seeds the Memory Agent) ──────────────────
      try {
        await db.collection('task_history').doc(taskId).set(toTaskHistoryEntry(context), { merge: true });
      } catch (err) {
        console.warn('[Orchestrator] task_history write skipped:', err.message);
      }

      // ── 16. Evaluation Benchmark — append initial planning metrics ──────
      try {
        await recordBenchmarkSnapshot(context, {}, eventBus, sseEmit);
      } catch (err) {
        console.warn('[Orchestrator] Benchmark snapshot skipped:', err.message);
      }

      // ── 17. RAG seed ──────────────────────────────────────────────────────
      try {
        const totalEstimatedHours = (context.estimation?.estimations ?? [])
          .reduce((sum, e) => sum + (e.finalEstimateMinutes || 0), 0) / 60;
        const queryText = `${context.intent?.category ?? 'other'} task "${context.intent?.title ?? context.rawGoal}" complexity ${context.intent?.complexity ?? 'medium'}`;
        const vector = await clients.embedding?.embed(queryText);
        if (vector) {
          await addEntry(userId, queryText, vector, {
            taskId,
            category: context.intent?.category,
            complexity: context.intent?.complexity,
            estimatedHours: totalEstimatedHours,
            type: 'active_task',
          });
        }
      } catch (ragErr) {
        console.warn('[Orchestrator] RAG seed skipped:', ragErr.message);
      }

      // ── 18. Complete ──────────────────────────────────────────────────────
      const clientTask = toClientTask(context);
      close(processId, {
        taskId,
        title: clientTask.title,
        deadline: clientTask.deadline,
        priorityScore: clientTask.priorityScore,
        riskScore: clientTask.riskScore,
        subtaskCount: clientTask.subtaskCount,
        calendarConnected: context.metadata.calendarConnected,
        scheduledCount: clientTask.scheduledCount,
        warnings: clientTask.warnings,
        llmProvider: clients.keyType,
        usedPersonalKey: isPersonal,
      });

    } catch (pipelineErr) {
      // Preserve whatever the run got through before it died, so a retry can
      // resume instead of re-paying for every completed stage. Marked failed so
      // it is excluded from the project list rather than shown as a real project.
      if (context) {
        context.metadata = context.metadata ?? {};
        context.metadata.pipelineFailed = true;
        context.metadata.pipelineError = pipelineErr.message ?? String(pipelineErr);
        await checkpoint(taskId, context, context.metadata.pipelineStage ?? 'failed');
      }

      // ── Quota error — distinguish from other errors ──────────────────────
      if (isQuotaError(pipelineErr) && !isPersonal) {
        emit(processId, {
          agent: 'system',
          status: 'quota_exceeded',
          message: '⚠️ Shared quota reached. Add your own API key to continue.',
          data: { taskId, resumable: true },
          ts: Date.now(),
        });
        closeWithError(processId, 'QUOTA_EXCEEDED');
      } else if (isQuotaError(pipelineErr) && isPersonal) {
        emit(processId, {
          agent: 'system',
          status: 'quota_exceeded',
          message: '⚠️ Your personal API key quota is exhausted. Try again later or check your plan.',
          data: { taskId, resumable: true, isPersonal: true },
          ts: Date.now(),
        });
        closeWithError(processId, 'PERSONAL_QUOTA_EXCEEDED');
      } else {
        throw pipelineErr;
      }
    }

  } catch (err) {
    console.error(`[Orchestrator] Pipeline failed for ${processId}:`, err.message);
    if (err.message === 'NO_CLIENTS') {
      closeWithError(processId, 'No API key available. Please add your Gemini or Groq key.');
    } else {
      closeWithError(processId, err.message || 'Unexpected error in agent pipeline');
    }
  }
}

/**
 * Replan flow: load the persisted PlanningContext, find the most-overrun
 * task (if any), consume buffer / reschedule affected tasks via the
 * Replanning Agent, re-sync Google Calendar, reassess progress, and persist.
 */
export async function replanTask(taskId, userId, processId) {
  const emitter = makeEmitter(processId);
  const sseEmit = makeSseEmit(emitter);

  try {
    const { clients } = await getUserClients(userId);

    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== userId) {
      throw new Error('Task not found');
    }
    const context = fromFirestoreDocument(doc.data());
    // Re-fetch preferences (not the value frozen at creation time) so a
    // day/night preference change takes effect on the very next replan.
    context.preferences = await loadUserPreferences(userId);

    const overrun = findOverrunTask(context);
    let updatedContext = context;
    let disruptionScore = 0;
    let warnings = [];

    if (overrun) {
      emitter({ agent: 'scheduler', status: 'thinking', message: '🔄 Replanning affected tasks...' });
      const result = await runReplanningAgent(context, clients, userId, eventBus, sseEmit, {
        delayedTaskId: overrun.taskId,
        overrunMinutes: overrun.overrunMinutes,
      });
      updatedContext = result.context;
      disruptionScore = result.disruptionScore;
      warnings = result.warnings ?? [];
    } else {
      emitter({ agent: 'scheduler', status: 'done', message: 'No overrun detected — schedule unchanged.' });
    }

    try {
      reassessTask(updatedContext);
    } catch (err) {
      console.warn('[Orchestrator] Post-replan progress reassessment failed (non-fatal):', err.message);
    }

    updatedContext = await persistContext(taskId, updatedContext, sseEmit);

    const clientTask = toClientTask(updatedContext);
    close(processId, { taskId, disruptionScore, warnings, ...clientTask });

  } catch (err) {
    console.error(`[Orchestrator] Replan failed for ${processId}:`, err.message);
    closeWithError(processId, err.message || 'Replan failed');
  }
}

/**
 * Continue a run that failed part-way, reusing everything it already completed.
 *
 * The pipeline makes a dozen-plus LLM calls; before checkpointing existed, a
 * failure at any point discarded all of them and the user paid again from
 * scratch. Stages whose output is already in the stored context are skipped (see
 * the `if (!context.x)` guards in orchestrateTask), so a resume only re-runs what
 * genuinely didn't finish.
 *
 * @param {string} taskId
 * @param {string} userId
 * @param {string} processId
 */
export async function resumeTask(taskId, userId, processId) {
  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== userId) {
      throw new Error('Task not found');
    }

    const context = fromFirestoreDocument(doc.data());
    if (context.metadata?.pipelineStage === 'complete') {
      throw new Error('This project already finished planning — nothing to resume.');
    }

    emit(processId, {
      agent: 'system',
      status: 'start',
      message: `♻️ Resuming from "${context.metadata?.pipelineStage ?? 'the beginning'}" — completed stages will be reused.`,
      ts: Date.now(),
    });

    await orchestrateTask(processId, context.rawGoal, userId, context.explicitDeadline ?? null, {
      resumeContext: context,
      resumeTaskId: taskId,
    });
  } catch (err) {
    console.error(`[Orchestrator] Resume failed for ${processId}:`, err.message);
    closeWithError(processId, err.message || 'Resume failed');
  }
}

/**
 * The full progress sweep: detect escalated tasks, then actually replan each one.
 *
 * Lives here rather than in index.js so the in-process node-cron schedule and the
 * external-scheduler endpoint (routes/cron.js) run byte-identical logic. On a
 * host that sleeps when idle — Render's free tier, for instance — the in-process
 * timer never fires, and autonomous replanning is the product's most distinctive
 * claim; it should not depend on which trigger woke the server.
 *
 * One task failing to replan must not abandon the rest of the sweep, so each is
 * caught individually.
 *
 * @returns {Promise<{processed:number, escalated:number, replanned:number, failed:number}>}
 */
export async function runProgressSweepWithReplan() {
  const { processed, escalated, escalatedTasks } = await runProgressCron();
  let replanned = 0;
  let failed = 0;

  for (const { taskId, userId } of escalatedTasks ?? []) {
    console.log(`[Sweep] Auto-replanning escalated task ${taskId} for user ${userId}...`);
    try {
      await replanTask(taskId, userId, uuidv4());
      replanned++;
    } catch (err) {
      failed++;
      console.error(`[Sweep] Auto-replan failed for task ${taskId}:`, err.message);
    }
  }

  return { processed, escalated, replanned, failed };
}
