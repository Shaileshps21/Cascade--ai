/**
 * google_calendar_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic Google Calendar integration, extracted from the old
 * schedulerAgent.js (63KB, purely deterministic file). No LLM calls.
 *
 * Token storage is wire-compatible with the existing OAuth callback route
 * (server/routes/calendar.js): tokens are read from / written to
 * `users/{userId}/settings/calendar_tokens`, exactly as the OAuth callback
 * already stores them. This agent does not perform the OAuth handshake
 * itself — that remains routes/calendar.js's job — it only consumes the
 * stored tokens.
 *
 * Exports:
 *   getCalendarClient(userId)                     — OAuth2 client w/ token refresh
 *   getFreeBusy(userId, timeMinISO, timeMaxISO)    — busy blocks, [] if not connected/any error
 *   syncScheduleToCalendar(context, userId)        — creates calendar events for unsynced scheduledTasks
 *   deleteCalendarEvents(userId, eventIds)         — preserved signature from the old scheduler
 *   buildCalendarEventPayload(...)                 — pure, exported for unit testing
 */

import { google } from 'googleapis';
import { db } from '../../config/firebase.js';
import './schema.js'; // registers schema (documentation/validation aid)

// ── Calendar event conventions (verified against the old schedulerAgent.js) ──
// First scheduled task  → 🚀 Peacock blue (colorId '9'), reminders at 30min + 5min
// Last scheduled task   → 🏁 Tomato red   (colorId '11'), reminders at 120min + 30min + 10min
// Everything else       → default calendar color (no colorId), single 15min reminder
export const FIRST_TASK_COLOR_ID = '9';
export const LAST_TASK_COLOR_ID = '11';
export const CALENDAR_EVENT_PREFIX = '⚡ [Cascade]';

// ═════════════════════════════════════════════════════════════════════════
// Pure helpers (no network — unit-tested in agent.test.js)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Build the Google Calendar `events.insert` request body for a single
 * scheduled task. Pure function — does not touch the network.
 *
 * @param {{taskId:string, taskName:string, startTime:string, endTime:string, adjustedDuration?:number, estimatedDuration?:number}} scheduledTask
 * @param {'first'|'last'|null} label
 * @param {string} taskTitle - the parent task/project title, for the description
 * @param {{overview?:string, aiGuidance?:string[]}} [taskDetail] - optional task-workspace detail (from context.planning.tasks)
 * @returns {object} Google Calendar event request body
 */
export function buildCalendarEventPayload(scheduledTask, label, taskTitle, taskDetail = {}) {
    const emoji = label === 'first' ? '🚀' : (label === 'last' ? '🏁' : null);
    const summary = `${CALENDAR_EVENT_PREFIX} ${emoji ? emoji + ' ' : ''}${scheduledTask.taskName}`.trim();

    const headerLine = label === 'first'
        ? '🚀 START BLOCK'
        : label === 'last'
            ? '🏁 FINAL BLOCK'
            : null;

    const tips = Array.isArray(taskDetail.aiGuidance) && taskDetail.aiGuidance.length
        ? taskDetail.aiGuidance.map(t => `• ${t}`).join('\n')
        : 'Stay focused and make meaningful progress.';

    const durationMinutes = typeof scheduledTask.adjustedDuration === 'number'
        ? scheduledTask.adjustedDuration
        : (scheduledTask.estimatedDuration ?? 0);

    const description = [
        headerLine ? `${headerLine} — Part of: "${taskTitle}"` : `Part of: "${taskTitle}"`,
        '',
        taskDetail.overview || '',
        '',
        '💡 Tips:',
        tips,
        '',
        `⏱ Estimated: ${durationMinutes} minutes`,
    ].join('\n').trim();

    const reminders = label === 'first'
        ? { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }, { method: 'popup', minutes: 5 }] }
        : label === 'last'
            ? { useDefault: false, overrides: [{ method: 'popup', minutes: 120 }, { method: 'popup', minutes: 30 }, { method: 'popup', minutes: 10 }] }
            : { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] };

    const payload = {
        summary,
        description,
        start: { dateTime: scheduledTask.startTime },
        end: { dateTime: scheduledTask.endTime },
        reminders,
    };

    const colorId = label === 'first' ? FIRST_TASK_COLOR_ID : (label === 'last' ? LAST_TASK_COLOR_ID : undefined);
    if (colorId) payload.colorId = colorId;

    return payload;
}

/**
 * Given a list of scheduledTasks pending sync, determine which taskId is
 * "first" (earliest startTime) and which is "last" (latest endTime).
 * Pure function — no network.
 * @param {Array<{taskId:string, startTime:string, endTime:string}>} scheduledTasks
 * @returns {{ firstId: string|null, lastId: string|null }}
 */
export function identifyFirstAndLastTasks(scheduledTasks) {
    if (!Array.isArray(scheduledTasks) || scheduledTasks.length === 0) {
        return { firstId: null, lastId: null };
    }
    const byStart = [...scheduledTasks].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const byEnd = [...scheduledTasks].sort((a, b) => new Date(a.endTime) - new Date(b.endTime));
    const firstId = byStart[0]?.taskId ?? null;
    const lastCandidate = byEnd[byEnd.length - 1]?.taskId ?? null;
    const lastId = lastCandidate !== firstId ? lastCandidate : null;
    return { firstId, lastId };
}

// ═════════════════════════════════════════════════════════════════════════
// OAuth / Google Calendar API (network — not covered by agent.test.js)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Build an authenticated Google Calendar client for a user, refreshing and
 * persisting tokens as needed. Reads/writes
 * `users/{userId}/settings/calendar_tokens` — the exact same Firestore path
 * the OAuth callback route (routes/calendar.js) already uses.
 *
 * @param {string} userId
 * @returns {Promise<import('googleapis').calendar_v3.Calendar>}
 * @throws {Error} with message 'CALENDAR_NOT_CONNECTED' if no tokens are stored
 */
export async function getCalendarClient(userId) {
    const tokenRef = db.collection('users').doc(userId).collection('settings').doc('calendar_tokens');
    const doc = await tokenRef.get();

    if (!doc.exists || !doc.data()?.access_token) {
        throw new Error('CALENDAR_NOT_CONNECTED');
    }

    const tokens = doc.data();
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI,
    );
    oauth2Client.setCredentials(tokens);

    // Persist refreshed tokens (e.g. new access_token) back to Firestore.
    oauth2Client.on('tokens', async (newTokens) => {
        try {
            await tokenRef.set({ ...tokens, ...newTokens }, { merge: true });
        } catch (err) {
            console.warn('[google_calendar_agent] Failed to persist refreshed tokens:', err.message);
        }
    });

    return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Fetch Google Calendar FreeBusy blocks for the user's primary calendar.
 * Non-fatal: returns [] gracefully if the calendar isn't connected or any
 * error occurs (calendar sync is optional — this must never break the
 * pipeline).
 *
 * @param {string} userId
 * @param {string} timeMinISO
 * @param {string} timeMaxISO
 * @returns {Promise<Array<{start:string, end:string}>>}
 */
export async function getFreeBusy(userId, timeMinISO, timeMaxISO) {
    try {
        const calendar = await getCalendarClient(userId);
        const res = await calendar.freebusy.query({
            requestBody: {
                timeMin: timeMinISO,
                timeMax: timeMaxISO,
                items: [{ id: 'primary' }],
            },
        });
        const busy = res.data?.calendars?.primary?.busy ?? [];
        return busy.map((b) => ({ start: b.start, end: b.end }));
    } catch (err) {
        if (err.message !== 'CALENDAR_NOT_CONNECTED') {
            console.warn('[google_calendar_agent] getFreeBusy failed (non-fatal):', err.message);
        }
        return [];
    }
}

/**
 * Create Google Calendar events for every entry in
 * `context.schedule.scheduledTasks[]` that doesn't already have a
 * `calendarEventId`. The earliest-starting task gets the 🚀 "first" anchor
 * (colorId '9'), the latest-ending task gets the 🏁 "last" anchor (colorId
 * '11'); everything else gets a default-colored event.
 *
 * Non-fatal at every layer: if the calendar isn't connected, returns the
 * schedule unchanged with `calendarConnected: false`. If individual event
 * creation calls fail, the failure is recorded in `warnings` and the task's
 * `calendarEventId` stays null — it does not abort the rest of the sync.
 *
 * @param {object} context - PlanningContext (reads context.schedule, context.intent, context.planning, context.rawGoal)
 * @param {string} userId
 * @returns {Promise<{ scheduledTasks: Array<object>, calendarConnected: boolean, warnings: string[] }>}
 */
export async function syncScheduleToCalendar(context, userId) {
    const scheduledTasks = context?.schedule?.scheduledTasks ?? [];
    if (scheduledTasks.length === 0) {
        return { scheduledTasks: [], calendarConnected: false, warnings: [] };
    }

    const taskTitle = context?.intent?.title ?? context?.rawGoal?.slice(0, 50) ?? 'Task';
    const planningTaskById = new Map((context?.planning?.tasks ?? []).map((t) => [t.taskId, t]));

    let calendar;
    try {
        calendar = await getCalendarClient(userId);
    } catch (err) {
        return {
            scheduledTasks,
            calendarConnected: false,
            warnings: err.message === 'CALENDAR_NOT_CONNECTED' ? [] : [`Calendar connection failed: ${err.message}`],
        };
    }

    const updated = scheduledTasks.map((t) => ({ ...t }));
    const pending = updated.filter((t) => !t.calendarEventId);
    if (pending.length === 0) {
        return { scheduledTasks: updated, calendarConnected: true, warnings: [] };
    }

    const { firstId, lastId } = identifyFirstAndLastTasks(pending);
    const warnings = [];

    for (const task of updated) {
        if (task.calendarEventId) continue; // already synced from a prior run

        const label = task.taskId === firstId ? 'first' : (task.taskId === lastId ? 'last' : null);
        const detail = planningTaskById.get(task.taskId) ?? {};
        const payload = buildCalendarEventPayload(task, label, taskTitle, {
            overview: detail.overview,
            aiGuidance: detail.aiGuidance,
        });

        try {
            const res = await calendar.events.insert({ calendarId: 'primary', requestBody: payload });
            task.calendarEventId = res.data.id;
            task.calendarLabel = label;
            console.log(`[google_calendar_agent] Created ${label ?? 'regular'} event "${payload.summary}": ${res.data.id}`);
        } catch (err) {
            console.error(`[google_calendar_agent] Event creation failed for "${task.taskName}":`, err.message);
            warnings.push(`Calendar event failed for "${task.taskName}": ${err.message}`);
        }
    }

    return { scheduledTasks: updated, calendarConnected: true, warnings };
}

/**
 * Delete a set of Google Calendar events for a user. Preserved with the
 * exact same signature as the old schedulerAgent.js so
 * server/routes/tasks.js's subtask-complete / task-delete flows can switch
 * their import path with no other code changes.
 *
 * Non-fatal: if the calendar client can't be built (not connected, auth
 * error, etc.) this silently returns — deletion failures must never block
 * the caller's own success path.
 *
 * @param {string} userId
 * @param {Array<string|null|undefined>} eventIds
 * @returns {Promise<void>}
 */
export async function deleteCalendarEvents(userId, eventIds) {
    const ids = (eventIds || []).filter(Boolean);
    if (ids.length === 0) return;

    let calendar;
    try {
        calendar = await getCalendarClient(userId);
    } catch (err) {
        console.warn('[google_calendar_agent] deleteCalendarEvents — no calendar client:', err.message);
        return;
    }

    const results = await Promise.allSettled(
        ids.map((id) => calendar.events.delete({ calendarId: 'primary', eventId: id })),
    );

    results.forEach((r, i) => {
        if (r.status === 'rejected') {
            console.warn(`[google_calendar_agent] Could not delete event ${ids[i]}:`, r.reason?.message);
        } else {
            console.log(`[google_calendar_agent] Deleted calendar event: ${ids[i]}`);
        }
    });
}
