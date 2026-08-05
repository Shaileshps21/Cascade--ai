
// // --------------------------------------------------new file---------------------------------------------------

// import { google } from 'googleapis';
// import { db } from '../config/firebase.js';

// const WORK_START_HOUR = 8;
// const WORK_END_HOUR = 22;
// const MIN_SLOT_MINUTES = 20;
// const BUFFER_MINUTES = 10;

// // ── OAuth client ──────────────────────────────────────────────────────────────
// async function getCalendarClient(userId) {
//   const tokenDoc = await db
//     .collection('users').doc(userId)
//     .collection('settings').doc('calendar_tokens')
//     .get();

//   if (!tokenDoc.exists || !tokenDoc.data()?.access_token)
//     throw new Error('CALENDAR_NOT_CONNECTED');

//   const tokens = tokenDoc.data();
//   const oauth2Client = new google.auth.OAuth2(
//     process.env.GOOGLE_CLIENT_ID,
//     process.env.GOOGLE_CLIENT_SECRET,
//     process.env.GOOGLE_REDIRECT_URI
//   );
//   oauth2Client.setCredentials(tokens);
//   oauth2Client.on('tokens', async (newTokens) => {
//     await db.collection('users').doc(userId)
//       .collection('settings').doc('calendar_tokens')
//       .set({ ...tokens, ...newTokens }, { merge: true });
//   });
//   return google.calendar({ version: 'v3', auth: oauth2Client });
// }

// // ── Freebusy ──────────────────────────────────────────────────────────────────
// async function getBusyTimes(calendar, timeMin, timeMax) {
//   const res = await calendar.freebusy.query({
//     requestBody: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: 'primary' }] },
//   });
//   const busy = res.data.calendars?.primary?.busy || [];
//   console.log(`[Scheduler] Busy slots: ${busy.length}`);
//   return busy.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
// }

// // ── Free slot computation ─────────────────────────────────────────────────────
// function computeFreeSlots(busyTimes, from, to) {
//   const slots = [];
//   let cursor = new Date(from);
//   const sorted = [...busyTimes].sort((a, b) => a.start - b.start);
//   sorted.push({ start: to, end: to });

//   for (const busy of sorted) {
//     const freeEnd = busy.start < to ? busy.start : to;
//     while (cursor < freeEnd) {
//       const dayStart = new Date(cursor); dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
//       const dayEnd = new Date(cursor); dayEnd.setHours(WORK_END_HOUR, 0, 0, 0);

//       if (cursor < dayStart) cursor = new Date(dayStart);
//       if (cursor >= dayEnd) {
//         cursor = new Date(cursor);
//         cursor.setDate(cursor.getDate() + 1);
//         cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//         continue;
//       }

//       const slotEnd = new Date(Math.min(freeEnd.getTime(), dayEnd.getTime()));
//       const mins = (slotEnd - cursor) / 60_000;
//       if (mins >= MIN_SLOT_MINUTES)
//         slots.push({ start: new Date(cursor), end: slotEnd, durationMinutes: Math.floor(mins) });

//       cursor = new Date(slotEnd);
//       if (cursor >= dayEnd) {
//         cursor.setDate(cursor.getDate() + 1);
//         cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//       }
//     }
//     if (busy.end > cursor) cursor = new Date(busy.end);
//   }
//   return slots;
// }

// // ── Sequential fallback slots ─────────────────────────────────────────────────
// function sequentialSlots(subtasks) {
//   let cursor = new Date(Date.now() + 5 * 60_000);
//   if (cursor.getHours() < WORK_START_HOUR) cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//   if (cursor.getHours() >= WORK_END_HOUR) {
//     cursor.setDate(cursor.getDate() + 1);
//     cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//   }

//   return subtasks.map((s) => {
//     if (cursor.getHours() >= WORK_END_HOUR) {
//       cursor.setDate(cursor.getDate() + 1);
//       cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//     }
//     const start = new Date(cursor);
//     const end = new Date(cursor.getTime() + s.estimatedMinutes * 60_000);
//     cursor = new Date(end.getTime() + BUFFER_MINUTES * 60_000);
//     return { id: s.id, start, end };
//   });
// }

// // ── Calendar event creation ───────────────────────────────────────────────────
// async function createCalendarEvent(calendar, subtask, start, end, taskTitle) {
//   const tipsText = subtask.tips?.length
//     ? subtask.tips.map((t) => `• ${t}`).join('\n')
//     : 'Stay focused and make meaningful progress.';

//   const requestBody = {
//     summary: `⚡ [LifeSaver] ${subtask.title}`,
//     description: [
//       `📌 Part of: "${taskTitle}"`,
//       '',
//       subtask.description || '',
//       '',
//       '💡 Tips:',
//       tipsText,
//       '',
//       `⏱ Estimated: ${subtask.estimatedMinutes} minutes`,
//     ].join('\n').trim(),
//     start: { dateTime: start.toISOString() },
//     end: { dateTime: end.toISOString() },
//     colorId: '6', // Tangerine
//     reminders: {
//       useDefault: false,
//       overrides: [{ method: 'popup', minutes: 15 }],
//     },
//   };

//   console.log(`[Scheduler] Creating event: "${requestBody.summary}" @ ${start.toLocaleString()}`);
//   const res = await calendar.events.insert({ calendarId: 'primary', requestBody });
//   console.log(`[Scheduler] ✅ Created: ${res.data.id}`);
//   return res.data.id;
// }

// // ── Main export ───────────────────────────────────────────────────────────────
// export async function runSchedulerAgent(subtasks, userId, deadline, taskTitle, emit = null) {
//   emit?.({ agent: 'scheduler', status: 'thinking', message: '📅 Connecting to Google Calendar...' });

//   // Identify the 2 priority subtasks for calendar booking
//   const prioritySubtasks = subtasks.filter((s) => s.calendarPriority);
//   const regularSubtasks = subtasks.filter((s) => !s.calendarPriority);

//   emit?.({
//     agent: 'scheduler', status: 'thinking',
//     message: `📌 Booking 2 key subtasks into calendar: "${prioritySubtasks.map((s) => s.title).join('" & "')}"`,
//   });

//   // ── Connect to Calendar ───────────────────────────────────────────────────
//   let calendar = null;
//   try {
//     calendar = await getCalendarClient(userId);
//     emit?.({ agent: 'scheduler', status: 'thinking', message: '✅ Calendar connected — finding your free slots...' });
//   } catch (err) {
//     if (err.message === 'CALENDAR_NOT_CONNECTED') {
//       emit?.({
//         agent: 'scheduler', status: 'warning',
//         message: '📅 Calendar not connected — all subtasks time-blocked but no Google events created.',
//       });
//       return buildNoCalendarResult(subtasks, emit);
//     }
//     console.error('[Scheduler] Auth error:', err.message);
//     return buildNoCalendarResult(subtasks, emit);
//   }

//   // ── Fetch free slots ──────────────────────────────────────────────────────
//   const now = new Date();
//   const deadlineEnd = new Date(deadline) > now
//     ? new Date(deadline)
//     : new Date(now.getTime() + 7 * 24 * 3_600_000);

//   let freeSlots = [];
//   try {
//     const busy = await getBusyTimes(calendar, now, deadlineEnd);
//     freeSlots = computeFreeSlots(busy, now, deadlineEnd);
//     emit?.({ agent: 'scheduler', status: 'thinking', message: `🕐 Found ${freeSlots.length} free slots...` });
//   } catch (err) {
//     console.error('[Scheduler] Freebusy failed:', err.message);
//     freeSlots = [];
//   }

//   // ── Assign time slots to ALL subtasks ─────────────────────────────────────
//   // Priority subtasks get real free slots first; the rest get sequential times.
//   const slotMap = new Map(); // subtask.id → { start, end }
//   const remainSlots = freeSlots.map((s) => ({ ...s }));

//   // Assign free slots to priority subtasks
//   for (const s of prioritySubtasks) {
//     const needed = s.estimatedMinutes + BUFFER_MINUTES;
//     const idx = remainSlots.findIndex((sl) => sl.durationMinutes >= needed);

//     if (idx !== -1) {
//       const slot = remainSlots[idx];
//       const start = new Date(slot.start);
//       const end = new Date(slot.start.getTime() + s.estimatedMinutes * 60_000);
//       slotMap.set(s.id, { start, end });
//       slot.start = new Date(end.getTime() + BUFFER_MINUTES * 60_000);
//       slot.durationMinutes = (slot.end - slot.start) / 60_000;
//       if (slot.durationMinutes < MIN_SLOT_MINUTES) remainSlots.splice(idx, 1);
//     }
//   }

//   // Sequential slots for priority subtasks that didn't fit + all regular ones
//   const unslotted = prioritySubtasks.filter((s) => !slotMap.has(s.id));
//   const needsSeq = [...unslotted, ...regularSubtasks];
//   const seqSlots = sequentialSlots(needsSeq);
//   seqSlots.forEach((sl, i) => slotMap.set(needsSeq[i].id, { start: sl.start, end: sl.end }));

//   // ── Create Google Calendar events for ONLY the 2 priority subtasks ─────────
//   emit?.({
//     agent: 'scheduler', status: 'thinking',
//     message: `📅 Adding 2 calendar events for your key subtasks...`,
//   });

//   const scheduledSlots = [];
//   const failedEvents = [];

//   for (const subtask of subtasks) {
//     const { start, end } = slotMap.get(subtask.id) || {};
//     let calendarEventId = null;

//     if (subtask.calendarPriority && calendar && start && end) {
//       try {
//         calendarEventId = await createCalendarEvent(calendar, subtask, start, end, taskTitle);
//       } catch (err) {
//         console.error(`[Scheduler] Event failed for "${subtask.title}":`, err.message);
//         failedEvents.push(subtask.title);
//       }
//     }

//     scheduledSlots.push({
//       subtaskId: subtask.id,
//       subtaskTitle: subtask.title,
//       startTime: start?.toISOString() || null,
//       endTime: end?.toISOString() || null,
//       calendarEventId,
//       isCalendarEvent: !!calendarEventId,
//     });
//   }

//   const eventsCreated = scheduledSlots.filter((s) => s.calendarEventId).length;
//   const warnings = failedEvents.length > 0
//     ? [`Calendar event failed for: ${failedEvents.join(', ')} — check server logs`]
//     : [];

//   emit?.({
//     agent: 'scheduler',
//     status: eventsCreated > 0 ? 'done' : 'warning',
//     message: eventsCreated > 0
//       ? `✅ ${eventsCreated} key subtask${eventsCreated > 1 ? 's' : ''} added to Google Calendar · ${subtasks.length - eventsCreated} others time-blocked`
//       : `⚠️ Could not create calendar events — check permissions`,
//     data: {
//       totalSubtasks: subtasks.length,
//       eventsCreated,
//       calendarSubtasks: prioritySubtasks.map((s) => s.title),
//       firstSlot: scheduledSlots.find((s) => s.isCalendarEvent)?.startTime,
//       warnings,
//     },
//   });

//   return { scheduledSlots, calendarConnected: true, warnings };
// }

// // ── No-calendar fallback ──────────────────────────────────────────────────────
// function buildNoCalendarResult(subtasks, emit) {
//   const seqSlots = sequentialSlots(subtasks);
//   const scheduledSlots = seqSlots.map((sl, i) => ({
//     subtaskId: subtasks[i].id,
//     subtaskTitle: subtasks[i].title,
//     startTime: sl.start.toISOString(),
//     endTime: sl.end.toISOString(),
//     calendarEventId: null,
//     isCalendarEvent: false,
//   }));

//   emit?.({
//     agent: 'scheduler', status: 'done',
//     message: `📋 ${subtasks.length} subtasks time-blocked — connect Calendar to enable Google events`,
//     data: { totalSubtasks: subtasks.length, eventsCreated: 0, warnings: [] },
//   });

//   return { scheduledSlots, calendarConnected: false, warnings: [] };
// }

// // ── Delete calendar events (used by re-planner) ───────────────────────────────
// export async function deleteCalendarEvents(userId, eventIds) {
//   let calendar;
//   try { calendar = await getCalendarClient(userId); } catch { return; }
//   await Promise.allSettled(
//     (eventIds || []).filter(Boolean).map((id) =>
//       calendar.events.delete({ calendarId: 'primary', eventId: id })
//     )
//   );
// }



// // -----------------------------------newest file by mrh2025031-------------------------------------------
// import { google } from 'googleapis';
// import { db } from '../config/firebase.js';

// const WORK_START_HOUR = 8;
// const WORK_END_HOUR = 22;
// const MIN_SLOT_MINUTES = 20;
// const BUFFER_MINUTES = 10;
// const DEADLINE_LEAD_MS = 2 * 60 * 60_000; // last subtask should land 2h before the deadline

// // ── OAuth client ──────────────────────────────────────────────────────────────
// async function getCalendarClient(userId) {
//   const tokenDoc = await db
//     .collection('users').doc(userId)
//     .collection('settings').doc('calendar_tokens')
//     .get();

//   if (!tokenDoc.exists || !tokenDoc.data()?.access_token)
//     throw new Error('CALENDAR_NOT_CONNECTED');

//   const tokens = tokenDoc.data();
//   const oauth2Client = new google.auth.OAuth2(
//     process.env.GOOGLE_CLIENT_ID,
//     process.env.GOOGLE_CLIENT_SECRET,
//     process.env.GOOGLE_REDIRECT_URI
//   );
//   oauth2Client.setCredentials(tokens);
//   oauth2Client.on('tokens', async (newTokens) => {
//     await db.collection('users').doc(userId)
//       .collection('settings').doc('calendar_tokens')
//       .set({ ...tokens, ...newTokens }, { merge: true });
//   });
//   return google.calendar({ version: 'v3', auth: oauth2Client });
// }

// // ── Freebusy ──────────────────────────────────────────────────────────────────
// async function getBusyTimes(calendar, timeMin, timeMax) {
//   const res = await calendar.freebusy.query({
//     requestBody: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: 'primary' }] },
//   });
//   const busy = res.data.calendars?.primary?.busy || [];
//   console.log(`[Scheduler] Busy slots: ${busy.length}`);
//   return busy.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
// }

// // ── Free slot computation ─────────────────────────────────────────────────────
// function computeFreeSlots(busyTimes, from, to) {
//   const slots = [];
//   let cursor = new Date(from);
//   const sorted = [...busyTimes].sort((a, b) => a.start - b.start);
//   sorted.push({ start: to, end: to });

//   for (const busy of sorted) {
//     const freeEnd = busy.start < to ? busy.start : to;
//     while (cursor < freeEnd) {
//       const dayStart = new Date(cursor); dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
//       const dayEnd = new Date(cursor); dayEnd.setHours(WORK_END_HOUR, 0, 0, 0);

//       if (cursor < dayStart) cursor = new Date(dayStart);
//       if (cursor >= dayEnd) {
//         cursor = new Date(cursor);
//         cursor.setDate(cursor.getDate() + 1);
//         cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//         continue;
//       }

//       const slotEnd = new Date(Math.min(freeEnd.getTime(), dayEnd.getTime()));
//       const mins = (slotEnd - cursor) / 60_000;
//       if (mins >= MIN_SLOT_MINUTES)
//         slots.push({ start: new Date(cursor), end: slotEnd, durationMinutes: Math.floor(mins) });

//       cursor = new Date(slotEnd);
//       if (cursor >= dayEnd) {
//         cursor.setDate(cursor.getDate() + 1);
//         cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//       }
//     }
//     if (busy.end > cursor) cursor = new Date(busy.end);
//   }
//   return slots;
// }

// // ── Sequential fallback slots ─────────────────────────────────────────────────
// function sequentialSlots(subtasks) {
//   let cursor = new Date(Date.now() + 5 * 60_000);
//   if (cursor.getHours() < WORK_START_HOUR) cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//   if (cursor.getHours() >= WORK_END_HOUR) {
//     cursor.setDate(cursor.getDate() + 1);
//     cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//   }

//   return subtasks.map((s) => {
//     if (cursor.getHours() >= WORK_END_HOUR) {
//       cursor.setDate(cursor.getDate() + 1);
//       cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//     }
//     const start = new Date(cursor);
//     const end = new Date(cursor.getTime() + s.estimatedMinutes * 60_000);
//     cursor = new Date(end.getTime() + BUFFER_MINUTES * 60_000);
//     return { id: s.id, start, end };
//   });
// }

// // ── Slot-selection helpers ─────────────────────────────────────────────────────
// // Takes the earliest free slot (chronologically first) that fits, mutating remainSlots
// // so subsequent calls don't double-book the same time.
// function takeEarliestSlot(remainSlots, estimatedMinutes) {
//   const needed = estimatedMinutes + BUFFER_MINUTES;
//   const idx = remainSlots.findIndex((sl) => sl.durationMinutes >= needed);
//   if (idx === -1) return null;

//   const slot = remainSlots[idx];
//   const start = new Date(slot.start);
//   const end = new Date(start.getTime() + estimatedMinutes * 60_000);

//   slot.start = new Date(end.getTime() + BUFFER_MINUTES * 60_000);
//   slot.durationMinutes = (slot.end - slot.start) / 60_000;
//   if (slot.durationMinutes < MIN_SLOT_MINUTES) remainSlots.splice(idx, 1);

//   return { start, end };
// }

// // Takes the latest free slot that ends at/before `before`, mutating remainSlots.
// // Used to place the last subtask as close as possible to the deadline anchor
// // when the exact anchor time itself isn't free.
// function takeLatestSlotBefore(remainSlots, estimatedMinutes, before) {
//   for (let i = remainSlots.length - 1; i >= 0; i--) {
//     const slot = remainSlots[i];
//     if (slot.start >= before) continue;

//     const usableEnd = slot.end < before ? slot.end : before;
//     const availableMinutes = (usableEnd - slot.start) / 60_000;
//     if (availableMinutes < estimatedMinutes) continue;

//     const end = usableEnd;
//     const start = new Date(end.getTime() - estimatedMinutes * 60_000);

//     slot.end = new Date(start.getTime() - BUFFER_MINUTES * 60_000);
//     slot.durationMinutes = (slot.end - slot.start) / 60_000;
//     if (slot.durationMinutes < MIN_SLOT_MINUTES) remainSlots.splice(i, 1);

//     return { start, end };
//   }
//   return null;
// }

// function isRangeFree(busyTimes, start, end) {
//   return !busyTimes.some((b) => start < b.end && end > b.start);
// }

// // ── Calendar event creation ───────────────────────────────────────────────────
// async function createCalendarEvent(calendar, subtask, start, end, taskTitle) {
//   const tipsText = subtask.tips?.length
//     ? subtask.tips.map((t) => `• ${t}`).join('\n')
//     : 'Stay focused and make meaningful progress.';

//   const requestBody = {
//     summary: `⚡ [LifeSaver] ${subtask.title}`,
//     description: [
//       `📌 Part of: "${taskTitle}"`,
//       '',
//       subtask.description || '',
//       '',
//       '💡 Tips:',
//       tipsText,
//       '',
//       `⏱ Estimated: ${subtask.estimatedMinutes} minutes`,
//     ].join('\n').trim(),
//     start: { dateTime: start.toISOString() },
//     end: { dateTime: end.toISOString() },
//     colorId: '6', // Tangerine
//     reminders: {
//       useDefault: false,
//       overrides: [{ method: 'popup', minutes: 15 }],
//     },
//   };

//   console.log(`[Scheduler] Creating event: "${requestBody.summary}" @ ${start.toLocaleString()}`);
//   const res = await calendar.events.insert({ calendarId: 'primary', requestBody });
//   console.log(`[Scheduler] ✅ Created: ${res.data.id}`);
//   return res.data.id;
// }

// // ── Main export ───────────────────────────────────────────────────────────────
// export async function runSchedulerAgent(subtasks, userId, deadline, taskTitle, emit = null) {
//   emit?.({ agent: 'scheduler', status: 'thinking', message: '📅 Connecting to Google Calendar...' });

//   if (!subtasks?.length) {
//     return { scheduledSlots: [], calendarConnected: false, warnings: [] };
//   }

//   // The first subtask (by order) gets the earliest free slot; the last subtask
//   // (by order) gets booked 2 hours ahead of the deadline. Both are the only
//   // subtasks that get real Google Calendar events — everything else is just
//   // time-blocked internally.
//   const firstSubtask = subtasks[0];
//   const lastSubtask = subtasks[subtasks.length - 1];
//   const isSingleSubtask = firstSubtask.id === lastSubtask.id;
//   const specialSubtasks = isSingleSubtask ? [firstSubtask] : [firstSubtask, lastSubtask];

//   emit?.({
//     agent: 'scheduler', status: 'thinking',
//     message: isSingleSubtask
//       ? `📌 Booking "${firstSubtask.title}" into calendar`
//       : `📌 Booking 2 key subtasks into calendar: "${firstSubtask.title}" & "${lastSubtask.title}"`,
//   });

//   // ── Connect to Calendar ───────────────────────────────────────────────────
//   let calendar = null;
//   try {
//     calendar = await getCalendarClient(userId);
//     emit?.({ agent: 'scheduler', status: 'thinking', message: '✅ Calendar connected — finding your free slots...' });
//   } catch (err) {
//     if (err.message === 'CALENDAR_NOT_CONNECTED') {
//       emit?.({
//         agent: 'scheduler', status: 'warning',
//         message: '📅 Calendar not connected — all subtasks time-blocked but no Google events created.',
//       });
//       return buildNoCalendarResult(subtasks, emit);
//     }
//     console.error('[Scheduler] Auth error:', err.message);
//     return buildNoCalendarResult(subtasks, emit);
//   }

//   // ── Fetch free slots ──────────────────────────────────────────────────────
//   const now = new Date();
//   const deadlineDate = new Date(deadline);
//   const hasValidDeadline = !isNaN(deadlineDate.getTime()) && deadlineDate > now;
//   const deadlineEnd = hasValidDeadline
//     ? deadlineDate
//     : new Date(now.getTime() + 7 * 24 * 3_600_000);

//   let busyTimes = [];
//   let freeSlots = [];
//   try {
//     busyTimes = await getBusyTimes(calendar, now, deadlineEnd);
//     freeSlots = computeFreeSlots(busyTimes, now, deadlineEnd);
//     emit?.({ agent: 'scheduler', status: 'thinking', message: `🕐 Found ${freeSlots.length} free slots...` });
//   } catch (err) {
//     console.error('[Scheduler] Freebusy failed:', err.message);
//     freeSlots = [];
//   }

//   // ── Assign time slots to ALL subtasks ─────────────────────────────────────
//   const slotMap = new Map(); // subtask.id → { start, end }
//   const remainSlots = freeSlots.map((s) => ({ ...s }));

//   // 1) First subtask → earliest available free slot.
//   const firstSlot = takeEarliestSlot(remainSlots, firstSubtask.estimatedMinutes);
//   if (firstSlot) slotMap.set(firstSubtask.id, firstSlot);

//   // 2) Last subtask → anchored 2 hours before the deadline (skipped if it's the
//   //    same subtask as the first, e.g. a single-subtask task).
//   if (!isSingleSubtask) {
//     let lastSlot = null;

//     if (hasValidDeadline) {
//       const anchorEnd = new Date(deadlineDate.getTime() - DEADLINE_LEAD_MS);
//       const anchorStart = new Date(anchorEnd.getTime() - lastSubtask.estimatedMinutes * 60_000);

//       if (anchorStart > now && isRangeFree(busyTimes, anchorStart, anchorEnd)) {
//         // The exact 2-hours-before-deadline slot is free — use it directly.
//         lastSlot = { start: anchorStart, end: anchorEnd };
//       } else {
//         // Otherwise, get as close to that anchor as possible.
//         lastSlot = takeLatestSlotBefore(remainSlots, lastSubtask.estimatedMinutes, anchorEnd);
//       }
//     }

//     // Last resort: no usable deadline, or nothing fit near it — take whatever's earliest.
//     if (!lastSlot) lastSlot = takeEarliestSlot(remainSlots, lastSubtask.estimatedMinutes);

//     if (lastSlot) slotMap.set(lastSubtask.id, lastSlot);
//   }

//   // 3) Everything else (regular subtasks, plus first/last if they didn't fit
//   //    anywhere on the calendar) gets sequential fallback times.
//   const regularSubtasks = subtasks.filter((s) => !specialSubtasks.some((sp) => sp.id === s.id));
//   const unassignedSpecial = specialSubtasks.filter((s) => !slotMap.has(s.id));
//   const needsSeq = [...unassignedSpecial, ...regularSubtasks];
//   const seqSlots = sequentialSlots(needsSeq);
//   seqSlots.forEach((sl, i) => slotMap.set(needsSeq[i].id, { start: sl.start, end: sl.end }));

//   // ── Create Google Calendar events for ONLY the first/last subtasks ─────────
//   emit?.({
//     agent: 'scheduler', status: 'thinking',
//     message: isSingleSubtask
//       ? '📅 Adding calendar event for your subtask...'
//       : '📅 Adding 2 calendar events for your key subtasks...',
//   });

//   const calendarSubtaskIds = new Set(specialSubtasks.map((s) => s.id));
//   const scheduledSlots = [];
//   const failedEvents = [];

//   for (const subtask of subtasks) {
//     const { start, end } = slotMap.get(subtask.id) || {};
//     let calendarEventId = null;

//     if (calendarSubtaskIds.has(subtask.id) && calendar && start && end) {
//       try {
//         calendarEventId = await createCalendarEvent(calendar, subtask, start, end, taskTitle);
//       } catch (err) {
//         console.error(`[Scheduler] Event failed for "${subtask.title}":`, err.message);
//         failedEvents.push(subtask.title);
//       }
//     }

//     scheduledSlots.push({
//       subtaskId: subtask.id,
//       subtaskTitle: subtask.title,
//       startTime: start?.toISOString() || null,
//       endTime: end?.toISOString() || null,
//       calendarEventId,
//       isCalendarEvent: !!calendarEventId,
//     });
//   }

//   const eventsCreated = scheduledSlots.filter((s) => s.calendarEventId).length;
//   const warnings = failedEvents.length > 0
//     ? [`Calendar event failed for: ${failedEvents.join(', ')} — check server logs`]
//     : [];

//   emit?.({
//     agent: 'scheduler',
//     status: eventsCreated > 0 ? 'done' : 'warning',
//     message: eventsCreated > 0
//       ? `✅ ${eventsCreated} key subtask${eventsCreated > 1 ? 's' : ''} added to Google Calendar · ${subtasks.length - eventsCreated} others time-blocked`
//       : `⚠️ Could not create calendar events — check permissions`,
//     data: {
//       totalSubtasks: subtasks.length,
//       eventsCreated,
//       calendarSubtasks: specialSubtasks.map((s) => s.title),
//       firstSlot: scheduledSlots.find((s) => s.isCalendarEvent)?.startTime,
//       warnings,
//     },
//   });

//   return { scheduledSlots, calendarConnected: true, warnings };
// }

// // ── No-calendar fallback ──────────────────────────────────────────────────────
// function buildNoCalendarResult(subtasks, emit) {
//   const seqSlots = sequentialSlots(subtasks);
//   const scheduledSlots = seqSlots.map((sl, i) => ({
//     subtaskId: subtasks[i].id,
//     subtaskTitle: subtasks[i].title,
//     startTime: sl.start.toISOString(),
//     endTime: sl.end.toISOString(),
//     calendarEventId: null,
//     isCalendarEvent: false,
//   }));

//   emit?.({
//     agent: 'scheduler', status: 'done',
//     message: `📋 ${subtasks.length} subtasks time-blocked — connect Calendar to enable Google events`,
//     data: { totalSubtasks: subtasks.length, eventsCreated: 0, warnings: [] },
//   });

//   return { scheduledSlots, calendarConnected: false, warnings: [] };
// }

// // ── Delete calendar events (used by re-planner and on subtask completion) ─────
// export async function deleteCalendarEvents(userId, eventIds) {
//   let calendar;
//   try { calendar = await getCalendarClient(userId); } catch { return; }
//   await Promise.allSettled(
//     (eventIds || []).filter(Boolean).map((id) =>
//       calendar.events.delete({ calendarId: 'primary', eventId: id })
//     )
//   );
// }



// // ------------------------------------------------------new file by shailesh-------------------------------------------
// /**
//  * Agent 4: Scheduler Agent
//  * ─────────────────────────────────────────────────────────────────────────────
//  * Google Calendar strategy:
//  *   • FIRST subtask  → earliest available free slot (start now, get going)
//  *   • LAST subtask   → slot ending exactly 2 hours before deadline (final push)
//  *   • All others     → sequential time blocks only (no calendar events)
//  *
//  * On subtask complete → caller should invoke deleteCalendarEvents()
//  */

// import { google } from 'googleapis';
// import { db } from '../config/firebase.js';

// const WORK_START_HOUR = 8;
// const WORK_END_HOUR = 22;
// const MIN_SLOT_MINUTES = 15;
// const BUFFER_MINUTES = 10;

// // ── OAuth ─────────────────────────────────────────────────────────────────────
// async function getCalendarClient(userId) {
//   const doc = await db
//     .collection('users').doc(userId)
//     .collection('settings').doc('calendar_tokens')
//     .get();

//   if (!doc.exists || !doc.data()?.access_token)
//     throw new Error('CALENDAR_NOT_CONNECTED');

//   const tokens = doc.data();
//   const oauth2Client = new google.auth.OAuth2(
//     process.env.GOOGLE_CLIENT_ID,
//     process.env.GOOGLE_CLIENT_SECRET,
//     process.env.GOOGLE_REDIRECT_URI
//   );
//   oauth2Client.setCredentials(tokens);
//   oauth2Client.on('tokens', async (t) => {
//     await db.collection('users').doc(userId)
//       .collection('settings').doc('calendar_tokens')
//       .set({ ...tokens, ...t }, { merge: true });
//   });
//   return google.calendar({ version: 'v3', auth: oauth2Client });
// }

// // ── Freebusy ──────────────────────────────────────────────────────────────────
// async function getBusyTimes(calendar, timeMin, timeMax) {
//   const res = await calendar.freebusy.query({
//     requestBody: {
//       timeMin: timeMin.toISOString(),
//       timeMax: timeMax.toISOString(),
//       items: [{ id: 'primary' }],
//     },
//   });
//   const busy = res.data.calendars?.primary?.busy || [];
//   console.log(`[Scheduler] Busy slots from Google: ${busy.length}`);
//   return busy.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
// }

// // ── Free slot computation ─────────────────────────────────────────────────────
// function computeFreeSlots(busyTimes, from, to) {
//   const slots = [];
//   let cursor = new Date(from);
//   const sorted = [...busyTimes].sort((a, b) => a.start - b.start);
//   sorted.push({ start: to, end: to });

//   for (const busy of sorted) {
//     const freeEnd = busy.start < to ? busy.start : to;
//     while (cursor < freeEnd) {
//       const dayStart = new Date(cursor); dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
//       const dayEnd = new Date(cursor); dayEnd.setHours(WORK_END_HOUR, 0, 0, 0);

//       if (cursor < dayStart) cursor = new Date(dayStart);
//       if (cursor >= dayEnd) {
//         cursor = new Date(cursor);
//         cursor.setDate(cursor.getDate() + 1);
//         cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//         continue;
//       }

//       const slotEnd = new Date(Math.min(freeEnd.getTime(), dayEnd.getTime()));
//       const mins = (slotEnd - cursor) / 60_000;
//       if (mins >= MIN_SLOT_MINUTES)
//         slots.push({ start: new Date(cursor), end: slotEnd, durationMinutes: Math.floor(mins) });

//       cursor = new Date(slotEnd);
//       if (cursor >= dayEnd) {
//         cursor.setDate(cursor.getDate() + 1);
//         cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//       }
//     }
//     if (busy.end > cursor) cursor = new Date(busy.end);
//   }
//   return slots;
// }

// // ── Sequential fallback (no calendar) ────────────────────────────────────────
// function sequentialSlots(subtasks, startFrom = null) {
//   let cursor = startFrom ? new Date(startFrom) : new Date(Date.now() + 5 * 60_000);

//   if (cursor.getHours() < WORK_START_HOUR) cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//   if (cursor.getHours() >= WORK_END_HOUR) {
//     cursor.setDate(cursor.getDate() + 1);
//     cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//   }

//   return subtasks.map((s) => {
//     if (cursor.getHours() >= WORK_END_HOUR) {
//       cursor.setDate(cursor.getDate() + 1);
//       cursor.setHours(WORK_START_HOUR, 0, 0, 0);
//     }
//     const start = new Date(cursor);
//     const end = new Date(cursor.getTime() + s.estimatedMinutes * 60_000);
//     cursor = new Date(end.getTime() + BUFFER_MINUTES * 60_000);
//     return { id: s.id, start, end };
//   });
// }

// // ── Find the best free slot for a target start time ──────────────────────────
// // Looks for a free slot that contains targetStart and has enough duration.
// // If none, returns the closest slot before targetStart.
// function findSlotNear(freeSlots, targetStart, neededMinutes) {
//   // First: exact fit — slot that contains the target time
//   const exact = freeSlots.find(
//     (sl) => sl.start <= targetStart &&
//       sl.end >= new Date(targetStart.getTime() + neededMinutes * 60_000)
//   );
//   if (exact) return { start: targetStart, end: new Date(targetStart.getTime() + neededMinutes * 60_000) };

//   // Second: last slot that ends before or at target start + buffer
//   const before = [...freeSlots]
//     .filter((sl) => sl.start < targetStart && sl.durationMinutes >= neededMinutes)
//     .sort((a, b) => b.start - a.start)[0]; // latest before target

//   if (before) {
//     // Place the event at the end of this slot
//     const start = new Date(before.end.getTime() - neededMinutes * 60_000);
//     return { start, end: new Date(before.end) };
//   }

//   // Third: first available slot at all
//   const any = freeSlots.find((sl) => sl.durationMinutes >= neededMinutes);
//   if (any) return { start: any.start, end: new Date(any.start.getTime() + neededMinutes * 60_000) };

//   return null;
// }

// // ── Create a Google Calendar event ───────────────────────────────────────────
// async function createCalendarEvent(calendar, subtask, start, end, taskTitle, label) {
//   const tipsText = subtask.tips?.length
//     ? subtask.tips.map((t) => `• ${t}`).join('\n')
//     : 'Stay focused.';

//   const labelEmoji = label === 'first' ? '🚀 START' : '🏁 FINAL';

//   const requestBody = {
//     summary: `⚡ [LifeSaver] ${subtask.title}`,
//     description: [
//       `${labelEmoji} — Part of: "${taskTitle}"`,
//       '',
//       subtask.description || '',
//       '',
//       '💡 Tips:',
//       tipsText,
//       '',
//       `⏱ Estimated: ${subtask.estimatedMinutes} minutes`,
//     ].join('\n').trim(),
//     start: { dateTime: start.toISOString() },
//     end: { dateTime: end.toISOString() },
//     colorId: label === 'first' ? '7' : '11', // Peacock blue for start, Tomato red for final
//     reminders: {
//       useDefault: false,
//       overrides: label === 'first'
//         ? [{ method: 'popup', minutes: 30 },
//           // { method: 'popup', minutes: 5 }
//         ]
//         : [{ method: 'popup', minutes: 120 }, { method: 'popup', minutes: 30 }],
//     },
//   };

//   console.log(`[Scheduler] Creating ${label} event: "${requestBody.summary}" @ ${start.toLocaleString()}`);
//   const res = await calendar.events.insert({ calendarId: 'primary', requestBody });
//   console.log(`[Scheduler] ✅ Event created: ${res.data.id}`);
//   return res.data.id;
// }

// // ── Main ──────────────────────────────────────────────────────────────────────
// export async function runSchedulerAgent(subtasks, userId, deadline, taskTitle, emit = null) {
//   if (!subtasks || subtasks.length === 0) {
//     return { scheduledSlots: [], calendarConnected: false, warnings: ['No subtasks to schedule'] };
//   }

//   const now = new Date();
//   const deadlineDate = new Date(deadline);

//   // Sorted by order — guaranteed by planningAgent but ensure it here
//   const sorted = [...subtasks].sort((a, b) => a.order - b.order);
//   const first = sorted[0];
//   const last = sorted[sorted.length - 1];
//   const middle = sorted.slice(1, -1); // everything between first and last

//   emit?.({ agent: 'scheduler', status: 'thinking', message: '📅 Connecting to Google Calendar...' });

//   // ── Try calendar connection ───────────────────────────────────────────────
//   let calendar = null;
//   try {
//     calendar = await getCalendarClient(userId);
//     emit?.({ agent: 'scheduler', status: 'thinking', message: '✅ Calendar connected — finding optimal slots...' });
//   } catch (err) {
//     if (err.message === 'CALENDAR_NOT_CONNECTED') {
//       emit?.({
//         agent: 'scheduler', status: 'warning',
//         message: '📅 Calendar not connected — time-blocking all subtasks without Google events.'
//       });
//       return buildNoCalendarResult(subtasks, emit);
//     }
//     console.error('[Scheduler] Auth error:', err.message);
//     return buildNoCalendarResult(subtasks, emit);
//   }

//   // ── Fetch free slots ──────────────────────────────────────────────────────
//   const scheduleEnd = deadlineDate > now
//     ? deadlineDate
//     : new Date(now.getTime() + 7 * 24 * 3_600_000);

//   let freeSlots = [];
//   try {
//     const busy = await getBusyTimes(calendar, now, scheduleEnd);
//     freeSlots = computeFreeSlots(busy, now, scheduleEnd);
//     emit?.({
//       agent: 'scheduler', status: 'thinking',
//       message: `🕐 Found ${freeSlots.length} free slots — placing first & last subtasks...`
//     });
//   } catch (err) {
//     console.error('[Scheduler] Freebusy error:', err.message);
//   }

//   // ── 1. FIRST subtask → earliest free slot ────────────────────────────────
//   let firstStart, firstEnd;
//   if (freeSlots.length > 0 && freeSlots[0].durationMinutes >= first.estimatedMinutes) {
//     firstStart = new Date(freeSlots[0].start);
//     firstEnd = new Date(firstStart.getTime() + first.estimatedMinutes * 60_000);
//   } else {
//     // No free slot — schedule right now (or at work-hour start)
//     firstStart = new Date(Math.max(now.getTime() + 5 * 60_000,
//       (() => { const d = new Date(now); d.setHours(WORK_START_HOUR, 0, 0, 0); return d; })().getTime()
//     ));
//     firstEnd = new Date(firstStart.getTime() + first.estimatedMinutes * 60_000);
//   }

//   // ── 2. LAST subtask → ends 2 hours before deadline ───────────────────────
//   const twoHoursBefore = new Date(deadlineDate.getTime() - 2 * 3_600_000);
//   const lastStart = new Date(twoHoursBefore.getTime() - last.estimatedMinutes * 60_000);
//   let lastActualStart, lastActualEnd;

//   // Ensure last subtask doesn't overlap with first
//   if (lastStart > firstEnd) {
//     // Try to find a free slot near lastStart
//     const nearSlot = findSlotNear(freeSlots, lastStart, last.estimatedMinutes);
//     if (nearSlot) {
//       lastActualStart = nearSlot.start;
//       lastActualEnd = nearSlot.end;
//     } else {
//       lastActualStart = lastStart;
//       lastActualEnd = new Date(lastStart.getTime() + last.estimatedMinutes * 60_000);
//     }
//   } else {
//     // Deadline is very close — place last subtask right after first
//     lastActualStart = new Date(firstEnd.getTime() + BUFFER_MINUTES * 60_000);
//     lastActualEnd = new Date(lastActualStart.getTime() + last.estimatedMinutes * 60_000);
//   }

//   // ── 3. Middle subtasks → sequential time blocks between first and last ────
//   const middleSeq = sequentialSlots(middle, new Date(firstEnd.getTime() + BUFFER_MINUTES * 60_000));
//   const middleSlotMap = new Map(middleSeq.map((sl, i) => [middle[i].id, sl]));

//   // ── 4. Create Google Calendar events for FIRST and LAST only ─────────────
//   emit?.({
//     agent: 'scheduler', status: 'thinking',
//     message: `📅 Adding "🚀 Start" event for "${first.title}" and "🏁 Final" event for "${last.title}"...`
//   });

//   const scheduledSlots = [];
//   const failedEvents = [];

//   for (const subtask of sorted) {
//     let start, end, calendarEventId = null, label = null;

//     if (subtask.id === first.id) {
//       start = firstStart; end = firstEnd; label = 'first';
//     } else if (subtask.id === last.id) {
//       start = lastActualStart; end = lastActualEnd; label = 'last';
//     } else {
//       const seq = middleSlotMap.get(subtask.id);
//       start = seq?.start || new Date(); end = seq?.end || new Date();
//     }

//     // Only create calendar events for first and last
//     if (label && calendar) {
//       try {
//         calendarEventId = await createCalendarEvent(calendar, subtask, start, end, taskTitle, label);
//       } catch (err) {
//         console.error(`[Scheduler] Event failed for "${subtask.title}":`, err.message);
//         failedEvents.push(subtask.title);
//       }
//     }

//     scheduledSlots.push({
//       subtaskId: subtask.id,
//       subtaskTitle: subtask.title,
//       startTime: start.toISOString(),
//       endTime: end.toISOString(),
//       calendarEventId,
//       calendarLabel: label, // 'first' | 'last' | null
//     });
//   }

//   const eventsCreated = scheduledSlots.filter((s) => s.calendarEventId).length;
//   const warnings = failedEvents.length > 0
//     ? [`Calendar event failed for: ${failedEvents.join(', ')}`]
//     : [];

//   emit?.({
//     agent: 'scheduler',
//     status: eventsCreated > 0 ? 'done' : 'warning',
//     message: eventsCreated > 0
//       ? `✅ Calendar: 🚀 "${first.title}" @ ${firstStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · 🏁 "${last.title}" 2h before deadline`
//       : `⚠️ Schedule built but calendar events failed — check server logs`,
//     data: {
//       totalSubtasks: subtasks.length,
//       eventsCreated,
//       firstEvent: { title: first.title, startTime: firstStart.toISOString() },
//       lastEvent: { title: last.title, startTime: lastActualStart.toISOString() },
//       deadlineBuffer: '2 hours',
//       warnings,
//     },
//   });

//   return { scheduledSlots, calendarConnected: true, warnings };
// }

// // ── No-calendar result ────────────────────────────────────────────────────────
// function buildNoCalendarResult(subtasks, emit) {
//   const sorted = [...subtasks].sort((a, b) => a.order - b.order);
//   const slots = sequentialSlots(sorted);
//   const scheduledSlots = slots.map((sl, i) => ({
//     subtaskId: sorted[i].id,
//     subtaskTitle: sorted[i].title,
//     startTime: sl.start.toISOString(),
//     endTime: sl.end.toISOString(),
//     calendarEventId: null,
//     calendarLabel: null,
//   }));

//   emit?.({
//     agent: 'scheduler', status: 'done',
//     message: `📋 ${subtasks.length} subtasks time-blocked — connect Calendar to get Google events`,
//     data: { totalSubtasks: subtasks.length, eventsCreated: 0 },
//   });

//   return { scheduledSlots, calendarConnected: false, warnings: [] };
// }

// // ── Delete calendar events (used on subtask complete + re-planner) ────────────
// export async function deleteCalendarEvents(userId, eventIds) {
//   const ids = (eventIds || []).filter(Boolean);
//   if (ids.length === 0) return;

//   let calendar;
//   try { calendar = await getCalendarClient(userId); }
//   catch (err) { console.warn('[Scheduler] deleteCalendarEvents — no calendar client:', err.message); return; }

//   const results = await Promise.allSettled(
//     ids.map((id) => calendar.events.delete({ calendarId: 'primary', eventId: id }))
//   );

//   results.forEach((r, i) => {
//     if (r.status === 'rejected') {
//       console.warn(`[Scheduler] Could not delete event ${ids[i]}:`, r.reason?.message);
//     } else {
//       console.log(`[Scheduler] Deleted calendar event: ${ids[i]}`);
//     }
//   });
// }


// ----------------------------------------------new file------------------------------------------------------------------------------------
/**
 * Agent 4: Scheduler Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Spreads subtasks naturally across the available days:
 *   • FIRST subtask  → earliest slot today (🚀 calendar event)
 *   • LAST subtask   → 2 hours before deadline (🏁 calendar event)
 *   • MIDDLE subtasks → 1 per day spread across remaining days, 9 AM each day
 *
 * For a 7-day task: one subtask per day.
 * For a 3-day task with 6 subtasks: 2 per day.
 * Never packs everything into a single day.
 */

import { google } from 'googleapis';
import { db } from '../config/firebase.js';

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 21;
const BUFFER_MINUTES = 10;
const MIN_SLOT_MINUTES = 15;

// ── OAuth ─────────────────────────────────────────────────────────────────────
async function getCalendarClient(userId) {
  const doc = await db
    .collection('users').doc(userId)
    .collection('settings').doc('calendar_tokens')
    .get();

  if (!doc.exists || !doc.data()?.access_token)
    throw new Error('CALENDAR_NOT_CONNECTED');

  const tokens = doc.data();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', async (t) => {
    await db.collection('users').doc(userId)
      .collection('settings').doc('calendar_tokens')
      .set({ ...tokens, ...t }, { merge: true });
  });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// ── Freebusy ──────────────────────────────────────────────────────────────────
async function getBusyTimes(calendar, timeMin, timeMax) {
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    },
  });
  const busy = res.data.calendars?.primary?.busy || [];
  console.log(`[Scheduler] Busy slots: ${busy.length}`);
  return busy.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
}

// ── Free slot computation (for first/last calendar events) ────────────────────
function computeFreeSlots(busyTimes, from, to) {
  const slots = [];
  let cursor = new Date(from);
  const sorted = [...busyTimes].sort((a, b) => a.start - b.start);
  sorted.push({ start: to, end: to });

  for (const busy of sorted) {
    const freeEnd = busy.start < to ? busy.start : to;
    while (cursor < freeEnd) {
      const dayStart = new Date(cursor); dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
      const dayEnd = new Date(cursor); dayEnd.setHours(WORK_END_HOUR, 0, 0, 0);

      if (cursor < dayStart) cursor = new Date(dayStart);
      if (cursor >= dayEnd) {
        cursor = new Date(cursor);
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(WORK_START_HOUR, 0, 0, 0);
        continue;
      }
      const slotEnd = new Date(Math.min(freeEnd.getTime(), dayEnd.getTime()));
      const mins = (slotEnd - cursor) / 60_000;
      if (mins >= MIN_SLOT_MINUTES)
        slots.push({ start: new Date(cursor), end: slotEnd, durationMinutes: Math.floor(mins) });
      cursor = new Date(slotEnd);
      if (cursor >= dayEnd) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(WORK_START_HOUR, 0, 0, 0);
      }
    }
    if (busy.end > cursor) cursor = new Date(busy.end);
  }
  return slots;
}

// ── Core: spread subtasks naturally across available days ─────────────────────
// e.g. 6 subtasks over 3 days → 2 per day
//      6 subtasks over 7 days → 1 per day
function spreadAcrossDays(subtasks, fromDate, toDate) {
  if (subtasks.length === 0) return [];

  const totalMs = Math.max(0, toDate - fromDate);
  const totalDays = totalMs / (24 * 3_600_000);

  console.log(`[Scheduler] Spreading ${subtasks.length} subtasks across ${totalDays.toFixed(1)} days`);

  return subtasks.map((subtask, i) => {
    let dayOffset;

    if (subtasks.length === 1) {
      dayOffset = 0;
    } else {
      // Distribute evenly: subtask i gets dayOffset = floor(fraction * totalDays)
      // Clamp so last subtask doesn't go past deadline
      const fraction = i / (subtasks.length - 1);
      dayOffset = Math.floor(fraction * Math.max(0, totalDays - 0.5));
    }

    // Build the target datetime: target day at 9 AM
    const targetDay = new Date(fromDate);
    targetDay.setDate(targetDay.getDate() + dayOffset);
    targetDay.setHours(WORK_START_HOUR, 0, 0, 0);

    // For day 0 (today): don't schedule in the past
    if (dayOffset === 0) {
      const minStart = new Date(fromDate.getTime() + 20 * 60_000); // at least 20 min from now
      if (minStart > targetDay) {
        // If it's past work hours, push to tomorrow
        if (minStart.getHours() >= WORK_END_HOUR) {
          targetDay.setDate(targetDay.getDate() + 1);
          targetDay.setHours(WORK_START_HOUR, 0, 0, 0);
        } else {
          targetDay.setTime(minStart.getTime());
        }
      }
    }

    const start = new Date(targetDay);
    const end = new Date(start.getTime() + subtask.estimatedMinutes * 60_000);

    console.log(`[Scheduler]   ${subtask.title}: Day +${dayOffset} → ${start.toLocaleDateString()} ${start.toLocaleTimeString()}`);

    return { id: subtask.id, start, end };
  });
}

// ── Create a Google Calendar event ───────────────────────────────────────────
async function createCalendarEvent(calendar, subtask, start, end, taskTitle, label) {
  const tipsText = subtask.tips?.length
    ? subtask.tips.map((t) => `• ${t}`).join('\n')
    : 'Stay focused.';

  const requestBody = {
    summary: `⚡ [LifeSaver] ${label === 'first' ? '🚀' : '🏁'} ${subtask.title}`,
    description: [
      `${label === 'first' ? '🚀 START BLOCK' : '🏁 FINAL BLOCK'} — Part of: "${taskTitle}"`,
      '',
      subtask.description || '',
      '',
      '💡 Tips:',
      tipsText,
      '',
      `⏱ Estimated: ${subtask.estimatedMinutes} minutes`,
    ].join('\n').trim(),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    colorId: label === 'first' ? '9' : '11', // Peacock (blue) for start, Tomato (red) for final
    reminders: {
      useDefault: false,
      overrides: label === 'first'
        ? [{ method: 'popup', minutes: 30 }, { method: 'popup', minutes: 5 }]
        : [{ method: 'popup', minutes: 120 }, { method: 'popup', minutes: 30 }, { method: 'popup', minutes: 10 }],
    },
  };

  console.log(`[Scheduler] Creating "${label}" event: "${subtask.title}" @ ${start.toLocaleString()}`);
  const res = await calendar.events.insert({ calendarId: 'primary', requestBody });
  console.log(`[Scheduler] ✅ Created event: ${res.data.id}`);
  return res.data.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function runSchedulerAgent(subtasks, userId, deadline, taskTitle, emit = null) {
  if (!subtasks || subtasks.length === 0)
    return { scheduledSlots: [], calendarConnected: false, warnings: [] };

  const now = new Date();
  const deadlineDate = new Date(deadline);
  const totalDays = (deadlineDate - now) / (24 * 3_600_000);

  // Sort by order
  const sorted = [...subtasks].sort((a, b) => a.order - b.order);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const middle = sorted.length > 2 ? sorted.slice(1, -1) : [];

  console.log(`[Scheduler] Task has ${totalDays.toFixed(1)} days, ${sorted.length} subtasks`);

  emit?.({
    agent: 'scheduler', status: 'thinking',
    message: `📅 ${totalDays.toFixed(1)} days available — spreading ${sorted.length} subtasks naturally...`
  });

  // ── Try calendar ──────────────────────────────────────────────────────────
  let calendar = null;
  try {
    calendar = await getCalendarClient(userId);
    emit?.({ agent: 'scheduler', status: 'thinking', message: '✅ Calendar connected — finding free slots...' });
  } catch (err) {
    if (err.message === 'CALENDAR_NOT_CONNECTED') {
      emit?.({
        agent: 'scheduler', status: 'warning',
        message: '📅 Calendar not connected — scheduling across days without Google events.'
      });
      return buildResult(sorted, first, last, middle, now, deadlineDate, null, emit);
    }
    return buildResult(sorted, first, last, middle, now, deadlineDate, null, emit);
  }

  // ── Fetch free slots for first/last calendar events ───────────────────────
  const scheduleEnd = deadlineDate > now
    ? deadlineDate
    : new Date(now.getTime() + 7 * 24 * 3_600_000);

  let freeSlots = [];
  try {
    const busy = await getBusyTimes(calendar, now, scheduleEnd);
    freeSlots = computeFreeSlots(busy, now, scheduleEnd);
  } catch (err) {
    console.error('[Scheduler] Freebusy error:', err.message);
  }

  return buildResult(sorted, first, last, middle, now, deadlineDate, calendar, emit, freeSlots, taskTitle);
}

// ── Build result: compute all slots + create calendar events ──────────────────
async function buildResult(sorted, first, last, middle, now, deadlineDate, calendar, emit, freeSlots = [], taskTitle = '') {

  const slotMap = new Map(); // subtask.id → { start, end }

  // ── 1. FIRST subtask: earliest available slot ─────────────────────────────
  let firstStart, firstEnd;
  const firstNeeded = first.estimatedMinutes;
  const firstFree = freeSlots.find((s) => s.durationMinutes >= firstNeeded);

  if (firstFree) {
    firstStart = new Date(firstFree.start);
  } else {
    // No free slot found: schedule at work-hour start today or now + 20min
    firstStart = new Date(Math.max(
      now.getTime() + 20 * 60_000,
      (() => { const d = new Date(now); d.setHours(WORK_START_HOUR, 0, 0, 0); return d.getTime(); })()
    ));
    // If past work hours today, push to tomorrow morning
    if (firstStart.getHours() >= WORK_END_HOUR) {
      firstStart.setDate(firstStart.getDate() + 1);
      firstStart.setHours(WORK_START_HOUR, 0, 0, 0);
    }
  }
  firstEnd = new Date(firstStart.getTime() + first.estimatedMinutes * 60_000);
  slotMap.set(first.id, { start: firstStart, end: firstEnd });

  console.log(`[Scheduler] FIRST: "${first.title}" → ${firstStart.toLocaleString()}`);

  // ── 2. LAST subtask: 2 hours before deadline ──────────────────────────────
  let lastStart = new Date(deadlineDate.getTime() - 2 * 3_600_000 - last.estimatedMinutes * 60_000);
  let lastEnd = new Date(deadlineDate.getTime() - 2 * 3_600_000);

  // If last would overlap with first, push it after first
  if (lastStart <= firstEnd) {
    lastStart = new Date(firstEnd.getTime() + BUFFER_MINUTES * 60_000);
    lastEnd = new Date(lastStart.getTime() + last.estimatedMinutes * 60_000);
  }

  // If late night, pull back to 9 PM
  if (lastStart.getHours() >= WORK_END_HOUR) {
    lastStart.setHours(WORK_END_HOUR - 1, 0, 0, 0);
    lastEnd = new Date(lastStart.getTime() + last.estimatedMinutes * 60_000);
  }

  slotMap.set(last.id, { start: lastStart, end: lastEnd });
  console.log(`[Scheduler] LAST:  "${last.title}" → ${lastStart.toLocaleString()}`);

  // ── 3. MIDDLE subtasks: spread across days between first and last ─────────
  if (middle.length > 0) {
    const middleFrom = new Date(firstEnd.getTime() + BUFFER_MINUTES * 60_000);
    const middleTo = new Date(lastStart.getTime() - BUFFER_MINUTES * 60_000);
    const middleSlots = spreadAcrossDays(middle, middleFrom, middleTo);
    middleSlots.forEach((sl) => slotMap.set(sl.id, { start: sl.start, end: sl.end }));
  }

  // ── 4. Create calendar events for first + last only ───────────────────────
  const scheduledSlots = [];
  const failedEvents = [];

  for (const subtask of sorted) {
    const { start, end } = slotMap.get(subtask.id) || { start: new Date(), end: new Date() };
    let calendarEventId = null;
    let calendarLabel = null;

    const isFirst = subtask.id === first.id;
    const isLast = subtask.id === last.id && sorted.length > 1;

    if ((isFirst || isLast) && calendar) {
      calendarLabel = isFirst ? 'first' : 'last';
      try {
        calendarEventId = await createCalendarEvent(
          calendar, subtask, start, end, taskTitle, calendarLabel
        );
      } catch (err) {
        console.error(`[Scheduler] Event failed for "${subtask.title}":`, err.message);
        failedEvents.push(subtask.title);
      }
    }

    scheduledSlots.push({
      subtaskId: subtask.id,
      subtaskTitle: subtask.title,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      calendarEventId,
      calendarLabel,
    });
  }

  const eventsCreated = scheduledSlots.filter((s) => s.calendarEventId).length;
  const warnings = failedEvents.length > 0
    ? [`Calendar events failed for: ${failedEvents.join(', ')}`]
    : [];

  emit?.({
    agent: 'scheduler',
    status: 'done',
    message: eventsCreated > 0
      ? `✅ 🚀 "${first.title}" on ${firstStart.toLocaleDateString()} · 🏁 "${last.title}" on ${lastStart.toLocaleDateString()} (2h before deadline)`
      : `📋 ${sorted.length} subtasks spread across days — connect Calendar for Google events`,
    data: {
      totalSubtasks: sorted.length,
      eventsCreated,
      daysSpanned: Math.round((lastStart - firstStart) / (24 * 3_600_000) * 10) / 10,
      firstEvent: { title: first.title, date: firstStart.toLocaleDateString() },
      lastEvent: { title: last.title, date: lastStart.toLocaleDateString() },
      warnings,
    },
  });

  return { scheduledSlots, calendarConnected: !!calendar, warnings };
}

// ── No-calendar fallback ──────────────────────────────────────────────────────
function buildNoCalendarResult(subtasks, emit) {
  const sorted = [...subtasks].sort((a, b) => a.order - b.order);
  const now = new Date();
  const slots = spreadAcrossDays(sorted, now, new Date(now.getTime() + 7 * 24 * 3_600_000));

  const scheduledSlots = slots.map((sl, i) => ({
    subtaskId: sorted[i].id,
    subtaskTitle: sorted[i].title,
    startTime: sl.start.toISOString(),
    endTime: sl.end.toISOString(),
    calendarEventId: null,
    calendarLabel: null,
  }));

  emit?.({
    agent: 'scheduler', status: 'done',
    message: `📋 ${sorted.length} subtasks spread across days — connect Calendar for Google events`
  });
  return { scheduledSlots, calendarConnected: false, warnings: [] };
}

// ── Delete events (used on subtask complete + re-planner) ─────────────────────
export async function deleteCalendarEvents(userId, eventIds) {
  const ids = (eventIds || []).filter(Boolean);
  if (ids.length === 0) return;
  let calendar;
  try { calendar = await getCalendarClient(userId); } catch { return; }
  await Promise.allSettled(
    ids.map((id) => calendar.events.delete({ calendarId: 'primary', eventId: id }))
  );
  console.log(`[Scheduler] Deleted ${ids.length} calendar event(s)`);
}