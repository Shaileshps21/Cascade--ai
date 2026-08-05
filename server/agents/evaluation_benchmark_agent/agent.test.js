/**
 * evaluation_benchmark_agent/agent.test.js
 * Unit tests for the pure, deterministic compute helpers. No Firestore, no
 * network — loadUserBenchmarkContext/recordBenchmarkSnapshot (which touch
 * `db`) are intentionally NOT exercised here.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    computePlanningQuality,
    computeSchedulingAccuracy,
    computeEstimationAccuracy,
    computeDependencyMetrics,
    computeKnowledgeQuality,
    computeProductivityMetrics,
    computeSystemMetrics,
    computeCalendarReliability,
    computePlannerConfidence,
    computeTrend,
    appendBenchmarkHistory,
    toHistorySummary,
    pickMonthlyBaseline,
    buildRecommendations,
    applyActualCompletionOverride,
    buildDefaultBenchmark,
} from './agent.js';
import { validateBenchmarkOutput } from './schema.js';

// ═════════════════════════════════════════════════════════════════════════
// computePlanningQuality
// ═════════════════════════════════════════════════════════════════════════

describe('computePlanningQuality', () => {
    test('returns neutral 50 when there is no planning data', () => {
        assert.equal(computePlanningQuality({}), 50);
        assert.equal(computePlanningQuality({ milestones: [], tasks: [] }), 50);
    });

    test('penalizes a hierarchy with only 2 milestones (below the 4-8 bound)', () => {
        const wellFormedTasks = Array.from({ length: 4 }, (_, i) => ({
            taskId: `T${i + 1}`,
            title: `Task ${i + 1}`,
            executionSteps: [1, 2, 3, 4],
            dependencies: [],
        }));

        const wellFormedMilestones = Array.from({ length: 6 }, (_, i) => ({
            id: `M${i + 1}`,
            modules: [
                { id: `MOD${i}A`, tasks: ['T1', 'T2'] },
                { id: `MOD${i}B`, tasks: ['T3', 'T4'] },
            ],
        }));

        const goodScore = computePlanningQuality({ milestones: wellFormedMilestones, tasks: wellFormedTasks });

        const poorMilestones = [
            { id: 'M1', modules: [{ id: 'MODA', tasks: ['T1', 'T2'] }] },
            { id: 'M2', modules: [{ id: 'MODB', tasks: ['T3', 'T4'] }] },
        ];
        const poorScore = computePlanningQuality({ milestones: poorMilestones, tasks: wellFormedTasks });

        assert.ok(poorScore < goodScore, `expected poorScore (${poorScore}) < goodScore (${goodScore})`);
        assert.ok(poorScore < 100);
    });

    test('penalizes duplicate task titles', () => {
        const base = {
            milestones: [{ id: 'M1', modules: [{ id: 'MOD1', tasks: ['T1', 'T2'] }] }],
        };
        const uniqueTasks = [
            { taskId: 'T1', title: 'Write tests', executionSteps: [1, 2, 3], dependencies: [] },
            { taskId: 'T2', title: 'Deploy app', executionSteps: [1, 2, 3], dependencies: [] },
        ];
        const duplicateTasks = [
            { taskId: 'T1', title: 'Write tests', executionSteps: [1, 2, 3], dependencies: [] },
            { taskId: 'T2', title: 'Write tests', executionSteps: [1, 2, 3], dependencies: [] },
        ];

        const uniqueScore = computePlanningQuality({ ...base, tasks: uniqueTasks });
        const duplicateScore = computePlanningQuality({ ...base, tasks: duplicateTasks });

        assert.ok(duplicateScore < uniqueScore);
    });

    test('penalizes dependencies referencing unknown task IDs', () => {
        const milestones = [{ id: 'M1', modules: [{ id: 'MOD1', tasks: ['T1', 'T2'] }] }];
        const validDeps = [
            { taskId: 'T1', title: 'A', executionSteps: [1, 2, 3], dependencies: [] },
            { taskId: 'T2', title: 'B', executionSteps: [1, 2, 3], dependencies: ['T1'] },
        ];
        const invalidDeps = [
            { taskId: 'T1', title: 'A', executionSteps: [1, 2, 3], dependencies: [] },
            { taskId: 'T2', title: 'B', executionSteps: [1, 2, 3], dependencies: ['T99'] },
        ];

        const validScore = computePlanningQuality({ milestones, tasks: validDeps });
        const invalidScore = computePlanningQuality({ milestones, tasks: invalidDeps });

        assert.ok(invalidScore < validScore);
    });

    test('never returns a score outside [0, 100]', () => {
        const manyMilestones = Array.from({ length: 20 }, (_, i) => ({ id: `M${i}`, modules: [] }));
        const score = computePlanningQuality({ milestones: manyMilestones, tasks: [] });
        assert.ok(score >= 0 && score <= 100);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeSchedulingAccuracy
// ═════════════════════════════════════════════════════════════════════════

describe('computeSchedulingAccuracy', () => {
    test('returns neutral 50 when there are no scheduled tasks', () => {
        assert.equal(computeSchedulingAccuracy({}), 50);
    });

    test('penalizes an imbalanced daily workload', () => {
        const balanced = {
            scheduledTasks: [
                { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', estimatedDuration: 60, type: 'coding' },
                { taskId: 'T2', startTime: '2026-07-17T09:00:00.000Z', estimatedDuration: 60, type: 'coding' },
                { taskId: 'T3', startTime: '2026-07-18T09:00:00.000Z', estimatedDuration: 60, type: 'coding' },
            ],
        };
        const imbalanced = {
            scheduledTasks: [
                { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', estimatedDuration: 480, type: 'coding' },
                { taskId: 'T2', startTime: '2026-07-17T09:00:00.000Z', estimatedDuration: 15, type: 'coding' },
                { taskId: 'T3', startTime: '2026-07-18T09:00:00.000Z', estimatedDuration: 15, type: 'coding' },
            ],
        };

        const balancedScore = computeSchedulingAccuracy(balanced);
        const imbalancedScore = computeSchedulingAccuracy(imbalanced);

        assert.ok(imbalancedScore < balancedScore);
    });

    test('penalizes excessive context switching between adjacent tasks', () => {
        const grouped = {
            scheduledTasks: [
                { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', estimatedDuration: 60, type: 'coding' },
                { taskId: 'T2', startTime: '2026-07-16T10:00:00.000Z', estimatedDuration: 60, type: 'coding' },
                { taskId: 'T3', startTime: '2026-07-16T11:00:00.000Z', estimatedDuration: 60, type: 'testing' },
            ],
        };
        const scattered = {
            scheduledTasks: [
                { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', estimatedDuration: 60, type: 'coding' },
                { taskId: 'T2', startTime: '2026-07-16T10:00:00.000Z', estimatedDuration: 60, type: 'research' },
                { taskId: 'T3', startTime: '2026-07-16T11:00:00.000Z', estimatedDuration: 60, type: 'coding' },
            ],
        };

        const groupedScore = computeSchedulingAccuracy(grouped);
        const scatteredScore = computeSchedulingAccuracy(scattered);

        assert.ok(scatteredScore < groupedScore);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeEstimationAccuracy
// ═════════════════════════════════════════════════════════════════════════

describe('computeEstimationAccuracy', () => {
    test('computes correct percentage error and excludes missing actuals', () => {
        const estimations = [
            { taskId: 'T1', finalEstimateMinutes: 100 },
            { taskId: 'T2', finalEstimateMinutes: 50 },
            { taskId: 'T3', finalEstimateMinutes: 200 }, // no matching actual — excluded
        ];
        const tasks = [
            { taskId: 'T1', progress: { actualMinutes: 120 } }, // +20%
            { taskId: 'T2', progress: { actualMinutes: 40 } },  // -20%
            { taskId: 'T3', progress: {} },                     // no actualMinutes
        ];

        const result = computeEstimationAccuracy(estimations, tasks);

        assert.equal(result.sampleSize, 2);
        assert.deepEqual(result.percentageErrors.sort((a, b) => a - b), [-20, 20]);
        // average signed error should be 0 (symmetric +20/-20)
        assert.equal(result.averagePlanningError, 0);
        // average absolute error is 20 -> score = 100 - 20 = 80
        assert.equal(result.score, 80);
    });

    test('does not crash and returns neutral score when no actuals are present', () => {
        const result = computeEstimationAccuracy(
            [{ taskId: 'T1', finalEstimateMinutes: 60 }],
            [{ taskId: 'T1', progress: {} }]
        );
        assert.equal(result.sampleSize, 0);
        assert.equal(result.score, 50);
    });

    test('handles empty inputs gracefully', () => {
        const result = computeEstimationAccuracy([], []);
        assert.equal(result.sampleSize, 0);
        assert.equal(result.score, 50);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeDependencyMetrics
// ═════════════════════════════════════════════════════════════════════════

describe('computeDependencyMetrics', () => {
    test('returns neutral 50 with no graph data', () => {
        const result = computeDependencyMetrics({});
        assert.equal(result.score, 50);
    });

    test('penalizes violations (nodes missing from topological ordering)', () => {
        const clean = {
            dependencyGraph: { nodes: ['T1', 'T2'], edges: [{ from: 'T1', to: 'T2' }] },
            topologicalOrdering: ['T1', 'T2'],
            blockedTasks: ['T2'],
            parallelGroups: [['T1']],
        };
        const withViolation = {
            dependencyGraph: { nodes: ['T1', 'T2', 'T3'], edges: [] },
            topologicalOrdering: ['T1', 'T2'], // T3 never resolved — a violation
            blockedTasks: ['T2'],
            parallelGroups: [['T1']],
        };

        const cleanResult = computeDependencyMetrics(clean);
        const violationResult = computeDependencyMetrics(withViolation);

        assert.equal(cleanResult.violations, 0);
        assert.equal(violationResult.violations, 1);
        assert.ok(violationResult.score < cleanResult.score);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeKnowledgeQuality
// ═════════════════════════════════════════════════════════════════════════

describe('computeKnowledgeQuality', () => {
    test('returns high neutral score when learning is not required', () => {
        const score = computeKnowledgeQuality({ requiresLearning: false, confidence: 0.9 });
        assert.ok(score >= 60);
    });

    test('penalizes learning-required with zero resources', () => {
        const withResources = computeKnowledgeQuality({ requiresLearning: true, confidence: 0.9, resources: [{ title: 'A' }] });
        const withoutResources = computeKnowledgeQuality({ requiresLearning: true, confidence: 0.9, resources: [] });
        assert.ok(withoutResources < withResources);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeProductivityMetrics
// ═════════════════════════════════════════════════════════════════════════

describe('computeProductivityMetrics', () => {
    test('computes completion rate and average delay correctly', () => {
        const planning = {
            tasks: [
                { taskId: 'T1', estimatedMinutes: 60, progress: { status: 'completed', actualMinutes: 90 } }, // +30
                { taskId: 'T2', estimatedMinutes: 60, progress: { status: 'completed', actualMinutes: 30 } },  // -30
                { taskId: 'T3', estimatedMinutes: 60, progress: { status: 'not_started' } },
            ],
        };

        const result = computeProductivityMetrics(planning);

        assert.equal(result.completionRate, 67); // 2/3 rounded
        assert.equal(result.averageDelayMinutes, 0); // (30 + -30) / 2
        assert.equal(result.completedCount, 2);
        assert.equal(result.totalCount, 3);
    });

    test('handles empty task list', () => {
        const result = computeProductivityMetrics({ tasks: [] });
        assert.equal(result.completionRate, 50);
        assert.equal(result.averageDelayMinutes, 0);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeSystemMetrics / computeCalendarReliability / computePlannerConfidence
// ═════════════════════════════════════════════════════════════════════════

describe('computeSystemMetrics', () => {
    test('derives agentSuccessRate from observability logs', () => {
        const context = {
            metadata: {
                observabilityLogs: [
                    { status: 'success', tokens: { total: 100 }, estimatedCost: 0.001, elapsedMs: 500, retries: 0, confidence: 0.9 },
                    { status: 'failed', tokens: { total: 50 }, estimatedCost: 0.0005, elapsedMs: 200, retries: 1, confidence: 0.4 },
                ],
            },
        };
        const result = computeSystemMetrics(context);
        assert.equal(result.totalAgents, 2);
        assert.equal(result.agentSuccessRate, 50);
    });

    test('returns 100% success rate when there are no logs', () => {
        const result = computeSystemMetrics({ metadata: { observabilityLogs: [] } });
        assert.equal(result.agentSuccessRate, 100);
    });
});

describe('computeCalendarReliability', () => {
    test('returns 100 when calendar is not connected', () => {
        const score = computeCalendarReliability({ metadata: { calendarConnected: false }, schedule: { scheduledTasks: [{ taskId: 'T1' }] } });
        assert.equal(score, 100);
    });

    test('computes % of scheduled tasks with a calendar event when connected', () => {
        const context = {
            metadata: { calendarConnected: true },
            schedule: {
                scheduledTasks: [
                    { taskId: 'T1', calendarEventId: 'evt1' },
                    { taskId: 'T2', calendarEventId: null },
                ],
            },
        };
        assert.equal(computeCalendarReliability(context), 50);
    });
});

describe('computePlannerConfidence', () => {
    test('falls back to neutral 70 with no signals', () => {
        assert.equal(computePlannerConfidence({}, {}), 70);
    });

    test('averages available confidence signals', () => {
        const context = { review: { confidenceScore: 90 }, schedule: { confidenceScore: 80 } };
        const result = computePlannerConfidence(context, { avgConfidence: null });
        assert.equal(result, 85);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// computeTrend
// ═════════════════════════════════════════════════════════════════════════

describe('computeTrend', () => {
    test('classifies Improving / Stable / Declining correctly around the ±5 threshold', () => {
        assert.equal(computeTrend(90, 80), 'Improving'); // +10
        assert.equal(computeTrend(82, 80), 'Stable');    // +2
        assert.equal(computeTrend(70, 80), 'Declining'); // -10
    });

    test('defaults to Stable when there is no previous value', () => {
        assert.equal(computeTrend(90, undefined), 'Stable');
        assert.equal(computeTrend(90, null), 'Stable');
    });
});

// ═════════════════════════════════════════════════════════════════════════
// Benchmark history — append-only growth, capped at 50
// ═════════════════════════════════════════════════════════════════════════

describe('appendBenchmarkHistory', () => {
    test('grows by one entry when under the cap', () => {
        const previous = [{ snapshotAt: '1' }, { snapshotAt: '2' }];
        const result = appendBenchmarkHistory(previous, { snapshotAt: '3' }, 50);
        assert.equal(result.length, 3);
        assert.deepEqual(result, [{ snapshotAt: '1' }, { snapshotAt: '2' }, { snapshotAt: '3' }]);
    });

    test('never truncates below existing entries while under the cap', () => {
        let history = [];
        for (let i = 0; i < 10; i++) {
            const before = history.length;
            history = appendBenchmarkHistory(history, { snapshotAt: String(i) }, 50);
            assert.equal(history.length, before + 1);
        }
        assert.equal(history.length, 10);
    });

    test('caps at 50 entries, dropping only the oldest, never the newest', () => {
        let history = Array.from({ length: 50 }, (_, i) => ({ snapshotAt: String(i) }));
        const beforeIds = history.map(h => h.snapshotAt);

        history = appendBenchmarkHistory(history, { snapshotAt: 'NEW' }, 50);

        assert.equal(history.length, 50);
        // oldest entry (id "0") was dropped
        assert.ok(!history.some(h => h.snapshotAt === '0'));
        // the rest of the previous entries (1..49) are all preserved, in order
        assert.deepEqual(history.slice(0, 49).map(h => h.snapshotAt), beforeIds.slice(1));
        // newest entry is present and last
        assert.equal(history[history.length - 1].snapshotAt, 'NEW');
    });
});

describe('toHistorySummary', () => {
    test('extracts the compact summary fields from a full snapshot', () => {
        const snapshot = {
            updatedAt: '2026-07-16T00:00:00.000Z',
            planningQuality: 90,
            scheduleAccuracy: 85,
            dependencyAccuracy: 95,
            estimationAccuracy: 80,
            knowledgeQuality: 88,
            calendarReliability: 100,
            completionRate: 70,
            plannerConfidence: 75,
            benchmarkHistory: ['should not leak into summary'],
            recommendations: ['should not leak into summary'],
        };
        const summary = toHistorySummary(snapshot);
        assert.equal(summary.snapshotAt, snapshot.updatedAt);
        assert.equal(summary.planningQuality, 90);
        assert.equal(summary.completionRate, 70);
        assert.ok(!('benchmarkHistory' in summary));
        assert.ok(!('recommendations' in summary));
    });
});

describe('pickMonthlyBaseline', () => {
    test('returns null when history is empty', () => {
        assert.equal(pickMonthlyBaseline([]), null);
        assert.equal(pickMonthlyBaseline(undefined), null);
    });

    test('returns the oldest entry when history is shorter than 30', () => {
        const history = [{ completionRate: 10 }, { completionRate: 20 }];
        assert.deepEqual(pickMonthlyBaseline(history), { completionRate: 10 });
    });

    test('returns the entry ~30 back when history is long enough', () => {
        const history = Array.from({ length: 40 }, (_, i) => ({ completionRate: i }));
        const baseline = pickMonthlyBaseline(history);
        assert.equal(baseline.completionRate, 10); // index 40 - 30
    });
});

// ═════════════════════════════════════════════════════════════════════════
// buildRecommendations / applyActualCompletionOverride / buildDefaultBenchmark
// ═════════════════════════════════════════════════════════════════════════

describe('buildRecommendations', () => {
    test('flags low scores with actionable recommendations', () => {
        const recs = buildRecommendations({
            estimationAccuracy: 50,
            scheduleAccuracy: 50,
            planningQuality: 95,
            dependencyAccuracy: 95,
            knowledgeQuality: 95,
            averageDelayMinutes: 10,
        });
        assert.ok(recs.some(r => /Time estimates/.test(r)));
        assert.ok(recs.some(r => /Scheduling/.test(r)));
        assert.ok(!recs.some(r => /Plan hierarchy/.test(r)));
    });

    test('returns an empty array when all scores are healthy', () => {
        const recs = buildRecommendations({
            estimationAccuracy: 95,
            scheduleAccuracy: 95,
            planningQuality: 95,
            dependencyAccuracy: 95,
            knowledgeQuality: 95,
            averageDelayMinutes: 5,
        });
        assert.deepEqual(recs, []);
    });
});

describe('applyActualCompletionOverride', () => {
    test('marks the matching task completed with the provided actual minutes', () => {
        const planning = { tasks: [{ taskId: 'T1', progress: { status: 'in_progress' } }] };
        const updated = applyActualCompletionOverride(planning, { taskId: 'T1', actualMinutes: 45 });
        assert.equal(updated.tasks[0].progress.status, 'completed');
        assert.equal(updated.tasks[0].progress.actualMinutes, 45);
    });

    test('returns planning unchanged when no completion data is given', () => {
        const planning = { tasks: [{ taskId: 'T1', progress: { status: 'in_progress' } }] };
        const result = applyActualCompletionOverride(planning, null);
        assert.deepEqual(result, planning);
    });
});

describe('buildDefaultBenchmark', () => {
    test('returns neutral 50 scores and empty arrays, and passes schema validation', () => {
        const defaults = buildDefaultBenchmark();
        assert.equal(defaults.planningQuality, 50);
        assert.deepEqual(defaults.benchmarkHistory, []);
        assert.deepEqual(defaults.recommendations, []);

        const { valid, errors } = validateBenchmarkOutput(defaults);
        assert.ok(valid, `expected defaults to be valid, got errors: ${errors.join(', ')}`);
    });
});
