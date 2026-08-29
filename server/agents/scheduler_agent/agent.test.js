/**
 * scheduler_agent/agent.test.js
 * Unit tests for the pure, deterministic helpers + a mocked end-to-end run.
 * No live LLM/network access — clients.pro/flash are stubbed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    computeBufferPercent,
    validateNoDependencyViolations,
    validateBufferPercent,
} from './validator.js';

import {
    isWithinWorkingHours,
    findNextFreeSlot,
    computeTotalEffortMinutes,
    computeProjectDurationDays,
    computeAvailableMinutes,
    checkDeadlineFeasibility,
    buildFailureConditions,
    buildScheduleSkeleton,
    enforceFirstTaskDelay,
    fixDependencyViolations,
    checkWorkingHoursCompliance,
    runSchedulerAgent,
    resolveWorkingHours,
    WORK_STYLE_PRESETS,
    WORK_START_HOUR,
    WORK_END_HOUR,
    FIRST_TASK_DELAY_MINUTES,
    DEFAULT_DAILY_AVAILABLE_MINUTES,
} from './agent.js';

// ── Fixture builder ────────────────────────────────────────────────────────
// All dates are constructed via local-time Date(...) so working-hours checks
// (which use .getHours()) are self-consistent regardless of the machine's
// timezone.
function makeContext({ createdAt, deadline, tasks, estimations, topologicalOrdering } = {}) {
    const created = createdAt ?? new Date(2026, 6, 16, 9, 0, 0); // Jul 16 2026, 09:00 local
    return {
        taskId: 'task-1',
        userId: 'user-1',
        intent: deadline !== undefined ? { deadline: deadline ? new Date(deadline).toISOString() : null } : null,
        explicitDeadline: null,
        planning: {
            tasks: tasks ?? [
                { taskId: 'T1', title: 'Learn fundamentals', estimatedMinutes: 60, difficulty: 'high', priority: 'high', dependencies: [] },
                { taskId: 'T2', title: 'Build feature', estimatedMinutes: 120, difficulty: 'medium', priority: 'medium', dependencies: ['T1'] },
                { taskId: 'T3', title: 'Write tests', estimatedMinutes: 60, difficulty: 'low', priority: 'low', dependencies: ['T2'] },
            ],
        },
        dependency: { topologicalOrdering: topologicalOrdering ?? ['T1', 'T2', 'T3'], criticalPath: ['T1', 'T2', 'T3'] },
        estimation: {
            estimations: estimations ?? [
                { taskId: 'T1', finalEstimateMinutes: 70 },
                { taskId: 'T2', finalEstimateMinutes: 130 },
                { taskId: 'T3', finalEstimateMinutes: 50 },
            ],
        },
        feasibility: null,
        memory: null,
        metadata: { createdAt: created.toISOString(), warnings: [], observabilityLogs: [] },
    };
}

// ═════════════════════════════════════════════════════════════════════════
// computeBufferPercent — Rule 3 thresholds
// ═════════════════════════════════════════════════════════════════════════
describe('computeBufferPercent', () => {
    test('< 5 days → 10%', () => {
        assert.equal(computeBufferPercent(0), 0.10);
        assert.equal(computeBufferPercent(2.5), 0.10);
        assert.equal(computeBufferPercent(4.99), 0.10);
    });

    test('5–15 days → 15%', () => {
        assert.equal(computeBufferPercent(5), 0.15);
        assert.equal(computeBufferPercent(10), 0.15);
        assert.equal(computeBufferPercent(14.99), 0.15);
    });

    test('15+ days → 20%', () => {
        assert.equal(computeBufferPercent(15), 0.20);
        assert.equal(computeBufferPercent(30), 0.20);
    });

    test('unknown duration defaults to the middle tier (15%)', () => {
        assert.equal(computeBufferPercent(null), 0.15);
        assert.equal(computeBufferPercent(undefined), 0.15);
        assert.equal(computeBufferPercent(NaN), 0.15);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// validateNoDependencyViolations
// ═════════════════════════════════════════════════════════════════════════
describe('validateNoDependencyViolations', () => {
    test('passes a correctly ordered schedule', () => {
        const scheduledTasks = [
            { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z', dependencies: [] },
            { taskId: 'T2', startTime: '2026-07-16T10:10:00.000Z', endTime: '2026-07-16T11:10:00.000Z', dependencies: ['T1'] },
        ];
        const { valid, violations } = validateNoDependencyViolations(scheduledTasks);
        assert.equal(valid, true);
        assert.deepEqual(violations, []);
    });

    test('catches a task starting before its dependency ends', () => {
        const scheduledTasks = [
            { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z', dependencies: [] },
            // T2 starts BEFORE T1 finishes — violation
            { taskId: 'T2', startTime: '2026-07-16T09:30:00.000Z', endTime: '2026-07-16T10:30:00.000Z', dependencies: ['T1'] },
        ];
        const { valid, violations } = validateNoDependencyViolations(scheduledTasks);
        assert.equal(valid, false);
        assert.equal(violations.length, 1);
        assert.equal(violations[0].taskId, 'T2');
        assert.equal(violations[0].dependsOn, 'T1');
    });

    test('catches an ordering violation via topologicalOrdering even when timestamps agree', () => {
        const scheduledTasks = [
            { taskId: 'T2', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z', dependencies: ['T1'] },
            { taskId: 'T1', startTime: '2026-07-16T11:00:00.000Z', endTime: '2026-07-16T12:00:00.000Z', dependencies: [] },
        ];
        const { valid, violations } = validateNoDependencyViolations(scheduledTasks, { topologicalOrdering: ['T1', 'T2'] });
        assert.equal(valid, false);
        assert.ok(violations.some(v => v.taskId === 'T2' && v.dependsOn === 'T1'));
    });

    test('ignores dependencies not present in the schedule (assumed already completed)', () => {
        const scheduledTasks = [
            { taskId: 'T2', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z', dependencies: ['T0-already-done'] },
        ];
        const { valid } = validateNoDependencyViolations(scheduledTasks);
        assert.equal(valid, true);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// validateBufferPercent
// ═════════════════════════════════════════════════════════════════════════
describe('validateBufferPercent', () => {
    test('passes when buffer meets the required percentage', () => {
        const scheduledTasks = [
            { isBuffer: false, adjustedDuration: 800 },
            { isBuffer: true, adjustedDuration: 200 }, // 200/1000 = 20%
        ];
        const result = validateBufferPercent(scheduledTasks, 20); // 15+ days -> 20% required
        assert.equal(result.valid, true);
        assert.equal(result.requiredPct, 0.20);
        assert.equal(result.actualPct, 0.20);
    });

    test('fails when buffer is well below the required percentage', () => {
        const scheduledTasks = [
            { isBuffer: false, adjustedDuration: 980 },
            { isBuffer: true, adjustedDuration: 20 }, // 2%
        ];
        const result = validateBufferPercent(scheduledTasks, 20); // requires 20%
        assert.equal(result.valid, false);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// isWithinWorkingHours / findNextFreeSlot
// ═════════════════════════════════════════════════════════════════════════
describe('isWithinWorkingHours', () => {
    test('true during working hours, false outside', () => {
        assert.equal(isWithinWorkingHours(new Date(2026, 6, 16, 10, 0, 0)), true);
        assert.equal(isWithinWorkingHours(new Date(2026, 6, 16, 8, 0, 0)), false);
        assert.equal(isWithinWorkingHours(new Date(2026, 6, 16, 21, 0, 0)), false);
        assert.equal(isWithinWorkingHours(new Date(2026, 6, 16, 22, 0, 0)), false);
    });
});

describe('findNextFreeSlot', () => {
    test('returns the requested slot immediately when nothing conflicts', () => {
        const from = new Date(2026, 6, 16, 10, 0, 0);
        const { start, end } = findNextFreeSlot(from, 60, []);
        assert.equal(start.getTime(), from.getTime());
        assert.equal((end.getTime() - start.getTime()) / 60000, 60);
    });

    test('skips a busy slot that overlaps the candidate window', () => {
        const from = new Date(2026, 6, 16, 10, 0, 0);
        const busy = [{ start: new Date(2026, 6, 16, 10, 0, 0), end: new Date(2026, 6, 16, 11, 0, 0) }];
        const { start } = findNextFreeSlot(from, 30, busy);
        assert.ok(start.getTime() >= busy[0].end.getTime());
    });

    test('pushes to the next working day when it would run past work-end', () => {
        const from = new Date(2026, 6, 16, 20, 45, 0); // 15 min before 21:00 close
        const { start } = findNextFreeSlot(from, 60, []); // needs a full hour — doesn't fit today
        assert.equal(start.getDate(), 17);
        assert.equal(start.getHours(), WORK_START_HOUR);
    });

    test('never places a slot outside configured working hours', () => {
        const from = new Date(2026, 6, 16, 6, 0, 0); // before work starts
        const { start } = findNextFreeSlot(from, 30, []);
        assert.equal(start.getHours(), WORK_START_HOUR);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// Priority-Weighted Within-Day Ordering (suggestions.md #21)
// ═════════════════════════════════════════════════════════════════════════
describe('buildScheduleSkeleton — priority-weighted within-day ordering', () => {
    test('reorders same-day, dependency-free tasks critical > high > medium > low', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const context = makeContext({
            createdAt,
            deadline: new Date(2026, 7, 1),
            tasks: [
                { taskId: 'T1', title: 'Low prio', estimatedMinutes: 20, difficulty: 'low', priority: 'low', dependencies: [] },
                { taskId: 'T2', title: 'Critical', estimatedMinutes: 20, difficulty: 'high', priority: 'critical', dependencies: [] },
                { taskId: 'T3', title: 'Medium', estimatedMinutes: 20, difficulty: 'medium', priority: 'medium', dependencies: [] },
            ],
            estimations: [],
            topologicalOrdering: ['T1', 'T2', 'T3'],
        });

        const skeleton = buildScheduleSkeleton(context, [], 120, 9, 21, 'skip');

        assert.deepEqual(skeleton.map((s) => s.taskId), ['T2', 'T3', 'T1']);
    });

    test('never produces overlapping slots after reordering', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const context = makeContext({
            createdAt,
            deadline: new Date(2026, 7, 1),
            tasks: [
                { taskId: 'T1', title: 'Low', estimatedMinutes: 45, difficulty: 'low', priority: 'low', dependencies: [] },
                { taskId: 'T2', title: 'Critical', estimatedMinutes: 45, difficulty: 'high', priority: 'critical', dependencies: [] },
                { taskId: 'T3', title: 'Medium', estimatedMinutes: 45, difficulty: 'medium', priority: 'medium', dependencies: [] },
                { taskId: 'T4', title: 'High', estimatedMinutes: 45, difficulty: 'high', priority: 'high', dependencies: [] },
            ],
            estimations: [],
            topologicalOrdering: ['T1', 'T2', 'T3', 'T4'],
        });

        const skeleton = buildScheduleSkeleton(context, [], 180, 9, 21, 'skip');
        const sorted = [...skeleton].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        for (let i = 1; i < sorted.length; i++) {
            assert.ok(
                new Date(sorted[i].startTime).getTime() >= new Date(sorted[i - 1].endTime).getTime(),
                `expected ${sorted[i].taskId} to start at/after ${sorted[i - 1].taskId} ends`
            );
        }
    });

    test('sinks buffer/review slots to the end of the day regardless of priority', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const context = makeContext({
            createdAt,
            deadline: new Date(2026, 7, 1),
            tasks: [
                { taskId: 'BUF1', title: 'Buffer', estimatedMinutes: 15, difficulty: 'low', priority: 'critical', dependencies: [], isBuffer: true },
                { taskId: 'T1', title: 'Medium work', estimatedMinutes: 20, difficulty: 'medium', priority: 'medium', dependencies: [] },
            ],
            estimations: [],
            topologicalOrdering: ['BUF1', 'T1'],
        });

        const skeleton = buildScheduleSkeleton(context, [], 120, 9, 21, 'skip');
        assert.deepEqual(skeleton.map((s) => s.taskId), ['T1', 'BUF1']);
    });

    test('leaves already priority-ordered days untouched (no gratuitous reshuffling)', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        // Default fixture is already critical/high -> medium -> low in topo order.
        const context = makeContext({ createdAt, deadline: new Date(2026, 7, 1) });
        const skeleton = buildScheduleSkeleton(context, []);
        assert.deepEqual(skeleton.map((s) => s.taskId), ['T1', 'T2', 'T3']);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// buildScheduleSkeleton / enforceFirstTaskDelay — Rule 1 (30-min start delay)
// ═════════════════════════════════════════════════════════════════════════
describe('Rule 1 — first task starts ~30 minutes after project creation', () => {
    test('buildScheduleSkeleton anchors the first task to createdAt + 30min', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const context = makeContext({ createdAt, deadline: new Date(2026, 7, 1) });
        const skeleton = buildScheduleSkeleton(context, []);

        assert.ok(skeleton.length > 0);
        const first = skeleton[0];
        const expectedMinStart = new Date(createdAt.getTime() + FIRST_TASK_DELAY_MINUTES * 60_000);
        assert.equal(new Date(first.startTime).getTime(), expectedMinStart.getTime());
    });

    test('enforceFirstTaskDelay nudges a too-early task forward on a small fixture', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const scheduledTasks = [
            // Starts immediately (violates the 30-min delay rule)
            { taskId: 'T1', startTime: createdAt.toISOString(), endTime: new Date(createdAt.getTime() + 30 * 60000).toISOString(), isBuffer: false },
        ];
        enforceFirstTaskDelay(scheduledTasks, createdAt);

        const minStart = new Date(createdAt.getTime() + FIRST_TASK_DELAY_MINUTES * 60000);
        assert.equal(new Date(scheduledTasks[0].startTime).getTime(), minStart.getTime());
        // Duration must be preserved
        assert.equal(new Date(scheduledTasks[0].endTime).getTime() - new Date(scheduledTasks[0].startTime).getTime(), 30 * 60000);
    });

    test('enforceFirstTaskDelay leaves an already-compliant schedule untouched', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const compliantStart = new Date(createdAt.getTime() + 45 * 60000); // already later than 30 min
        const scheduledTasks = [
            { taskId: 'T1', startTime: compliantStart.toISOString(), endTime: new Date(compliantStart.getTime() + 30 * 60000).toISOString(), isBuffer: false },
        ];
        enforceFirstTaskDelay(scheduledTasks, createdAt);
        assert.equal(scheduledTasks[0].startTime, compliantStart.toISOString());
    });
});

// ═════════════════════════════════════════════════════════════════════════
// fixDependencyViolations
// ═════════════════════════════════════════════════════════════════════════
describe('fixDependencyViolations', () => {
    test('pushes a task forward so it no longer starts before its dependency ends', () => {
        const scheduledTasks = [
            { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z', dependencies: [] },
            { taskId: 'T2', startTime: '2026-07-16T09:30:00.000Z', endTime: '2026-07-16T10:30:00.000Z', dependencies: ['T1'] },
        ];
        const { fixedCount } = fixDependencyViolations(scheduledTasks);
        assert.equal(fixedCount, 1);
        const { valid } = validateNoDependencyViolations(scheduledTasks);
        assert.equal(valid, true);
        // Duration preserved (1 hour)
        const t2 = scheduledTasks[1];
        assert.equal(new Date(t2.endTime).getTime() - new Date(t2.startTime).getTime(), 60 * 60000);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// checkWorkingHoursCompliance
// ═════════════════════════════════════════════════════════════════════════
describe('checkWorkingHoursCompliance', () => {
    test('flags a task scheduled outside working hours', () => {
        const scheduledTasks = [
            { taskId: 'T1', startTime: new Date(2026, 6, 16, 22, 0, 0).toISOString(), endTime: new Date(2026, 6, 16, 23, 0, 0).toISOString(), isBuffer: false },
        ];
        const violations = checkWorkingHoursCompliance(scheduledTasks);
        assert.deepEqual(violations, ['T1']);
    });

    test('ignores buffer tasks', () => {
        const scheduledTasks = [
            { taskId: 'BUF1', startTime: new Date(2026, 6, 16, 22, 0, 0).toISOString(), endTime: new Date(2026, 6, 16, 23, 0, 0).toISOString(), isBuffer: true },
        ];
        assert.deepEqual(checkWorkingHoursCompliance(scheduledTasks), []);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// Failure conditions — deadline impossible
// ═════════════════════════════════════════════════════════════════════════
describe('checkDeadlineFeasibility / buildFailureConditions', () => {
    test('detects infeasibility when total effort vastly exceeds available time', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const deadline = new Date(2026, 6, 17, 9, 0, 0); // only 1 day away
        const context = makeContext({
            createdAt,
            deadline,
            tasks: [
                { taskId: 'T1', title: 'Huge task', estimatedMinutes: 2000, difficulty: 'high', priority: 'high', dependencies: [] },
            ],
            estimations: [{ taskId: 'T1', finalEstimateMinutes: 2400 }], // 40 hours of work in 1 day
        });

        const check = checkDeadlineFeasibility(context);
        assert.equal(check.isFeasible, false);
        assert.ok(check.requiredAdditionalMinutes > 0);

        const failureConditions = buildFailureConditions(check, context);
        assert.ok(failureConditions.requiredAdditionalHours > 0);
        assert.ok(new Date(failureConditions.suggestedDeadline).getTime() > deadline.getTime());
        assert.ok(Array.isArray(failureConditions.tasksToDefer));
        assert.ok(failureConditions.completionProbability >= 0 && failureConditions.completionProbability <= 1);
        assert.ok(failureConditions.reasoning.length > 0);
    });

    test('treats a project with no known deadline as feasible', () => {
        const context = makeContext({ deadline: null });
        const check = checkDeadlineFeasibility(context);
        assert.equal(check.isFeasible, true);
    });

    test('is feasible when effort comfortably fits before the deadline', () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const deadline = new Date(2026, 7, 15, 9, 0, 0); // ~30 days away
        const context = makeContext({ createdAt, deadline });
        const check = checkDeadlineFeasibility(context);
        assert.equal(check.isFeasible, true);
    });
});

describe('runSchedulerAgent — end-to-end failure-condition path (no LLM call needed)', () => {
    test('returns isFeasible:false with failureConditions when the deadline is impossible', async () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const deadline = new Date(2026, 6, 17, 9, 0, 0); // 1 day away
        const context = makeContext({
            createdAt,
            deadline,
            tasks: [
                { taskId: 'T1', title: 'Huge task', estimatedMinutes: 3000, difficulty: 'high', priority: 'high', dependencies: [] },
            ],
            estimations: [{ taskId: 'T1', finalEstimateMinutes: 3000 }],
        });

        let proWasCalled = false;
        const mockClients = {
            pro: { generateText: async () => { proWasCalled = true; return { text: '{}' }; } },
            flash: { generateText: async () => ({ text: '{}' }) },
            embedding: { embed: async () => null },
        };

        const result = await runSchedulerAgent(context, mockClients, null, null, []);

        assert.equal(proWasCalled, false, 'the LLM should never be called when the deadline is deterministically infeasible');
        assert.equal(result.isFeasible, false);
        assert.ok(result.failureConditions);
        assert.ok(result.failureConditions.requiredAdditionalHours > 0);
        assert.equal(context.schedule.isFeasible, false, 'runAgent should have written the result into context.schedule');
    });
});

describe('runSchedulerAgent — end-to-end success path (mocked LLM)', () => {
    test('accepts a well-formed, dependency-respecting LLM response and computes a schedulingScore', async () => {
        const createdAt = new Date(2026, 6, 16, 9, 0, 0);
        const deadline = new Date(2026, 7, 15, 9, 0, 0); // comfortably far away
        const context = makeContext({ createdAt, deadline });

        // Build the mock LLM response FROM the deterministic skeleton so
        // dependency ordering and working hours are guaranteed to be valid —
        // this test is about the plumbing (schema validation, score
        // computation, context write), not the post-processing repair paths
        // (those are covered by fixDependencyViolations / checkWorkingHoursCompliance above).
        const skeleton = buildScheduleSkeleton(context, []);
        const mockResponse = {
            schemaVersion: '1.0.0',
            scheduledTasks: skeleton.map(s => ({
                taskId: s.taskId,
                taskName: s.taskName,
                startTime: s.startTime,
                endTime: s.endTime,
                estimatedDuration: s.estimatedDuration,
                adjustedDuration: s.adjustedDuration,
                adjustmentReason: s.adjustmentReason,
                priority: s.priority,
                energyLevel: s.difficulty === 'high' ? 'high' : (s.difficulty === 'low' ? 'low' : 'medium'),
                isBuffer: s.isBuffer,
                isReview: s.isReview,
                isDeepWork: s.difficulty === 'high',
                dependencies: s.dependencies,
                confidence: 0.8,
            })),
            bufferSlots: [],
            schedulingScore: 88,
            confidenceScore: 85,
            warnings: [],
            recommendations: [],
            isFeasible: true,
            failureConditions: null,
        };

        const mockClients = {
            pro: { generateText: async () => ({ text: JSON.stringify(mockResponse), usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }, provider: 'test', model: 'test' }) },
            flash: { generateText: async () => ({ text: '{}' }) },
            embedding: { embed: async () => null },
        };

        const result = await runSchedulerAgent(context, mockClients, null, null, []);

        assert.equal(result.isFeasible, true);
        assert.equal(result.scheduledTasks.length, 3);
        assert.equal(typeof result.schedulingScore, 'number');
        assert.ok(result.schedulingScore >= 0 && result.schedulingScore <= 100);
        assert.equal(context.schedule.scheduledTasks.length, 3);

        const { valid } = validateNoDependencyViolations(result.scheduledTasks, context.dependency);
        assert.equal(valid, true);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// Deterministic-only fast path — explicit working-hours window + a hard
// constraint the skeleton already fully enforces (fixed events / focus rule)
// ═════════════════════════════════════════════════════════════════════════
describe('runSchedulerAgent — deterministic-only fast path (explicit window + fixed events)', () => {
    test('skips the LLM entirely and packs same-day tasks inside the stated 09:00-18:00 window', async () => {
        const createdAt = new Date(2026, 6, 16, 8, 0, 0); // 08:00 local
        const deadline = new Date(2026, 6, 17, 18, 0, 0); // tomorrow evening — comfortably feasible
        const context = makeContext({
            createdAt,
            deadline,
            tasks: [
                { taskId: 'T1', title: 'Fix Production API Bug', estimatedMinutes: 60, difficulty: 'high', priority: 'critical', dependencies: [] },
                { taskId: 'T2', title: 'Review feedback notes', estimatedMinutes: 30, difficulty: 'low', priority: 'medium', dependencies: [] },
                { taskId: 'T3', title: 'Finalize report', estimatedMinutes: 120, difficulty: 'medium', priority: 'high', dependencies: ['T2'] },
            ],
            estimations: [],
            topologicalOrdering: ['T1', 'T2', 'T3'],
        });
        context.intent = {
            deadline: deadline.toISOString(),
            workStartHour: 9,
            workEndHour: 18,
            fixedEvents: [{
                title: 'Client Status Call',
                startTime: new Date(2026, 6, 16, 11, 30, 0).toISOString(),
                endTime: new Date(2026, 6, 16, 12, 30, 0).toISOString(),
            }],
            maxContinuousFocusMinutes: 90,
            breakMinutes: 15,
        };

        let proWasCalled = false;
        const mockClients = {
            pro: { generateText: async () => { proWasCalled = true; return { text: '{}' }; } },
            flash: { generateText: async () => ({ text: '{}' }) },
            embedding: { embed: async () => null },
        };

        const result = await runSchedulerAgent(context, mockClients, null, null, []);

        assert.equal(proWasCalled, false, 'an explicit window + fixed events/focus rule should be handled deterministically, no LLM call');
        assert.equal(result.isFeasible, true);
        // 3 real tasks + however many break slots the 90-min continuous-focus
        // rule inserted (isBuffer:true) — count those separately.
        const realTasks = result.scheduledTasks.filter((t) => !t.isBuffer);
        assert.equal(realTasks.length, 3);
        assert.ok(result.schedulingScore >= 70, `expected a healthy score, got ${result.schedulingScore}`);

        for (const t of result.scheduledTasks) {
            if (t.isBuffer) continue;
            const start = new Date(t.startTime);
            const end = new Date(t.endTime);
            assert.ok(start.getHours() >= 9, `${t.taskId} starts before 09:00`);
            const endFraction = end.getHours() + end.getMinutes() / 60;
            assert.ok(endFraction <= 18, `${t.taskId} ends after 18:00`);
        }

        // Must not overlap the fixed client call.
        const callStart = new Date(2026, 6, 16, 11, 30, 0).getTime();
        const callEnd = new Date(2026, 6, 16, 12, 30, 0).getTime();
        for (const t of result.scheduledTasks) {
            const s = new Date(t.startTime).getTime();
            const e = new Date(t.endTime).getTime();
            assert.ok(e <= callStart || s >= callEnd, `${t.taskId} overlaps the fixed client call`);
        }
    });
});

// ── resolveWorkingHours — day-person / night-person preference ─────────────
describe('resolveWorkingHours', () => {
    test('defaults to the flexible preset when no preferences are set', () => {
        const { workStartHour, workEndHour, workStyle } = resolveWorkingHours({});
        assert.equal(workStartHour, WORK_START_HOUR);
        assert.equal(workEndHour, WORK_END_HOUR);
        assert.equal(workStyle, 'flexible');
    });

    test('"day" workStyle resolves to an early window', () => {
        const { workStartHour, workEndHour } = resolveWorkingHours({ preferences: { workStyle: 'day' } });
        assert.equal(workStartHour, WORK_STYLE_PRESETS.day.workStartHour);
        assert.equal(workEndHour, WORK_STYLE_PRESETS.day.workEndHour);
    });

    test('"night" workStyle resolves to a noon-to-midnight window', () => {
        const { workStartHour, workEndHour } = resolveWorkingHours({ preferences: { workStyle: 'night' } });
        assert.equal(workStartHour, 12);
        assert.equal(workEndHour, 24);
    });

    test('unknown workStyle falls back to flexible instead of throwing', () => {
        const { workStartHour, workEndHour } = resolveWorkingHours({ preferences: { workStyle: 'bogus' } });
        assert.equal(workStartHour, WORK_START_HOUR);
        assert.equal(workEndHour, WORK_END_HOUR);
    });

    test('explicit workStartHour/workEndHour override the preset', () => {
        const { workStartHour, workEndHour } = resolveWorkingHours({
            preferences: { workStyle: 'day', workStartHour: 6, workEndHour: 22 },
        });
        assert.equal(workStartHour, 6);
        assert.equal(workEndHour, 22);
    });

    test('a working-hours window stated in THIS request (intent) overrides the saved profile preset', () => {
        const result = resolveWorkingHours({
            preferences: { workStyle: 'day' }, // saved preset would be 7-19
            intent: { workStartHour: 9, workEndHour: 18 },
        });
        assert.equal(result.workStartHour, 9);
        assert.equal(result.workEndHour, 18);
        assert.equal(result.explicitWindowStated, true);
        // Full stated window, no 2h/day hobby-default haircut.
        assert.equal(result.dailyAvailableMinutes, 9 * 60);
    });

    test('no intent-stated window leaves explicitWindowStated false and the default capacity untouched', () => {
        const result = resolveWorkingHours({});
        assert.equal(result.explicitWindowStated, false);
        assert.equal(result.dailyAvailableMinutes, DEFAULT_DAILY_AVAILABLE_MINUTES);
    });
});

// ── night preset (noon–midnight) plays correctly with the existing ─────────
// ── same-day slot math (no wraparound handling needed) ─────────────────────
describe('night preset boundary behavior', () => {
    test('a 3am candidate start clamps forward to noon the same day', () => {
        const from = new Date(2026, 6, 16, 3, 0, 0); // 3am
        const { start } = findNextFreeSlot(from, 60, [], 12, 24);
        assert.equal(start.getHours(), 12);
        assert.equal(start.getDate(), 16);
    });

    test('a task that would end exactly at midnight fits within the night window', () => {
        const from = new Date(2026, 6, 16, 23, 0, 0); // 11pm
        const { start, end } = findNextFreeSlot(from, 60, [], 12, 24);
        assert.equal(start.getHours(), 23);
        assert.equal(end.getHours(), 0); // rolled to 00:00 the next calendar day
        assert.equal(end.getDate(), 17);
    });

    test('a task that would spill past midnight rolls to noon the next day', () => {
        const from = new Date(2026, 6, 16, 23, 30, 0); // 11:30pm, 60min needed
        const { start } = findNextFreeSlot(from, 60, [], 12, 24);
        assert.equal(start.getHours(), 12);
        assert.equal(start.getDate(), 17);
    });
});
