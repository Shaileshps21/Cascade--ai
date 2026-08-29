/**
 * scheduler_agent/prompt_v1.js
 * The Intelligent Scheduling Agent prompt.
 *
 * The LLM (clients.pro) receives a deterministically pre-computed candidate
 * "skeleton" (topological order + naive slot placement avoiding calendar
 * busy times) plus task/estimation/memory metadata, and is asked to refine
 * it: assign energy levels, minimize context switching, group similar work,
 * respect the buffer/energy/ordering rules below, and flag infeasibility.
 *
 * The skeleton is a *starting point*, not a constraint the LLM must copy —
 * agent.js post-processes the response deterministically afterwards to
 * catch/repair anything the model got wrong (dependency ordering, working
 * hours, buffer %).
 */

/**
 * @param {object} opts
 * @param {Array<object>} opts.skeleton - deterministic candidate slots (see agent.js buildScheduleSkeleton)
 * @param {object} opts.taskMeta        - { taskId -> { title, difficulty, priority, type, dependencies, isBuffer, isReview } }
 * @param {object|null} opts.memory     - context.memory (optimalWorkHours, averageSpeeds, reliabilityScore, commonFailures)
 * @param {object|null} opts.estimation - context.estimation (per-task multi-factor adjustment chain, already computed)
 * @param {number} opts.bufferPercent   - required buffer % (0.10 | 0.15 | 0.20) from computeBufferPercent(projectDurationDays)
 * @param {number|null} opts.projectDurationDays
 * @param {string} opts.createdAtISO    - context.metadata.createdAt
 * @param {string|null} opts.deadlineISO
 * @param {number} opts.dailyAvailableMinutes - the assumed daily capacity (user-set or default)
 * @param {string} [opts.weekendMode]         - 'skip' | 'light' | 'normal' | 'heavy'
 * @param {number} opts.workStartHour
 * @param {number} opts.workEndHour
 * @param {Array<{title:string, startTime:string, endTime:string}>} [opts.fixedEvents] - user-stated non-negotiable time blocks (already carved out of the skeleton as busy time — shown here so the LLM understands why those gaps exist)
 * @param {number|null} [opts.maxContinuousFocusMinutes] - user-stated continuous-work limit before a break, if any
 * @param {number|null} [opts.breakMinutes] - break duration paired with maxContinuousFocusMinutes
 * @returns {string} prompt
 */
export function buildSchedulerPrompt({
    skeleton,
    taskMeta = {},
    memory = null,
    estimation = null,
    bufferPercent,
    projectDurationDays,
    createdAtISO,
    deadlineISO,
    dailyAvailableMinutes,
    weekendMode = 'skip',
    workStartHour,
    workEndHour,
    fixedEvents = [],
    maxContinuousFocusMinutes = null,
    breakMinutes = null,
}) {
    const optimalWorkHours = memory?.optimalWorkHours ?? [9, 10, 14, 15];
    const reliabilityScore = memory?.reliabilityScore ?? null;
    const commonFailures = memory?.commonFailures ?? [];
    const averageSpeeds = memory?.averageSpeeds ?? null;

    const weekendLabel = weekendMode === 'skip'
        ? 'Skip weekends entirely — do NOT place any tasks on Saturday or Sunday'
        : weekendMode === 'light'
            ? 'Light weekend mode — weekend tasks allowed but capped at 50% of daily capacity; prefer lighter/review tasks on weekends'
            : weekendMode === 'heavy'
                ? 'Weekend-heavy mode — place MORE tasks on Saturdays and Sundays (150% of weekday capacity). Treat weekends as the primary working days and use them to make the most progress. Weekdays can be lighter as a result.'
                : 'Normal weekend mode — weekends are treated identically to weekdays';

    return `You are the Intelligent Scheduling Agent — an expert project-management AI that turns a task list into a realistic, humane, deadline-aware calendar schedule.

## Current context
- Now / project created at: ${createdAtISO}
- Deadline: ${deadlineISO ?? 'not specified — treat as flexible, but still balance workload'}
- Project duration: ${projectDurationDays !== null && projectDurationDays !== undefined ? `${projectDurationDays.toFixed(1)} days` : 'unknown'}
- Required buffer reservation: ${Math.round(bufferPercent * 100)}% of total scheduled time
- Working hours: ${workStartHour}:00–${workEndHour}:00 local time
- Daily capacity: ${dailyAvailableMinutes} minutes/day (never schedule more than 70% of this per day = ~${Math.round(dailyAvailableMinutes * 0.7)} min)
- Weekend preference: ${weekendLabel}
- Historically productive hours (from memory agent): ${optimalWorkHours.join(', ')}
${reliabilityScore !== null ? `- User reliability score (historical on-time completion): ${reliabilityScore}` : ''}
${commonFailures.length ? `- Common historical failure patterns to avoid: ${commonFailures.join('; ')}` : ''}
${averageSpeeds ? `- Historical average speeds by task type: ${JSON.stringify(averageSpeeds)}` : ''}
${fixedEvents.length ? `- FIXED, NON-NEGOTIABLE commitments (already carved out of the skeleton below — do NOT schedule anything over these): ${fixedEvents.map(e => `"${e.title}" ${e.startTime}–${e.endTime}`).join('; ')}` : ''}
${maxContinuousFocusMinutes ? `- Continuous-focus limit: no more than ${maxContinuousFocusMinutes} minutes of back-to-back work before a ${breakMinutes ?? 15}-minute break (the skeleton below already inserts these breaks — preserve them, do not remove or merge them away).` : ''}

## Candidate skeleton (deterministically pre-computed — topological order + naive slot placement avoiding calendar conflicts)
This is your STARTING POINT. Refine timing, energy levels, and ordering — do not feel obligated to copy it exactly, but do NOT violate dependency ordering.

${JSON.stringify(skeleton, null, 2)}

## Task metadata
${JSON.stringify(taskMeta, null, 2)}

${estimation ? `## Time estimation context (already computed by time_estimation_agent — DO NOT recompute; reuse finalEstimateMinutes)\n${JSON.stringify(estimation, null, 2)}` : ''}

## Rules you MUST enforce

**Rule 1 — Start delay**: The first scheduled task must begin approximately 30 minutes after project creation (${createdAtISO}), not immediately.

**Rule 2 — Deadline protection**: The final implementation task must finish BEFORE the deadline. Reserve a final period (review/polish/testing) that also completes before the deadline.

**Rule 3 — Buffer reservation**: Reserve buffer time equal to at least ${Math.round(bufferPercent * 100)}% of total scheduled duration. Represent this as explicit \`bufferSlots\` AND/OR tasks with \`isBuffer: true\`.

**Rule 4 — Spread across the full project window, do NOT cram**: This is the rule most commonly violated — read it carefully. Daily workload must never exceed ${dailyAvailableMinutes} minutes/day (ideally at or below 70%, ~${Math.round(dailyAvailableMinutes * 0.7)} minutes/day). The candidate skeleton below was already built to respect this cap by rolling extra work onto later days — preserve that spread. Do NOT pull later tasks earlier just to "fill up" an early day, and do NOT leave the back half of the timeline empty by finishing everything in the first day or two. If there are ${projectDurationDays !== null && projectDurationDays !== undefined ? Math.max(1, Math.round(projectDurationDays)) : 'N'} days until the deadline, a good schedule uses close to all of them — a handful of short sessions per day across the whole window beats a couple of marathon days followed by long idle stretches.

**Rule 5 — Difficulty/order strategy**: Hard tasks earlier, easy tasks later. Preferred macro-ordering where applicable: Learning → Practice → Implementation → Testing → Review. Never place an implementation task before its prerequisite learning task.

**Similar-task detection**: Identify tasks that are conceptually similar (e.g. "Backend API" ≈ "REST API" ≈ "Auth API"; "Research Paper" ≈ "Literature Review"). Group similar tasks together to minimize context switching (prefer sequences like Coding → Coding → Testing → Documentation over Coding → Research → Coding).

**Energy-aware scheduling**: Assign \`energyLevel\` per task:
- difficulty=high / hard tasks → schedule at the user's most productive hours (${optimalWorkHours.join(', ')}) and mark energyLevel="high"
- difficulty=medium → normal hours, energyLevel="medium"
- difficulty=low/easy → end of the work session, energyLevel="low"
- admin/buffer/review type tasks → lowest-energy hours, energyLevel="low"

**Learning ordering**: If any task represents learning/study, it must come before any task that applies that knowledge (Learning → Practice → Implementation → Testing). Never schedule implementation before its learning prerequisite.

**Review day reservation**: Reserve time at the end of the plan for review (isReview: true) — for technical projects this covers testing/bug-fixing/documentation; for academic projects, revision/practice/mock-tests.

**Deep work flag**: Mark \`isDeepWork: true\` for tasks requiring sustained focus (difficulty high, or long duration, non-admin).

## Failure conditions
If — even accounting for buffer reduction and workload balancing — the deadline cannot realistically be met, DO NOT invent an unrealistic schedule. Instead return:
\`\`\`json
{ "isFeasible": false, "failureConditions": { "requiredAdditionalHours": <number>, "suggestedDeadline": "<ISO 8601>", "tasksToDefer": ["<taskId>", ...], "completionProbability": <0-1>, "reasoning": "<string>" } }
\`\`\`

## Output format
Return ONLY valid JSON matching this exact schema (no markdown fences, no commentary):

\`\`\`json
{
  "schemaVersion": "1.0.0",
  "scheduledTasks": [{
    "taskId": "T1",
    "taskName": "string",
    "startTime": "ISO 8601",
    "endTime": "ISO 8601",
    "estimatedDuration": 60,
    "adjustedDuration": 87,
    "adjustmentReason": "string explaining any adjustment vs base estimate",
    "priority": "low|medium|high|critical",
    "energyLevel": "high|medium|low",
    "isBuffer": false,
    "isReview": false,
    "isDeepWork": true,
    "dependencies": ["T0"],
    "confidence": 0.82
  }],
  "bufferSlots": [{ "startTime": "ISO 8601", "endTime": "ISO 8601", "durationMinutes": 0 }],
  "schedulingScore": 88,
  "confidenceScore": 85,
  "warnings": ["string"],
  "recommendations": ["string"],
  "isFeasible": true,
  "failureConditions": null,
  "reasoning": {
    "confidence": 0.85,
    "assumptions": ["string"],
    "warnings": ["string"],
    "promptVersion": "v1.0.0"
  }
}
\`\`\`

Every taskId in the skeleton and task metadata must appear exactly once in \`scheduledTasks\` (when isFeasible is true). Do not drop tasks. Do not invent taskIds that don't exist in the input.`;
}
