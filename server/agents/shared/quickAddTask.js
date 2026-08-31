/**
 * quickAddTask.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure helpers behind "Quick-Add Subtask": appending a single subtask to an
 * existing module — AI-generated or manually built, the two share the same
 * PlanningContext shape — without invoking any agent. Extracted from
 * routes/projects.js so taskId generation and the new-task shape can be
 * tested without Firestore, matching how applyStepUpdate() was pulled out of
 * the same route file for the same reason.
 */

const TASK_ID_PATTERN = /^T(\d+)$/;
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const DEFAULT_ESTIMATED_MINUTES = 30;

/**
 * Next unused "T<n>" taskId, one past the highest numeric suffix among
 * existing tasks. Both planning_agent (`T${i + 1}` in document order) and the
 * Manual Project Builder (`T${taskCounter}`) assign taskIds this way, so
 * reusing the convention makes a quick-added task indistinguishable from one
 * either origin created — no separate ID namespace to keep track of.
 * @param {Array<{taskId?: string}>} existingTasks
 * @returns {string}
 */
export function nextTaskId(existingTasks = []) {
    let max = 0;
    for (const t of existingTasks ?? []) {
        const match = TASK_ID_PATTERN.exec(t?.taskId ?? '');
        if (match) max = Math.max(max, Number(match[1]));
    }
    return `T${max + 1}`;
}

/**
 * Build a new task object in the exact shape toClientTask()/toClientProject()
 * expect — mirrors the Manual Project Builder's per-subtask shape verbatim,
 * including a single execution step, so a quick-added task renders, opens in
 * the Task Workspace, and completes identically to any AI-planned or
 * manually-built one.
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.milestoneId
 * @param {string} opts.moduleId
 * @param {string} opts.title
 * @param {number} [opts.estimatedMinutes] - defaults to 30 when absent/invalid, clamped to a 5-minute floor
 * @param {string} [opts.priority] - defaults to 'medium' when not one of low/medium/high/critical
 * @param {string} [opts.deadline] - ISO date string ("End Date"), or null when not given
 * @returns {object} a `planning.tasks[]` entry
 */
export function buildQuickAddTask({ taskId, milestoneId, moduleId, title, estimatedMinutes, priority, deadline }) {
    const resolvedPriority = PRIORITIES.includes(priority) ? priority : 'medium';
    const parsedMinutes = Number(estimatedMinutes);
    const resolvedMinutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0
        ? Math.max(5, Math.round(parsedMinutes))
        : DEFAULT_ESTIMATED_MINUTES;
    const parsedDeadline = deadline ? new Date(deadline) : null;
    const resolvedDeadline = parsedDeadline && !Number.isNaN(parsedDeadline.getTime())
        ? parsedDeadline.toISOString()
        : null;
    const stepId = 'S1';

    return {
        taskId,
        milestoneId,
        moduleId,
        title,
        difficulty: 'medium',
        requiredSkills: [],
        dependencies: [],
        priority: resolvedPriority,
        estimatedMinutes: resolvedMinutes,
        reviewRequired: false,
        isBuffer: false,
        isReview: false,
        deadline: resolvedDeadline,
        overview: '',
        objectives: [],
        // Exactly one execution step, matching normalizeExecutionStep()'s
        // shape verbatim — the Task Workspace is entirely step-driven, so a
        // quick-added task needs one to be completable at all.
        executionSteps: [{
            id: stepId,
            stepId,
            title,
            description: '',
            order: 1,
            estimatedMinutes: resolvedMinutes,
            status: 'pending',
            dependencies: [],
            resources: [],
            notes: '',
            completionEvidence: '',
            isOptional: false,
            progress: 0,
            startedAt: null,
            completedAt: null,
            blockedReason: null,
            blockedSince: null,
        }],
        deliverables: [],
        successCriteria: [],
        commonMistakes: [],
        aiGuidance: [],
        reflectionQuestions: [],
        resources: [],
        notes: [],
        progress: { status: 'not_started', completedAt: null, actualMinutes: null },
    };
}

/**
 * Build a `context.schedule.scheduledTasks[]` entry for a quick-added task
 * that was given its own Start Date + Start Time — same shape
 * scheduler_agent's `skeletonToScheduledTasks()` produces, so the task shows
 * up in the Schedule tab and syncs to Google Calendar identically to an
 * AI-scheduled one. Mirrors the Manual Project Builder's single-subtask
 * scheduling logic (routes/tasks.js POST /manual), just for one task instead
 * of a whole project.
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.title
 * @param {number} opts.estimatedMinutes - already-resolved minutes (buildQuickAddTask's output)
 * @param {string} opts.priority - already-resolved priority (buildQuickAddTask's output)
 * @param {string} opts.startTime - ISO datetime string
 * @returns {object|null} a scheduledTasks[] entry, or null if startTime doesn't parse
 */
export function buildQuickAddScheduleEntry({ taskId, title, estimatedMinutes, priority, startTime }) {
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + estimatedMinutes * 60_000);

    return {
        taskId,
        taskName: title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        estimatedDuration: estimatedMinutes,
        adjustedDuration: estimatedMinutes,
        adjustmentReason: '',
        priority,
        difficulty: 'medium',
        dependencies: [],
        isBuffer: false,
        isReview: false,
        energyLevel: 'medium',
        isDeepWork: false,
    };
}
