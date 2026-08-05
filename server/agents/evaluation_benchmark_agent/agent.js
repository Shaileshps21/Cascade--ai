/**
 * evaluation_benchmark_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluation Benchmark Agent — the 15th agent.
 *
 * Design principle: "Memory learns. Evaluation measures." This agent is
 * purely deterministic — it makes NO LLM calls. It has two entry points:
 *
 *   1. loadUserBenchmarkContext(userId)
 *      Lightweight, READ-ONLY. Used early in the orchestrator pipeline
 *      (step 4) to seed context.benchmark with the user's most recent
 *      historical snapshot. Never writes anything.
 *
 *   2. recordBenchmarkSnapshot(context, opts, eventBus, sseEmit)
 *      The full 7-metric-category computation, run AFTER a task/pipeline
 *      completes (from the orchestrator at the end of a run, and later
 *      from progress_tracking_agent whenever an individual task is marked
 *      complete). Appends a new snapshot to `user_benchmarks` and
 *      `system_benchmarks` — never overwrites.
 *
 * All scoring/metric functions are small, pure, and exported individually
 * for unit testing (see agent.test.js). None of them touch Firestore or
 * the network.
 */

import './schema.js'; // registers schema
import { db } from '../../config/firebase.js';
import { writeNamespace } from '../contextManager.js';
import { createAgentLog, completeAgentLog, attachToContext, getObservabilitySummary } from '../shared/logger.js';
import { toMillis } from '../shared/firestoreUtil.js';

const AGENT_NAME = 'evaluation_benchmark_agent';
const SCHEMA_VERSION = '1.0.0';
const HISTORY_CAP = 50;
const TREND_THRESHOLD = 5;

// ═════════════════════════════════════════════════════════════════════════
// Small numeric helpers
// ═════════════════════════════════════════════════════════════════════════

/** Distance of `value` outside the [min, max] bounds (0 if within bounds). */
function _deviation(value, min, max) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    if (value < min) return min - value;
    if (value > max) return value - max;
    return 0;
}

function _clampScore(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
}

function _dayKey(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

// ═════════════════════════════════════════════════════════════════════════
// 1. Planning Quality (0-100) — from context.planning
// ═════════════════════════════════════════════════════════════════════════

/**
 * Score plan quality: duplicate task titles, hierarchy balance
 * (milestones 4-8, modules 2-6, tasks 2-8), task atomicity
 * (executionSteps 3-8), dependency completeness.
 * @param {object} planning - context.planning
 * @returns {number} 0-100
 */
export function computePlanningQuality(planning = {}) {
    const milestones = Array.isArray(planning?.milestones) ? planning.milestones : [];
    const tasks = Array.isArray(planning?.tasks) ? planning.tasks : [];

    if (milestones.length === 0 && tasks.length === 0) return 50; // no data — neutral

    let score = 100;

    // Duplicate task titles
    const titleCounts = new Map();
    for (const t of tasks) {
        const key = String(t?.title ?? '').trim().toLowerCase();
        if (!key) continue;
        titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    }
    const duplicates = [...titleCounts.values()].filter(c => c > 1).length;
    score -= Math.min(20, duplicates * 5);

    // Hierarchy balance — milestone count (4-8)
    score -= Math.min(15, _deviation(milestones.length, 4, 8) * 4);

    // Hierarchy balance — modules per milestone (2-6) and tasks per module (2-8)
    let moduleDeviationSum = 0;
    let taskPerModuleDeviationSum = 0;
    let moduleGroupCount = 0;

    for (const m of milestones) {
        const modules = Array.isArray(m?.modules) ? m.modules : [];
        moduleDeviationSum += _deviation(modules.length, 2, 6);
        for (const mod of modules) {
            moduleGroupCount += 1;
            const taskIds = Array.isArray(mod?.tasks) ? mod.tasks : [];
            taskPerModuleDeviationSum += _deviation(taskIds.length, 2, 8);
        }
    }

    if (milestones.length > 0) {
        score -= Math.min(15, (moduleDeviationSum / milestones.length) * 4);
    }
    if (moduleGroupCount > 0) {
        score -= Math.min(15, (taskPerModuleDeviationSum / moduleGroupCount) * 3);
    }

    // Task atomicity — executionSteps per task (3-8)
    if (tasks.length > 0) {
        const stepDeviationSum = tasks.reduce((acc, t) => {
            const steps = Array.isArray(t?.executionSteps) ? t.executionSteps.length : 0;
            return acc + _deviation(steps, 3, 8);
        }, 0);
        score -= Math.min(20, (stepDeviationSum / tasks.length) * 4);
    }

    // Dependency completeness — dependencies must reference valid task IDs
    if (tasks.length > 0) {
        const validIds = new Set(tasks.map(t => t?.taskId));
        let missingDeps = 0;
        let totalDeps = 0;
        for (const t of tasks) {
            const deps = Array.isArray(t?.dependencies) ? t.dependencies : [];
            totalDeps += deps.length;
            for (const d of deps) {
                if (!validIds.has(d)) missingDeps += 1;
            }
        }
        if (totalDeps > 0) {
            score -= Math.min(15, (missingDeps / totalDeps) * 15);
        }
    }

    return _clampScore(score);
}

// ═════════════════════════════════════════════════════════════════════════
// 2. Scheduling Accuracy (0-100) — from context.schedule
// ═════════════════════════════════════════════════════════════════════════

/**
 * Score scheduling quality: daily workload balance (coefficient of
 * variation of per-day scheduled minutes), buffer usage %, and
 * context-switching count (adjacent scheduled tasks with a different
 * `type`/category).
 * @param {object} schedule - context.schedule
 * @returns {number} 0-100
 */
export function computeSchedulingAccuracy(schedule = {}) {
    const scheduledTasks = Array.isArray(schedule?.scheduledTasks) ? schedule.scheduledTasks : [];
    if (scheduledTasks.length === 0) return 50; // no data — neutral

    let score = 100;

    // Daily workload balance
    const dailyMinutes = new Map();
    for (const t of scheduledTasks) {
        const day = _dayKey(t?.startTime);
        if (!day) continue;
        const duration = Number(t?.adjustedDuration ?? t?.estimatedDuration ?? 0);
        dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) + duration);
    }
    const dayValues = [...dailyMinutes.values()];
    if (dayValues.length > 1) {
        const mean = dayValues.reduce((a, b) => a + b, 0) / dayValues.length;
        const variance = dayValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / dayValues.length;
        const stddev = Math.sqrt(variance);
        const coefficientOfVariation = mean > 0 ? stddev / mean : 0;
        score -= Math.min(30, coefficientOfVariation * 60);
    }

    // Buffer usage % — ideal range 10-20% of total scheduled time
    const bufferSlots = Array.isArray(schedule?.bufferSlots) ? schedule.bufferSlots : [];
    const totalBufferMinutes = bufferSlots.reduce((acc, b) => acc + Number(b?.durationMinutes ?? 0), 0);
    const totalScheduledMinutes = scheduledTasks.reduce(
        (acc, t) => acc + Number(t?.adjustedDuration ?? t?.estimatedDuration ?? 0),
        0
    );
    const bufferPct = totalScheduledMinutes > 0 ? (totalBufferMinutes / totalScheduledMinutes) * 100 : 0;
    score -= Math.min(15, _deviation(bufferPct, 10, 20) * 1.5);

    // Context switching — adjacent scheduled tasks with a different type/category
    const sorted = scheduledTasks
        .filter(t => t?.startTime)
        .slice()
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    let switches = 0;
    for (let i = 1; i < sorted.length; i++) {
        const prevCategory = sorted[i - 1]?.type ?? sorted[i - 1]?.category ?? sorted[i - 1]?.energyLevel ?? 'unknown';
        const currCategory = sorted[i]?.type ?? sorted[i]?.category ?? sorted[i]?.energyLevel ?? 'unknown';
        if (prevCategory !== currCategory) switches += 1;
    }
    const switchRatio = sorted.length > 1 ? switches / (sorted.length - 1) : 0;
    score -= Math.min(20, switchRatio * 20);

    return _clampScore(score);
}

// ═════════════════════════════════════════════════════════════════════════
// 3. Time Estimation Accuracy (0-100) — estimation vs actuals
// ═════════════════════════════════════════════════════════════════════════

/**
 * Compute time-estimation accuracy: percentageError = (actual - estimated)
 * / estimated * 100, averaged across tasks that have both an estimate and
 * a recorded actual. Missing actuals are excluded (never crash).
 * @param {Array} estimations - context.estimation.estimations
 * @param {Array} tasks - context.planning.tasks
 * @returns {{ score: number, averagePlanningError: number, sampleSize: number, percentageErrors: number[] }}
 */
export function computeEstimationAccuracy(estimations = [], tasks = []) {
    const estList = Array.isArray(estimations) ? estimations : [];
    const taskList = Array.isArray(tasks) ? tasks : [];
    const taskMap = new Map(taskList.map(t => [t?.taskId, t]));

    const percentageErrors = [];
    for (const est of estList) {
        const task = taskMap.get(est?.taskId);
        const actual = task?.progress?.actualMinutes;
        const estimated = est?.finalEstimateMinutes;
        if (typeof actual !== 'number' || typeof estimated !== 'number' || estimated <= 0) continue;
        // A partial actual (only some steps had measurable start→complete spans)
        // must not be compared against a whole-task estimate — that systematically
        // reads as "we overestimated" and would teach the profile to shrink every
        // future estimate. Explicit false only: legacy actuals predate the flag and
        // are whole-task figures, so they stay eligible.
        if (task?.progress?.actualMinutesIsComplete === false) continue;
        percentageErrors.push(((actual - estimated) / estimated) * 100);
    }

    if (percentageErrors.length === 0) {
        return { score: 50, averagePlanningError: 0, sampleSize: 0, percentageErrors: [] };
    }

    const avgAbsError = percentageErrors.reduce((acc, e) => acc + Math.abs(e), 0) / percentageErrors.length;
    const averagePlanningError = Math.round(
        percentageErrors.reduce((a, b) => a + b, 0) / percentageErrors.length
    );

    return {
        score: _clampScore(100 - avgAbsError),
        averagePlanningError,
        sampleSize: percentageErrors.length,
        percentageErrors,
    };
}

// ═════════════════════════════════════════════════════════════════════════
// 4. Dependency Metrics — from context.dependency
// ═════════════════════════════════════════════════════════════════════════

/**
 * Score dependency graph health: violations (nodes never resolved into the
 * topological ordering — cycles/orphans), blocked-tasks %, parallel-task
 * usage %.
 * @param {object} dependency - context.dependency
 * @returns {{ score: number, violations: number, blockedPct: number, parallelUsagePct: number }}
 */
export function computeDependencyMetrics(dependency = {}) {
    const graph = dependency?.dependencyGraph ?? {};
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const topo = Array.isArray(dependency?.topologicalOrdering) ? dependency.topologicalOrdering : [];
    const blockedTasks = Array.isArray(dependency?.blockedTasks) ? dependency.blockedTasks : [];
    const parallelGroups = Array.isArray(dependency?.parallelGroups) ? dependency.parallelGroups : [];

    if (nodes.length === 0) {
        return { score: 50, violations: 0, blockedPct: 0, parallelUsagePct: 0 };
    }

    const topoSet = new Set(topo);
    const violations = nodes.filter(n => !topoSet.has(n)).length;
    const blockedPct = (blockedTasks.length / nodes.length) * 100;

    const parallelNodesCount = parallelGroups
        .filter(g => Array.isArray(g) && g.length > 1)
        .reduce((acc, g) => acc + g.length, 0);
    const parallelUsagePct = (parallelNodesCount / nodes.length) * 100;

    let score = 100;
    score -= Math.min(50, violations * 15);
    // A moderate blocked% is expected; only excessive blocking (>70%) is penalized
    score -= Math.min(20, Math.max(0, blockedPct - 70) * 0.5);

    return {
        score: _clampScore(score),
        violations,
        blockedPct: Math.round(blockedPct),
        parallelUsagePct: Math.round(parallelUsagePct),
    };
}

// ═════════════════════════════════════════════════════════════════════════
// 5. Knowledge Quality (0-100) — from context.knowledge
// ═════════════════════════════════════════════════════════════════════════

/**
 * Score knowledge quality: resource count sanity check, confidence passthrough.
 * @param {object} knowledge - context.knowledge
 * @returns {number} 0-100
 */
export function computeKnowledgeQuality(knowledge = {}) {
    if (!knowledge || typeof knowledge !== 'object') return 50;

    const resources = Array.isArray(knowledge.resources) ? knowledge.resources : [];
    const requiresLearning = knowledge.requiresLearning ?? false;
    const confidence = typeof knowledge.confidence === 'number' ? knowledge.confidence : 0.7;

    if (!requiresLearning) {
        // No learning required — knowledge quality is neutral-to-high by default
        return _clampScore(Math.max(60, confidence * 100));
    }

    let score = confidence * 100;

    if (resources.length === 0) {
        score -= 30; // learning required but no resources found
    } else if (resources.length > 20) {
        score -= 10; // too many — likely noisy/duplicated
    }

    return _clampScore(score);
}

// ═════════════════════════════════════════════════════════════════════════
// 6. Productivity Metrics — from context.planning
// ═════════════════════════════════════════════════════════════════════════

/**
 * Compute completion rate and average delay minutes for completed tasks.
 * @param {object} planning - context.planning
 * @returns {{ completionRate: number, averageDelayMinutes: number, completedCount: number, totalCount: number }}
 */
export function computeProductivityMetrics(planning = {}) {
    const tasks = Array.isArray(planning?.tasks) ? planning.tasks : [];
    if (tasks.length === 0) {
        return { completionRate: 50, averageDelayMinutes: 0, completedCount: 0, totalCount: 0 };
    }

    const completed = tasks.filter(t => t?.progress?.status === 'completed');
    const completionRate = Math.round((completed.length / tasks.length) * 100);

    const delays = [];
    for (const t of completed) {
        const actual = t?.progress?.actualMinutes;
        const estimated = t?.estimatedMinutes;
        if (typeof actual === 'number' && typeof estimated === 'number') {
            delays.push(actual - estimated);
        }
    }
    const averageDelayMinutes = delays.length > 0
        ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
        : 0;

    return { completionRate, averageDelayMinutes, completedCount: completed.length, totalCount: tasks.length };
}

// ═════════════════════════════════════════════════════════════════════════
// 7. System Metrics — from shared/logger.js observability summary
// ═════════════════════════════════════════════════════════════════════════

/**
 * Pull system metrics (tokens, cost, elapsed time, retries, agent success
 * rate) straight from getObservabilitySummary(context).
 * @param {object} context - PlanningContext
 * @returns {object} observability summary + agentSuccessRate
 */
export function computeSystemMetrics(context) {
    const summary = getObservabilitySummary(context);
    const agentSuccessRate = summary.totalAgents > 0
        ? Math.round((summary.successful / summary.totalAgents) * 100)
        : 100;
    return { ...summary, agentSuccessRate };
}

// ═════════════════════════════════════════════════════════════════════════
// Calendar reliability, planner confidence, trend calculation
// ═════════════════════════════════════════════════════════════════════════

/**
 * Calendar reliability: % of scheduled tasks that successfully received a
 * Google Calendar event, when the calendar is connected. Neutral 100 when
 * not connected or nothing was scheduled (nothing to fail).
 * @param {object} context - PlanningContext
 * @returns {number} 0-100
 */
export function computeCalendarReliability(context) {
    const schedule = context?.schedule ?? {};
    const scheduledTasks = Array.isArray(schedule.scheduledTasks) ? schedule.scheduledTasks : [];

    if (!context?.metadata?.calendarConnected || scheduledTasks.length === 0) return 100;

    const withEvents = scheduledTasks.filter(t => t?.calendarEventId).length;
    return _clampScore((withEvents / scheduledTasks.length) * 100);
}

/**
 * Aggregate planner confidence from whatever confidence signals are
 * available on the context (review score, schedule confidence, average
 * agent confidence). Falls back to a neutral 70 when nothing is available.
 * @param {object} context - PlanningContext
 * @param {object} systemMetrics - result of computeSystemMetrics(context)
 * @returns {number} 0-100
 */
export function computePlannerConfidence(context, systemMetrics) {
    const signals = [];
    if (typeof context?.review?.confidenceScore === 'number') signals.push(context.review.confidenceScore);
    if (typeof context?.schedule?.confidenceScore === 'number') signals.push(context.schedule.confidenceScore);
    if (typeof systemMetrics?.avgConfidence === 'number') signals.push(systemMetrics.avgConfidence * 100);

    if (signals.length === 0) return 70;
    return _clampScore(signals.reduce((a, b) => a + b, 0) / signals.length);
}

/**
 * Classify a trend by comparing a current value to a previous one.
 * @param {number} currentValue
 * @param {number|null|undefined} previousValue
 * @param {number} [threshold=5]
 * @returns {'Improving'|'Stable'|'Declining'}
 */
export function computeTrend(currentValue, previousValue, threshold = TREND_THRESHOLD) {
    if (typeof previousValue !== 'number' || Number.isNaN(previousValue)) return 'Stable';
    const diff = currentValue - previousValue;
    if (diff > threshold) return 'Improving';
    if (diff < -threshold) return 'Declining';
    return 'Stable';
}

// ═════════════════════════════════════════════════════════════════════════
// Benchmark history helpers
// ═════════════════════════════════════════════════════════════════════════

/**
 * Build the compact history-entry summary stored inside benchmarkHistory[].
 * @param {object} snapshot - a full benchmark snapshot (with updatedAt)
 * @returns {object}
 */
export function toHistorySummary(snapshot) {
    return {
        snapshotAt: snapshot.updatedAt ?? new Date().toISOString(),
        planningQuality: snapshot.planningQuality,
        scheduleAccuracy: snapshot.scheduleAccuracy,
        dependencyAccuracy: snapshot.dependencyAccuracy,
        estimationAccuracy: snapshot.estimationAccuracy,
        knowledgeQuality: snapshot.knowledgeQuality,
        calendarReliability: snapshot.calendarReliability,
        completionRate: snapshot.completionRate,
        plannerConfidence: snapshot.plannerConfidence,
    };
}

/**
 * Append a new history entry, capping the array at `cap` entries. Never
 * drops the newest entry, and only ever removes the OLDEST entries once
 * the cap is exceeded — existing entries are otherwise preserved as-is.
 * @param {Array} previousHistory
 * @param {object} newEntry
 * @param {number} [cap=50]
 * @returns {Array}
 */
export function appendBenchmarkHistory(previousHistory = [], newEntry, cap = HISTORY_CAP) {
    const history = Array.isArray(previousHistory) ? previousHistory : [];
    return [...history, newEntry].slice(-cap);
}

/**
 * Pick a baseline snapshot from ~30 entries back in history (approximating
 * "a month ago") for monthly trend comparison. Falls back to the oldest
 * available entry when history is shorter than 30, or null when empty.
 * @param {Array} benchmarkHistory
 * @returns {object|null}
 */
export function pickMonthlyBaseline(benchmarkHistory) {
    if (!Array.isArray(benchmarkHistory) || benchmarkHistory.length === 0) return null;
    const idx = Math.max(0, benchmarkHistory.length - 30);
    return benchmarkHistory[idx];
}

/**
 * Build simple deterministic recommendations from the computed scores.
 * @param {object} scores - snapshot core fields
 * @returns {string[]}
 */
export function buildRecommendations(scores) {
    const recs = [];
    if (scores.estimationAccuracy < 70) {
        recs.push('Time estimates show high error — recalibrate baseline estimates using historical data.');
    }
    if (scores.scheduleAccuracy < 70) {
        recs.push('Scheduling shows workload imbalance or excessive context switching — review buffer allocation.');
    }
    if (scores.planningQuality < 70) {
        recs.push('Plan hierarchy deviates from recommended structure — review milestone/module/task balance.');
    }
    if (scores.dependencyAccuracy < 70) {
        recs.push('Dependency graph shows violations or excessive blocking — review task dependencies.');
    }
    if (scores.knowledgeQuality < 70) {
        recs.push('Knowledge resources may be insufficient or unused — review resource relevance.');
    }
    if (Math.abs(scores.averageDelayMinutes ?? 0) > 60) {
        recs.push('Average task delay exceeds one hour — adjust future estimates accordingly.');
    }
    return recs;
}

/**
 * Apply a single-task completion event onto a shallow copy of
 * context.planning so recordBenchmarkSnapshot can be called from
 * progress_tracking_agent for one completed task without requiring the
 * caller to have already mutated the full planning namespace.
 * @param {object} planning - context.planning
 * @param {{taskId:string, actualMinutes?:number, completedAt?:string}|null} actualCompletionData
 * @returns {object} planning (possibly with one task's progress updated)
 */
export function applyActualCompletionOverride(planning, actualCompletionData) {
    if (!actualCompletionData?.taskId) return planning ?? {};
    const tasks = Array.isArray(planning?.tasks) ? planning.tasks : [];
    const updatedTasks = tasks.map(t => {
        if (t?.taskId !== actualCompletionData.taskId) return t;
        return {
            ...t,
            progress: {
                ...(t.progress ?? {}),
                status: 'completed',
                actualMinutes: actualCompletionData.actualMinutes ?? t.progress?.actualMinutes ?? null,
                completedAt: actualCompletionData.completedAt ?? new Date().toISOString(),
            },
        };
    });
    return { ...(planning ?? {}), tasks: updatedTasks };
}

/**
 * Build the neutral default benchmark object returned when a user has no
 * prior history yet.
 * @returns {object}
 */
export function buildDefaultBenchmark() {
    return {
        schemaVersion: SCHEMA_VERSION,
        planningQuality: 50,
        scheduleAccuracy: 50,
        dependencyAccuracy: 50,
        estimationAccuracy: 50,
        knowledgeQuality: 50,
        calendarReliability: 50,
        averagePlanningError: 0,
        completionRate: 50,
        averageDelayMinutes: 0,
        plannerConfidence: 50,
        weeklyTrend: 'Stable',
        monthlyTrend: 'Stable',
        benchmarkHistory: [],
        recommendations: [],
    };
}

// ═════════════════════════════════════════════════════════════════════════
// Entry point 1 — loadUserBenchmarkContext (READ-ONLY, lightweight)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Load the user's latest benchmark snapshot from Firestore. READ-ONLY —
 * never writes to the benchmark store. Used early in the orchestrator
 * pipeline to seed context.benchmark (step 4) so downstream agents
 * (Time Estimation, Scheduler) can read historical bias data.
 *
 * Returns a sensible neutral default (all scores at 50, empty arrays) when
 * no prior snapshot exists yet.
 * @param {string} userId
 * @returns {Promise<object>} the latest benchmark snapshot, or defaults
 */
export async function loadUserBenchmarkContext(userId) {
    const defaults = buildDefaultBenchmark();
    if (!userId) return defaults;

    try {
        // Filter on userId only (no .orderBy()) so this never depends on a
        // composite index being deployed — sort the (small) result set of
        // this user's own benchmark snapshots in memory instead.
        const snap = await db
            .collection('user_benchmarks')
            .where('userId', '==', userId)
            .limit(50)
            .get();

        if (snap.empty) return defaults;

        const docs = snap.docs.map(d => d.data()).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
        return { ...defaults, ...docs[0], schemaVersion: SCHEMA_VERSION };
    } catch (err) {
        console.warn(`[${AGENT_NAME}] loadUserBenchmarkContext failed: ${err.message}`);
        return defaults;
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Entry point 2 — recordBenchmarkSnapshot (full deterministic computation)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Compute the full 7-metric-category benchmark snapshot and append it to
 * both `user_benchmarks` (per-user) and `system_benchmarks` (system-wide,
 * no userId scoping). Never overwrites prior snapshots.
 *
 * Called AFTER a task/pipeline completes — from the orchestrator at the
 * end of a run, and from progress_tracking_agent whenever an individual
 * task is marked complete (pass `actualCompletionData` in that case so the
 * productivity/estimation metrics reflect the just-completed task even if
 * context.planning hasn't been mutated yet).
 *
 * @param {object} context - PlanningContext
 * @param {{actualCompletionData?: {taskId:string, actualMinutes?:number, completedAt?:string}|null}} [opts]
 * @param {object|null} [eventBus]
 * @param {function|null} [sseEmit]
 * @returns {Promise<object>} the new benchmark snapshot (written to context.benchmark)
 */
export async function recordBenchmarkSnapshot(context, { actualCompletionData = null } = {}, eventBus = null, sseEmit = null) {
    const log = createAgentLog(AGENT_NAME, 'v1.0.0');
    sseEmit?.('benchmark', 'thinking', 'Computing benchmark metrics...', null);
    eventBus?.agentStart?.(AGENT_NAME);

    try {
        const userId = context.userId;
        const previous = await loadUserBenchmarkContext(userId);

        const planningForMetrics = applyActualCompletionOverride(context.planning ?? {}, actualCompletionData);

        const planningQuality = computePlanningQuality(planningForMetrics);
        const scheduleAccuracy = computeSchedulingAccuracy(context.schedule ?? {});
        const dependencyMetrics = computeDependencyMetrics(context.dependency ?? {});
        const estimationResult = computeEstimationAccuracy(
            context.estimation?.estimations ?? [],
            planningForMetrics.tasks ?? []
        );
        const knowledgeQuality = computeKnowledgeQuality(context.knowledge ?? {});
        const productivity = computeProductivityMetrics(planningForMetrics);
        const systemMetrics = computeSystemMetrics(context);
        const calendarReliability = computeCalendarReliability(context);
        const plannerConfidence = computePlannerConfidence(context, systemMetrics);

        const weeklyTrend = computeTrend(productivity.completionRate, previous.completionRate);
        const monthlyBaseline = pickMonthlyBaseline(previous.benchmarkHistory);
        const monthlyTrend = monthlyBaseline
            ? computeTrend(productivity.completionRate, monthlyBaseline.completionRate)
            : weeklyTrend;

        const updatedAt = new Date().toISOString();

        const snapshotCore = {
            schemaVersion: SCHEMA_VERSION,
            planningQuality,
            scheduleAccuracy,
            dependencyAccuracy: dependencyMetrics.score,
            estimationAccuracy: estimationResult.score,
            knowledgeQuality,
            calendarReliability,
            averagePlanningError: estimationResult.averagePlanningError ?? 0,
            completionRate: productivity.completionRate,
            averageDelayMinutes: productivity.averageDelayMinutes,
            plannerConfidence,
            weeklyTrend,
            monthlyTrend,
        };

        const recommendations = buildRecommendations(snapshotCore);
        const newHistoryEntry = toHistorySummary({ ...snapshotCore, updatedAt });
        const benchmarkHistory = appendBenchmarkHistory(previous.benchmarkHistory, newHistoryEntry, HISTORY_CAP);

        const snapshot = {
            ...snapshotCore,
            benchmarkHistory,
            recommendations,
        };

        // ── Persist — APPEND only, never overwrite ─────────────────────────────
        try {
            await db.collection('user_benchmarks').add({
                userId,
                ...snapshot,
                updatedAt: new Date(),
            });
        } catch (err) {
            console.warn(`[${AGENT_NAME}] failed to write user_benchmarks: ${err.message}`);
        }

        try {
            await db.collection('system_benchmarks').add({
                ...snapshot,
                snapshotDate: new Date(),
            });
        } catch (err) {
            console.warn(`[${AGENT_NAME}] failed to write system_benchmarks: ${err.message}`);
        }

        writeNamespace(context, 'benchmark', snapshot);

        completeAgentLog(log, { confidence: plannerConfidence / 100, status: 'success' });
        attachToContext(context, log);

        sseEmit?.('benchmark', 'done', `Benchmark recorded: planning ${planningQuality}, schedule ${scheduleAccuracy}, completion ${productivity.completionRate}%`, null);
        eventBus?.agentComplete?.(AGENT_NAME, 'benchmark snapshot recorded', snapshot);
        eventBus?.emit?.('benchmark:complete', { agentName: AGENT_NAME, data: snapshot });

        return snapshot;
    } catch (err) {
        completeAgentLog(log, { status: 'failed', errors: [err.message] });
        attachToContext(context, log);
        sseEmit?.('benchmark', 'error', `Benchmark agent failed: ${err.message}`, null);
        eventBus?.agentError?.(AGENT_NAME, err, 'benchmark snapshot failed');
        throw err;
    }
}
