/**
 * dependency_analysis_agent/agent.test.js
 * Unit tests for the pure, deterministic DAG algorithms and graph builders.
 * No network, LLM, or Firestore access required.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    topologicalSort,
    detectCycles,
    breakCycles,
    computeCriticalPath,
    findParallelGroups,
    findBlockedTasks,
    buildInitialGraph,
    classifyNodeTypes,
    buildDurationsMap,
    buildNodeSummaries,
    mergeSuggestedEdges,
} from './agent.js';

describe('topologicalSort', () => {
    test('produces a valid order for a simple chain A -> B -> C', () => {
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
        const { order, hasCycle } = topologicalSort(nodes, edges);
        assert.equal(hasCycle, false);
        assert.deepEqual(order, ['A', 'B', 'C']);
    });

    test('produces a valid order for a diamond dependency graph', () => {
        // A -> B, A -> C, B -> D, C -> D
        const nodes = ['D', 'C', 'B', 'A'];
        const edges = [
            { from: 'A', to: 'B' },
            { from: 'A', to: 'C' },
            { from: 'B', to: 'D' },
            { from: 'C', to: 'D' },
        ];
        const { order, hasCycle } = topologicalSort(nodes, edges);
        assert.equal(hasCycle, false);
        // A must come first, D must come last; B/C can be in either order (lexicographic tiebreak -> B before C)
        assert.equal(order[0], 'A');
        assert.equal(order[order.length - 1], 'D');
        assert.deepEqual(order, ['A', 'B', 'C', 'D']);
    });

    test('is deterministic across repeated calls on the same graph', () => {
        const nodes = ['T3', 'T1', 'T2', 'T4'];
        const edges = [{ from: 'T1', to: 'T3' }, { from: 'T2', to: 'T3' }, { from: 'T3', to: 'T4' }];
        const first = topologicalSort(nodes, edges);
        const second = topologicalSort(nodes, edges);
        assert.deepEqual(first.order, second.order);
    });

    test('detects a cycle and marks hasCycle true, with a partial order', () => {
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }];
        const { order, hasCycle } = topologicalSort(nodes, edges);
        assert.equal(hasCycle, true);
        assert.ok(order.length < nodes.length);
    });

    test('handles an empty graph', () => {
        const { order, hasCycle } = topologicalSort([], []);
        assert.deepEqual(order, []);
        assert.equal(hasCycle, false);
    });

    test('handles disconnected nodes with no edges', () => {
        const { order, hasCycle } = topologicalSort(['X', 'Y', 'Z'], []);
        assert.equal(hasCycle, false);
        assert.deepEqual(order, ['X', 'Y', 'Z']);
    });
});

describe('detectCycles', () => {
    test('returns empty array for an acyclic graph', () => {
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
        assert.deepEqual(detectCycles(nodes, edges), []);
    });

    test('finds a known 3-node cycle', () => {
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }];
        const cycles = detectCycles(nodes, edges);
        assert.equal(cycles.length, 1);
        const cycle = cycles[0];
        // First and last node of the reported cycle must match (closed loop)
        assert.equal(cycle[0], cycle[cycle.length - 1]);
        // All three nodes must appear in the cycle
        for (const n of nodes) assert.ok(cycle.includes(n));
    });

    test('finds a direct 2-node mutual cycle', () => {
        const nodes = ['M1', 'M2'];
        const edges = [{ from: 'M1', to: 'M2' }, { from: 'M2', to: 'M1' }];
        const cycles = detectCycles(nodes, edges);
        assert.equal(cycles.length, 1);
    });

    test('finds no cycle in a graph with a shared dependency (diamond)', () => {
        const nodes = ['A', 'B', 'C', 'D'];
        const edges = [
            { from: 'A', to: 'B' }, { from: 'A', to: 'C' },
            { from: 'B', to: 'D' }, { from: 'C', to: 'D' },
        ];
        assert.deepEqual(detectCycles(nodes, edges), []);
    });
});

describe('breakCycles', () => {
    test('removes an edge to make a 3-node cycle acyclic', () => {
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }];
        const { edges: fixed, removedEdges } = breakCycles(nodes, edges);
        assert.equal(removedEdges.length, 1);
        assert.equal(detectCycles(nodes, fixed).length, 0);
    });

    test('prefers removing an edge flagged as removable', () => {
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }];
        const isRemovable = (edge) => edge.from === 'C' && edge.to === 'A';
        const { edges: fixed, removedEdges } = breakCycles(nodes, edges, isRemovable);
        assert.equal(removedEdges.length, 1);
        assert.deepEqual(removedEdges[0], { from: 'C', to: 'A' });
        assert.equal(fixed.length, 2);
    });

    test('is a no-op when the graph is already acyclic', () => {
        const nodes = ['A', 'B'];
        const edges = [{ from: 'A', to: 'B' }];
        const { edges: fixed, removedEdges } = breakCycles(nodes, edges);
        assert.equal(removedEdges.length, 0);
        assert.deepEqual(fixed, edges);
    });

    test('resolves multiple independent cycles', () => {
        const nodes = ['A', 'B', 'C', 'X', 'Y', 'Z'];
        const edges = [
            { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' },
            { from: 'X', to: 'Y' }, { from: 'Y', to: 'Z' }, { from: 'Z', to: 'X' },
        ];
        const { edges: fixed } = breakCycles(nodes, edges);
        assert.equal(detectCycles(nodes, fixed).length, 0);
    });
});

describe('computeCriticalPath', () => {
    test('finds the correct path and total duration for a simple weighted chain', () => {
        const nodes = ['T1', 'T2', 'T3'];
        const edges = [{ from: 'T1', to: 'T2' }, { from: 'T2', to: 'T3' }];
        const durations = { T1: 30, T2: 60, T3: 45 };
        const { path, length } = computeCriticalPath(nodes, edges, durations);
        assert.deepEqual(path, ['T1', 'T2', 'T3']);
        assert.equal(length, 135);
    });

    test('picks the longer branch in a diamond graph', () => {
        // A(10) -> B(50) -> D(10)
        // A(10) -> C(5)  -> D(10)
        // Longer path is A -> B -> D = 70
        const nodes = ['A', 'B', 'C', 'D'];
        const edges = [
            { from: 'A', to: 'B' }, { from: 'A', to: 'C' },
            { from: 'B', to: 'D' }, { from: 'C', to: 'D' },
        ];
        const durations = { A: 10, B: 50, C: 5, D: 10 };
        const { path, length } = computeCriticalPath(nodes, edges, durations);
        assert.deepEqual(path, ['A', 'B', 'D']);
        assert.equal(length, 70);
    });

    test('defaults missing durations to 0', () => {
        const nodes = ['A', 'B'];
        const edges = [{ from: 'A', to: 'B' }];
        const { length } = computeCriticalPath(nodes, edges, {});
        assert.equal(length, 0);
    });

    test('returns an error and empty path when the graph has a cycle', () => {
        const nodes = ['A', 'B'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }];
        const result = computeCriticalPath(nodes, edges, { A: 10, B: 10 });
        assert.deepEqual(result.path, []);
        assert.equal(result.length, 0);
        assert.ok(result.error);
    });

    test('handles a single isolated node', () => {
        const { path, length } = computeCriticalPath(['A'], [], { A: 20 });
        assert.deepEqual(path, ['A']);
        assert.equal(length, 20);
    });
});

describe('findParallelGroups', () => {
    test('groups independent root nodes together', () => {
        const nodes = ['A', 'B', 'C'];
        const groups = findParallelGroups(nodes, []);
        assert.equal(groups.length, 1);
        assert.deepEqual(groups[0], ['A', 'B', 'C']);
    });

    test('separates a linear chain into one node per group', () => {
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
        const groups = findParallelGroups(nodes, edges);
        assert.deepEqual(groups, [['A'], ['B'], ['C']]);
    });

    test('groups siblings with a shared dependency into the same level', () => {
        // A -> B, A -> C (B and C can run in parallel after A)
        const nodes = ['A', 'B', 'C'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }];
        const groups = findParallelGroups(nodes, edges);
        assert.equal(groups.length, 2);
        assert.deepEqual(groups[0], ['A']);
        assert.deepEqual(groups[1], ['B', 'C']);
    });

    test('returns empty array for a cyclic graph', () => {
        const nodes = ['A', 'B'];
        const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }];
        assert.deepEqual(findParallelGroups(nodes, edges), []);
    });
});

describe('findBlockedTasks', () => {
    test('identifies tasks with at least one incoming dependency edge', () => {
        const nodes = ['T1', 'T2', 'T3'];
        const edges = [{ from: 'T1', to: 'T2' }, { from: 'T1', to: 'T3' }];
        assert.deepEqual(findBlockedTasks(nodes, edges), ['T2', 'T3']);
    });

    test('returns empty array when no tasks have dependencies', () => {
        const nodes = ['T1', 'T2'];
        assert.deepEqual(findBlockedTasks(nodes, []), []);
    });

    test('only reports nodes present in the provided candidate list', () => {
        // MOD1 -> T1 edge exists, but only T1 is in the candidate (task) list
        const candidateTasks = ['T1', 'T2'];
        const edges = [{ from: 'MOD1', to: 'T1' }];
        assert.deepEqual(findBlockedTasks(candidateTasks, edges), ['T1']);
    });
});

describe('buildInitialGraph', () => {
    const planning = {
        milestones: [
            {
                id: 'M1',
                dependencies: [],
                modules: [
                    { id: 'MOD1', dependencies: [] },
                    { id: 'MOD2', dependencies: ['MOD1'] },
                ],
            },
            {
                id: 'M2',
                dependencies: ['M1'],
                modules: [{ id: 'MOD3', dependencies: [] }],
            },
        ],
        tasks: [
            { taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', dependencies: [] },
            { taskId: 'T2', milestoneId: 'M1', moduleId: 'MOD1', dependencies: ['T1'] },
            { taskId: 'T3', milestoneId: 'M2', moduleId: 'MOD3', dependencies: ['T2'] },
        ],
    };

    test('includes all milestone, module, and task ids as nodes', () => {
        const { nodes } = buildInitialGraph(planning);
        for (const id of ['M1', 'M2', 'MOD1', 'MOD2', 'MOD3', 'T1', 'T2', 'T3']) {
            assert.ok(nodes.includes(id), `expected nodes to include ${id}`);
        }
    });

    test('builds edges from declared dependencies at every level', () => {
        const { edges } = buildInitialGraph(planning);
        assert.ok(edges.some(e => e.from === 'M1' && e.to === 'M2'));
        assert.ok(edges.some(e => e.from === 'MOD1' && e.to === 'MOD2'));
        assert.ok(edges.some(e => e.from === 'T1' && e.to === 'T2'));
        assert.ok(edges.some(e => e.from === 'T2' && e.to === 'T3'));
    });

    test('the resulting graph is acyclic and yields a full topological order', () => {
        const { nodes, edges } = buildInitialGraph(planning);
        const { hasCycle, order } = topologicalSort(nodes, edges);
        assert.equal(hasCycle, false);
        assert.equal(order.length, nodes.length);
    });

    test('ignores self-dependencies defensively', () => {
        const selfDepPlanning = {
            milestones: [],
            tasks: [{ taskId: 'T1', dependencies: ['T1'] }],
        };
        const { edges } = buildInitialGraph(selfDepPlanning);
        assert.equal(edges.length, 0);
    });

    test('handles missing/empty planning gracefully', () => {
        const { nodes, edges } = buildInitialGraph({});
        assert.deepEqual(nodes, []);
        assert.deepEqual(edges, []);
    });
});

describe('classifyNodeTypes', () => {
    test('separates milestone, module, and task ids correctly', () => {
        const planning = {
            milestones: [{ id: 'M1', modules: [{ id: 'MOD1' }] }],
            tasks: [{ taskId: 'T1' }, { taskId: 'T2' }],
        };
        const { milestoneIds, moduleIds, taskIds } = classifyNodeTypes(planning);
        assert.deepEqual([...milestoneIds], ['M1']);
        assert.deepEqual([...moduleIds], ['MOD1']);
        assert.deepEqual([...taskIds].sort(), ['T1', 'T2']);
    });
});

describe('buildDurationsMap', () => {
    test('uses estimatedMinutes when present and positive', () => {
        const planning = { tasks: [{ taskId: 'T1', estimatedMinutes: 90 }] };
        assert.deepEqual(buildDurationsMap(planning), { T1: 90 });
    });

    test('falls back to a default duration when missing or non-positive', () => {
        const planning = {
            tasks: [
                { taskId: 'T1' },
                { taskId: 'T2', estimatedMinutes: 0 },
                { taskId: 'T3', estimatedMinutes: -5 },
            ],
        };
        const durations = buildDurationsMap(planning);
        assert.equal(durations.T1, 30);
        assert.equal(durations.T2, 30);
        assert.equal(durations.T3, 30);
    });
});

describe('buildNodeSummaries', () => {
    test('produces one summary entry per milestone, module, and task', () => {
        const planning = {
            milestones: [{ id: 'M1', title: 'Milestone One', dependencies: [], modules: [{ id: 'MOD1', title: 'Module One', dependencies: [] }] }],
            tasks: [{ taskId: 'T1', title: 'Task One', dependencies: [] }],
        };
        const summaries = buildNodeSummaries(planning);
        assert.equal(summaries.length, 3);
        assert.deepEqual(summaries.map(s => s.type).sort(), ['milestone', 'module', 'task']);
    });
});

describe('mergeSuggestedEdges', () => {
    test('accepts a valid, cycle-safe suggestion', () => {
        const nodes = ['T1', 'T2', 'T3'];
        const declared = [{ from: 'T1', to: 'T2' }];
        const suggested = [{ from: 'T2', to: 'T3', reason: 'topically related' }];
        const { edges, acceptedKeys, rejected } = mergeSuggestedEdges(nodes, declared, suggested);
        assert.equal(edges.length, 2);
        assert.ok(acceptedKeys.has('T2->T3'));
        assert.equal(rejected.length, 0);
    });

    test('rejects a suggestion that would introduce a cycle', () => {
        const nodes = ['T1', 'T2', 'T3'];
        const declared = [{ from: 'T1', to: 'T2' }, { from: 'T2', to: 'T3' }];
        const suggested = [{ from: 'T3', to: 'T1', reason: 'bad suggestion' }];
        const { edges, rejected } = mergeSuggestedEdges(nodes, declared, suggested);
        assert.equal(edges.length, 2); // unchanged
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].reason, 'would introduce a cycle');
    });

    test('rejects a self-dependency suggestion', () => {
        const nodes = ['T1'];
        const { edges, rejected } = mergeSuggestedEdges(nodes, [], [{ from: 'T1', to: 'T1' }]);
        assert.equal(edges.length, 0);
        assert.equal(rejected[0].reason, 'self-dependency');
    });

    test('rejects a suggestion referencing an unknown node', () => {
        const nodes = ['T1', 'T2'];
        const { edges, rejected } = mergeSuggestedEdges(nodes, [], [{ from: 'T1', to: 'T99' }]);
        assert.equal(edges.length, 0);
        assert.equal(rejected[0].reason, 'unknown node id');
    });

    test('rejects a duplicate of an already-declared edge', () => {
        const nodes = ['T1', 'T2'];
        const declared = [{ from: 'T1', to: 'T2' }];
        const { edges, rejected } = mergeSuggestedEdges(nodes, declared, [{ from: 'T1', to: 'T2' }]);
        assert.equal(edges.length, 1);
        assert.equal(rejected[0].reason, 'already declared');
    });
});

describe('end-to-end deterministic pipeline (no LLM)', () => {
    test('builds graph, merges suggestions, breaks cycles, and computes all outputs consistently', () => {
        const planning = {
            milestones: [
                { id: 'M1', dependencies: [], modules: [{ id: 'MOD1', dependencies: [] }] },
            ],
            tasks: [
                { taskId: 'T1', dependencies: [], estimatedMinutes: 20 },
                { taskId: 'T2', dependencies: ['T1'], estimatedMinutes: 40 },
                { taskId: 'T3', dependencies: ['T1'], estimatedMinutes: 10 },
            ],
        };

        const { nodes, edges: declaredEdges } = buildInitialGraph(planning);
        const { taskIds, milestoneIds } = classifyNodeTypes(planning);
        const durations = buildDurationsMap(planning);

        // Simulate an LLM suggestion that is valid (T3 -> T2 introduces no cycle... actually
        // check: T3 has no dependents yet, so T3 -> T2 is fine since T2 doesn't feed back to T3)
        const { edges: merged } = mergeSuggestedEdges(nodes, declaredEdges, [{ from: 'T3', to: 'T2' }]);

        const { order, hasCycle } = topologicalSort(nodes, merged);
        assert.equal(hasCycle, false);

        const { path, length } = computeCriticalPath(nodes, merged, durations);
        assert.ok(path.length > 0);
        assert.ok(length > 0);

        const groups = findParallelGroups(nodes, merged);
        assert.ok(groups.length > 0);

        const blocked = findBlockedTasks([...taskIds], merged);
        assert.ok(blocked.includes('T2'));
        assert.ok(blocked.includes('T3'));
        assert.ok(!blocked.includes('T1'));

        const milestoneOrder = order.filter(id => milestoneIds.has(id));
        assert.deepEqual(milestoneOrder, ['M1']);
    });
});
