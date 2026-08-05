/**
 * scheduler_agent/validator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure, deterministic validation helpers used both by scheduler_agent/agent.js
 * (post-processing the LLM's scheduling decision) and directly unit-tested in
 * agent.test.js. No network, LLM, or Firestore access.
 */

/**
 * Buffer percentage reserved for a project, based on total project duration.
 * Rule 3 (from the scheduling-intelligence spec):
 *   <5 days   → 10%
 *   5–15 days → 15%
 *   15+ days  → 20%
 *
 * @param {number|null|undefined} days - project duration in days (deadline - createdAt)
 * @returns {number} buffer percentage as a decimal (0.10 | 0.15 | 0.20)
 */
export function computeBufferPercent(days) {
    if (days === null || days === undefined || Number.isNaN(days)) {
        // No known deadline — default to the middle tier as a safe assumption.
        return 0.15;
    }
    if (days < 5) return 0.10;
    if (days < 15) return 0.15;
    return 0.20;
}

/**
 * Check that no scheduled task starts before all of its dependencies have
 * finished. Cross-checked two ways:
 *   1. Directly against each task's own `dependencies[]` + the other
 *      scheduled tasks' startTime/endTime.
 *   2. (Defense in depth) Against `dependencyGraph.topologicalOrdering`, if
 *      provided, to catch ordering issues even when timestamps are missing
 *      or ambiguous.
 *
 * A dependency that is not itself present in `scheduledTasks` is assumed to
 * be already completed (e.g. from a prior planning cycle) and is skipped.
 *
 * @param {Array<{taskId:string, startTime:string, endTime:string, dependencies?:string[]}>} scheduledTasks
 * @param {{topologicalOrdering?: string[]}|null} [dependencyGraph]
 * @returns {{ valid: boolean, violations: Array<{taskId:string, dependsOn:string, reason:string}> }}
 */
export function validateNoDependencyViolations(scheduledTasks, dependencyGraph = null) {
    const violations = [];
    const byId = new Map((scheduledTasks ?? []).map(t => [t.taskId, t]));

    for (const task of scheduledTasks ?? []) {
        for (const depId of task.dependencies ?? []) {
            const dep = byId.get(depId);
            if (!dep) continue; // dependency not part of this schedule — assume already done

            const depEnd = new Date(dep.endTime).getTime();
            const taskStart = new Date(task.startTime).getTime();
            if (Number.isNaN(depEnd) || Number.isNaN(taskStart)) continue;

            if (depEnd > taskStart) {
                violations.push({
                    taskId: task.taskId,
                    dependsOn: depId,
                    reason: `Task "${task.taskId}" starts at ${task.startTime} before dependency "${depId}" ends at ${dep.endTime}`,
                });
            }
        }
    }

    const topoOrder = Array.isArray(dependencyGraph?.topologicalOrdering)
        ? dependencyGraph.topologicalOrdering
        : null;

    if (topoOrder) {
        const indexOf = new Map(topoOrder.map((id, i) => [id, i]));
        for (const task of scheduledTasks ?? []) {
            for (const depId of task.dependencies ?? []) {
                if (!indexOf.has(depId) || !indexOf.has(task.taskId)) continue;
                if (indexOf.get(depId) > indexOf.get(task.taskId)) {
                    violations.push({
                        taskId: task.taskId,
                        dependsOn: depId,
                        reason: `Task "${task.taskId}" is scheduled before its dependency "${depId}" in the topological ordering`,
                    });
                }
            }
        }
    }

    return { valid: violations.length === 0, violations };
}

/**
 * Validate that the schedule reserves at least the required buffer
 * percentage (per computeBufferPercent) relative to the total scheduled
 * duration (task time + buffer time). Allows a small tolerance since the
 * LLM's buffer placement won't always be exact.
 *
 * @param {Array<{isBuffer?:boolean, estimatedDuration?:number, adjustedDuration?:number}>} scheduledTasks
 * @param {number|null} projectDurationDays
 * @param {number} [tolerance] - allowed shortfall below the required percentage (default 0.03 = 3pp)
 * @returns {{ valid: boolean, requiredPct: number, actualPct: number, bufferMinutes: number, totalMinutes: number }}
 */
export function validateBufferPercent(scheduledTasks, projectDurationDays, tolerance = 0.03) {
    const requiredPct = computeBufferPercent(projectDurationDays);

    const durationOf = (t) => (typeof t.adjustedDuration === 'number' ? t.adjustedDuration : (t.estimatedDuration ?? 0));

    const bufferMinutes = (scheduledTasks ?? [])
        .filter(t => t.isBuffer)
        .reduce((sum, t) => sum + durationOf(t), 0);

    const taskMinutes = (scheduledTasks ?? [])
        .filter(t => !t.isBuffer)
        .reduce((sum, t) => sum + durationOf(t), 0);

    const totalMinutes = bufferMinutes + taskMinutes;
    const actualPct = totalMinutes > 0 ? bufferMinutes / totalMinutes : 0;
    const valid = actualPct >= (requiredPct - tolerance);

    return { valid, requiredPct, actualPct, bufferMinutes, totalMinutes };
}
