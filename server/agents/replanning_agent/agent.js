/**
 * replanning_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Adaptive replanning agent. Triggered when a task overruns its scheduled
 * time (progress_tracking_agent detects this and calls
 * orchestrator.replanTask(), which loads the PlanningContext and invokes
 * this agent).
 *
 * This agent does NOT make its own LLM calls — it orchestrates other
 * already-existing agents (scheduler_agent, google_calendar_agent,
 * evaluation_benchmark_agent), so it does not go through the standard
 * `runAgent()` 7-step wrapper. It logs itself via the shared logger helpers
 * directly instead.
 *
 * Flow:
 *   1. identifyAffectedTasks()  — delayed task + transitive dependents,
 *                                 minus anything already completed.
 *   2. consumeBuffer()          — absorb the overrun from existing buffer
 *                                 time first (cheapest, least disruptive fix).
 *   3. If buffer is insufficient, re-invoke scheduler_agent.runSchedulerAgent
 *      scoped to just the affected tasks, then merge the resulting slots
 *      back into context.schedule.scheduledTasks — completed tasks and
 *      untouched future tasks keep their original startTime/endTime/
 *      calendarEventId.
 *   4. Protect review/buffer slots at the tail of the plan; only compress
 *      them if there is truly no other option (logged as a warning).
 *   5. computeDisruptionScore() — % of scheduled tasks whose start/end
 *      changed.
 *   6. Best-effort Google Calendar re-sync: delete stale events for
 *      rescheduled tasks, recreate via syncScheduleToCalendar().
 *   7. Best-effort evaluation_benchmark_agent snapshot.
 *
 * Reads:  context.planning, context.dependency, context.schedule
 * Writes: context.schedule (scheduledTasks / bufferSlots), context.metadata
 *         (observability log)
 */

import { createAgentLog, completeAgentLog, attachToContext } from '../shared/logger.js';
import { runSchedulerAgent, FIRST_TASK_DELAY_MINUTES } from '../scheduler_agent/agent.js';
import { getFreeBusy, deleteCalendarEvents, syncScheduleToCalendar } from '../google_calendar_agent/agent.js';
import { recordBenchmarkSnapshot } from '../evaluation_benchmark_agent/agent.js';

const AGENT_NAME = 'replanning_agent';
// No distinct SSE agent name exists for replanning in the plan's agent list —
// replanning is conceptually a scheduler re-run, so the 'scheduler' SSE
// channel is reused (see implementation_plan.md's SSE agent name table).
const SSE_NAME = 'scheduler';
const PROMPT_VERSION = 'n/a'; // no prompt — this agent is pure orchestration

// ═════════════════════════════════════════════════════════════════════════
// Pure, deterministic helpers (unit-tested, no network/LLM/Firestore access)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Identify every task affected by a delay: the delayed task itself plus all
 * of its transitive dependents (tasks whose dependency chain leads back to
 * it), excluding any task already marked `progress.status === 'completed'`.
 *
 * Prefers `context.dependency.dependencyGraph.edges` (each `{from, to}` edge
 * means `from` is a dependency of `to`, i.e. `from` must finish before `to`
 * can start — the exact convention produced by dependency_analysis_agent).
 * Falls back to the raw `context.planning.tasks[].dependencies` arrays when
 * no dependency graph has been computed yet.
 *
 * @param {object} context - PlanningContext
 * @param {string} delayedTaskId
 * @returns {string[]} affected task ids (delayed task included, completed tasks excluded)
 */
export function identifyAffectedTasks(context, delayedTaskId) {
    if (!delayedTaskId) return [];

    const tasks = context?.planning?.tasks ?? [];
    const taskById = new Map(tasks.map(t => [t.taskId, t]));

    // Build a "dependents" adjacency map: taskId -> [ids that depend on it].
    const dependentsMap = new Map();
    const edges = context?.dependency?.dependencyGraph?.edges;

    if (Array.isArray(edges) && edges.length > 0) {
        for (const e of edges) {
            if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
            if (!dependentsMap.has(e.from)) dependentsMap.set(e.from, []);
            dependentsMap.get(e.from).push(e.to);
        }
    } else {
        for (const t of tasks) {
            for (const dep of t.dependencies ?? []) {
                if (!dependentsMap.has(dep)) dependentsMap.set(dep, []);
                dependentsMap.get(dep).push(t.taskId);
            }
        }
    }

    // BFS from the delayed task, following "depends on me" edges forward.
    const visited = new Set();
    const queue = [delayedTaskId];
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        for (const next of dependentsMap.get(current) ?? []) {
            if (!visited.has(next)) queue.push(next);
        }
    }

    return Array.from(visited).filter(id => {
        const task = taskById.get(id);
        return task ? task.progress?.status !== 'completed' : true;
    });
}

/**
 * Consume up to `overrunMinutes` of slack from the plan's existing buffer
 * time, earliest slot first. Buffer time may live in two places:
 *   - `context.schedule.bufferSlots[]`  — explicit { startTime, endTime, durationMinutes }
 *   - `context.schedule.scheduledTasks[]` entries flagged `isBuffer: true`
 * Pure/read-only — does not mutate `context`; the caller applies the
 * resulting consumption.
 *
 * @param {object} context - PlanningContext
 * @param {number} overrunMinutes
 * @returns {{ remainingOverrunMinutes: number, consumedSlots: Array<object> }}
 */
export function consumeBuffer(context, overrunMinutes) {
    let remaining = Math.max(0, overrunMinutes ?? 0);
    const consumedSlots = [];
    if (remaining <= 0) return { remainingOverrunMinutes: 0, consumedSlots };

    const explicitBufferSlots = Array.isArray(context?.schedule?.bufferSlots)
        ? context.schedule.bufferSlots.map(s => ({
            source: 'bufferSlots',
            taskId: s.taskId ?? null,
            startTime: s.startTime,
            endTime: s.endTime,
            durationMinutes: typeof s.durationMinutes === 'number'
                ? s.durationMinutes
                : Math.max(0, (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60_000),
        }))
        : [];

    const bufferTaskSlots = Array.isArray(context?.schedule?.scheduledTasks)
        ? context.schedule.scheduledTasks
            .filter(t => t?.isBuffer)
            .map(t => ({
                source: 'scheduledTasks',
                taskId: t.taskId,
                startTime: t.startTime,
                endTime: t.endTime,
                durationMinutes: Math.max(0, (new Date(t.endTime).getTime() - new Date(t.startTime).getTime()) / 60_000),
            }))
        : [];

    const candidates = [...explicitBufferSlots, ...bufferTaskSlots]
        .filter(s => s.startTime && s.endTime && s.durationMinutes > 0)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    for (const slot of candidates) {
        if (remaining <= 0) break;
        const consumedMinutes = Math.min(remaining, slot.durationMinutes);
        consumedSlots.push({ ...slot, consumedMinutes });
        remaining -= consumedMinutes;
    }

    return { remainingOverrunMinutes: remaining, consumedSlots };
}

/**
 * % (0-100) of scheduled tasks whose startTime and/or endTime changed
 * between the original and new schedule. Tasks present in only one of the
 * two lists (added/removed) count as changed.
 *
 * @param {Array<{taskId:string, startTime:string, endTime:string}>} originalScheduledTasks
 * @param {Array<{taskId:string, startTime:string, endTime:string}>} newScheduledTasks
 * @returns {number} 0-100
 */
export function computeDisruptionScore(originalScheduledTasks, newScheduledTasks) {
    const originals = Array.isArray(originalScheduledTasks) ? originalScheduledTasks : [];
    const news = Array.isArray(newScheduledTasks) ? newScheduledTasks : [];

    const originalById = new Map(originals.map(t => [t.taskId, t]));
    const newById = new Map(news.map(t => [t.taskId, t]));

    const allIds = new Set([...originalById.keys(), ...newById.keys()]);
    if (allIds.size === 0) return 0;

    let changedCount = 0;
    for (const id of allIds) {
        const o = originalById.get(id);
        const n = newById.get(id);
        if (!o || !n) { changedCount++; continue; }
        if (o.startTime !== n.startTime || o.endTime !== n.endTime) changedCount++;
    }

    return Math.round((changedCount / allIds.size) * 100);
}

// ═════════════════════════════════════════════════════════════════════════
// Internal (non-exported) mutation helpers used by runReplanningAgent
// ═════════════════════════════════════════════════════════════════════════

/**
 * Apply the buffer consumption computed by consumeBuffer() back onto
 * context.schedule — shrinking or removing the consumed slots.
 * @param {object} context
 * @param {Array<object>} consumedSlots
 */
function applyBufferConsumption(context, consumedSlots) {
    if (!context?.schedule || !Array.isArray(consumedSlots) || consumedSlots.length === 0) return;

    for (const consumed of consumedSlots) {
        const isFull = consumed.consumedMinutes >= consumed.durationMinutes;

        if (consumed.source === 'bufferSlots' && Array.isArray(context.schedule.bufferSlots)) {
            const idx = context.schedule.bufferSlots.findIndex(
                s => s.startTime === consumed.startTime && s.endTime === consumed.endTime,
            );
            if (idx === -1) continue;
            if (isFull) {
                context.schedule.bufferSlots.splice(idx, 1);
            } else {
                const slot = context.schedule.bufferSlots[idx];
                const newStart = new Date(new Date(slot.startTime).getTime() + consumed.consumedMinutes * 60_000);
                slot.startTime = newStart.toISOString();
                slot.durationMinutes = (typeof slot.durationMinutes === 'number' ? slot.durationMinutes : consumed.durationMinutes) - consumed.consumedMinutes;
            }
        } else if (consumed.source === 'scheduledTasks' && Array.isArray(context.schedule.scheduledTasks)) {
            const idx = context.schedule.scheduledTasks.findIndex(t => t.taskId === consumed.taskId);
            if (idx === -1) continue;
            if (isFull) {
                context.schedule.scheduledTasks.splice(idx, 1);
            } else {
                const task = context.schedule.scheduledTasks[idx];
                const newStart = new Date(new Date(task.startTime).getTime() + consumed.consumedMinutes * 60_000);
                task.startTime = newStart.toISOString();
            }
        }
    }
}

/**
 * Re-invoke scheduler_agent scoped to just the affected task ids, anchored
 * just after the delayed task's (now-overrun) finish time, then merge the
 * resulting slots back into context.schedule.scheduledTasks. Slots for
 * tasks outside the affected set — completed tasks and untouched future
 * tasks — are left byte-for-byte unchanged.
 *
 * @param {object} context
 * @param {object} clients
 * @param {string[]} affectedTaskIds
 * @param {string} delayedTaskId
 * @param {number} remainingOverrunMinutes
 * @param {object|null} eventBus
 * @param {function|null} sseEmit
 * @param {string[]} warnings - mutated in place
 */
async function rescheduleAffectedTasks(context, clients, affectedTaskIds, delayedTaskId, remainingOverrunMinutes, eventBus, sseEmit, warnings) {
    const affectedSet = new Set(affectedTaskIds);
    const allPlanningTasks = context?.planning?.tasks ?? [];
    const affectedTasks = allPlanningTasks.filter(t => affectedSet.has(t.taskId));
    if (affectedTasks.length === 0) return;

    const existingSlots = context?.schedule?.scheduledTasks ?? [];
    const delayedSlot = existingSlots.find(s => s.taskId === delayedTaskId);

    const now = new Date();
    let anchor = now;
    if (delayedSlot?.endTime) {
        const delayedEnd = new Date(delayedSlot.endTime);
        if (delayedEnd > anchor) anchor = delayedEnd;
    }
    // buildScheduleSkeleton adds FIRST_TASK_DELAY_MINUTES on top of
    // metadata.createdAt, so back that off here to avoid double-counting it.
    const reducedCreatedAt = new Date(anchor.getTime() - FIRST_TASK_DELAY_MINUTES * 60_000);

    const reducedContext = {
        ...context,
        planning: { ...context.planning, tasks: affectedTasks },
        metadata: { ...context.metadata, createdAt: reducedCreatedAt.toISOString() },
    };

    let busySlots = [];
    try {
        const farFuture = new Date(anchor.getTime() + 30 * 24 * 3_600_000);
        busySlots = await getFreeBusy(context.userId, anchor.toISOString(), farFuture.toISOString());
    } catch (err) {
        warnings.push(`Could not fetch calendar free/busy for replanning (non-fatal): ${err?.message?.slice(0, 150)}`);
    }

    let reducedResult;
    try {
        reducedResult = await runSchedulerAgent(reducedContext, clients, eventBus, sseEmit, busySlots);
    } catch (err) {
        warnings.push(`Scheduler re-invocation for affected tasks failed, keeping prior slots for those tasks: ${err?.message?.slice(0, 150)}`);
        return;
    }

    const newSlotsForAffected = Array.isArray(reducedResult?.scheduledTasks) ? reducedResult.scheduledTasks : [];
    if (newSlotsForAffected.length === 0) {
        if (Array.isArray(reducedResult?.warnings) && reducedResult.warnings.length > 0) {
            warnings.push(...reducedResult.warnings);
        }
        return;
    }

    const mergedById = new Map(existingSlots.map(s => [s.taskId, s]));
    for (const slot of newSlotsForAffected) {
        mergedById.set(slot.taskId, slot);
    }

    if (!context.schedule) context.schedule = {};
    context.schedule.scheduledTasks = Array.from(mergedById.values());
    if (typeof reducedResult.schedulingScore === 'number') {
        context.schedule.schedulingScore = reducedResult.schedulingScore;
    }
    if (Array.isArray(reducedResult.warnings) && reducedResult.warnings.length > 0) {
        warnings.push(...reducedResult.warnings);
    }
    if (remainingOverrunMinutes > 0) {
        warnings.push(`Rescheduled ${newSlotsForAffected.length} affected task(s) — buffer alone could not absorb the remaining ${remainingOverrunMinutes}m overrun.`);
    }
}

/**
 * Only compress review/buffer slots if there was truly no other option —
 * detect and warn about it rather than silently shrinking protected time.
 * @param {Array<object>} originalScheduledTasks
 * @param {Array<object>} newScheduledTasks
 * @param {string[]} warnings - mutated in place
 */
function protectTailSlots(originalScheduledTasks, newScheduledTasks, warnings) {
    const originalById = new Map((originalScheduledTasks ?? []).map(t => [t.taskId, t]));
    for (const t of newScheduledTasks ?? []) {
        if (!t?.isReview && !t?.isBuffer) continue;
        const orig = originalById.get(t.taskId);
        if (!orig) continue;

        const origDuration = new Date(orig.endTime).getTime() - new Date(orig.startTime).getTime();
        const newDuration = new Date(t.endTime).getTime() - new Date(t.startTime).getTime();
        if (Number.isFinite(origDuration) && Number.isFinite(newDuration) && newDuration < origDuration) {
            const kind = t.isReview ? 'review' : 'buffer';
            warnings.push(
                `Compressed ${kind} slot for task ${t.taskId} from ${Math.round(origDuration / 60_000)}m to ${Math.round(newDuration / 60_000)}m — no other option was available to absorb the delay.`,
            );
        }
    }
}

/**
 * Best-effort Google Calendar re-sync for tasks whose start/end changed:
 * delete the stale event, clear its calendarEventId so
 * syncScheduleToCalendar() recreates it. Never throws — calendar failures
 * must not block replanning.
 * @param {object} context
 * @param {string} userId
 * @param {Array<object>} originalScheduledTasks
 * @param {Array<object>} newScheduledTasks
 * @param {string[]} warnings - mutated in place
 */
async function resyncCalendar(context, userId, originalScheduledTasks, newScheduledTasks, warnings) {
    try {
        const originalById = new Map((originalScheduledTasks ?? []).map(t => [t.taskId, t]));
        const staleEventIds = [];

        for (const t of newScheduledTasks ?? []) {
            const orig = originalById.get(t.taskId);
            const changed = !orig || orig.startTime !== t.startTime || orig.endTime !== t.endTime;
            if (changed && orig?.calendarEventId) {
                staleEventIds.push(orig.calendarEventId);
                t.calendarEventId = null;
                t.calendarLabel = null;
            }
        }

        if (staleEventIds.length === 0) return;

        await deleteCalendarEvents(userId, staleEventIds);
        const syncResult = await syncScheduleToCalendar(context, userId);

        if (context.schedule && Array.isArray(syncResult?.scheduledTasks)) {
            context.schedule.scheduledTasks = syncResult.scheduledTasks;
        }
        if (Array.isArray(syncResult?.warnings) && syncResult.warnings.length > 0) {
            warnings.push(...syncResult.warnings);
        }
    } catch (err) {
        warnings.push(`Calendar re-sync skipped (non-fatal): ${err?.message?.slice(0, 150)}`);
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Main agent entry point
// ═════════════════════════════════════════════════════════════════════════

/**
 * Run the Replanning Agent.
 *
 * Reads:  context.planning, context.dependency, context.schedule
 * Writes: context.schedule (in place)
 *
 * @param {object} context - PlanningContext
 * @param {object} clients - LLM clients { pro, flash, embedding } — forwarded to scheduler_agent
 * @param {string} userId
 * @param {object|null} [eventBus]
 * @param {function|null} [sseEmit]
 * @param {{delayedTaskId: string, overrunMinutes: number}} opts
 * @returns {Promise<{ context: object, disruptionScore: number, affectedTaskIds: string[], warnings: string[] }>}
 */
export async function runReplanningAgent(context, clients, userId, eventBus = null, sseEmit = null, { delayedTaskId, overrunMinutes = 0 } = {}) {
    const log = createAgentLog(AGENT_NAME, PROMPT_VERSION);
    const warnings = [];

    eventBus?.agentStart?.(AGENT_NAME, `Replanning triggered by a ${overrunMinutes}m overrun on task ${delayedTaskId}`);
    sseEmit?.(SSE_NAME, 'thinking', `Re-optimizing schedule after a ${overrunMinutes}-minute delay...`, null);

    try {
        if (!delayedTaskId) {
            throw new Error('runReplanningAgent requires opts.delayedTaskId');
        }
        if (!context.schedule) context.schedule = { scheduledTasks: [], bufferSlots: [] };
        if (!Array.isArray(context.schedule.scheduledTasks)) context.schedule.scheduledTasks = [];

        const originalScheduledTasks = JSON.parse(JSON.stringify(context.schedule.scheduledTasks));

        // ── Step 1: identify affected tasks ──────────────────────────────────
        const affectedTaskIds = identifyAffectedTasks(context, delayedTaskId);

        // Reflect the actual overrun on the delayed task's own slot, if any.
        const delayedSlot = context.schedule.scheduledTasks.find(s => s.taskId === delayedTaskId);
        if (delayedSlot && overrunMinutes > 0) {
            const newEnd = new Date(new Date(delayedSlot.endTime).getTime() + overrunMinutes * 60_000);
            delayedSlot.endTime = newEnd.toISOString();
        }

        // ── Step 2: consume existing buffer time first ───────────────────────
        const { remainingOverrunMinutes, consumedSlots } = consumeBuffer(context, overrunMinutes);
        applyBufferConsumption(context, consumedSlots);
        if (consumedSlots.length > 0) {
            warnings.push(`Absorbed ${overrunMinutes - remainingOverrunMinutes}m of the ${overrunMinutes}m overrun using existing buffer time.`);
        }

        // ── Step 3: buffer insufficient — re-invoke scheduler on the ─────────
        //           affected subset only, merging results back in.
        if (remainingOverrunMinutes > 0 && affectedTaskIds.length > 0) {
            await rescheduleAffectedTasks(context, clients, affectedTaskIds, delayedTaskId, remainingOverrunMinutes, eventBus, sseEmit, warnings);
        }

        const newScheduledTasks = context.schedule.scheduledTasks;

        // ── Step 4: protect review/buffer slots ──────────────────────────────
        protectTailSlots(originalScheduledTasks, newScheduledTasks, warnings);

        // ── Step 5: disruption score ──────────────────────────────────────────
        const disruptionScore = computeDisruptionScore(originalScheduledTasks, newScheduledTasks);

        // ── Step 6: Google Calendar re-sync (best-effort, non-fatal) ─────────
        await resyncCalendar(context, userId, originalScheduledTasks, newScheduledTasks, warnings);

        // ── Step 7: benchmark snapshot (best-effort, non-fatal) ───────────────
        try {
            await recordBenchmarkSnapshot(context, {}, eventBus, sseEmit);
        } catch (err) {
            warnings.push(`Benchmark snapshot skipped (non-fatal): ${err?.message?.slice(0, 150)}`);
        }

        completeAgentLog(log, {
            status: 'success',
            confidence: remainingOverrunMinutes > 0 ? 0.75 : 0.95,
        });
        attachToContext(context, log);

        const summary = `Replanning complete — ${disruptionScore}% of the schedule affected (${affectedTaskIds.length} task(s)).`;
        eventBus?.agentComplete?.(AGENT_NAME, summary, { disruptionScore, affectedTaskIds });
        sseEmit?.(SSE_NAME, 'done', summary, { disruptionScore, affectedTaskIds, warnings });

        return { context, disruptionScore, affectedTaskIds, warnings };
    } catch (err) {
        completeAgentLog(log, { status: 'failed', errors: [err?.message ?? 'Unknown error'] });
        attachToContext(context, log);

        eventBus?.agentError?.(AGENT_NAME, err, `Replanning failed: ${err?.message}`);
        sseEmit?.(SSE_NAME, 'error', `Replanning failed: ${err?.message?.slice(0, 150)}`, null);

        throw err;
    }
}
