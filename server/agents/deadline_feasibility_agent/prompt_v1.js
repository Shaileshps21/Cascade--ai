/**
 * deadline_feasibility_agent/prompt_v1.js
 * Small reconciliation prompt used ONLY when the deterministic feasibility
 * calculation determines the plan is infeasible (totalEffortMinutes > availableMinutes).
 *
 * The LLM is asked purely for human-friendly reconciliation *suggestions* —
 * it never re-decides feasibility itself; that stays deterministic.
 */

/**
 * Build the reconciliation prompt.
 * @param {object} opts
 * @param {string} opts.taskTitle             - human-readable title/goal
 * @param {number} opts.totalEffortMinutes    - summed finalEstimateMinutes across all tasks
 * @param {number} opts.availableMinutes      - deterministic available working minutes until deadline
 * @param {number} opts.slackMinutes          - availableMinutes - totalEffortMinutes (negative when infeasible)
 * @param {string|null} opts.deadline         - ISO 8601 deadline string, if any
 * @param {string} opts.now                   - ISO 8601 current time
 * @param {Array<{title:string, priority?:string, minutes?:number}>} [opts.tasks] - the actual planned tasks, so suggestions name real items instead of generic ones
 * @returns {string} prompt
 */
export function buildReconciliationPrompt({ taskTitle, totalEffortMinutes, availableMinutes, slackMinutes, deadline, now, tasks = [] }) {
    const shortfallMinutes = Math.max(0, totalEffortMinutes - availableMinutes);
    const shortfallHours = parseFloat((shortfallMinutes / 60).toFixed(2));

    const taskListBlock = tasks.length > 0
        ? tasks
            .map((t) => `- "${t.title}" (priority: ${t.priority ?? 'medium'}${typeof t.minutes === 'number' ? `, ~${Math.round(t.minutes / 60 * 10) / 10}h` : ''})`)
            .join('\n')
        : '(no task list available — reason generically about scope reduction)';

    return `You are a pragmatic project-planning assistant helping reconcile an infeasible deadline.

Project: "${taskTitle}"
Current time: ${now}
Deadline: ${deadline ?? 'not specified'}

Total estimated effort required: ${totalEffortMinutes} minutes (~${(totalEffortMinutes / 60).toFixed(1)}h)
Total working time available before deadline: ${availableMinutes} minutes (~${(availableMinutes / 60).toFixed(1)}h)
Shortfall: ${shortfallMinutes} minutes (~${shortfallHours}h short); slack = ${slackMinutes} minutes.

The actual planned tasks for this project are:
${taskListBlock}

The plan as scoped CANNOT be completed in time under normal working hours. Propose realistic
reconciliation options. Return ONLY valid JSON, no markdown, no explanation, in this exact shape:

{
  "suggestedDeadline": "ISO 8601 datetime string — a realistic new deadline that would make the plan feasible",
  "reducedScope": ["short bullet describing scope that could be cut or deferred", "..."],
  "additionalWorkHoursNeeded": ${shortfallHours},
  "priorityReductions": ["short bullet naming a task/category whose priority could be lowered or deferred", "..."]
}

Rules:
- "suggestedDeadline" must be strictly after "${now}" and should reflect the extra time needed given the shortfall above.
- "reducedScope" and "priorityReductions" should each contain 1-4 concise, actionable items.
- "additionalWorkHoursNeeded" should be a realistic number of extra hours (may adjust the provided estimate slightly).
- CRITICAL: "reducedScope" and "priorityReductions" must refer ONLY to tasks named in the actual planned-tasks list above (quote or closely paraphrase their titles). Do NOT invent unrelated tasks, features, or technology (no made-up scope like "mobile app", "CDN", "real-time collaboration") that isn't in that list.
- If the task list above says "(no task list available...)", reason generically instead — do not invent specific features.
- Return ONLY the JSON object.`;
}
