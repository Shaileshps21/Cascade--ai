/**
 * dependency_analysis_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Hybrid agent: LLM (clients.flash) reviews the module/task dependency graph
 * for completeness (missing edges, circular references), then a fully
 * deterministic set of DAG algorithms runs on the (possibly LLM-augmented)
 * graph: topological sort, cycle detection, critical path, parallel groups,
 * blocked-task identification.
 *
 * Reads:  context.planning (milestones[], modules nested in milestones, tasks[])
 * Writes: context.dependency
 *
 * All graph algorithms below are pure, dependency-free functions and are
 * exported for unit testing (see agent.test.js). They never touch the
 * network, Firestore, or the LLM clients.
 */

import './schema.js'; // registers schema
import { buildDependencyReviewPrompt } from './prompt_v1.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';

const AGENT_NAME = 'dependency_analysis_agent';
const SSE_NAME = 'dependency';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';
const DEFAULT_TASK_DURATION_MINUTES = 30;

// ═════════════════════════════════════════════════════════════════════════
// Pure, deterministic graph algorithms (unit-tested in agent.test.js)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Build an adjacency list { node -> [successors] } from a node list and edge list.
 * Nodes referenced only by an edge (not present in `nodes`) are included too,
 * so callers get a complete, defensive adjacency map.
 * @param {string[]} nodes
 * @param {{from:string,to:string}[]} edges
 * @returns {Map<string,string[]>}
 */
function buildAdjacency(nodes, edges) {
    const adj = new Map();
    for (const n of nodes) adj.set(n, []);
    for (const e of edges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        if (!adj.has(e.to)) adj.set(e.to, []);
        adj.get(e.from).push(e.to);
    }
    return adj;
}

/**
 * Kahn's algorithm topological sort.
 * Deterministic: ties are broken by lexicographic id order so the same
 * graph always produces the same ordering.
 * @param {string[]} nodes
 * @param {{from:string,to:string}[]} edges
 * @returns {{ order: string[], hasCycle: boolean }}
 */
export function topologicalSort(nodes, edges) {
    const uniqueNodes = Array.from(new Set(nodes));
    const inDegree = new Map(uniqueNodes.map(n => [n, 0]));
    const adj = buildAdjacency(uniqueNodes, edges);

    // Edges may reference nodes not in the provided `nodes` list — count them too.
    for (const n of adj.keys()) {
        if (!inDegree.has(n)) inDegree.set(n, 0);
    }
    for (const e of edges) {
        inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }

    const allNodes = Array.from(inDegree.keys());
    let queue = allNodes.filter(n => inDegree.get(n) === 0).sort();
    const order = [];
    const remaining = new Map(inDegree);

    while (queue.length > 0) {
        queue.sort();
        const n = queue.shift();
        order.push(n);
        for (const m of adj.get(n) ?? []) {
            remaining.set(m, remaining.get(m) - 1);
            if (remaining.get(m) === 0) queue.push(m);
        }
    }

    const hasCycle = order.length !== allNodes.length;
    return { order, hasCycle };
}

/**
 * Detect all simple cycles reachable via DFS (white/gray/black coloring).
 * Returns each cycle as an ordered array of node ids where the first and
 * last element are the same (e.g. ["A","B","C","A"]).
 * @param {string[]} nodes
 * @param {{from:string,to:string}[]} edges
 * @returns {string[][]}
 */
export function detectCycles(nodes, edges) {
    const uniqueNodes = Array.from(new Set(nodes));
    const adj = buildAdjacency(uniqueNodes, edges);
    for (const n of adj.keys()) {
        if (!uniqueNodes.includes(n)) uniqueNodes.push(n);
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map(uniqueNodes.map(n => [n, WHITE]));
    const stack = [];
    const cycles = [];

    function dfs(node) {
        color.set(node, GRAY);
        stack.push(node);
        for (const neighbor of adj.get(node) ?? []) {
            if (color.get(neighbor) === GRAY) {
                const idx = stack.indexOf(neighbor);
                if (idx !== -1) {
                    cycles.push(stack.slice(idx).concat(neighbor));
                }
            } else if ((color.get(neighbor) ?? WHITE) === WHITE) {
                dfs(neighbor);
            }
        }
        stack.pop();
        color.set(node, BLACK);
    }

    for (const n of uniqueNodes) {
        if (color.get(n) === WHITE) dfs(n);
    }

    return cycles;
}

/**
 * Remove the minimum set of edges needed to make the graph acyclic.
 * When a cycle is found, prefers removing an edge for which
 * `isRemovable(edge)` returns true (e.g. an LLM-suggested edge, which is
 * lower-confidence than a declared dependency); falls back to removing the
 * last edge in the cycle otherwise.
 * @param {string[]} nodes
 * @param {{from:string,to:string}[]} edges
 * @param {(edge:{from:string,to:string}) => boolean} [isRemovable]
 * @returns {{ edges: {from:string,to:string}[], removedEdges: {from:string,to:string}[] }}
 */
export function breakCycles(nodes, edges, isRemovable = () => true) {
    let currentEdges = edges.slice();
    const removedEdges = [];
    let guard = 0;
    const maxIterations = edges.length + nodes.length + 10;

    while (guard++ < maxIterations) {
        const cycles = detectCycles(nodes, currentEdges);
        if (cycles.length === 0) break;

        const cycle = cycles[0];
        const cycleEdgeIndices = [];
        for (let i = 0; i < cycle.length - 1; i++) {
            const from = cycle[i];
            const to = cycle[i + 1];
            const idx = currentEdges.findIndex(e => e.from === from && e.to === to);
            if (idx !== -1) cycleEdgeIndices.push(idx);
        }
        if (cycleEdgeIndices.length === 0) break; // defensive: shouldn't happen

        let targetIdx = cycleEdgeIndices.find(idx => isRemovable(currentEdges[idx]));
        if (targetIdx === undefined) targetIdx = cycleEdgeIndices[cycleEdgeIndices.length - 1];

        removedEdges.push(currentEdges[targetIdx]);
        currentEdges = currentEdges.filter((_, i) => i !== targetIdx);
    }

    return { edges: currentEdges, removedEdges };
}

/**
 * Longest-path (critical path) calculation over a DAG, weighted by
 * per-node duration. Returns the path with the greatest total duration.
 * If the graph contains a cycle, returns an empty path with an error note
 * rather than throwing (callers should break cycles first).
 * @param {string[]} nodes
 * @param {{from:string,to:string}[]} edges
 * @param {Record<string, number>} [durationsByNode]
 * @returns {{ path: string[], length: number, error?: string }}
 */
export function computeCriticalPath(nodes, edges, durationsByNode = {}) {
    const { order, hasCycle } = topologicalSort(nodes, edges);
    if (hasCycle) {
        return { path: [], length: 0, error: 'Cannot compute critical path: graph contains a cycle' };
    }
    if (order.length === 0) {
        return { path: [], length: 0 };
    }

    const adj = buildAdjacency(order, edges);
    const dist = new Map(order.map(n => [n, durationsByNode[n] ?? 0]));
    const prev = new Map();

    for (const n of order) {
        for (const m of adj.get(n) ?? []) {
            const mDur = durationsByNode[m] ?? 0;
            const candidate = (dist.get(n) ?? 0) + mDur;
            if (candidate > (dist.get(m) ?? -Infinity)) {
                dist.set(m, candidate);
                prev.set(m, n);
            }
        }
    }

    let endNode = order[0];
    let maxDist = dist.get(endNode) ?? 0;
    for (const [n, d] of dist) {
        if (d > maxDist) {
            maxDist = d;
            endNode = n;
        }
    }

    const path = [];
    let cur = endNode;
    while (cur !== undefined) {
        path.unshift(cur);
        cur = prev.get(cur);
    }

    return { path, length: maxDist };
}

/**
 * Group nodes into "parallel groups" — batches that can, in principle, run
 * concurrently because none depends (directly or transitively) on another
 * node within the same batch. Uses the longest-path level of each node
 * (0 for root nodes, 1 + max(level of predecessors) otherwise).
 * @param {string[]} nodes
 * @param {{from:string,to:string}[]} edges
 * @returns {string[][]} array of groups, each group a sorted array of node ids
 */
export function findParallelGroups(nodes, edges) {
    const { order, hasCycle } = topologicalSort(nodes, edges);
    if (hasCycle) return [];

    const preds = new Map(order.map(n => [n, []]));
    for (const e of edges) {
        if (!preds.has(e.to)) preds.set(e.to, []);
        preds.get(e.to).push(e.from);
    }

    const level = new Map();
    for (const n of order) {
        const ps = preds.get(n) ?? [];
        if (ps.length === 0) {
            level.set(n, 0);
        } else {
            level.set(n, Math.max(...ps.map(p => level.get(p) ?? 0)) + 1);
        }
    }

    const groups = [];
    for (const n of order) {
        const l = level.get(n) ?? 0;
        if (!groups[l]) groups[l] = [];
        groups[l].push(n);
    }

    return groups.filter(Boolean).map(g => g.sort());
}

/**
 * Tasks that are "blocked" — i.e. have at least one declared dependency
 * (incoming edge) and therefore cannot start until that dependency resolves.
 * @param {string[]} nodes - the candidate node ids to check (e.g. task ids only)
 * @param {{from:string,to:string}[]} edges - the full edge list
 * @returns {string[]} sorted list of blocked node ids
 */
export function findBlockedTasks(nodes, edges) {
    const hasIncoming = new Set(edges.map(e => e.to));
    return nodes.filter(n => hasIncoming.has(n)).sort();
}

// ═════════════════════════════════════════════════════════════════════════
// Deterministic graph construction from context.planning
// ═════════════════════════════════════════════════════════════════════════

/**
 * Build the initial dependency graph directly from the declared
 * `dependencies` arrays on milestones, modules, and tasks.
 * @param {object} planning - context.planning
 * @returns {{ nodes: string[], edges: {from:string,to:string}[] }}
 */
export function buildInitialGraph(planning) {
    const nodes = new Set();
    const edges = [];

    const milestones = Array.isArray(planning?.milestones) ? planning.milestones : [];
    const tasks = Array.isArray(planning?.tasks) ? planning.tasks : [];

    for (const m of milestones) {
        if (!m?.id) continue;
        nodes.add(m.id);
        for (const dep of m.dependencies ?? []) {
            if (dep === m.id) continue; // no self-dependency
            nodes.add(dep);
            edges.push({ from: dep, to: m.id });
        }
        for (const mod of m.modules ?? []) {
            if (!mod?.id) continue;
            nodes.add(mod.id);
            for (const dep of mod.dependencies ?? []) {
                if (dep === mod.id) continue;
                nodes.add(dep);
                edges.push({ from: dep, to: mod.id });
            }
        }
    }

    for (const t of tasks) {
        if (!t?.taskId) continue;
        nodes.add(t.taskId);
        for (const dep of t.dependencies ?? []) {
            if (dep === t.taskId) continue;
            nodes.add(dep);
            edges.push({ from: dep, to: t.taskId });
        }
    }

    return { nodes: Array.from(nodes), edges };
}

/**
 * Classify node ids by hierarchy level for later ordering/filtering.
 * @param {object} planning - context.planning
 * @returns {{ milestoneIds: Set<string>, moduleIds: Set<string>, taskIds: Set<string> }}
 */
export function classifyNodeTypes(planning) {
    const milestoneIds = new Set();
    const moduleIds = new Set();
    const taskIds = new Set();

    for (const m of planning?.milestones ?? []) {
        if (m?.id) milestoneIds.add(m.id);
        for (const mod of m.modules ?? []) {
            if (mod?.id) moduleIds.add(mod.id);
        }
    }
    for (const t of planning?.tasks ?? []) {
        if (t?.taskId) taskIds.add(t.taskId);
    }

    return { milestoneIds, moduleIds, taskIds };
}

/**
 * Build a per-node duration map (minutes) used for critical path calculation.
 * Only tasks carry a meaningful duration in the planning schema; milestones
 * and modules are treated as zero-duration aggregation nodes.
 * @param {object} planning - context.planning
 * @returns {Record<string, number>}
 */
export function buildDurationsMap(planning) {
    const durations = {};
    for (const t of planning?.tasks ?? []) {
        if (!t?.taskId) continue;
        durations[t.taskId] = typeof t.estimatedMinutes === 'number' && t.estimatedMinutes > 0
            ? t.estimatedMinutes
            : DEFAULT_TASK_DURATION_MINUTES;
    }
    return durations;
}

/**
 * Build the compact node summary list fed to the LLM review prompt.
 * @param {object} planning - context.planning
 * @returns {Array<{id:string, type:string, title:string, dependencies:string[]}>}
 */
export function buildNodeSummaries(planning) {
    const summaries = [];

    for (const m of planning?.milestones ?? []) {
        if (!m?.id) continue;
        summaries.push({ id: m.id, type: 'milestone', title: m.title ?? '', dependencies: m.dependencies ?? [] });
        for (const mod of m.modules ?? []) {
            if (!mod?.id) continue;
            summaries.push({ id: mod.id, type: 'module', title: mod.title ?? '', dependencies: mod.dependencies ?? [] });
        }
    }
    for (const t of planning?.tasks ?? []) {
        if (!t?.taskId) continue;
        summaries.push({ id: t.taskId, type: 'task', title: t.title ?? '', dependencies: t.dependencies ?? [] });
    }

    return summaries;
}

/**
 * Merge LLM-suggested edges into the declared edge list, accepting only
 * suggestions that: reference known nodes, aren't self-loops, aren't
 * already present, and — critically — do NOT introduce a cycle when added
 * to the graph as it stands so far.
 * @param {string[]} nodes
 * @param {{from:string,to:string}[]} declaredEdges
 * @param {Array<{from:string,to:string,reason?:string}>} suggestedEdges
 * @returns {{ edges: {from:string,to:string}[], acceptedKeys: Set<string>, rejected: Array<{from:string,to:string,reason:string}> }}
 */
export function mergeSuggestedEdges(nodes, declaredEdges, suggestedEdges) {
    const nodeSet = new Set(nodes);
    const edges = declaredEdges.slice();
    const existingKeys = new Set(edges.map(e => `${e.from}->${e.to}`));
    const acceptedKeys = new Set();
    const rejected = [];

    for (const s of suggestedEdges ?? []) {
        if (!s || typeof s.from !== 'string' || typeof s.to !== 'string') continue;
        const key = `${s.from}->${s.to}`;

        if (s.from === s.to) { rejected.push({ ...s, reason: 'self-dependency' }); continue; }
        if (!nodeSet.has(s.from) || !nodeSet.has(s.to)) { rejected.push({ ...s, reason: 'unknown node id' }); continue; }
        if (existingKeys.has(key)) { rejected.push({ ...s, reason: 'already declared' }); continue; }

        const tentative = edges.concat([{ from: s.from, to: s.to }]);
        const { hasCycle } = topologicalSort(nodes, tentative);
        if (hasCycle) { rejected.push({ ...s, reason: 'would introduce a cycle' }); continue; }

        edges.push({ from: s.from, to: s.to });
        existingKeys.add(key);
        acceptedKeys.add(key);
    }

    return { edges, acceptedKeys, rejected };
}

// ═════════════════════════════════════════════════════════════════════════
// Main agent entry point
// ═════════════════════════════════════════════════════════════════════════

/**
 * Run the Dependency Analysis Agent.
 * Reads:  context.planning
 * Writes: context.dependency
 * @param {object} context - PlanningContext
 * @param {object} clients - LLM clients { pro, flash, embedding }
 * @param {object|null} [eventBus]
 * @param {function|null} [sseEmit]
 * @returns {Promise<object>} the parsed and validated dependency output
 */
export async function runDependencyAnalysisAgent(context, clients, eventBus = null, sseEmit = null) {
    return runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'dependency',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 1,
        agentFn: async (ctx, llm) => {
            const planning = ctx.planning ?? {};
            const { nodes, edges: declaredEdges } = buildInitialGraph(planning);
            const { milestoneIds, moduleIds, taskIds } = classifyNodeTypes(planning);
            const durations = buildDurationsMap(planning);

            // ── Step 1: LLM review (best-effort, non-fatal on failure) ────────
            let suggestedEdges = [];
            let flaggedCycles = [];
            try {
                if (nodes.length > 0) {
                    const summaries = buildNodeSummaries(planning);
                    const prompt = buildDependencyReviewPrompt(summaries);
                    const result = await llm.flash.generateText(prompt, { promptVersion: PROMPT_VERSION });
                    const text = extractText(result);
                    const parsed = await parseJSONWithRepair(text, llm.flash);
                    suggestedEdges = Array.isArray(parsed?.suggestedEdges) ? parsed.suggestedEdges : [];
                    flaggedCycles = Array.isArray(parsed?.flaggedCycles) ? parsed.flaggedCycles : [];
                }
            } catch (err) {
                console.warn(`[${AGENT_NAME}] LLM review skipped: ${err.message?.slice(0, 120)}`);
                ctx.metadata?.warnings?.push(`${AGENT_NAME}: LLM dependency review failed (${err.message?.slice(0, 100)}); using declared dependencies only.`);
            }

            // ── Step 2: Merge only cycle-safe suggested edges ──────────────────
            const { edges: mergedEdges, acceptedKeys, rejected } = mergeSuggestedEdges(nodes, declaredEdges, suggestedEdges);

            // ── Step 3: Detect + break any remaining cycles (from declared deps) ─
            const preExistingCycles = detectCycles(nodes, mergedEdges);
            let finalEdges = mergedEdges;
            const removedEdges = [];
            if (preExistingCycles.length > 0) {
                const isLlmEdge = (edge) => acceptedKeys.has(`${edge.from}->${edge.to}`);
                const { edges: brokenEdges, removedEdges: removed } = breakCycles(nodes, mergedEdges, isLlmEdge);
                finalEdges = brokenEdges;
                removedEdges.push(...removed);
                for (const r of removed) {
                    ctx.metadata?.warnings?.push(
                        `${AGENT_NAME}: broke circular dependency by dropping edge ${r.from} -> ${r.to}`
                    );
                }
            }

            // ── Step 4: Deterministic DAG algorithms ────────────────────────────
            const { order: topologicalOrdering, hasCycle: stillHasCycle } = topologicalSort(nodes, finalEdges);
            const { path: criticalPath } = computeCriticalPath(nodes, finalEdges, durations);
            const parallelGroups = findParallelGroups(nodes, finalEdges);
            const blockedTasks = findBlockedTasks(Array.from(taskIds), finalEdges);
            const milestoneOrder = topologicalOrdering.filter(id => milestoneIds.has(id));
            const moduleOrder = topologicalOrdering.filter(id => moduleIds.has(id));

            if (stillHasCycle) {
                ctx.metadata?.warnings?.push(`${AGENT_NAME}: graph still contains a cycle after cycle-breaking; ordering may be incomplete.`);
            }

            const confidence = preExistingCycles.length > 0
                ? 0.6
                : (rejected.length > 0 ? 0.85 : 0.95);

            return {
                schemaVersion: SCHEMA_VERSION,
                dependencyGraph: { nodes, edges: finalEdges },
                parallelGroups,
                criticalPath,
                blockedTasks,
                topologicalOrdering,
                milestoneOrder,
                moduleOrder,
                reasoning: {
                    confidence,
                    assumptions: [
                        `${acceptedKeys.size} LLM-suggested dependency edge(s) accepted`,
                        `${rejected.length} LLM-suggested edge(s) rejected (duplicate, unknown node, or would create a cycle)`,
                    ],
                    warnings: [
                        ...(removedEdges.length > 0 ? [`${removedEdges.length} declared/suggested edge(s) removed to break cycles`] : []),
                        ...(flaggedCycles.length > 0 ? [`LLM flagged ${flaggedCycles.length} potential cycle(s) for review`] : []),
                    ],
                    alternatives: [],
                    promptVersion: PROMPT_VERSION,
                },
            };
        },
    });
}
