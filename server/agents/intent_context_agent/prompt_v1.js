/**
 * intent_context_agent/prompt_v1.js
 * Prompt templates for the Intent Context Agent.
 * Preserved from the original parserAgent.js and enhanced with
 * reasoning block, preferences, userConstraints, and scope fields.
 */

/**
 * Build the intent extraction prompt.
 * @param {string} rawGoal
 * @param {boolean} hasExplicitDeadline - true if user supplied a deadline
 * @param {string} nowISO               - current time as ISO 8601
 * @returns {string} prompt
 */
export function buildIntentPrompt(rawGoal, hasExplicitDeadline, nowISO) {
    const deadlineInstruction = hasExplicitDeadline
        ? `The user has already provided a deadline. Extract and normalize it to ISO 8601 format. If the deadline is in the past, flag it in warnings.`
        : `The user has NOT provided a deadline. You must infer a realistic deadline based on:
- Task complexity and scope
- Typical time requirements for this type of goal
- Current time: ${nowISO}

Guidelines for deadline inference:
- Low complexity: 1–3 days from now
- Medium complexity: 3–7 days from now  
- High complexity: 1–3 weeks from now
- Very high complexity: 3–8 weeks from now
Adjust based on the specific content of the goal.`;

    return `You are an expert Task Intent Extraction Agent.

Your job is to deeply understand the user's goal and extract structured intent data.

Current time: ${nowISO}

User's goal:
"${rawGoal}"

${deadlineInstruction}

Extract the following and return as JSON:

1. title: A concise 3–5 word title summarizing the goal (be specific, not generic)
2. deadline: ISO 8601 datetime string
3. category: One of [work, academic, personal, health, finance, creative, other]
4. complexity: One of [low, medium, high, very_high]
5. urgency: One of [Low, Medium, High, Critical] — based on deadline proximity and stakes
6. estimatedHours: Realistic total hours needed (number)
7. userConstraints: Array of constraints the user mentioned (e.g. "must be done at night", "no budget")
8. assumptions: Array of assumptions you made to fill in missing information
9. preferences: Array of preferences implied by the goal (e.g. "prefers hands-on practice")
10. scope: One sentence describing what is IN scope and what is NOT in scope
11. fixedEvents: Array of NON-NEGOTIABLE, clock-time-specific commitments the user
    explicitly mentioned (meetings, calls, appointments, lunch, classes) — things
    that must NOT be scheduled over, as opposed to flexible tasks. Only extract an
    event here if the user gave (or clearly implied) a specific start and end
    clock time. Resolve relative day references ("today", "tomorrow") against
    Current time above. Each entry: { "title": string, "startTime": ISO 8601,
    "endTime": ISO 8601 }. If the user mentioned NO such fixed-time commitments,
    return an empty array — do not invent any.
12. maxContinuousFocusMinutes: number|null — if the user explicitly stated a rule
    like "no more than 90 minutes of continuous work" or "take a break every
    hour", extract the number of minutes here. Otherwise null — do NOT invent a
    default; the scheduler only applies this rule when it is non-null.
13. breakMinutes: number|null — the break duration the user stated should follow
    maxContinuousFocusMinutes of work (e.g. "then a 15-minute break" → 15).
    Only set this alongside a non-null maxContinuousFocusMinutes; otherwise null.
14. workStartHour: number|null — if the user explicitly stated working hours for
    THIS request (e.g. "working hours: 09:00 to 18:00", "9am-6pm", "office hours"),
    the start hour as an integer 0-23 (24-hour clock, e.g. 9 for 9am). Otherwise
    null — do NOT invent one from typical habits; this is only for an hours
    window the user actually named.
15. workEndHour: number|null — the matching end hour (0-24, 24 meaning midnight)
    for the window above, e.g. 18 for "6pm" / "18:00". Only set alongside a
    non-null workStartHour; otherwise null.
16. reasoning: Object with:
    - confidence: number 0-1 (how confident you are in this extraction)
    - assumptions: array of strings
    - warnings: array of strings (e.g. ambiguous goal, past deadline)
    - promptVersion: "v1.0.0"

Return ONLY valid JSON. No markdown, no explanation.

Example output structure:
{
  "schemaVersion": "1.0.0",
  "title": "Build REST API",
  "deadline": "2025-08-01T23:59:59.000Z",
  "category": "work",
  "complexity": "high",
  "urgency": "High",
  "estimatedHours": 40,
  "userConstraints": ["must use Node.js"],
  "assumptions": ["User has basic programming knowledge"],
  "preferences": ["prefers backend work"],
  "scope": "Includes API design and implementation; excludes frontend and deployment.",
  "fixedEvents": [
    { "title": "Client Status Call", "startTime": "2025-08-01T11:30:00.000Z", "endTime": "2025-08-01T12:30:00.000Z" }
  ],
  "maxContinuousFocusMinutes": 90,
  "breakMinutes": 15,
  "workStartHour": 9,
  "workEndHour": 18,
  "reasoning": {
    "confidence": 0.88,
    "assumptions": ["deadline inferred from complexity"],
    "warnings": [],
    "promptVersion": "v1.0.0"
  }
}

If the goal has no fixed-time commitments or focus/break rule, still include the
fields with their empty/null defaults ("fixedEvents": [], "maxContinuousFocusMinutes": null,
"breakMinutes": null, "workStartHour": null, "workEndHour": null) — never omit them.`;
}
