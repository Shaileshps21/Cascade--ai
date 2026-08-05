/**
 * planning_agent/validator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deep structural validation of the planning hierarchy — beyond the shallow
 * shape checks done by schema.js. This is the evaluator wired into
 * agentRunner's quality-gate (score < 80 triggers a retry) and is also
 * exported standalone for use by the Review Agent and unit tests.
 *
 * Checks performed:
 *   - 4-8 milestones
 *   - 2-6 modules per milestone
 *   - 2-8 tasks per module (via module.tasks[] taskId references)
 *   - 3-8 execution steps per task
 *   - milestoneId/moduleId references on each task are internally consistent
 *     with the hierarchy (module.tasks[] agree with task.milestoneId/moduleId)
 *   - dependency ids (milestone/module/task) reference real entities
 *   - no self-dependencies at any level
 *   - no orphan modules (modules with zero tasks)
 */

const MILESTONE_MIN = 4;
const MILESTONE_MAX = 8;
const MODULE_MIN = 2;
const MODULE_MAX = 6;
const TASK_MIN = 2;
const TASK_MAX = 8;
const STEP_MIN = 3;
const STEP_MAX = 8;

/**
 * Validate the full planning hierarchy structure.
 * @param {object} planning - the planning namespace object { milestones, tasks, ... }
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePlanningHierarchy(planning) {
    const errors = [];
    const warnings = [];

    if (!planning || typeof planning !== 'object') {
        return { valid: false, errors: ['planning must be an object'], warnings: [] };
    }

    const milestones = Array.isArray(planning.milestones) ? planning.milestones : [];
    const tasks = Array.isArray(planning.tasks) ? planning.tasks : [];

    if (milestones.length === 0) {
        errors.push('planning.milestones must be a non-empty array');
    }
    if (tasks.length === 0) {
        errors.push('planning.tasks must be a non-empty array');
    }

    if (milestones.length < MILESTONE_MIN || milestones.length > MILESTONE_MAX) {
        errors.push(`milestone count must be ${MILESTONE_MIN}-${MILESTONE_MAX}, got ${milestones.length}`);
    }

    // ── Pass 1: collect all valid ids up-front (avoids order-dependent false positives) ──
    const milestoneIds = new Set(milestones.map((m) => m?.id).filter(Boolean));
    const moduleIds = new Set();
    const moduleOwnerMilestone = new Map(); // moduleId -> milestoneId
    const moduleTaskRefs = new Map(); // moduleId -> [taskId,...]

    for (const m of milestones) {
        const modules = Array.isArray(m?.modules) ? m.modules : [];
        for (const mod of modules) {
            if (mod?.id) {
                moduleIds.add(mod.id);
                moduleOwnerMilestone.set(mod.id, m?.id);
                moduleTaskRefs.set(mod.id, Array.isArray(mod.tasks) ? mod.tasks : []);
            }
        }
    }

    const taskIds = new Set(tasks.map((t) => t?.taskId).filter(Boolean));

    // ── Pass 2: milestone-level checks ──────────────────────────────────────
    milestones.forEach((m, mi) => {
        const label = m?.id ?? `milestones[${mi}]`;
        const modules = Array.isArray(m?.modules) ? m.modules : [];

        if (modules.length < MODULE_MIN || modules.length > MODULE_MAX) {
            errors.push(`milestone ${label} has ${modules.length} modules, expected ${MODULE_MIN}-${MODULE_MAX}`);
        }

        (Array.isArray(m?.dependencies) ? m.dependencies : []).forEach((dep) => {
            if (dep === m?.id) errors.push(`milestone ${label} has a self-dependency`);
            else if (!milestoneIds.has(dep)) errors.push(`milestone ${label} depends on unknown milestone "${dep}"`);
        });

        // ── module-level checks ────────────────────────────────────────────
        modules.forEach((mod, modi) => {
            const modLabel = mod?.id ?? `${label}.modules[${modi}]`;
            const modTasks = Array.isArray(mod?.tasks) ? mod.tasks : [];

            if (modTasks.length === 0) {
                errors.push(`module ${modLabel} is orphaned — it has zero tasks`);
            } else if (modTasks.length < TASK_MIN || modTasks.length > TASK_MAX) {
                errors.push(`module ${modLabel} has ${modTasks.length} tasks, expected ${TASK_MIN}-${TASK_MAX}`);
            }

            modTasks.forEach((tid) => {
                if (!taskIds.has(tid)) {
                    errors.push(`module ${modLabel} references unknown task "${tid}"`);
                }
            });

            (Array.isArray(mod?.dependencies) ? mod.dependencies : []).forEach((dep) => {
                if (dep === mod?.id) errors.push(`module ${modLabel} has a self-dependency`);
                else if (!moduleIds.has(dep)) errors.push(`module ${modLabel} depends on unknown module "${dep}"`);
            });
        });
    });

    // ── Pass 3: task-level checks ────────────────────────────────────────────
    tasks.forEach((t, ti) => {
        const label = t?.taskId ?? `tasks[${ti}]`;
        const steps = Array.isArray(t?.executionSteps) ? t.executionSteps : [];

        if (steps.length < STEP_MIN || steps.length > STEP_MAX) {
            errors.push(`task ${label} has ${steps.length} execution steps, expected ${STEP_MIN}-${STEP_MAX}`);
        }

        if (t?.milestoneId && !milestoneIds.has(t.milestoneId)) {
            errors.push(`task ${label} references unknown milestoneId "${t.milestoneId}"`);
        }
        if (t?.moduleId && !moduleIds.has(t.moduleId)) {
            errors.push(`task ${label} references unknown moduleId "${t.moduleId}"`);
        }

        // Cross-check: the owning module must actually list this task, and
        // the module's parent milestone must match the task's milestoneId.
        if (t?.moduleId && moduleTaskRefs.has(t.moduleId)) {
            const refs = moduleTaskRefs.get(t.moduleId);
            if (!refs.includes(t.taskId)) {
                warnings.push(`task ${label} is not listed in its module (${t.moduleId})'s tasks[]`);
            }
            const ownerMilestone = moduleOwnerMilestone.get(t.moduleId);
            if (ownerMilestone && t?.milestoneId && ownerMilestone !== t.milestoneId) {
                errors.push(`task ${label} has milestoneId "${t.milestoneId}" but its module ${t.moduleId} belongs to milestone "${ownerMilestone}"`);
            }
        }

        (Array.isArray(t?.dependencies) ? t.dependencies : []).forEach((dep) => {
            if (dep === t?.taskId) errors.push(`task ${label} has a self-dependency`);
            else if (!taskIds.has(dep)) errors.push(`task ${label} depends on unknown task "${dep}"`);
        });
    });

    return { valid: errors.length === 0, errors, warnings };
}
