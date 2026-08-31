/**
 * crossProjectBusySlots.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-Project Conflict Detection (suggestions.md #25).
 *
 * The scheduler already avoids double-booking against external Google
 * Calendar events (google_calendar_agent.getFreeBusy). It has no equivalent
 * awareness of a user's OTHER Cascade projects — two concurrent projects
 * could book the exact same slot with no warning. This treats every other
 * active project's already-scheduled tasks as opaque busy blocks, in the
 * same `{start, end}` shape `getFreeBusy` returns, so both feed the same
 * `busySlots` parameter scheduler_agent already accepts.
 *
 * Shared (not inlined in orchestrator.js) because two call sites need it:
 * orchestrator.js (initial scheduling) and replanning_agent.js (re-invokes
 * the scheduler for tasks affected by an overrun) — replanning_agent cannot
 * import from orchestrator.js without an import cycle.
 */

import { db } from '../../config/firebase.js';

/**
 * Fetch `{start, end}` busy blocks from every OTHER active project's already
 * scheduled tasks for this user.
 *
 * "Active" mirrors the same filter GET /api/tasks / GET /api/projects use:
 * excludes archived and mid-pipeline-failed documents. A project's own slots
 * are excluded via `excludeTaskId`. Slots whose `endTime` has already passed
 * are dropped — a stale/past slot can't conflict with anything being
 * scheduled from now on.
 *
 * Ordered by `createdAt desc` (not just `.limit()`'d with no order) so that
 * if a user has more than `limit` active projects, the ones surfaced are the
 * most recent — not an arbitrary Firestore-decided subset.
 *
 * Best-effort: any Firestore error is swallowed and logged, returning `[]`,
 * so a conflict-detection hiccup never blocks the scheduler from running.
 *
 * @param {string} userId
 * @param {string|null} [excludeTaskId] - the project currently being scheduled
 * @param {number} [limit]
 * @returns {Promise<Array<{start:string, end:string}>>}
 */
export async function getCrossProjectBusySlots(userId, excludeTaskId = null, limit = 50) {
    try {
        const snapshot = await db
            .collection('tasks')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const now = Date.now();
        const slots = [];

        for (const doc of snapshot.docs) {
            if (doc.id === excludeTaskId) continue;
            const data = doc.data();
            const meta = data?.metadata ?? {};
            if (meta.archived === true || meta.pipelineFailed === true) continue;

            const scheduledTasks = data?.schedule?.scheduledTasks ?? [];
            for (const slot of scheduledTasks) {
                if (!slot?.startTime || !slot?.endTime) continue;
                const end = new Date(slot.endTime).getTime();
                if (Number.isNaN(end) || end < now) continue; // past — can't conflict
                slots.push({ start: slot.startTime, end: slot.endTime });
            }
        }

        return slots;
    } catch (err) {
        console.warn('[crossProjectBusySlots] Fetch skipped (non-fatal):', err.message);
        return [];
    }
}
