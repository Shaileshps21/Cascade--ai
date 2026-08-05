/**
 * progress_tracking_agent/agent.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the pure/deterministic parts of the progress tracking agent.
 * No live Firestore/network access — everything here uses fake PlanningContext
 * fixtures and node:test/node:assert.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeLiveRiskScore,
    linearRegressionSlope,
    computeDailyCompletionRates,
    computeProductivityTrend,
    computeFocusMinutesLast7Days,
    computeDelayProbability,
    computeActualVsEstimated,
    reassessTask,
    ESCALATION_RISK_THRESHOLD,
    MAX_REPLAN_COUNT,
} from './agent.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTask(overrides = {}) {
    return {
        taskId: 'T1',
        title: 'Sample task',
        estimatedMinutes: 60,
        progress: { status: 'not_started', completedAt: null, actualMinutes: null },
        ...overrides,
    };
}

function makeContext({
    createdAt,
    deadline,
    tasks = [],
    scheduledTasks = [],
    revisionCount = 0,
} = {}) {
    return {
        taskId: 'proj-1',
        userId: 'user-1',
        rawGoal: 'Test project',
        explicitDeadline: deadline ?? null,
        intent: deadline ? { title: 'Test project', deadline } : null,
        planning: { tasks },
        schedule: { scheduledTasks },
        metadata: {
            createdAt: createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revisionCount,
            warnings: [],
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeLiveRiskScore
// ─────────────────────────────────────────────────────────────────────────────

test('computeLiveRiskScore: low risk when progress keeps pace with time', () => {
    const now = Date.now();
    const created = new Date(now - 10 * 3600000).toISOString(); // 10h ago
    const deadline = new Date(now + 10 * 3600000).toISOString(); // 10h from now (halfway through timeline)

    const tasks = [
        makeTask({ taskId: 'T1', progress: { status: 'completed', completedAt: new Date().toISOString(), actualMinutes: 60 } }),
        makeTask({ taskId: 'T2', progress: { status: 'not_started', completedAt: null, actualMinutes: null } }),
    ];

    const context = makeContext({ createdAt: created, deadline, tasks });
    const risk = computeLiveRiskScore(context);

    assert.ok(risk >= 0 && risk <= 100, 'risk should be within 0-100');
    assert.ok(risk < 50, `expected low-ish risk when on pace, got ${risk}`);
});

test('computeLiveRiskScore: boosts to >=90 when <2h left and not done', () => {
    const now = Date.now();
    const created = new Date(now - 22 * 3600000).toISOString();
    const deadline = new Date(now + 1 * 3600000).toISOString(); // 1h left

    const tasks = [
        makeTask({ taskId: 'T1', progress: { status: 'not_started', completedAt: null, actualMinutes: null } }),
    ];

    const context = makeContext({ createdAt: created, deadline, tasks });
    const risk = computeLiveRiskScore(context);

    assert.ok(risk >= 90, `expected risk >= 90 near deadline with work left, got ${risk}`);
});

test('computeLiveRiskScore: overdue schedule slots add +15 each', () => {
    const now = Date.now();
    const created = new Date(now - 3600000).toISOString();
    const deadline = new Date(now + 100 * 3600000).toISOString(); // far away, so base risk ~0

    const tasks = [
        makeTask({ taskId: 'T1' }),
        makeTask({ taskId: 'T2' }),
    ];
    const scheduledTasks = [
        { taskId: 'T1', startTime: new Date(now - 7200000).toISOString(), endTime: new Date(now - 3600000).toISOString() }, // ended 1h ago, overdue
        { taskId: 'T2', startTime: new Date(now + 3600000).toISOString(), endTime: new Date(now + 7200000).toISOString() }, // future, not overdue
    ];

    const context = makeContext({ createdAt: created, deadline, tasks, scheduledTasks });
    const risk = computeLiveRiskScore(context);

    assert.ok(risk >= 15, `expected at least +15 from one overdue slot, got ${risk}`);
});

test('computeLiveRiskScore: clamps to [0, 100]', () => {
    const now = Date.now();
    const created = new Date(now - 1000 * 3600000).toISOString();
    const deadline = new Date(now - 500 * 3600000).toISOString(); // deadline already long past

    const tasks = Array.from({ length: 5 }, (_, i) => makeTask({ taskId: `T${i}` }));
    const scheduledTasks = tasks.map(t => ({
        taskId: t.taskId,
        startTime: new Date(now - 200 * 3600000).toISOString(),
        endTime: new Date(now - 100 * 3600000).toISOString(),
    }));

    const context = makeContext({ createdAt: created, deadline, tasks, scheduledTasks });
    const risk = computeLiveRiskScore(context);

    assert.equal(risk, 100);
});

test('computeLiveRiskScore: no deadline falls back to overdue-only heuristic', () => {
    const tasks = [makeTask({ taskId: 'T1' })];
    const context = makeContext({ tasks }); // no deadline
    const risk = computeLiveRiskScore(context);

    assert.equal(risk, 0); // no scheduled slots => no overdue => 0
    assert.ok(risk >= 0 && risk <= 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// linearRegressionSlope
// ─────────────────────────────────────────────────────────────────────────────

test('linearRegressionSlope: perfectly increasing sequence has slope 1', () => {
    assert.equal(linearRegressionSlope([1, 2, 3, 4, 5]), 1);
});

test('linearRegressionSlope: perfectly decreasing sequence has slope -1', () => {
    assert.equal(linearRegressionSlope([5, 4, 3, 2, 1]), -1);
});

test('linearRegressionSlope: flat sequence has slope 0', () => {
    assert.equal(linearRegressionSlope([3, 3, 3, 3]), 0);
});

test('linearRegressionSlope: fewer than 2 points returns 0', () => {
    assert.equal(linearRegressionSlope([]), 0);
    assert.equal(linearRegressionSlope([42]), 0);
    assert.equal(linearRegressionSlope(null), 0);
});

test('linearRegressionSlope: accepts {x,y} point objects', () => {
    const slope = linearRegressionSlope([{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 4, y: 8 }]);
    assert.equal(slope, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// computeDailyCompletionRates / computeProductivityTrend
// ─────────────────────────────────────────────────────────────────────────────

test('computeDailyCompletionRates: always returns `days` zero-filled entries', () => {
    const context = makeContext({ tasks: [] });
    const rates = computeDailyCompletionRates(context, 7);
    assert.equal(rates.length, 7);
    assert.ok(rates.every(r => r.count === 0));
});

test('computeDailyCompletionRates: counts completions on the correct day', () => {
    const today = new Date().toISOString().slice(0, 10);
    const tasks = [
        makeTask({ taskId: 'T1', progress: { status: 'completed', completedAt: new Date().toISOString(), actualMinutes: 30 } }),
        makeTask({ taskId: 'T2', progress: { status: 'completed', completedAt: new Date().toISOString(), actualMinutes: 45 } }),
        makeTask({ taskId: 'T3', progress: { status: 'not_started', completedAt: null, actualMinutes: null } }),
    ];
    const context = makeContext({ tasks });
    const rates = computeDailyCompletionRates(context, 7);
    const todayEntry = rates.find(r => r.date === today);

    assert.ok(todayEntry, 'today should be present in the trailing window');
    assert.equal(todayEntry.count, 2);
});

test('computeProductivityTrend: rising daily counts => improving', () => {
    const dailyCompletionRates = [0, 1, 1, 2, 2, 3, 4].map((count, i) => ({ date: `day-${i}`, count }));
    const trend = computeProductivityTrend(dailyCompletionRates);
    assert.equal(trend.label, 'improving');
    assert.ok(trend.slope > 0);
});

test('computeProductivityTrend: falling daily counts => declining', () => {
    const dailyCompletionRates = [4, 3, 2, 2, 1, 1, 0].map((count, i) => ({ date: `day-${i}`, count }));
    const trend = computeProductivityTrend(dailyCompletionRates);
    assert.equal(trend.label, 'declining');
    assert.ok(trend.slope < 0);
});

test('computeProductivityTrend: flat daily counts => stable', () => {
    const dailyCompletionRates = [2, 2, 2, 2, 2, 2, 2].map((count, i) => ({ date: `day-${i}`, count }));
    const trend = computeProductivityTrend(dailyCompletionRates);
    assert.equal(trend.label, 'stable');
    assert.equal(trend.slope, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// computeFocusMinutesLast7Days
// ─────────────────────────────────────────────────────────────────────────────

test('computeFocusMinutesLast7Days: sums actualMinutes for recent completions only', () => {
    const now = Date.now();
    const tasks = [
        makeTask({ taskId: 'T1', progress: { status: 'completed', completedAt: new Date(now - 1 * 24 * 3600000).toISOString(), actualMinutes: 30 } }),
        makeTask({ taskId: 'T2', progress: { status: 'completed', completedAt: new Date(now - 10 * 24 * 3600000).toISOString(), actualMinutes: 999 } }), // too old
        makeTask({ taskId: 'T3', progress: { status: 'not_started', completedAt: null, actualMinutes: null } }),
    ];
    const context = makeContext({ tasks });
    assert.equal(computeFocusMinutesLast7Days(context, 7), 30);
});

// ─────────────────────────────────────────────────────────────────────────────
// computeDelayProbability
// ─────────────────────────────────────────────────────────────────────────────

test('computeDelayProbability: 0 when all tasks are already done', () => {
    const tasks = [makeTask({ taskId: 'T1', progress: { status: 'completed', completedAt: new Date().toISOString(), actualMinutes: 60 } })];
    const context = makeContext({ tasks, deadline: new Date(Date.now() + 3600000).toISOString() });
    assert.equal(computeDelayProbability(context), 0);
});

test('computeDelayProbability: 0 when there is no deadline', () => {
    const tasks = [makeTask({ taskId: 'T1' })];
    const context = makeContext({ tasks });
    assert.equal(computeDelayProbability(context), 0);
});

test('computeDelayProbability: high when history shows overruns and little time remains', () => {
    const now = Date.now();
    const tasks = [
        makeTask({ taskId: 'T1', estimatedMinutes: 60, progress: { status: 'completed', completedAt: new Date().toISOString(), actualMinutes: 120 } }),
        makeTask({ taskId: 'T2', estimatedMinutes: 120, progress: { status: 'not_started', completedAt: null, actualMinutes: null } }),
    ];
    const context = makeContext({ tasks, deadline: new Date(now + 30 * 60000).toISOString() }); // only 30 min left
    const prob = computeDelayProbability(context);
    assert.ok(prob > 0.5, `expected high delay probability, got ${prob}`);
    assert.ok(prob <= 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// computeActualVsEstimated
// ─────────────────────────────────────────────────────────────────────────────

test('computeActualVsEstimated: computes delta only when both values are known', () => {
    const tasks = [
        makeTask({ taskId: 'T1', estimatedMinutes: 60, progress: { status: 'completed', completedAt: new Date().toISOString(), actualMinutes: 90 } }),
        makeTask({ taskId: 'T2', estimatedMinutes: 30, progress: { status: 'not_started', completedAt: null, actualMinutes: null } }),
    ];
    const context = makeContext({ tasks });
    const perf = computeActualVsEstimated(context);

    assert.equal(perf.length, 2);
    assert.equal(perf[0].deltaMinutes, 30);
    assert.equal(perf[1].deltaMinutes, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// reassessTask — integration of the above (still pure / no I/O)
// ─────────────────────────────────────────────────────────────────────────────

test('reassessTask: escalates when risk is high, deadline not too close, and rePlannedCount < max', () => {
    const now = Date.now();
    const created = new Date(now - 90 * 3600000).toISOString();
    const deadline = new Date(now + 5 * 3600000).toISOString(); // >1h left, so escalation path is reachable

    const tasks = [makeTask({ taskId: 'T1', progress: { status: 'not_started', completedAt: null, actualMinutes: null } })];
    const context = makeContext({ createdAt: created, deadline, tasks, revisionCount: 0 });

    const result = reassessTask(context);

    assert.equal(result.taskId, 'proj-1');
    assert.ok(result.riskScore >= ESCALATION_RISK_THRESHOLD, `expected risk >= ${ESCALATION_RISK_THRESHOLD}, got ${result.riskScore}`);
    assert.equal(result.escalate, true);
    assert.ok(context.metadata.warnings.some(w => w.includes('ESCALATION')));
});

test('reassessTask: does NOT escalate once rePlannedCount reaches MAX_REPLAN_COUNT', () => {
    const now = Date.now();
    const created = new Date(now - 90 * 3600000).toISOString();
    const deadline = new Date(now + 5 * 3600000).toISOString();

    const tasks = [makeTask({ taskId: 'T1', progress: { status: 'not_started', completedAt: null, actualMinutes: null } })];
    const context = makeContext({ createdAt: created, deadline, tasks, revisionCount: MAX_REPLAN_COUNT });

    const result = reassessTask(context);
    assert.equal(result.escalate, false);
});

test('reassessTask: status is "completed" once every leaf task is completed', () => {
    const tasks = [
        makeTask({ taskId: 'T1', progress: { status: 'completed', completedAt: new Date().toISOString(), actualMinutes: 60 } }),
    ];
    const context = makeContext({ tasks, deadline: new Date(Date.now() + 3600000).toISOString() });

    const result = reassessTask(context);
    assert.equal(result.status, 'completed');
    assert.equal(result.escalate, false);
});

test('reassessTask: status is "overdue" once the deadline has passed and work remains', () => {
    const tasks = [makeTask({ taskId: 'T1', progress: { status: 'not_started', completedAt: null, actualMinutes: null } })];
    const context = makeContext({ tasks, deadline: new Date(Date.now() - 3600000).toISOString() });

    const result = reassessTask(context);
    assert.equal(result.status, 'overdue');
});

test('reassessTask: auto-transitions a not_started leaf task to in_progress once its slot has started', () => {
    const now = Date.now();
    const tasks = [makeTask({ taskId: 'T1', progress: { status: 'not_started', completedAt: null, actualMinutes: null } })];
    const scheduledTasks = [{ taskId: 'T1', startTime: new Date(now - 60000).toISOString(), endTime: new Date(now + 3600000).toISOString() }];
    const context = makeContext({ tasks, scheduledTasks, deadline: new Date(now + 100 * 3600000).toISOString() });

    reassessTask(context);
    assert.equal(context.planning.tasks[0].progress.status, 'in_progress');
});

test('reassessTask: result validates against the registered schema shape', () => {
    const tasks = [makeTask({ taskId: 'T1' })];
    const context = makeContext({ tasks, deadline: new Date(Date.now() + 3600000).toISOString() });
    const result = reassessTask(context);

    assert.equal(typeof result.taskId, 'string');
    assert.equal(typeof result.status, 'string');
    assert.equal(typeof result.riskScore, 'number');
    assert.equal(typeof result.escalate, 'boolean');
    assert.ok(Array.isArray(result.dailyCompletionRates));
    assert.equal(result.dailyCompletionRates.length, 7);
    assert.equal(typeof result.productivityTrend, 'object');
    assert.equal(typeof result.productivityTrend.slope, 'number');
    assert.ok(['improving', 'declining', 'stable'].includes(result.productivityTrend.label));
    assert.equal(typeof result.delayProbability, 'number');
    assert.ok(result.delayProbability >= 0 && result.delayProbability <= 1);
    assert.equal(typeof result.focusMinutesLast7Days, 'number');
});
