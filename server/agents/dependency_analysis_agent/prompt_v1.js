/**
 * dependency_analysis_agent/prompt_v1.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The LLM's job here is narrow and cheap (uses clients.flash): review the
 * deterministic dependency graph already extracted from context.planning and
 * suggest any MISSING edges (two tasks/modules clearly related by topic that
 * have no declared dependency) and flag any circular references it notices.
 *
 * The LLM does NOT compute the DAG algorithms (topological sort, critical
 * path, parallel groups) — those are 100% deterministic and happen after
 * this review, in agent.js.
 */

/**
 * @param {Array<{id:string, type:'milestone'|'module'|'task', title:string, dependencies:string[]}>} nodeSummaries
 * @returns {string} prompt text
 */
export function buildDependencyReviewPrompt(nodeSummaries) {
    const compact = nodeSummaries.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        dependsOn: n.dependencies,
    }));

    return `You are a meticulous project-dependency reviewer.

Below is the full list of milestones, modules, and tasks for a project plan, each with its declared dependencies (items it depends on / must happen after).

DATA (JSON array of nodes):
${JSON.stringify(compact, null, 2)}

Your job:
1. Identify any MISSING dependency that should obviously exist based on the titles/topics (e.g. a task titled "Write integration tests for API" almost certainly depends on a task titled "Implement API endpoints" even if not declared). Only suggest edges you are reasonably confident about — do not invent speculative links.
2. Identify any circular reference chains you notice among the declared dependencies (a depends on b, b depends on a, directly or through a chain).
3. Never suggest a self-dependency (a node depending on itself).
4. Only reference ids that appear in the DATA above.

Return ONLY valid JSON, no markdown, no commentary, in exactly this shape:
{
  "suggestedEdges": [
    { "from": "<id this depends on>", "to": "<id that has the new dependency>", "reason": "short justification" }
  ],
  "flaggedCycles": [
    ["<id1>", "<id2>", "<id3>", "<id1>"]
  ]
}

If you find nothing to add, return { "suggestedEdges": [], "flaggedCycles": [] }.`;
}
