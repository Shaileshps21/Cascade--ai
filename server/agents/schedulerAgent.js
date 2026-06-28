/**
 * Agent 4: Scheduler Agent
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Fetches the user's busy time from Google Calendar
 * 2. Computes free slots between now and the task deadline
 * 3. Greedily fits subtasks into free slots (earliest available)
 * 4. Creates Google Calendar events for each scheduled subtask
 * 5. Returns scheduled slot data (written to Firestore by orchestrator)
 */

import { google } from 'googleapis';
import { db } from '../config/firebase.js';

const WORK_START_HOUR = 7;   // 7 AM — don't schedule before this
const WORK_END_HOUR = 23;    // 11 PM — don't schedule after this
const MIN_SLOT_MINUTES = 15; // Minimum viable slot
const BUFFER_MINUTES = 10;   // Gap between calendar events

/**
 * Build an authenticated Google Calendar client for a user.
 * Tokens are stored in Firestore: users/{userId}/settings/calendar_tokens
 */
async function getCalendarClient(userId) {
  const tokenDoc = await db
    .collection('users')
    .doc(userId)
    .collection('settings')
    .doc('calendar_tokens')
    .get();

  if (!tokenDoc.exists) {
    throw new Error('CALENDAR_NOT_CONNECTED');
  }

  const tokens = tokenDoc.data();

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens and persist new ones
  oauth2Client.on('tokens', async (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    await db.collection('users').doc(userId)
      .collection('settings').doc('calendar_tokens')
      .set(merged, { merge: true });
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Get busy time windows from Google Calendar (freebusy API).
 * @returns {Array<{ start: Date, end: Date }>}
 */
async function getBusyTimes(calendar, timeMin, timeMax) {
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    },
  });

  const busySlots = response.data.calendars?.primary?.busy || [];
  return busySlots.map((slot) => ({
    start: new Date(slot.start),
    end: new Date(slot.end),
  }));
}

/**
 * Compute free time slots between now and deadline, respecting work hours.
 * @param {Date[]} busyTimes
 * @param {Date}   from
 * @param {Date}   to
 * @returns {Array<{ start: Date, end: Date, durationMinutes: number }>}
 */
function computeFreeSlots(busyTimes, from, to) {
  const slots = [];
  let cursor = new Date(from);

  // Merge and sort busy times
  const sorted = [...busyTimes].sort((a, b) => a.start - b.start);

  // Add a fake "busy" block to end the loop cleanly
  sorted.push({ start: to, end: to });

  for (const busy of sorted) {
    // Before the busy block, we might have free time
    const freeEnd = busy.start < to ? busy.start : to;

    while (cursor < freeEnd) {
      // Snap cursor to work-hours start if needed
      const dayStart = new Date(cursor);
      dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(WORK_END_HOUR, 0, 0, 0);

      if (cursor < dayStart) cursor = dayStart;

      if (cursor >= dayEnd) {
        // Jump to next day's work start
        cursor = new Date(cursor);
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(WORK_START_HOUR, 0, 0, 0);
        continue;
      }

      const slotEnd = new Date(Math.min(freeEnd.getTime(), dayEnd.getTime()));
      const durationMinutes = (slotEnd - cursor) / 60000;

      if (durationMinutes >= MIN_SLOT_MINUTES) {
        slots.push({
          start: new Date(cursor),
          end: slotEnd,
          durationMinutes: Math.floor(durationMinutes),
        });
      }

      cursor = new Date(slotEnd);
      if (cursor >= dayEnd) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(WORK_START_HOUR, 0, 0, 0);
      }
    }

    // Advance cursor past the busy block
    if (busy.end > cursor) cursor = new Date(busy.end);
  }

  return slots;
}

/**
 * Create a Google Calendar event for a subtask.
 */
async function createCalendarEvent(calendar, subtask, startTime, endTime, taskTitle) {
  const event = {
    summary: `⚡ [LifeSaver] ${subtask.title}`,
    description: `Part of task: "${taskTitle}"\n\n${subtask.description}\n\n💡 Tips:\n${subtask.tips?.map((t) => `• ${t}`).join('\n') || 'None'}`,
    start: { dateTime: startTime.toISOString() },
    end: { dateTime: endTime.toISOString() },
    colorId: '6', // Tangerine/orange
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 10 },
        { method: 'popup', minutes: 1 },
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
  });

  return response.data.id;
}

/**
 * Main scheduler agent function.
 *
 * @param {object[]} subtasks  – from planning agent
 * @param {string}   userId
 * @param {string}   deadline  – ISO string
 * @param {string}   taskTitle – for calendar event descriptions
 * @param {Function} emit      – SSE emitter
 */
export async function runSchedulerAgent(
  subtasks,
  userId,
  deadline,
  taskTitle,
  emit = null
) {
  emit?.({
    agent: "scheduler",
    status: "thinking",
    message: "📅 Generating optimal schedule...",
  });

  const now = new Date();

  const scheduledSlots = [];

  // Start 30 minutes from now
  let cursor = new Date(now.getTime() + 30 * 60 * 1000);

  for (const subtask of subtasks) {

    // Skip night hours (11 PM → 7 AM)
    if (cursor.getHours() >= 23 || cursor.getHours() < 7) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 0, 0, 0);
    }

    const start = new Date(cursor);

    const end = new Date(
      cursor.getTime() + subtask.estimatedMinutes * 60 * 1000
    );

    scheduledSlots.push({
      subtaskId: subtask.id,
      subtaskTitle: subtask.title,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      calendarEventId: null,
    });

    // Next task begins after a 10-minute break
    cursor = new Date(end.getTime() + 10 * 60 * 1000);
  }

  emit?.({
    agent: "scheduler",
    status: "done",
    message: `✅ Scheduled ${scheduledSlots.length} subtasks`,
    data: {
      scheduled: scheduledSlots.length,
      total: subtasks.length,
      firstSlot: scheduledSlots[0]?.startTime,
      warnings: [],
    },
  });

  return {
    scheduledSlots,
    calendarConnected: false,
    warnings: [],
  };
}
/**
 * Delete calendar events for a list of event IDs (used by re-planner).
 */
// export async function deleteCalendarEvents(userId, eventIds) {
//   const calendar = await getCalendarClient(userId);
//   await Promise.allSettled(
//     eventIds
//       .filter(Boolean)
//       .map((id) => calendar.events.delete({ calendarId: 'primary', eventId: id }))
//   );
// }

export async function deleteCalendarEvents() {
  // Calendar integration disabled.
  return;
}