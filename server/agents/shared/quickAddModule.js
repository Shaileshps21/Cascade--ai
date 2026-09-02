/**
 * quickAddModule.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure helpers behind "Add Module": appending a new, empty module to an
 * existing project (AI-generated or manually-built — both share the same
 * PlanningContext shape) without invoking any agent. Mirrors quickAddTask.js
 * one level up the hierarchy.
 *
 * Also owns resolveModuleSource(), the single place that decides whether an
 * existing module counts as "manually added" — shared by contextManager.js
 * (decides whether the client shows a delete button on a module's subtasks)
 * and routes/projects.js's DELETE route (decides whether to actually allow
 * it), so display and enforcement can never drift apart.
 */

const MODULE_ID_PATTERN = /^MOD(\d+)$/;

/**
 * Next unused "MOD<n>" moduleId, one past the highest numeric suffix among
 * every module across every milestone. planning_agent assigns moduleIds this
 * same way — flattened and project-wide-unique, not scoped per milestone
 * (`moduleIds = flatModules.map((_, i) => \`MOD${i + 1}\`)` in
 * planning_agent/agent.js) — so reusing the convention keeps a manually-added
 * module's id indistinguishable in shape from an AI-planned one.
 * @param {Array<{modules?: Array<{id?: string}>}>} milestones
 * @returns {string}
 */
export function nextModuleId(milestones = []) {
    let max = 0;
    for (const milestone of milestones ?? []) {
        for (const mod of milestone?.modules ?? []) {
            const match = MODULE_ID_PATTERN.exec(mod?.id ?? '');
            if (match) max = Math.max(max, Number(match[1]));
        }
    }
    return `MOD${max + 1}`;
}

/**
 * Build a new, empty module in the exact shape toClientProject() expects.
 * `source: 'manual'` is the actual point of this helper — it's what lets
 * resolveModuleSource() (and therefore the delete-subtask feature) recognize
 * this module as user-added regardless of which project type it was added to.
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.title
 * @returns {object} a `milestone.modules[]` entry
 */
export function buildManualModule({ id, title }) {
    return {
        id,
        title,
        description: '',
        acceptanceCriteria: [],
        dependencies: [],
        tasks: [],
        source: 'manual',
    };
}

/**
 * Whether a module counts as "manually added" for the delete-subtask
 * feature — every subtask inside a manual module is deletable, regardless of
 * how that particular subtask itself was created.
 *
 * Modules created before this feature existed (all planning_agent output,
 * and every Manual Project Builder module created before today) have no
 * `source` field at all, so a fallback is needed instead of a data
 * migration:
 *   - No manualMode (AI-generated project): falls back to 'ai'.
 *   - manualMode true, never AI-enhanced: falls back to 'manual' — every
 *     original hand-typed module in a from-scratch Manual Todo Mode project
 *     counts as manually added, with no migration needed for projects that
 *     already exist.
 *   - manualMode true AND aiEnhanced true: falls back to 'ai'. `manualMode`
 *     marks how the project was *created* and stays true forever even after
 *     "Let AI enhance this" regenerates the whole plan (see
 *     contextManager.js's toClientTask() docs) — without the `!aiEnhanced`
 *     clause, an AI-regenerated module would incorrectly read as manual just
 *     because the project's origin was manual.
 * An explicit `source` on the module (set by buildManualModule() above, or
 * by routes/tasks.js's POST /manual going forward) always wins over any of
 * this fallback reasoning.
 * @param {{source?: string}} mod
 * @param {{manualMode?: boolean, aiEnhanced?: boolean}} [metadata]
 * @returns {'manual'|'ai'}
 */
export function resolveModuleSource(mod, metadata) {
    if (mod?.source === 'manual' || mod?.source === 'ai') return mod.source;
    return metadata?.manualMode && !metadata?.aiEnhanced ? 'manual' : 'ai';
}
