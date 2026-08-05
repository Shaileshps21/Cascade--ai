/**
 * review_agent/prompt_v1.js
 * QA review prompt: holistic quality assessment of the generated plan
 * (target = 'planning') or the generated schedule (target = 'schedule').
 *
 * Deterministic issues (already found by runDeterministicChecks) are fed
 * into the prompt so the LLM focuses on NEW issues rather than repeating
 * mechanical findings.
 */

/**
 * Build the holistic review prompt.
 * @param {object} context              - PlanningContext
 * @param {'planning'|'schedule'} target - which namespace to review
 * @param {Array<object>} [deterministicIssues] - issues already found deterministically
 * @returns {string} prompt
 */
export function buildReviewPrompt(context, target = 'planning', deterministicIssues = []) {
    const deterministicSummary = deterministicIssues.length
        ? deterministicIssues.map(i => `- [${i.severity}] ${i.type}: ${i.message}`).join('\n')
        : '(none found)';

    const goal = context?.rawGoal ?? context?.intent?.title ?? '(unknown goal)';

    if (target === 'schedule') {
        return buildScheduleReviewPrompt(context, goal, deterministicSummary);
    }
    return buildPlanningReviewPrompt(context, goal, deterministicSummary);
}

function buildPlanningReviewPrompt(context, goal, deterministicSummary) {
    const planning = context?.planning ?? {};
    const milestones = Array.isArray(planning.milestones) ? planning.milestones : [];
    const tasks = Array.isArray(planning.tasks) ? planning.tasks : [];

    const milestoneSummaries = milestones.map(m => ({
        id: m.id,
        title: m.title,
        riskLevel: m.riskLevel,
        moduleCount: Array.isArray(m.modules) ? m.modules.length : 0,
        modules: (Array.isArray(m.modules) ? m.modules : []).map(mod => ({
            id: mod.id,
            title: mod.title,
            taskCount: Array.isArray(mod.tasks) ? mod.tasks.length : 0,
        })),
    }));

    const taskSummaries = tasks.map(t => ({
        taskId: t.taskId,
        title: t.title,
        milestoneId: t.milestoneId,
        moduleId: t.moduleId,
        difficulty: t.difficulty,
        estimatedMinutes: t.estimatedMinutes,
        dependencies: t.dependencies ?? [],
        executionStepCount: Array.isArray(t.executionSteps) ? t.executionSteps.length : 0,
    }));

    return `You are a QA Review Agent evaluating a generated project PLAN.

The plan follows a 5-level hierarchy: Project → Milestones (4-8) → Modules (2-6 per milestone) → Tasks (2-8 per module) → Execution Steps (3-8 per task).

Deterministic checks have already been run against this plan and found the following issues:
${deterministicSummary}

Project goal: "${goal}"

Milestones (${milestoneSummaries.length} total):
${JSON.stringify(milestoneSummaries, null, 2).slice(0, 4000)}

Tasks (${taskSummaries.length} total):
${JSON.stringify(taskSummaries, null, 2).slice(0, 6000)}

Evaluate holistically:
1. Hierarchy balance — are milestone/module/task counts reasonable (4-8 milestones, 2-6 modules per milestone, 2-8 tasks per module, 3-8 execution steps per task)?
2. Milestone coverage — does the set of milestones fully cover the stated goal, with nothing important missing and nothing redundant?
3. Task atomicity — is each task a single coherent, appropriately-scoped unit of work (not too broad, not trivially small)?
4. Dependency correctness — are dependencies between milestones/modules/tasks sensible, with no missing links, no circular references, and no self-dependencies?
5. Workload distribution — is effort spread reasonably across milestones/modules, without one module dwarfing the others?

Return ONLY valid JSON (no markdown fences, no explanation) in exactly this shape:
{
  "qualityScore": 0,
  "confidenceScore": 0,
  "issues": [{ "type": "", "severity": "low|medium|high", "message": "", "entityId": "" }],
  "suggestedFixes": [{ "type": "", "description": "" }],
  "reasoning": { "confidence": 0.0, "assumptions": [], "warnings": [], "promptVersion": "v1.0.0" }
}

Do NOT restate the deterministic issues listed above in your "issues" array — only report NEW issues beyond those already found. qualityScore and confidenceScore must be numbers between 0 and 100.`;
}

function buildScheduleReviewPrompt(context, goal, deterministicSummary) {
    const schedule = context?.schedule ?? {};
    const scheduledTasks = Array.isArray(schedule.scheduledTasks) ? schedule.scheduledTasks : [];

    const scheduleSummary = scheduledTasks.map(s => ({
        taskId: s.taskId,
        taskName: s.taskName,
        startTime: s.startTime,
        endTime: s.endTime,
        adjustedDuration: s.adjustedDuration ?? s.estimatedDuration,
        priority: s.priority,
        energyLevel: s.energyLevel,
        isBuffer: !!s.isBuffer,
        isReview: !!s.isReview,
        dependencies: s.dependencies ?? [],
    }));

    return `You are a QA Review Agent evaluating a generated project SCHEDULE.

Deterministic checks have already been run against this schedule and found the following issues:
${deterministicSummary}

Project goal: "${goal}"
Scheduler-reported schedulingScore: ${schedule.schedulingScore ?? 'n/a'}
Scheduler warnings: ${JSON.stringify(schedule.warnings ?? [])}

Scheduled tasks (${scheduleSummary.length} total):
${JSON.stringify(scheduleSummary, null, 2).slice(0, 6000)}

Evaluate holistically:
1. Workload distribution across days — balanced, not front-loaded or back-loaded, no large idle gaps.
2. Energy-aware assignment — hard/deep-work tasks placed in productive hours, easy/admin tasks placed later.
3. Buffer adequacy — is reserved buffer time reasonable relative to project duration and risk?
4. Dependency ordering sanity — do scheduled start times respect logical task dependencies?
5. Overall executability — how confident are you this schedule can realistically be followed?

Return ONLY valid JSON (no markdown fences, no explanation) in exactly this shape:
{
  "qualityScore": 0,
  "confidenceScore": 0,
  "issues": [{ "type": "", "severity": "low|medium|high", "message": "", "entityId": "" }],
  "suggestedFixes": [{ "type": "", "description": "" }],
  "reasoning": { "confidence": 0.0, "assumptions": [], "warnings": [], "promptVersion": "v1.0.0" }
}

Do NOT restate the deterministic issues listed above in your "issues" array — only report NEW issues beyond those already found. qualityScore and confidenceScore must be numbers between 0 and 100.`;
}
