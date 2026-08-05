/**
 * progress_tracking_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Refactor of the legacy `server/agents/monitorAgent.js` ("Monitor & Re-Planner
 * Agent") onto the PlanningContext / 5-level hierarchy introduced in
 * `contextManager.js`. Deterministic — no LLM calls.
 *
 * The Firestore `tasks/{taskId}` document now stores a full serialized
 * PlanningContext (see contextManager.js `toFirestoreDocument`/
 * `fromFirestoreDocument`) instead of the old flat `{ subtasks: [...] }`
 * shape. This agent:
 *   - reconstructs the PlanningContext from the Firestore doc,
 *   - operates on `context.planning.tasks[]` (each a full task workspace with
 *     `progress: { status, completedAt, actualMinutes }`) and
 *     `context.schedule.scheduledTasks[]` (each a schedule slot with
 *     `startTime`/`endTime` — the new equivalents of the old flat
 *     `subtask.scheduledStart`/`subtask.scheduledEnd`),
 *   - persists the mutated context back via `toFirestoreDocument`.
 *
 * Preserved from the legacy file:
 *   - `computeLiveRiskScore()` risk formula (gap between time-progress and
 *     task-progress, deadline-proximity boosts, overdue-slot penalty).
 *   - Status transitions and the escalation/auto-replan threshold
 *     (`riskScore >= 80 && hoursLeft > 1 && rePlannedCount < 3`).
 *
 * New in this refactor (per implementation_plan.md):
 *   - Actual vs. estimated tracking per task (`computeActualVsEstimated`).
 *   - Trailing 7-day daily completion rates (`computeDailyCompletionRates`).
 *   - Productivity trend via simple linear regression
 *     (`linearRegressionSlope`, `computeProductivityTrend`).
 *   - Delay probability heuristic (`computeDelayProbability`).
 *   - Focus time tracking (`computeFocusMinutesLast7Days`).
 *
 * This agent intentionally does NOT import `replanning_agent` — doing so
 * would create a circular concern between "detecting risk" and "acting on
 * risk". Instead it flags `escalate: true` on its result and pushes a
 * warning to `context.metadata.warnings`; the orchestrator/route layer is
 * responsible for invoking the replanning agent when it sees the flag.
 */

import './schema.js'; // registers the v1.0.0 schema
import { db } from '../../config/firebase.js';
import { fromFirestoreDocument, toFirestoreDocument, writeNamespace, toTaskHistoryEntry } from '../contextManager.js';
import { validateAgentOutput } from '../shared/validator.js';
import { eventBus } from '../eventBus.js';

const AGENT_NAME = 'progress_tracking_agent';
const SCHEMA_VERSION = '1.0.0';

/** Risk threshold at/above which an auto-replan should be triggered. */
export const ESCALATION_RISK_THRESHOLD = 80;
/** Max number of automatic re-plans allowed per task (mirrors legacy monitorAgent.js). */
export const MAX_REPLAN_COUNT = 3;
/** Risk threshold at/above which overall status becomes 'at_risk'. */
export const AT_RISK_THRESHOLD = 70;

// ─────────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveDeadline(context) {
    const deadlineStr = context?.intent?.deadline ?? context?.explicitDeadline ?? null;
    if (!deadlineStr) return null;
    const d = new Date(deadlineStr);
    return Number.isNaN(d.getTime()) ? null : d;
}

function pushWarningOnce(context, message) {
    if (!context.metadata) context.metadata = { warnings: [] };
    if (!Array.isArray(context.metadata.warnings)) context.metadata.warnings = [];
    if (!context.metadata.warnings.includes(message)) {
        context.metadata.warnings.push(message);
    }
}

function taskLabel(context) {
    return context?.intent?.title ?? context?.rawGoal?.slice?.(0, 50) ?? context?.taskId ?? 'task';
}

/**
 * Coerce a value to a finite number, or `null` if it isn't one.
 * Deliberately stricter than `Number.isFinite(Number(v))` — that pattern
 * treats `null`/`''`/`[]` as `0` (since `Number(null) === 0`), which silently
 * turns "unknown" into "zero" for fields like `progress.actualMinutes`.
 * @param {*} v
 * @returns {number|null}
 */
function toFiniteNumberOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeLiveRiskScore — ported from legacy monitorAgent.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a live risk score (0-100) for a PlanningContext based on current
 * progress. Pure function — no I/O.
 *
 * Ported formula from legacy `monitorAgent.js#computeLiveRiskScore(task)`:
 *   - timeProgress = elapsed / totalTime (0→1 as deadline approaches)
 *   - taskProgress = completedTasks / totalTasks
 *   - gap = timeProgress - taskProgress; risk = round(gap * 120)
 *   - boosted to >=90 if <2h left and not done; >=75 if <6h left and <50% done
 *   - +15 per overdue (unfinished, schedule slot end already passed) task
 *   - clamped to [0, 100]
 *
 * Field mapping vs. the legacy flat shape:
 *   old `task.subtasks[]`            -> `context.planning.tasks[]`
 *   old `subtask.completed`          -> `task.progress.status === 'completed'`
 *   old `subtask.scheduledEnd`       -> schedule slot (by taskId) `.endTime`
 *   old `task.createdAt`             -> `context.metadata.createdAt`
 *   old `task.deadline`              -> `context.intent.deadline ?? context.explicitDeadline`
 *
 * @param {object} context - PlanningContext
 * @returns {number} risk score 0-100
 */
export function computeLiveRiskScore(context) {
    const now = Date.now();
    const tasks = context?.planning?.tasks ?? [];
    const scheduledTasks = context?.schedule?.scheduledTasks ?? [];
    const slotByTaskId = new Map(scheduledTasks.filter(s => s?.taskId).map(s => [s.taskId, s]));

    const overdueCount = tasks.filter(t => {
        if (t?.progress?.status === 'completed') return false;
        const slot = slotByTaskId.get(t.taskId);
        if (!slot?.endTime) return false;
        const end = new Date(slot.endTime).getTime();
        return !Number.isNaN(end) && end < now;
    }).length;

    const deadline = resolveDeadline(context);

    if (!deadline) {
        // Legacy file always assumed a deadline was present. Without one there
        // is no time-progress-vs-task-progress gap to measure — fall back to
        // a smaller, overdue-slot-only signal so risk is never entirely blind.
        return Math.min(100, overdueCount * 20);
    }

    const createdStr = context?.metadata?.createdAt ?? null;
    const created = createdStr ? new Date(createdStr).getTime() : now - 3600000;
    const deadlineMs = deadline.getTime();

    const totalTime = deadlineMs - created;
    const elapsed = now - created;
    const timeProgress = totalTime > 0 ? Math.min(1, Math.max(0, elapsed / totalTime)) : 1;

    const completed = tasks.filter(t => t?.progress?.status === 'completed').length;
    const taskProgress = tasks.length > 0 ? completed / tasks.length : 0;

    const gap = timeProgress - taskProgress;
    let risk = Math.round(gap * 120);

    const hoursLeft = (deadlineMs - now) / 3600000;
    if (hoursLeft < 2 && taskProgress < 1) risk = Math.max(risk, 90);
    else if (hoursLeft < 6 && taskProgress < 0.5) risk = Math.max(risk, 75);

    risk += overdueCount * 15;

    return Math.min(100, Math.max(0, risk));
}

// ─────────────────────────────────────────────────────────────────────────────
// linearRegressionSlope — small pure stats helper (no external dependency)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordinary-least-squares slope over a set of points.
 * Accepts either an array of numbers (treated as y-values with x = index)
 * or an array of `{ x, y }` objects.
 *
 * @param {(number|{x:number,y:number})[]} points
 * @returns {number} slope (0 if fewer than 2 points or degenerate x-spread)
 */
export function linearRegressionSlope(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;

    const pts = points.map((p, i) =>
        typeof p === 'number' ? { x: i, y: p } : { x: Number(p?.x), y: Number(p?.y) }
    ).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

    const n = pts.length;
    if (n < 2) return 0;

    const sumX = pts.reduce((a, p) => a + p.x, 0);
    const sumY = pts.reduce((a, p) => a + p.y, 0);
    const sumXY = pts.reduce((a, p) => a + p.x * p.y, 0);
    const sumXX = pts.reduce((a, p) => a + p.x * p.x, 0);

    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return 0;

    return (n * sumXY - sumX * sumY) / denom;
}

// ─────────────────────────────────────────────────────────────────────────────
// New analytics: daily completion rates / productivity trend / delay / focus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trailing-N-day (default 7) completion counts, grouped by UTC calendar day.
 * Always returns exactly `days` entries (oldest -> newest), zero-filled.
 * Pure function — no I/O.
 *
 * @param {object} context
 * @param {number} [days]
 * @returns {{date:string,count:number}[]}
 */
export function computeDailyCompletionRates(context, days = 7) {
    const tasks = context?.planning?.tasks ?? [];
    const now = new Date();

    const dayKeys = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        dayKeys.push(d.toISOString().slice(0, 10));
    }

    const counts = Object.fromEntries(dayKeys.map(k => [k, 0]));
    for (const t of tasks) {
        if (t?.progress?.status !== 'completed' || !t.progress.completedAt) continue;
        const completedAt = new Date(t.progress.completedAt);
        if (Number.isNaN(completedAt.getTime())) continue;
        const key = completedAt.toISOString().slice(0, 10);
        if (key in counts) counts[key] += 1;
    }

    return dayKeys.map(date => ({ date, count: counts[date] }));
}

/**
 * Productivity trend: OLS slope of the trailing daily-completion counts,
 * labeled 'improving' / 'declining' / 'stable'. Pure function.
 *
 * @param {{date:string,count:number}[]} dailyCompletionRates
 * @returns {{slope:number, label:'improving'|'declining'|'stable'}}
 */
export function computeProductivityTrend(dailyCompletionRates) {
    const counts = (dailyCompletionRates ?? []).map(d => d.count);
    const rawSlope = linearRegressionSlope(counts);
    const slope = Math.round(rawSlope * 1000) / 1000;

    let label = 'stable';
    if (slope > 0.05) label = 'improving';
    else if (slope < -0.05) label = 'declining';

    return { slope, label };
}

/**
 * Sum of `progress.actualMinutes` for tasks completed within the trailing
 * `days` (default 7) days. Pure function.
 *
 * @param {object} context
 * @param {number} [days]
 * @returns {number}
 */
export function computeFocusMinutesLast7Days(context, days = 7) {
    const tasks = context?.planning?.tasks ?? [];
    const cutoff = Date.now() - days * 24 * 3600 * 1000;

    return tasks.reduce((sum, t) => {
        if (t?.progress?.status !== 'completed' || !t.progress.completedAt) return sum;
        const completedAt = new Date(t.progress.completedAt).getTime();
        if (Number.isNaN(completedAt) || completedAt < cutoff) return sum;
        return sum + (toFiniteNumberOrNull(t.progress.actualMinutes) ?? 0);
    }, 0);
}

/**
 * Heuristic probability [0,1] that the remaining work will not finish by the
 * deadline, based on the average overrun (actual - estimated minutes) of
 * already-completed tasks projected across the remaining tasks, compared
 * against the actual time left. Pure function.
 *
 * @param {object} context
 * @returns {number} 0-1
 */
export function computeDelayProbability(context) {
    const tasks = context?.planning?.tasks ?? [];
    const remaining = tasks.filter(t => t?.progress?.status !== 'completed');
    if (remaining.length === 0) return 0;

    const deadline = resolveDeadline(context);
    if (!deadline) return 0;

    const completed = tasks.filter(t => t?.progress?.status === 'completed');
    const delays = completed
        .map(t => {
            const est = toFiniteNumberOrNull(t.estimatedMinutes);
            const act = toFiniteNumberOrNull(t?.progress?.actualMinutes);
            return est !== null && act !== null ? act - est : null;
        })
        .filter(v => v !== null);

    const avgDelayMinutes = delays.length > 0 ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;

    const remainingEstimateMinutes = remaining.reduce((sum, t) => {
        return sum + (toFiniteNumberOrNull(t.estimatedMinutes) ?? 0);
    }, 0);

    const projectedMinutes = remainingEstimateMinutes + Math.max(0, avgDelayMinutes) * remaining.length;
    const availableMinutes = Math.max(0, (deadline.getTime() - Date.now()) / 60000);

    if (projectedMinutes <= 0) return 0;
    if (availableMinutes <= 0) return 1;

    const ratio = projectedMinutes / availableMinutes;
    const probability = Math.min(1, Math.max(0, ratio - 1));
    return Math.round(probability * 1000) / 1000;
}

/**
 * Per-task actual-vs-estimated breakdown. Pure function.
 * @param {object} context
 * @returns {{taskId:string,title:string,estimatedMinutes:number|null,actualMinutes:number|null,status:string,deltaMinutes:number|null}[]}
 */
export function computeActualVsEstimated(context) {
    const tasks = context?.planning?.tasks ?? [];
    return tasks.map(t => {
        const estimatedMinutes = toFiniteNumberOrNull(t.estimatedMinutes);
        const actualMinutes = toFiniteNumberOrNull(t?.progress?.actualMinutes);
        return {
            taskId: t.taskId,
            title: t.title,
            estimatedMinutes,
            actualMinutes,
            status: t?.progress?.status ?? 'not_started',
            deltaMinutes: estimatedMinutes !== null && actualMinutes !== null ? actualMinutes - estimatedMinutes : null,
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// reassessTask — shared core used by both checkSingleTask() and runProgressCron()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recompute status/risk/analytics for a PlanningContext and write the result
 * into `context.progressTracking`. Pure with respect to I/O (no Firestore
 * calls) — mutates the given `context` object in place (auto status
 * transitions + warnings) and returns the per-task-check result matching
 * the `progress_tracking_agent` v1.0.0 schema.
 *
 * Status transitions applied here:
 *   - leaf task `progress.status`: 'not_started' -> 'in_progress' once its
 *     scheduled slot start time has passed (schema only allows
 *     not_started|in_progress|completed at the leaf level — see
 *     contextManager.js task workspace schema).
 *   - overall project `status` (returned, not written to a leaf task):
 *     'completed' | 'overdue' | 'at_risk' | 'in_progress' | 'not_started'
 *     (mirrors legacy monitorAgent.js's active/completed/overdue/at_risk
 *     states, adapted to the 3-value leaf enum for progress.status).
 *
 * Escalation (ported from legacy monitorAgent.js):
 *   riskScore >= ESCALATION_RISK_THRESHOLD (80) && hoursLeft > 1 &&
 *   rePlannedCount < MAX_REPLAN_COUNT (3) => escalate: true.
 *   `rePlannedCount` is read from `context.metadata.revisionCount` — the
 *   same field `contextManager.toClientTask()` already surfaces as
 *   `rePlannedCount` for the client.
 *
 * @param {object} context - PlanningContext (mutated in place)
 * @returns {object} result matching progress_tracking_agent schema v1.0.0
 */
export function reassessTask(context) {
    const now = new Date();
    const tasks = context?.planning?.tasks ?? [];
    const scheduledTasks = context?.schedule?.scheduledTasks ?? [];
    const slotByTaskId = new Map(scheduledTasks.filter(s => s?.taskId).map(s => [s.taskId, s]));

    // ── Auto status transition: not_started -> in_progress ──────────────────
    for (const t of tasks) {
        if (!t.progress) {
            t.progress = { status: 'not_started', completedAt: null, actualMinutes: null };
        }
        if (t.progress.status === 'not_started') {
            const slot = slotByTaskId.get(t.taskId);
            if (slot?.startTime) {
                const start = new Date(slot.startTime).getTime();
                if (!Number.isNaN(start) && start <= now.getTime()) {
                    t.progress.status = 'in_progress';
                }
            }
        }
    }

    const riskScore = computeLiveRiskScore(context);
    const deadline = resolveDeadline(context);
    const hoursLeft = deadline ? (deadline.getTime() - now.getTime()) / 3600000 : null;

    const allDone = tasks.length > 0 && tasks.every(t => t.progress?.status === 'completed');
    const anyInProgress = tasks.some(t => t.progress?.status === 'in_progress');

    let status;
    if (allDone) status = 'completed';
    else if (hoursLeft !== null && hoursLeft <= 0) status = 'overdue';
    else if (riskScore >= AT_RISK_THRESHOLD) status = 'at_risk';
    else if (anyInProgress) status = 'in_progress';
    else status = 'not_started';

    // ── Escalation: risk-based auto-replan trigger ───────────────────────────
    const rePlannedCount = context?.metadata?.revisionCount ?? 0;
    const escalate = Boolean(
        riskScore >= ESCALATION_RISK_THRESHOLD &&
        !allDone &&
        hoursLeft !== null &&
        hoursLeft > 1 &&
        rePlannedCount < MAX_REPLAN_COUNT
    );

    if (escalate) {
        pushWarningOnce(
            context,
            `ESCALATION: risk score ${riskScore} for "${taskLabel(context)}" — replanning recommended (rePlannedCount ${rePlannedCount}/${MAX_REPLAN_COUNT}).`
        );
    }

    // ── Deadline-proximity warning (ported from legacy runMonitorAgent) ──────
    if (!allDone && hoursLeft !== null && hoursLeft > 0 && hoursLeft < 2) {
        pushWarningOnce(
            context,
            `Only ${Math.round(hoursLeft * 60)} minutes until deadline for "${taskLabel(context)}"!`
        );
    }

    const dailyCompletionRates = computeDailyCompletionRates(context, 7);
    const productivityTrend = computeProductivityTrend(dailyCompletionRates);
    const delayProbability = computeDelayProbability(context);
    const focusMinutesLast7Days = computeFocusMinutesLast7Days(context, 7);
    const taskPerformance = computeActualVsEstimated(context);

    const result = {
        taskId: context.taskId,
        status,
        riskScore,
        escalate,
        dailyCompletionRates,
        productivityTrend,
        delayProbability,
        focusMinutesLast7Days,
        // Additive, non-schema fields:
        taskPerformance,
        // Backward-compat aliases for the (not-yet-migrated) legacy route
        // shape `{ replanTriggered, newRiskScore }` returned by the old
        // `checkSingleTask()` — see server/routes/tasks.js.
        replanTriggered: escalate,
        newRiskScore: riskScore,
    };

    const validation = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, result);
    if (!validation.valid) {
        console.warn(`[${AGENT_NAME}] Output failed schema validation: ${validation.errors.join('; ')}`);
        pushWarningOnce(context, `${AGENT_NAME}: schema validation errors: ${validation.errors.join('; ')}`);
    }

    writeNamespace(context, 'progressTracking', result);

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// checkSingleTask — called when a subtask/task is marked complete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a task doc, optionally mark one leaf task's progress complete, then
 * reassess risk/status and persist. Ported from legacy monitorAgent.js's
 * `checkSingleTask(taskId, userId)`, extended with an explicit `subtaskId`
 * (the new nested schema means there is no longer a flat `subtasks[]` array
 * for the route layer to mutate directly — that responsibility now lives
 * here) and an optional `actualMinutes` override.
 *
 * Call-site compatibility: `server/routes/tasks.js`'s
 * `PATCH /:taskId/subtask/:subtaskId/complete` currently (pre-migration)
 * mutates `task.subtasks` itself and calls the legacy
 * `checkSingleTask(taskId, userId)` with no subtaskId. Once that route is
 * migrated (see implementation_plan.md Phase 6) it should instead call
 * `checkSingleTask(taskId, userId, subtaskId)` and let this function own the
 * completion mutation. The returned object includes both the new schema
 * fields and the legacy `{ replanTriggered, newRiskScore }` aliases so
 * either call style keeps working during the transition.
 *
 * @param {string} taskId - Firestore `tasks/{taskId}` document id
 * @param {string} userId - Firebase Auth UID (ownership check; pass null/undefined to skip)
 * @param {string|null} [subtaskId] - id of the leaf task (context.planning.tasks[].taskId) to mark complete
 * @param {number|null} [actualMinutes] - explicit actual minutes; if omitted, computed from now - scheduled start
 * @returns {Promise<object>} result matching progress_tracking_agent schema v1.0.0
 */
export async function checkSingleTask(taskId, userId, subtaskId = null, actualMinutes = null) {
    eventBus.agentStart(AGENT_NAME, `Checking task ${taskId}${subtaskId ? ` (subtask ${subtaskId})` : ''}`);

    try {
        const docRef = db.collection('tasks').doc(taskId);
        const doc = await docRef.get();
        if (!doc.exists) {
            throw new Error(`Task ${taskId} not found`);
        }

        const raw = doc.data();
        if (userId && raw?.userId && raw.userId !== userId) {
            throw new Error(`Task ${taskId} does not belong to user ${userId}`);
        }

        const context = fromFirestoreDocument(raw);

        if (subtaskId) {
            const tasks = context?.planning?.tasks ?? [];
            const target = tasks.find(t => t.taskId === subtaskId);
            if (!target) {
                throw new Error(`Subtask ${subtaskId} not found in task ${taskId}`);
            }

            let mins = toFiniteNumberOrNull(actualMinutes);
            if (mins === null || mins < 0) {
                const slot = (context?.schedule?.scheduledTasks ?? []).find(s => s.taskId === subtaskId);
                if (slot?.startTime) {
                    const started = new Date(slot.startTime).getTime();
                    mins = Number.isNaN(started) ? (toFiniteNumberOrNull(target.estimatedMinutes) ?? 0) : Math.max(0, Math.round((Date.now() - started) / 60000));
                } else {
                    mins = toFiniteNumberOrNull(target.estimatedMinutes) ?? 0;
                }
            }

            target.progress = {
                status: 'completed',
                completedAt: new Date().toISOString(),
                actualMinutes: mins,
            };
        }

        const result = reassessTask(context);

        await docRef.set(toFirestoreDocument(context));

        const tasks = context?.planning?.tasks ?? [];
        const wholeTaskComplete = tasks.length > 0 && tasks.every(t => t.progress?.status === 'completed');

        if (wholeTaskComplete) {
            // Non-fatal: evaluation_benchmark_agent is being built in parallel
            // and may not exist yet / may throw. Never let benchmark recording
            // block the completion flow.
            try {
                const benchmarkModule = await import('../evaluation_benchmark_agent/agent.js');
                await benchmarkModule.recordBenchmarkSnapshot(context, { trigger: 'task_completed', taskId });
            } catch (benchErr) {
                console.warn(`[${AGENT_NAME}] recordBenchmarkSnapshot skipped (non-fatal): ${benchErr.message}`);
            }

            try {
                const historyEntry = toTaskHistoryEntry(context);
                await db.collection('task_history').add(historyEntry);
            } catch (histErr) {
                console.warn(`[${AGENT_NAME}] task_history write failed (non-fatal): ${histErr.message}`);
            }
        }

        eventBus.agentComplete(AGENT_NAME, `Task ${taskId} reassessed`, result);
        return result;
    } catch (err) {
        eventBus.agentError(AGENT_NAME, err, `${AGENT_NAME} failed for task ${taskId}: ${err.message}`);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// runProgressCron — */30 * * * * entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sweep all task docs, reassess risk/status for the still-active ones, and
 * persist. Ported from legacy monitorAgent.js's `runMonitorAgent()`.
 *
 * The legacy query was `db.collection('tasks').where('status','==','active')
 * .where('deadline','>', now)`. The new PlanningContext document shape (see
 * contextManager.js) has no guaranteed top-level `status`/`deadline` field
 * to filter on the same way — status is derived from nested
 * `planning.tasks[].progress.status` plus the deadline. This sweep therefore
 * scans all task docs and filters in memory (skipping un-planned, fully
 * completed, and already-overdue tasks, mirroring the legacy filters). If a
 * denormalized top-level status/deadline mirror is later added by the
 * orchestrator, this can be optimized back to a Firestore `.where()` query.
 *
 * NOTE: this function only *detects* escalation (sets `result.escalate` and
 * returns `escalatedTasks` for anything that crossed the risk threshold —
 * see ESCALATION_RISK_THRESHOLD above, which already factors in overdue/
 * missed scheduled slots via computeLiveRiskScore's overdueCount term). It
 * deliberately does NOT invoke the replanning agent itself, to keep
 * "detecting risk" and "acting on risk" separate (see file header). The
 * caller (server/index.js's cron handler) is responsible for calling
 * orchestrator.replanTask(taskId, userId, processId) for each entry in
 * `escalatedTasks` so a missed/overrun task actually gets reassigned and the
 * schedule modified — not just flagged.
 *
 * @returns {Promise<{processed:number, escalated:number, escalatedTasks:Array<{taskId:string, userId:string}>}>}
 */
export async function runProgressCron() {
    const now = new Date();
    let processed = 0;
    let escalated = 0;
    const escalatedTasks = [];

    eventBus.agentStart(AGENT_NAME, 'Progress tracking sweep started');

    let snapshot;
    try {
        snapshot = await db.collection('tasks').get();
    } catch (err) {
        console.error(`[${AGENT_NAME}] Failed to query tasks collection:`, err.message);
        eventBus.agentError(AGENT_NAME, err, 'Failed to query tasks collection');
        return { processed: 0, escalated: 0, escalatedTasks: [] };
    }

    if (snapshot.empty) {
        console.log(`[${AGENT_NAME}] No tasks to check`);
        eventBus.agentComplete(AGENT_NAME, 'No tasks to check', { processed: 0, escalated: 0 });
        return { processed: 0, escalated: 0, escalatedTasks: [] };
    }

    for (const doc of snapshot.docs) {
        try {
            const context = fromFirestoreDocument(doc.data());
            const tasks = context?.planning?.tasks ?? [];

            if (tasks.length === 0) continue; // not yet planned — nothing to monitor

            const allDone = tasks.every(t => t.progress?.status === 'completed');
            if (allDone) continue; // nothing left to monitor

            const deadline = resolveDeadline(context);
            if (deadline && deadline.getTime() <= now.getTime()) {
                continue; // already overdue — mirrors legacy `deadline > now` query filter
            }

            const result = reassessTask(context);
            await doc.ref.set(toFirestoreDocument(context));

            processed++;
            if (result.escalate) {
                escalated++;
                if (context.userId) escalatedTasks.push({ taskId: context.taskId ?? doc.id, userId: context.userId });
            }
        } catch (err) {
            console.error(`[${AGENT_NAME}] Error processing task ${doc.id}:`, err.message);
        }
    }

    console.log(`[${AGENT_NAME}] Sweep complete — checked ${processed} tasks, ${escalated} escalated`);
    eventBus.agentComplete(AGENT_NAME, `Sweep complete — checked ${processed} tasks`, { processed, escalated });

    return { processed, escalated, escalatedTasks };
}
