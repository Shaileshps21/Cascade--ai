/**
 * prioritization_agent/prompt_v1.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prompt template for the Prioritization Agent.
 *
 * Preserved from the original prioritizationAgent.js scoring rubric
 * (urgency thresholds based on hours-until-deadline, risk boosting based on
 * historical underestimation) — but adapted to read `context.memory`
 * (already computed by the Memory Agent from task_history/user_benchmarks)
 * instead of querying RAG/Firestore directly.
 *
 * New fields added per the v3 refactor: businessValue, projectImportance,
 * deadlineConfidence, estimatedUncertainty, expectedInterruptionScore.
 */

const PRIORITY_PROMPT = `You are a task prioritization AI with deep insight into human productivity patterns and project management risk.

Analyze the task, its intent, and the user's historical memory profile below. Respond ONLY with valid JSON:

{
  "priorityScore": <0-100 overall priority>,
  "urgencyScore":  <0-100 how time-critical>,
  "importanceScore": <0-100 how impactful>,
  "riskScore":     <0-100 likelihood of missing deadline>,
  "businessValue": <0-100 value delivered to the user's broader goals if completed>,
  "projectImportance": <0-100 how central this task is relative to the user's other commitments>,
  "deadlineConfidence": <0-1 confidence that the deadline is realistic and achievable>,
  "estimatedUncertainty": <0-100 uncertainty in the time/effort estimate — higher means less predictable>,
  "expectedInterruptionScore": <0-100 likelihood this task gets interrupted or deprioritized before completion>,
  "personalizationInsights": ["<insight derived from user memory/history, if available>"],
  "recommendedStartTime": "<ISO 8601 — latest safe start time to still hit the deadline>",
  "bufferHoursNeeded": <extra hours to reserve based on past underestimation, default 0>,
  "warningFlags": ["<critical warning if any, e.g. tight deadline, low reliability>"],
  "reasoning": {
    "confidence": <0-1 how confident you are in these scores>,
    "summary": "<2-3 sentence explanation of the scores above>",
    "assumptions": ["<assumption made, e.g. no history available>"],
    "warnings": ["<ambiguous input, missing deadline, etc.>"],
    "promptVersion": "v1.0.0"
  }
}

Scoring rules (preserve exactly):
- urgencyScore: 90+ if <12h left until deadline, 70+ if <24h, 50+ if <48h, 30+ if <72h, otherwise scale down further
- riskScore: increase (boost) if the user's memory profile shows a low reliabilityScore or low averageSuccessRate for similar tasks, or if commonFailures suggest this category is prone to delay
- If no meaningful memory/history is available, base all scores on task attributes only and note that explicitly in warningFlags/personalizationInsights
- deadlineConfidence should be LOW when riskScore is HIGH and reliabilityScore is LOW
- estimatedUncertainty should be HIGH when the memory profile has few similarProjects or low reliabilityScore
- expectedInterruptionScore should rise with task complexity and category volatility (e.g. "work" tasks with many dependents tend to get interrupted more than solitary "personal" tasks)`;

/**
 * Build the prioritization prompt.
 * @param {object} intent - context.intent { title, category, complexity, urgency, deadline, ... }
 * @param {object} memory - context.memory { similarProjects, averageSuccessRate, commonFailures, bestWorkflowModules, averageSpeeds, optimalWorkHours, reliabilityScore }
 * @param {string} nowISO - current time as ISO 8601
 * @param {number|null} hoursUntilDeadline - hours remaining until deadline (null if no deadline resolved yet)
 * @param {string} rawGoal - the original raw user goal string
 * @returns {string} prompt
 */
export function buildPrioritizationPrompt(intent, memory, nowISO, hoursUntilDeadline, rawGoal) {
    const safeIntent = intent ?? {};
    const safeMemory = memory ?? {};

    const memorySection = safeMemory && (safeMemory.similarProjects?.length || safeMemory.reliabilityScore !== undefined)
        ? `USER MEMORY PROFILE (from Memory Agent — derived from task_history/user_benchmarks):
- reliabilityScore: ${safeMemory.reliabilityScore ?? 'unknown'} (0-1, higher = more historically reliable)
- averageSuccessRate: ${safeMemory.averageSuccessRate ?? 'unknown'} (0-1)
- commonFailures: ${JSON.stringify(safeMemory.commonFailures ?? [])}
- bestWorkflowModules: ${JSON.stringify(safeMemory.bestWorkflowModules ?? [])}
- similarProjects: ${JSON.stringify((safeMemory.similarProjects ?? []).slice(0, 5))}
- optimalWorkHours: ${JSON.stringify(safeMemory.optimalWorkHours ?? [])}`
        : `USER MEMORY PROFILE: None available — base scores on task attributes only and flag this in warningFlags.`;

    const deadlineSection = hoursUntilDeadline !== null && hoursUntilDeadline !== undefined && !Number.isNaN(hoursUntilDeadline)
        ? `HOURS UNTIL DEADLINE: ${hoursUntilDeadline.toFixed(1)}`
        : `HOURS UNTIL DEADLINE: unknown — no resolved deadline yet, treat urgency conservatively`;

    return `${PRIORITY_PROMPT}

TASK INTENT (from Intent Context Agent):
${JSON.stringify({
        title: safeIntent.title,
        category: safeIntent.category,
        complexity: safeIntent.complexity,
        urgency: safeIntent.urgency,
        deadline: safeIntent.deadline,
        scope: safeIntent.scope,
        userConstraints: safeIntent.userConstraints,
    }, null, 2)}

RAW GOAL: "${rawGoal ?? ''}"

CURRENT TIME: ${nowISO}
${deadlineSection}

${memorySection}

Return ONLY valid JSON. No markdown, no explanation.

Example output structure:
{
  "priorityScore": 78,
  "urgencyScore": 65,
  "importanceScore": 82,
  "riskScore": 40,
  "businessValue": 70,
  "projectImportance": 75,
  "deadlineConfidence": 0.72,
  "estimatedUncertainty": 35,
  "expectedInterruptionScore": 30,
  "personalizationInsights": ["User historically completes similar 'work' tasks on time"],
  "recommendedStartTime": "2026-07-18T09:00:00.000Z",
  "bufferHoursNeeded": 2,
  "warningFlags": [],
  "reasoning": {
    "confidence": 0.82,
    "summary": "Deadline is comfortable and the user has a strong track record on similar tasks, so risk is moderate.",
    "assumptions": ["Memory profile reflects current work capacity"],
    "warnings": [],
    "promptVersion": "v1.0.0"
  }
}`;
}

export { PRIORITY_PROMPT };
