/**
 * time_estimation_agent/prompt_v1.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds a SINGLE prompt covering the entire task list so the LLM returns the
 * full `estimations[]` array in one JSON response (avoids one-call-per-task
 * cost/latency blowup on large plans).
 *
 * Multi-factor adjustment chain (per task):
 *   Base Estimate → Historical Adjustment → Complexity Adjustment
 *                 → Confidence Adjustment → Risk Adjustment → Final Estimate
 */

/**
 * @param {Array<object>} tasks     - context.planning.tasks (id, title, difficulty, requiredSkills, estimatedMinutes, ...)
 * @param {object|null}   memory    - context.memory (averageSpeeds, reliabilityScore, ...)
 * @param {object|null}   benchmark - context.benchmark (historical bias data, may be null/sparse)
 * @param {object|null}   dependency- context.dependency (criticalPath, topologicalOrdering)
 * @returns {string} prompt
 */
export function buildTimeEstimationPrompt(tasks, memory, benchmark, dependency) {
    const mem = memory ?? {};
    const bench = benchmark ?? {};
    const dep = dependency ?? {};

    const averageSpeeds = mem.averageSpeeds ?? {
        coding: 0, writing: 0, research: 0, reading: 0, design: 0, debugging: 0, revision: 0,
    };
    const reliabilityScore = typeof mem.reliabilityScore === 'number' ? mem.reliabilityScore : 0.5;

    const criticalPath = Array.isArray(dep.criticalPath) ? dep.criticalPath : [];
    const topologicalOrdering = Array.isArray(dep.topologicalOrdering) ? dep.topologicalOrdering : [];

    const taskSummaries = (tasks ?? []).map((t) => ({
        taskId: t.taskId,
        title: t.title,
        difficulty: t.difficulty ?? 'medium',
        requiredSkills: t.requiredSkills ?? [],
        baselineEstimatedMinutes: t.estimatedMinutes ?? 0,
        onCriticalPath: criticalPath.includes(t.taskId),
    }));

    return `You are an expert Time Estimation Agent for a project planning system.

Your job: produce a THREE-POINT estimate (optimistic / expected / worst-case) for EVERY task below,
using a multi-factor adjustment chain, and return them all in ONE JSON response.

## Adjustment Chain (apply in this exact order, each as a percentage of the running estimate)
1. Base Estimate — start from the task's baseline estimate (planning agent's rough guess), or infer
   one from difficulty + requiredSkills if the baseline is 0/missing.
2. Historical Adjustment (historicalAdjustmentPct) — use the user's historical averageSpeeds and
   benchmark bias below. If the user is historically SLOWER than baseline assumptions for this skill
   type, this should be POSITIVE (increase time). If faster, NEGATIVE.
3. Complexity Adjustment (complexityAdjustmentPct) — based on task difficulty and required skill breadth.
4. Confidence Adjustment (confidenceAdjustmentPct) — how well-specified the task is; ambiguous/novel
   tasks get a positive bump, well-understood/routine tasks can get a negative (reducing) adjustment.
5. Risk Adjustment (riskAdjustmentPct) — external risk factors (dependencies, critical path membership,
   unfamiliar tooling, integration risk). Tasks on the critical path should generally carry extra risk buffer.

finalEstimateMinutes = baseEstimateMinutes * (1 + (historicalAdjustmentPct + complexityAdjustmentPct + confidenceAdjustmentPct + riskAdjustmentPct) / 100)

## Three-point estimate
- optimisticMinutes: best-case, everything goes smoothly (should be <= expectedMinutes)
- expectedMinutes: should equal (or closely track) finalEstimateMinutes
- worstCaseMinutes: things go wrong, blockers, rework (should be >= expectedMinutes)
HARD CONSTRAINT: optimisticMinutes <= expectedMinutes <= worstCaseMinutes for every task. Never violate this.

## User Historical Context (context.memory)
averageSpeeds (minutes-per-unit-of-work by category, 0 = no data yet): ${JSON.stringify(averageSpeeds)}
reliabilityScore (0-1, how consistently the user hits their own estimates): ${reliabilityScore}

## Benchmark / Historical Bias Data (context.benchmark — may be sparse or empty; treat defensively)
${JSON.stringify(bench)}

## Dependency Context (context.dependency)
criticalPath: ${JSON.stringify(criticalPath)}
topologicalOrdering: ${JSON.stringify(topologicalOrdering)}

## Tasks to estimate (${taskSummaries.length} total)
${JSON.stringify(taskSummaries, null, 2)}

## Output format
Return ONLY valid JSON, no markdown, no explanation, in exactly this shape:

{
  "estimations": [
    {
      "taskId": "T1",
      "baseEstimateMinutes": 60,
      "historicalAdjustmentPct": 40,
      "complexityAdjustmentPct": 20,
      "confidenceAdjustmentPct": -10,
      "riskAdjustmentPct": 15,
      "finalEstimateMinutes": 109,
      "optimisticMinutes": 45,
      "expectedMinutes": 90,
      "worstCaseMinutes": 150,
      "difficulty": "medium",
      "confidence": 0.75,
      "riskFactors": ["string"],
      "similarTasksFound": true,
      "adjustmentReason": "string explaining the chain of adjustments applied"
    }
  ],
  "reasoning": {
    "confidence": 0.8,
    "assumptions": ["string"],
    "warnings": ["string"],
    "alternatives": [],
    "promptVersion": "v1.0.0"
  }
}

Include EXACTLY one entry in "estimations" per task listed above, in the same order, using the
exact same "taskId" values. Do not omit any task. Do not add extra tasks.`;
}
