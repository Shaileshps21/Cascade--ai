import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { registerClient } from '../rag/sseManager.js';
import { orchestrateTask, replanTask, resumeTask } from '../agents/orchestrator.js';
import { checkSingleTask } from '../agents/progress_tracking_agent/agent.js';
import { deleteCalendarEvents, syncScheduleToCalendar } from '../agents/google_calendar_agent/agent.js';
import { createContext, fromFirestoreDocument, toFirestoreDocument, toClientTask, toTaskHistoryEntry } from '../agents/contextManager.js';

const router = express.Router();

// ── POST /api/tasks/initiate ────────────────────────────────────────────────
router.post('/initiate', requireAuth, async (req, res) => {
  const { rawInput, deadline, calendarSync = true } = req.body;

  if (!rawInput?.trim()) {
    return res.status(400).json({ error: 'rawInput is required' });
  }

  // ── Deadline validation & logging ─────────────────────────────────────────
  let resolvedDeadline = null;

  if (deadline) {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Invalid deadline format.' });
    }
    if (d <= new Date()) {
      return res.status(400).json({ error: 'Deadline must be in the future.' });
    }
    resolvedDeadline = d.toISOString(); // normalise to ISO string
    console.log(`[Tasks] Explicit deadline received → ${resolvedDeadline} (${d.toLocaleString()})`);
  } else {
    console.log('[Tasks] No explicit deadline — AI will infer from task text');
  }

  const processId = uuidv4();

  // Pass calendarSync as an option to the orchestrator. The orchestrator
  // stores it in context.metadata.calendarSync so step 12 (Google Calendar
  // agent) can read it without any additional DB round-trip.
  setImmediate(() =>
    orchestrateTask(processId, rawInput.trim(), req.user.uid, resolvedDeadline, { calendarSync: calendarSync !== false })
  );

  res.json({ processId });
});

// ── POST /api/tasks/manual ──────────────────────────────────────────────────
// Manual Project Builder (Manual Todo Mode — suggestions.md #26): bypasses
// the 15-agent pipeline entirely so the app stays usable when the API quota
// is exhausted, the user is offline, or already has a plan in mind. Writes
// directly into the same PlanningContext schema every other view reads, so
// Project Workspace / Task Workspace / Progress Tracker / archive all work
// with zero extra code. No LLM calls are made anywhere in this handler.
//
// Body: { title, deadline?, calendarSync?, modules: [{ title, subtasks: [
//   { title, estimatedMinutes?, priority?, deadline? }
// ] }] }
const MANUAL_PRIORITIES = ['low', 'medium', 'high', 'critical'];

router.post('/manual', requireAuth, async (req, res) => {
  const { title, deadline, calendarSync = true, modules } = req.body ?? {};

  if (!title?.trim()) {
    return res.status(400).json({ error: 'Project title is required.' });
  }
  if (!Array.isArray(modules)) {
    return res.status(400).json({ error: 'At least one module with a subtask is required.' });
  }

  // Drop modules/subtasks with no title — the builder UI shouldn't submit
  // any, but never trust the client alone for a write endpoint.
  const cleanModules = modules
    .map((m) => ({
      title: (m?.title ?? '').trim(),
      subtasks: Array.isArray(m?.subtasks)
        ? m.subtasks.filter((s) => s?.title?.trim())
        : [],
    }))
    .filter((m) => m.title && m.subtasks.length > 0);

  if (cleanModules.length === 0) {
    return res.status(400).json({ error: 'Add at least one module with at least one subtask.' });
  }

  let resolvedDeadline = null;
  if (deadline) {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid deadline format.' });
    if (d <= new Date()) return res.status(400).json({ error: 'Deadline must be in the future.' });
    resolvedDeadline = d.toISOString();
  }

  const taskId = uuidv4();
  const context = createContext(taskId, req.user.uid, title.trim(), 'manual', resolvedDeadline);

  // No AI ran, so this is exactly what the user told us — no inferred
  // category/complexity/confidence to fabricate.
  context.intent = {
    title: title.trim(),
    deadline: resolvedDeadline,
    category: 'other',
    complexity: 'medium',
    urgency: 'Medium',
  };

  const milestoneId = 'M1';
  const planningModules = [];
  const planningTasks = [];
  const scheduledTasks = [];
  let taskCounter = 0;

  for (let mi = 0; mi < cleanModules.length; mi++) {
    const mod = cleanModules[mi];
    const moduleId = `MOD${mi + 1}`;
    const taskIds = [];

    for (const st of mod.subtasks) {
      taskCounter++;
      const tId = `T${taskCounter}`;
      taskIds.push(tId);

      const priority = MANUAL_PRIORITIES.includes(st.priority) ? st.priority : 'medium';
      const parsedMinutes = Number(st.estimatedMinutes);
      const estimatedMinutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0
        ? Math.max(5, Math.round(parsedMinutes))
        : 30;

      let subtaskDeadline = null;
      if (st.deadline) {
        const sd = new Date(st.deadline);
        if (!isNaN(sd.getTime())) subtaskDeadline = sd.toISOString();
      }

      // Optional per-subtask start time (ManualProjectBuilder's "start time"
      // field) — when every subtask in the project has one, this becomes the
      // project's real schedule below (see scheduledTasks.length check),
      // with no AI scheduling pass needed.
      let subtaskStartTime = null;
      if (st.startTime) {
        const s = new Date(st.startTime);
        if (!isNaN(s.getTime())) subtaskStartTime = s;
      }

      const stepId = 'S1';
      const subtaskTitle = st.title.trim();

      if (subtaskStartTime) {
        scheduledTasks.push({
          taskId: tId,
          taskName: subtaskTitle,
          startTime: subtaskStartTime.toISOString(),
          endTime: new Date(subtaskStartTime.getTime() + estimatedMinutes * 60_000).toISOString(),
          estimatedDuration: estimatedMinutes,
          adjustedDuration: estimatedMinutes,
          adjustmentReason: '',
          priority,
          energyLevel: 'medium',
          isBuffer: false,
          isReview: false,
          isDeepWork: false,
          dependencies: [],
          confidence: 1,
        });
      }
      planningTasks.push({
        taskId: tId,
        milestoneId,
        moduleId,
        title: subtaskTitle,
        difficulty: 'medium',
        requiredSkills: [],
        dependencies: [],
        priority,
        estimatedMinutes,
        reviewRequired: false,
        isBuffer: false,
        isReview: false,
        deadline: subtaskDeadline,
        overview: '',
        objectives: [],
        // Exactly one execution step per manual subtask — mirrors
        // planning_agent's normalizeExecutionStep() shape verbatim so the
        // Task Workspace (which is entirely step-driven) can mark it
        // complete like any AI-planned task.
        executionSteps: [{
          id: stepId,
          stepId,
          title: subtaskTitle,
          description: '',
          order: 1,
          estimatedMinutes,
          status: 'pending',
          dependencies: [],
          resources: [],
          notes: '',
          completionEvidence: '',
          isOptional: false,
          progress: 0,
          startedAt: null,
          completedAt: null,
          blockedReason: null,
          blockedSince: null,
        }],
        deliverables: [],
        successCriteria: [],
        commonMistakes: [],
        aiGuidance: [],
        reflectionQuestions: [],
        resources: [],
        notes: [],
        progress: { status: 'not_started', completedAt: null, actualMinutes: null },
      });
    }

    planningModules.push({
      id: moduleId,
      title: mod.title,
      description: '',
      acceptanceCriteria: [],
      dependencies: [],
      tasks: taskIds,
      // Tags every module a from-scratch Manual Project Builder project
      // creates as manually-added, same as Add Module — see
      // shared/quickAddModule.js's resolveModuleSource() for how untagged
      // (pre-existing) manual projects are still recognized without a data
      // migration.
      source: 'manual',
    });
  }

  context.planning = {
    schemaVersion: '1.0.0',
    milestones: [{
      id: milestoneId,
      title: title.trim(),
      description: '',
      estimatedOutcome: '',
      completionCriteria: [],
      riskLevel: 'medium',
      dependencies: [],
      modules: planningModules,
    }],
    tasks: planningTasks,
    dependencyGraph: {},
    criticalPath: [],
    riskSummary: [],
    planningNotes: 'Created manually — no AI planning applied yet.',
    realGoal: title.trim(),
  };

  context.metadata.manualMode = true;
  // Distinct from `hasSchedule`/`context.schedule`: a manual project can get a
  // schedule the moment the user gives every subtask its own start time (see
  // below), well before "Let AI enhance" ever runs. `aiEnhanced` is the only
  // flag that actually means "the AI pipeline has touched this project" — the
  // "manual" badge and "Let AI enhance this" CTA key off this, not hasSchedule.
  context.metadata.aiEnhanced = false;
  // Deliberately NOT 'complete': leaving it at the same checkpoint stage the
  // orchestrator itself uses after planning means POST /:taskId/resume (the
  // existing checkpoint-resume machinery, unchanged) already knows how to
  // "Let AI enhance" this later — it will run dependency/estimation/
  // feasibility/scheduler (and re-attach memory/knowledge) against these
  // exact tasks, skipping nothing the user already decided.
  context.metadata.pipelineStage = 'planning';
  context.metadata.pipelineFailed = false;
  context.metadata.calendarSync = calendarSync !== false;

  // ── User-specified schedule (every subtask got a start time) ─────────────
  // Only commit this as the project's real `schedule` when EVERY subtask has
  // one — a partial set would otherwise permanently block the AI scheduler
  // from ever running for the rest (runSchedulerAgent only runs when
  // `!context.schedule`), silently leaving those subtasks unscheduled even
  // after "Let AI enhance". A fully user-timed project has nothing left for
  // the AI to schedule, so it's safe — and correct — to treat it as done and
  // sync straight to Google Calendar without waiting for that step.
  if (scheduledTasks.length > 0 && scheduledTasks.length === planningTasks.length) {
    context.schedule = {
      schemaVersion: '1.0.0',
      scheduledTasks,
      bufferSlots: [],
      schedulingScore: 100,
      confidenceScore: 100,
      warnings: [],
      recommendations: [],
      isFeasible: true,
      failureConditions: null,
      reasoning: {
        confidence: 1,
        assumptions: ['User specified every subtask\'s start time directly — no AI scheduling was applied.'],
        warnings: [],
        promptVersion: 'manual',
      },
    };

    if (context.metadata.calendarSync) {
      try {
        const syncResult = await syncScheduleToCalendar(context, req.user.uid);
        context.schedule.scheduledTasks = syncResult.scheduledTasks;
        context.metadata.calendarConnected = syncResult.calendarConnected;
      } catch (err) {
        console.warn('[Tasks POST /manual] Calendar sync skipped:', err.message);
      }
    }
  }

  try {
    await db.collection('tasks').doc(taskId).set(toFirestoreDocument(context));
    res.json({ taskId });
  } catch (err) {
    console.error('[Tasks POST /manual]', err);
    res.status(500).json({ error: 'Failed to save manual project.' });
  }
});

// ── GET /api/tasks/stream/:processId ───────────────────────────────────────
router.get('/stream/:processId', (req, res) => {
  registerClient(req.params.processId, res);
});

// ── POST /api/tasks/:taskId/replan ──────────────────────────────────────────
// Manual trigger for the same replanning flow the progress-tracking cron
// runs automatically when a task's risk escalates (e.g. a missed/overrun
// task) — gives the user the freedom to force a reschedule on demand
// (e.g. right after they notice they've fallen behind, without waiting for
// the next 30-minute sweep). Streams progress over the same SSE channel
// /initiate uses.
router.post('/:taskId/replan', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }
  } catch {
    return res.status(500).json({ error: 'Failed to look up task' });
  }

  const processId = uuidv4();
  setImmediate(() => replanTask(taskId, req.user.uid, processId));
  res.json({ processId });
});

// ── POST /api/tasks/:taskId/resume ──────────────────────────────────────────
// Continue a planning run that failed part-way. The orchestrator checkpoints
// after its expensive stages, so this reuses the completed ones instead of
// re-paying for a dozen LLM calls. Streams over the same SSE channel.
router.post('/:taskId/resume', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (doc.data().metadata?.pipelineStage === 'complete') {
      return res.status(409).json({ error: 'This project already finished planning.' });
    }
  } catch {
    return res.status(500).json({ error: 'Failed to look up task' });
  }

  const processId = uuidv4();
  setImmediate(() => resumeTask(taskId, req.user.uid, processId));
  res.json({ processId });
});

// ── GET /api/tasks/failed ────────────────────────────────────────────────────
// Returns tasks where the pipeline failed mid-run and left a checkpoint.
// These are excluded from GET /api/tasks and GET /api/projects because a
// partial document should not render as a real project card. This endpoint
// exposes them explicitly so the Dashboard can offer a "Resume" button.
router.get('/failed', requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection('tasks')
      .where('userId', '==', req.user.uid)
      .where('metadata.pipelineFailed', '==', true)
      .limit(10)
      .get();

    const failed = snapshot.docs
      .filter((doc) => doc.data()?.metadata?.archived !== true) // exclude archived
      .map((doc) => {
        const data = doc.data();
        return {
          taskId: doc.id,
          rawGoal: data.rawGoal ?? data.intent?.title ?? 'Untitled task',
          pipelineStage: data.metadata?.pipelineStage ?? 'unknown',
          pipelineError: data.metadata?.pipelineError ?? null,
          checkpointedAt: data.metadata?.checkpointedAt ?? null,
        };
      });

    res.json({ failed });
  } catch (err) {
    console.error('[Tasks GET /failed]', err);
    res.status(500).json({ error: 'Failed to fetch interrupted tasks' });
  }
});


router.get('/', requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection('tasks')
      .where('userId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const now = new Date();
    const tasks = snapshot.docs
      // Partial documents left by a failed run are resumable, not real tasks.
      // Exclude partial pipeline-failed documents and archived (soft-deleted) tasks.
      .filter((doc) => {
        const meta = doc.data()?.metadata ?? {};
        return meta.pipelineFailed !== true && meta.archived !== true;
      })
      .map((doc) => {
        const clientTask = toClientTask(fromFirestoreDocument(doc.data()));
        const deadline = new Date(clientTask.deadline);
        return {
          ...clientTask,
          hoursRemaining: Math.max(0, Math.round((deadline - now) / 3_600_000 * 10) / 10),
        };
      });

    res.json({ tasks });
  } catch (err) {
    console.error('[Tasks GET]', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ── GET /api/tasks/:taskId ──────────────────────────────────────────────────
router.get('/:taskId', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });
    res.json({ task: toClientTask(fromFirestoreDocument(doc.data())) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// ── PATCH /api/tasks/:taskId/subtask/:subtaskId/complete ────────────────────
router.patch('/:taskId/subtask/:subtaskId/complete', requireAuth, async (req, res) => {
  const { taskId, subtaskId } = req.params;
  const { actualMinutes = null } = req.body ?? {};
  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });

    const context = fromFirestoreDocument(doc.data());
    const scheduledSlot = context.schedule?.scheduledTasks?.find((s) => s.taskId === subtaskId);

    // Delete Google Calendar event if present (non-fatal)
    let calendarEventDeleted = false;
    if (scheduledSlot?.calendarEventId) {
      try {
        await deleteCalendarEvents(req.user.uid, [scheduledSlot.calendarEventId]);
        calendarEventDeleted = true;
      } catch (calErr) {
        console.warn('[Tasks] Calendar delete failed (non-fatal):', calErr.message);
      }
    }

    const result = await checkSingleTask(taskId, req.user.uid, subtaskId, actualMinutes);

    res.json({ success: true, calendarEventDeleted, ...result });
  } catch (err) {
    console.error('[Subtask Complete]', err);
    res.status(500).json({ error: 'Failed to complete subtask' });
  }
});

// ── PATCH /api/tasks/:taskId/complete ──────────────────────────────────────
router.patch('/:taskId/complete', requireAuth, async (req, res) => {
  const { actualHours } = req.body ?? {};
  try {
    const doc = await db.collection('tasks').doc(req.params.taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });

    const context = fromFirestoreDocument(doc.data());
    const nowISO = new Date().toISOString();

    for (const task of context.planning?.tasks ?? []) {
      if (task.progress?.status !== 'completed') {
        task.progress = {
          ...task.progress,
          status: 'completed',
          completedAt: nowISO,
          actualMinutes: task.progress?.actualMinutes
            ?? (actualHours ? actualHours * 60 : task.estimatedMinutes ?? null),
        };
      }
    }
    context.metadata.updatedAt = nowISO;

    await doc.ref.set(toFirestoreDocument(context));

    try {
      const { recordBenchmarkSnapshot } = await import('../agents/evaluation_benchmark_agent/agent.js');
      await recordBenchmarkSnapshot(context);
    } catch (benchErr) {
      console.warn('[Task Complete] Benchmark snapshot skipped (non-fatal):', benchErr.message);
    }
    try {
      await db.collection('task_history').doc(req.params.taskId).set(toTaskHistoryEntry(context), { merge: true });
    } catch (histErr) {
      console.warn('[Task Complete] History write skipped (non-fatal):', histErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Task Complete]', err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// ── PATCH /api/tasks/:taskId/calendar-sync ──────────────────────────────────
// Toggle Google Calendar sync for a single project.
// Body: { enabled: boolean }
// - enabled=false: deletes all calendarEventIds from Google Calendar for this
//   task, clears the calendarEventId fields in Firestore so the task knows it
//   is un-synced, and persists calendarSync=false.
// - enabled=true: re-pushes any un-synced scheduledTasks to Google Calendar
//   and persists calendarSync=true.
router.patch('/:taskId/calendar-sync', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  const { enabled } = req.body ?? {};

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '`enabled` (boolean) is required.' });
  }

  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });

    const context = fromFirestoreDocument(doc.data());
    let syncedCount = 0;

    if (!enabled) {
      // Remove existing calendar events
      const eventIds = (context.schedule?.scheduledTasks ?? [])
        .map((s) => s.calendarEventId)
        .filter(Boolean);
      if (eventIds.length) {
        try {
          await deleteCalendarEvents(req.user.uid, eventIds);
        } catch (calErr) {
          console.warn('[Tasks PATCH /calendar-sync] Calendar delete failed (non-fatal):', calErr.message);
        }
        // Clear the stored calendarEventIds so the task knows it is un-synced
        (context.schedule?.scheduledTasks ?? []).forEach((s) => { delete s.calendarEventId; });
      }
    } else if (context.schedule?.scheduledTasks?.length) {
      // Re-sync to calendar
      try {
        const { syncScheduleToCalendar } = await import('../agents/google_calendar_agent/agent.js');
        const syncResult = await syncScheduleToCalendar(context, req.user.uid);
        context.schedule.scheduledTasks = syncResult.scheduledTasks;
        syncedCount = syncResult.scheduledTasks?.filter((s) => s.calendarEventId).length ?? 0;
      } catch (calErr) {
        console.warn('[Tasks PATCH /calendar-sync] Calendar sync failed:', calErr.message);
        return res.status(502).json({ error: 'Failed to sync with Google Calendar.' });
      }
    }
    // else: no AI schedule yet (e.g. a manually-created project awaiting
    // "Let AI enhance") — nothing to push to Google Calendar. Just persist
    // the preference below so sync kicks in once a schedule exists.

    context.metadata = context.metadata ?? {};
    context.metadata.calendarSync = enabled;
    context.metadata.updatedAt = new Date().toISOString();

    await doc.ref.set(toFirestoreDocument(context));
    res.json({ success: true, calendarSync: enabled, syncedCount });
  } catch (err) {
    console.error('[Tasks PATCH /calendar-sync]', err);
    res.status(500).json({ error: 'Failed to update calendar sync setting.' });
  }
});

// ── DELETE /api/tasks/:taskId ───────────────────────────────────────────────
// Soft-delete: sets metadata.archived = true instead of permanently removing
// the Firestore document. This preserves historical data for the memory agent
// (which reads task_history, not tasks, but archives retain audit value).
// Google Calendar events ARE deleted on archive — the user no longer needs them.
router.delete('/:taskId', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });

    const context = fromFirestoreDocument(doc.data());
    const eventIds = (context.schedule?.scheduledTasks ?? [])
      .map((s) => s.calendarEventId)
      .filter(Boolean);
    if (eventIds.length) {
      try {
        await deleteCalendarEvents(req.user.uid, eventIds);
      } catch (calErr) {
        console.warn('[Tasks] Calendar cleanup failed (non-fatal):', calErr.message);
      }
    }

    // Soft-delete: mark archived, never physically remove the document.
    // NOTE: dotted keys like 'metadata.archived' are NOT parsed as nested
    // field paths by set() the way they are by update() — passed to
    // set(..., {merge:true}) they create a literal top-level field named
    // "metadata.archived" instead of nesting under metadata, so the real
    // metadata.archived every filter checks never actually gets set. Mutate
    // the already-loaded `context.metadata` object and write it back via
    // toFirestoreDocument() (the same safe round-trip PATCH /calendar-sync
    // and the orchestrator's checkpoint() already use) instead.
    context.metadata = context.metadata ?? {};
    context.metadata.archived = true;
    context.metadata.archivedAt = new Date().toISOString();
    // Ensure it won't appear in the /failed banner after archiving
    context.metadata.pipelineFailed = false;
    await doc.ref.set(toFirestoreDocument(context));

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to archive task' });
  }
});

export default router;