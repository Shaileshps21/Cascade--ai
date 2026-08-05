/**
 * memory_agent/prompt_v1.js
 * Used as LLM fallback when insufficient task history exists (< 5 completed tasks).
 */

export function buildMemoryFallbackPrompt(category, complexity, rawGoal) {
    return `You are a project planning expert providing realistic baseline estimates.

A user wants to: "${rawGoal}"
Category: ${category}
Complexity: ${complexity}

Since no historical data is available, provide reasonable baseline estimates for this type of project.

Return ONLY valid JSON:
{
  "schemaVersion": "1.0.0",
  "similarProjects": [],
  "averageSuccessRate": 0.75,
  "commonFailures": [
    "Underestimating complexity",
    "Skipping testing",
    "Poor time management"
  ],
  "bestWorkflowModules": [
    "Research",
    "Design",
    "Implementation",
    "Testing",
    "Review"
  ],
  "averageSpeeds": {
    "coding": 30,
    "writing": 45,
    "research": 60,
    "reading": 40,
    "design": 50,
    "debugging": 35,
    "revision": 25
  },
  "optimalWorkHours": [9, 10, 14, 15],
  "reliabilityScore": 0.7,
  "reasoning": {
    "confidence": 0.6,
    "assumptions": ["No historical data — using category baseline"],
    "warnings": ["Low confidence: no historical data for this user"],
    "promptVersion": "v1.0.0"
  }
}`;
}
