/**
 * replanning_agent/agent.test.js
 * Unit tests for the pure, deterministic helpers exported by agent.js.
 * No network/LLM/Firestore/Calendar access — only fake, in-memory fixtures.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    identifyAffectedTasks,
    consumeBuffer,
    computeDisruptionScore,
} from './agent.js';

// ═════════════════════════════════════════════════════════════════════════
// identifyAffectedTasks
// ═════════════════════════════════════════════════════════════════════════
describe('identifyAffectedTasks', () => {
    function makeContext({ useDependencyGraph = true } = {}) {
        // Chain: T1 -> T2 -> T3 -> T4 (T4 depends on T3, T3 on T2, T2 on T1)
        // T5 is unrelated (depends on nothing, nothing depends on it).
        const tasks = [
            { taskId: 'T1', dependencies: [], progress: { status: 'not_started' } },
            { taskId: 'T2', dependencies: ['T1'], progress: { status: 'not_started' } },
            { taskId: 'T3', dependencies: ['T2'], progress: { status: 'not_started' } },
            { taskId: 'T4', dependencies: ['T3'], progress: { status: 'not_started' } },
            { taskId: 'T5', dependencies: [], progress: { status: 'not_started' } },
        ];

        const dependency = useDependencyGraph
            ? {
                dependencyGraph: {
                    nodes: ['T1', 'T2', 'T3', 'T4', 'T5'],
                    edges: [
                        { from: 'T1', to: 'T2' },
                        { from: 'T2', to: 'T3' },
                        { from: 'T3', to: 'T4' },
                    ],
                },
            }
            : null;

        return { planning: { tasks }, dependency };
    }

    test('delayed task + all transitive dependents are included (using dependencyGraph)', () => {
        const context = makeContext({ useDependencyGraph: true });
        const affected = identifyAffectedTasks(context, 'T2');
        assert.deepEqual(new Set(affected), new Set(['T2', 'T3', 'T4']));
        assert.ok(!affected.includes('T1'), 'upstream task should not be affected');
        assert.ok(!affected.includes('T5'), 'unrelated task should not be affected');
    });

    test('falls back to raw planning.tasks[].dependencies when no dependency graph exists', () => {
        const context = makeContext({ useDependencyGraph: false });
        const affected = identifyAffectedTasks(context, 'T1');
        assert.deepEqual(new Set(affected), new Set(['T1', 'T2', 'T3', 'T4']));
        assert.ok(!affected.includes('T5'));
    });

    test('excludes tasks already marked completed', () => {
        const context = makeContext({ useDependencyGraph: true });
        context.planning.tasks.find(t => t.taskId === 'T3').progress.status = 'completed';

        const affected = identifyAffectedTasks(context, 'T1');
        assert.ok(!affected.includes('T3'), 'completed task should be excluded');
        // T4 is still a transitive dependent even though T3 (its direct
        // dependency) is excluded from the result — it's still "affected"
        // by the upstream delay.
        assert.ok(affected.includes('T4'));
        assert.ok(affected.includes('T1'));
        assert.ok(affected.includes('T2'));
    });

    test('delayed leaf task with no dependents returns just itself', () => {
        const context = makeContext({ useDependencyGraph: true });
        const affected = identifyAffectedTasks(context, 'T5');
        assert.deepEqual(affected, ['T5']);
    });

    test('returns empty array when delayedTaskId is missing', () => {
        const context = makeContext();
        assert.deepEqual(identifyAffectedTasks(context, undefined), []);
        assert.deepEqual(identifyAffectedTasks(context, null), []);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// consumeBuffer
// ═════════════════════════════════════════════════════════════════════════
describe('consumeBuffer', () => {
    function makeContext() {
        return {
            schedule: {
                bufferSlots: [
                    { startTime: '2026-07-20T09:00:00.000Z', endTime: '2026-07-20T09:30:00.000Z', durationMinutes: 30 },
                    { startTime: '2026-07-21T09:00:00.000Z', endTime: '2026-07-21T10:00:00.000Z', durationMinutes: 60 },
                ],
                scheduledTasks: [
                    { taskId: 'BUF1', isBuffer: true, startTime: '2026-07-22T09:00:00.000Z', endTime: '2026-07-22T09:45:00.000Z' },
                    { taskId: 'T1', isBuffer: false, startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z' },
                ],
            },
        };
    }

    test('fully absorbs a small overrun from the earliest buffer slot', () => {
        const context = makeContext();
        const { remainingOverrunMinutes, consumedSlots } = consumeBuffer(context, 20);

        assert.equal(remainingOverrunMinutes, 0);
        assert.equal(consumedSlots.length, 1);
        assert.equal(consumedSlots[0].startTime, '2026-07-20T09:00:00.000Z');
        assert.equal(consumedSlots[0].consumedMinutes, 20);
    });

    test('partially absorbs a large overrun, leaving a remainder', () => {
        const context = makeContext();
        // Total available buffer across all slots: 30 + 60 + 45 = 135 minutes.
        const { remainingOverrunMinutes, consumedSlots } = consumeBuffer(context, 200);

        assert.equal(remainingOverrunMinutes, 200 - 135);
        // All three buffer sources should have been consumed, earliest first.
        assert.equal(consumedSlots.length, 3);
        assert.equal(consumedSlots[0].startTime, '2026-07-20T09:00:00.000Z');
        assert.equal(consumedSlots[0].consumedMinutes, 30);
        assert.equal(consumedSlots[1].startTime, '2026-07-21T09:00:00.000Z');
        assert.equal(consumedSlots[1].consumedMinutes, 60);
        assert.equal(consumedSlots[2].taskId, 'BUF1');
        assert.equal(consumedSlots[2].consumedMinutes, 45);
    });

    test('consumes exactly the available buffer when overrun matches it precisely', () => {
        const context = makeContext();
        const { remainingOverrunMinutes, consumedSlots } = consumeBuffer(context, 135);
        assert.equal(remainingOverrunMinutes, 0);
        assert.equal(consumedSlots.reduce((s, c) => s + c.consumedMinutes, 0), 135);
    });

    test('zero or negative overrun consumes nothing', () => {
        const context = makeContext();
        assert.deepEqual(consumeBuffer(context, 0), { remainingOverrunMinutes: 0, consumedSlots: [] });
        assert.deepEqual(consumeBuffer(context, -10), { remainingOverrunMinutes: 0, consumedSlots: [] });
    });

    test('no buffer available means the full overrun remains', () => {
        const context = { schedule: { bufferSlots: [], scheduledTasks: [] } };
        const { remainingOverrunMinutes, consumedSlots } = consumeBuffer(context, 50);
        assert.equal(remainingOverrunMinutes, 50);
        assert.equal(consumedSlots.length, 0);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeDisruptionScore
// ═════════════════════════════════════════════════════════════════════════
describe('computeDisruptionScore', () => {
    const base = [
        { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z' },
        { taskId: 'T2', startTime: '2026-07-16T10:10:00.000Z', endTime: '2026-07-16T11:10:00.000Z' },
        { taskId: 'T3', startTime: '2026-07-16T11:20:00.000Z', endTime: '2026-07-16T12:20:00.000Z' },
        { taskId: 'T4', startTime: '2026-07-16T12:30:00.000Z', endTime: '2026-07-16T13:30:00.000Z' },
    ];

    test('0% when nothing changed', () => {
        const identical = base.map(t => ({ ...t }));
        assert.equal(computeDisruptionScore(base, identical), 0);
    });

    test('100% when every task moved', () => {
        const shifted = base.map(t => ({
            ...t,
            startTime: new Date(new Date(t.startTime).getTime() + 3_600_000).toISOString(),
            endTime: new Date(new Date(t.endTime).getTime() + 3_600_000).toISOString(),
        }));
        assert.equal(computeDisruptionScore(base, shifted), 100);
    });

    test('partial: 50% when half the tasks changed', () => {
        const mixed = base.map((t, i) => {
            if (i % 2 === 0) {
                return {
                    ...t,
                    startTime: new Date(new Date(t.startTime).getTime() + 1_800_000).toISOString(),
                    endTime: new Date(new Date(t.endTime).getTime() + 1_800_000).toISOString(),
                };
            }
            return { ...t };
        });
        assert.equal(computeDisruptionScore(base, mixed), 50);
    });

    test('partial: 25% when only one of four tasks changed', () => {
        const mixed = base.map((t, i) => {
            if (i === 0) {
                return { ...t, endTime: new Date(new Date(t.endTime).getTime() + 600_000).toISOString() };
            }
            return { ...t };
        });
        assert.equal(computeDisruptionScore(base, mixed), 25);
    });

    test('empty vs empty is 0%', () => {
        assert.equal(computeDisruptionScore([], []), 0);
    });

    test('added/removed tasks count as changed', () => {
        const withExtra = [...base.map(t => ({ ...t })), { taskId: 'T5', startTime: '2026-07-17T09:00:00.000Z', endTime: '2026-07-17T10:00:00.000Z' }];
        // 1 changed (added) out of 5 union ids = 20%
        assert.equal(computeDisruptionScore(base, withExtra), 20);
    });
});
