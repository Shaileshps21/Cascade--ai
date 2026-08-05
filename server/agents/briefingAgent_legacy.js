// /**
//  * Agent 6: Daily Briefing Agent
//  * ─────────────────────────────────────────────────────────────────────────────
//  * Runs every morning via cron (3:30 AM UTC = ~9 AM IST).
//  * For each user with active tasks, generates a personalized AI briefing:
//  *   - Task urgency overview
//  *   - Highest risk callout
//  *   - Today's recommended focus block
//  *   - Pattern insights from past behavior
//  *   - Motivational framing specific to their situation
//  *
//  * Briefings are stored in Firestore: users/{userId}/briefings/{date}
//  * Frontend fetches and displays once per day (dismissed state tracked).
//  */

// import { db } from '../config/firebase.js';
// import { defaultClients, createClients, parseJSON } from '../config/llm.js';

// // ── Prompt ────────────────────────────────────────────────────────────────────
// const BRIEFING_PROMPT = `You are a sharp, empathetic productivity coach generating a personalized morning briefing.

// You will receive a user's active tasks with their current state.
// Generate a briefing that feels personal, direct, and actionable — not generic.

// Rules:
// - Be honest about risk. Don't sugarcoat urgent situations.
// - Each recommendation must reference the ACTUAL task name and subtask.
// - The insight must be derived from the data, not generic advice.
// - Tone: confident, warm, brief. No fluff.

// Respond ONLY with valid JSON:
// {
//   "greeting": "Personalized good morning (include name if provided)",
//   "headline": "One-line situational summary (honest, specific)",
//   "urgencyLevel": "calm | watchful | urgent | critical",
//   "taskOverview": [
//     {
//       "title": "task title",
//       "status": "on_track | at_risk | critical | overdue",
//       "hoursLeft": number,
//       "progress": number (0-100),
//       "nextAction": "specific next subtask to do"
//     }
//   ],
//   "topPriority": {
//     "taskTitle": "the task needing most attention today",
//     "reason": "why this task is the top priority (1 sentence)",
//     "firstSubtask": "exact title of the first thing to do",
//     "estimatedMinutes": number,
//     "scheduledTime": "time if scheduled, else null"
//   },
//   "insight": "One data-driven insight about this user's patterns or situation (specific, not generic)",
//   "motivationalNote": "One sentence — honest encouragement or honest warning, whichever is appropriate",
//   "todayGoal": "What 'a good day' looks like today — specific and achievable"
// }`;

// // ── Build task context for the prompt ─────────────────────────────────────────
// function buildTaskContext(tasks, userName) {
//     const now = new Date();

//     const taskSummaries = tasks.map((task) => {
//         const deadline = new Date(task.deadline);
//         const hoursLeft = Math.max(0, (deadline - now) / 3_600_000);
//         const completed = (task.subtasks || []).filter((s) => s.completed).length;
//         const total = (task.subtasks || []).length;
//         const nextSubtask = (task.subtasks || []).find((s) => !s.completed);

//         return {
//             title: task.title,
//             category: task.category,
//             complexity: task.complexity,
//             deadline: deadline.toLocaleString(),
//             hoursLeft: Math.round(hoursLeft * 10) / 10,
//             progress: total > 0 ? Math.round((completed / total) * 100) : 0,
//             riskScore: task.riskScore || 0,
//             status: task.status,
//             subtasksDone: completed,
//             subtasksTotal: total,
//             nextSubtask: nextSubtask?.title || 'All done',
//             nextSubtaskScheduled: nextSubtask?.scheduledStart || null,
//         };
//     });

//     return `USER: ${userName || 'User'}
// CURRENT TIME: ${now.toLocaleString()}
// DATE: ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

// ACTIVE TASKS (${tasks.length} total):
// ${JSON.stringify(taskSummaries, null, 2)}`;
// }

// // ── Generate briefing for one user ────────────────────────────────────────────
// async function generateBriefingForUser(userId, userName, tasks) {
//     // Get LLM client — user's personal key first, then server default
//     let clients = defaultClients;
//     try {
//         const keyDoc = await db
//             .collection('users').doc(userId)
//             .collection('settings').doc('llm_key')
//             .get();
//         if (keyDoc.exists && keyDoc.data()?.key) {
//             clients = createClients(keyDoc.data().keyType, keyDoc.data().key);
//         }
//     } catch { }

//     if (!clients) {
//         console.warn(`[Briefing] No LLM client for user ${userId} — skipping`);
//         return null;
//     }

//     const context = buildTaskContext(tasks, userName);
//     const fullPrompt = `${BRIEFING_PROMPT}\n\n---\n${context}\n---`;

//     const response = await clients.pro.generateText(fullPrompt);
//     return parseJSON(response);
// }

// // ── Get today's date key (YYYY-MM-DD) ─────────────────────────────────────────
// function todayKey() {
//     return new Date().toISOString().slice(0, 10);
// }

// // ── Main sweep — called by cron ───────────────────────────────────────────────
// export async function runBriefingAgent() {
//     const now = new Date();
//     const dateKey = todayKey();
//     let processed = 0;
//     let skipped = 0;

//     console.log(`\n[Briefing] 🌅 Morning briefing sweep — ${now.toLocaleString()}`);

//     // Get all users who have active tasks
//     const snapshot = await db
//         .collection('tasks')
//         .where('status', 'in', ['active', 'at_risk'])
//         .get();

//     if (snapshot.empty) {
//         console.log('[Briefing] No active tasks found — nothing to brief');
//         return;
//     }

//     // Group tasks by userId
//     const tasksByUser = {};
//     snapshot.docs.forEach((doc) => {
//         const task = doc.data();
//         const userId = task.userId;
//         if (!userId) return;
//         if (!tasksByUser[userId]) tasksByUser[userId] = [];
//         tasksByUser[userId].push(task);
//     });

//     console.log(`[Briefing] Generating briefings for ${Object.keys(tasksByUser).length} users`);

//     for (const [userId, tasks] of Object.entries(tasksByUser)) {
//         try {
//             // Check if briefing already generated today
//             const existingRef = db
//                 .collection('users').doc(userId)
//                 .collection('briefings').doc(dateKey);
//             const existing = await existingRef.get();

//             if (existing.exists) {
//                 skipped++;
//                 continue;
//             }

//             // Fetch user's display name
//             const userDoc = await db.collection('users').doc(userId).get();
//             const userName = userDoc.data()?.name || userDoc.data()?.email?.split('@')[0] || 'there';

//             // Generate the briefing
//             const briefing = await generateBriefingForUser(userId, userName, tasks);
//             if (!briefing) continue;

//             // Save to Firestore
//             await existingRef.set({
//                 ...briefing,
//                 userId,
//                 date: dateKey,
//                 generatedAt: new Date(),
//                 seen: false,
//                 dismissed: false,
//                 taskCount: tasks.length,
//             });

//             console.log(`[Briefing] ✅ Generated for user ${userId}: "${briefing.headline}"`);
//             processed++;
//         } catch (err) {
//             console.error(`[Briefing] Failed for user ${userId}:`, err.message);
//         }
//     }

//     console.log(`[Briefing] Complete — ${processed} generated, ${skipped} already existed\n`);
// }

// // ── Generate briefing for a single user on-demand ─────────────────────────────
// // Called when user clicks "Refresh Briefing" in the UI
// export async function generateBriefingNow(userId) {
//     const dateKey = todayKey();

//     // Fetch user's active tasks
//     const snapshot = await db
//         .collection('tasks')
//         .where('userId', '==', userId)
//         .where('status', 'in', ['active', 'at_risk', 'overdue'])
//         .get();

//     if (snapshot.empty) {
//         return { message: 'No active tasks — nothing to brief on.' };
//     }

//     const tasks = snapshot.docs.map((d) => d.data());
//     const userDoc = await db.collection('users').doc(userId).get();
//     const userName = userDoc.data()?.name || 'there';

//     const briefing = await generateBriefingForUser(userId, userName, tasks);
//     if (!briefing) throw new Error('Could not generate briefing — no LLM client available');

//     const briefingDoc = {
//         ...briefing,
//         userId,
//         date: dateKey,
//         generatedAt: new Date(),
//         seen: false,
//         dismissed: false,
//         taskCount: tasks.length,
//     };

//     await db
//         .collection('users').doc(userId)
//         .collection('briefings').doc(dateKey)
//         .set(briefingDoc, { merge: true });

//     return briefingDoc;
// }








// --------------------new file -------------------------------------------------
/**
 * Agent 6: Daily Briefing Agent — Improved
 * WHEN:  Cron 3:30 AM UTC (=9 AM IST). Also on-demand via UI button.
 * WHERE: Firestore → users/{userId}/briefings/{YYYY-MM-DD}
 *        Dashboard card + browser notification on app open.
 *
 * THREE STAGES (first two are deterministic, no AI cost):
 *  Stage 1 — Triage:    classify tasks into urgency buckets from raw data
 *  Stage 2 — Schedule:  build today's focus blocks (realistic, hours-aware)
 *  Stage 3 — Narrative: AI writes the personalized briefing text
 */

import { db } from '../config/firebase.js';
import { defaultClients, createClients, parseJSON } from '../config/llm.js';

const WORK_START = 9;   // 9 AM local
const WORK_END = 19;  // 7 PM local

// ── Stage 1: Deterministic triage ─────────────────────────────────────────────
function triageTasks(tasks) {
    const now = new Date();
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now.getTime() + 7 * 24 * 3_600_000);

    const buckets = { fireNow: [], dueToday: [], dueWeek: [], onTrack: [], overdue: [] };

    const enriched = tasks.map((task) => {
        const deadline = new Date(task.deadline);
        const hoursLeft = (deadline - now) / 3_600_000;
        const subs = task.subtasks || [];
        const done = subs.filter((s) => s.completed).length;
        const progress = subs.length > 0 ? Math.round((done / subs.length) * 100) : 0;
        const pending = subs.filter((s) => !s.completed);
        const workMinLeft = pending.reduce((a, s) => a + (s.estimatedMinutes || 60), 0);
        const nextSub = pending[0] || null;

        return {
            ...task,
            hoursLeft: Math.round(hoursLeft * 10) / 10,
            daysLeft: Math.round(hoursLeft / 24 * 10) / 10,
            progress,
            workMinLeft,
            nextSub,
            done,
            total: subs.length,
            isPastDue: deadline < now,
            isDueToday: deadline <= endOfToday && deadline >= now,
            isDueWeek: deadline <= endOfWeek && deadline > endOfToday,
        };
    });

    enriched.forEach((t) => {
        if (t.isPastDue) buckets.overdue.push(t);
        else if (t.hoursLeft <= 12) buckets.fireNow.push(t);
        else if (t.isDueToday) buckets.dueToday.push(t);
        else if (t.isDueWeek) buckets.dueWeek.push(t);
        else buckets.onTrack.push(t);
    });

    Object.values(buckets).forEach((b) => b.sort((a, b) => a.hoursLeft - b.hoursLeft));
    return { buckets, enriched };
}

// ── Stage 2: Build focus schedule (deterministic) ─────────────────────────────
function buildSchedule(buckets) {
    const now = new Date();
    let cursor = new Date(now);
    const schedule = [];

    if (cursor.getHours() < WORK_START) cursor.setHours(WORK_START, 0, 0, 0);
    if (cursor.getHours() >= WORK_END) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(WORK_START, 0, 0, 0);
    }

    const dayEnd = new Date(cursor); dayEnd.setHours(WORK_END, 0, 0, 0);
    let minsLeft = (dayEnd - cursor) / 60_000;
    const BUFFER = 15;

    const queue = [
        ...buckets.overdue,
        ...buckets.fireNow,
        ...buckets.dueToday,
        ...buckets.dueWeek.slice(0, 2),
    ];

    for (const task of queue) {
        if (minsLeft < 30) break;
        const pending = (task.subtasks || []).filter((s) => !s.completed);
        let addedCnt = 0;

        for (const sub of pending) {
            if (addedCnt >= 2 || minsLeft < 20) break;
            const dur = Math.min(sub.estimatedMinutes || 60, minsLeft - BUFFER, 120);

            schedule.push({
                time: cursor.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                endTime: new Date(cursor.getTime() + dur * 60_000)
                    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                subtask: sub.title,
                task: task.title,
                duration: Math.round(dur),
                urgency: task.isPastDue ? 'overdue' : task.hoursLeft <= 12 ? 'critical'
                    : task.isDueToday ? 'urgent' : 'normal',
                hoursLeft: task.hoursLeft,
            });

            cursor = new Date(cursor.getTime() + (dur + BUFFER) * 60_000);
            minsLeft -= (dur + BUFFER);
            addedCnt++;
        }
    }

    return schedule;
}

// ── Stage 3: AI narrative ──────────────────────────────────────────────────────
const NARRATIVE_PROMPT = `You are a sharp, direct productivity coach.
You receive pre-analyzed task data and a focus schedule.
Write ONLY the narrative text fields — do not re-schedule or re-analyze.

RULES:
- Name actual tasks and subtasks. Never write generic advice.
- urgencyLevel: "calm" (all fine) | "watchful" (something due soon) | "urgent" (due today) | "critical" (<6h left or overdue)
- headline: single punchy sentence — what matters most right now
- insight: something specific FROM the data (progress rate, time patterns, risk trends)
- warning: null OR a specific risk alert (only if real)
- motivationalNote: honest and energising — not a cliche
- todayGoal: exactly what "winning today" looks like

Respond with ONLY valid JSON:
{
  "greeting": "Personalised good morning with name and day",
  "headline": "The single most important sentence about today",
  "urgencyLevel": "calm|watchful|urgent|critical",
  "insight": "Data-specific observation about this user's situation",
  "warning": "string | null",
  "motivationalNote": "One honest, specific sentence",
  "todayGoal": "Concrete definition of a good day today"
}`;

async function generateNarrative(clients, userName, buckets, schedule, enriched) {
    const now = new Date();

    const ctx = `USER: ${userName}
TIME: ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString()}

TRIAGE:
  🔥 Fire (< 12h): ${buckets.fireNow.map(t => `"${t.title}" ${t.hoursLeft}h left ${t.progress}% done`).join(' | ') || 'none'}
  ⚠️  Due today:   ${buckets.dueToday.map(t => `"${t.title}" ${t.hoursLeft}h ${t.progress}%`).join(' | ') || 'none'}
  📅 This week:    ${buckets.dueWeek.map(t => `"${t.title}" ${t.daysLeft}d ${t.progress}%`).join(' | ') || 'none'}
  ✅ On track:     ${buckets.onTrack.map(t => `"${t.title}"`).join(', ') || 'none'}
  🚨 Overdue:      ${buckets.overdue.map(t => `"${t.title}" ${Math.abs(t.hoursLeft).toFixed(0)}h overdue`).join(' | ') || 'none'}

TODAY'S FOCUS SCHEDULE:
${schedule.length > 0
            ? schedule.map((b, i) => `  ${i + 1}. ${b.time}–${b.endTime}: "${b.subtask}" (${b.task}) ${b.duration}m [${b.urgency}]`).join('\n')
            : '  Rest day — no urgent work required today'}

WORK REMAINING per task:
${enriched.map(t => `  "${t.title}": ${t.done}/${t.total} done, ${t.workMinLeft}min remaining, risk ${t.riskScore || 0}/100`).join('\n')}`;

    const res = await clients.pro.generateText(`${NARRATIVE_PROMPT}\n\n---\n${ctx}\n---`);
    return parseJSON(res);
}

// ── Utility ───────────────────────────────────────────────────────────────────
function slim(t) {
    return {
        title: t.title, category: t.category, hoursLeft: t.hoursLeft,
        daysLeft: t.daysLeft, progress: t.progress, riskScore: t.riskScore,
        nextSubtask: t.nextSub?.title || null, workMinLeft: t.workMinLeft,
    };
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

async function getClients(userId) {
    try {
        const doc = await db.collection('users').doc(userId)
            .collection('settings').doc('llm_key').get();
        if (doc.exists && doc.data()?.key)
            return createClients(doc.data().keyType, doc.data().key);
    } catch { }
    return defaultClients;
}

async function buildBriefing(userId, tasks) {
    const clients = await getClients(userId);
    if (!clients) return null;

    const userDoc = await db.collection('users').doc(userId).get();
    const userName = userDoc.data()?.name || userDoc.data()?.email?.split('@')[0] || 'there';

    const { buckets, enriched } = triageTasks(tasks);
    const schedule = buildSchedule(buckets);
    const narrative = await generateNarrative(clients, userName, buckets, schedule, enriched);

    return {
        ...narrative,
        focusSchedule: schedule,
        triage: {
            fireNow: buckets.fireNow.map(slim),
            dueToday: buckets.dueToday.map(slim),
            dueWeek: buckets.dueWeek.map(slim),
            onTrack: buckets.onTrack.map(slim),
            overdue: buckets.overdue.map(slim),
        },
        userId,
        userName,
        date: todayKey(),
        generatedAt: new Date().toISOString(),
        seen: false,
        dismissed: false,
        taskCount: tasks.length,
        llmProvider: clients.keyType,
    };
}

// ── Cron sweep ────────────────────────────────────────────────────────────────
export async function runBriefingAgent() {
    const date = todayKey();
    let done = 0, skip = 0;
    console.log(`\n[Briefing] 🌅 Sweep — ${new Date().toLocaleString()}`);

    const snap = await db.collection('tasks')
        .where('status', 'in', ['active', 'at_risk', 'overdue']).get();
    if (snap.empty) { console.log('[Briefing] No tasks'); return; }

    const byUser = {};
    snap.docs.forEach((d) => {
        const t = d.data();
        if (!t.userId) return;
        (byUser[t.userId] = byUser[t.userId] || []).push(t);
    });

    for (const [uid, tasks] of Object.entries(byUser)) {
        try {
            const ref = db.collection('users').doc(uid).collection('briefings').doc(date);
            if ((await ref.get()).exists) { skip++; continue; }
            const b = await buildBriefing(uid, tasks);
            if (!b) continue;
            await ref.set(b);
            console.log(`[Briefing] ✅ ${uid}: "${b.headline}"`);
            done++;
        } catch (e) { console.error(`[Briefing] ❌ ${uid}:`, e.message); }
    }
    console.log(`[Briefing] Done — ${done} generated, ${skip} skipped\n`);
}

// ── On-demand ─────────────────────────────────────────────────────────────────
export async function generateBriefingNow(userId) {
    const snap = await db.collection('tasks')
        .where('userId', '==', userId)
        .where('status', 'in', ['active', 'at_risk', 'overdue']).get();

    if (snap.empty) {
        return {
            greeting: 'Good morning!', headline: 'No active tasks — enjoy a clear day.',
            urgencyLevel: 'calm', focusSchedule: [],
            triage: { fireNow: [], dueToday: [], dueWeek: [], onTrack: [], overdue: [] },
            insight: 'Add tasks to get personalized briefings.',
            warning: null, motivationalNote: 'A clear plate is a fresh start.',
            todayGoal: 'Plan what you want to tackle next.',
            date: todayKey(), generatedAt: new Date().toISOString(),
            seen: false, dismissed: false, taskCount: 0,
        };
    }

    const tasks = snap.docs.map((d) => d.data());
    const b = await buildBriefing(userId, tasks);
    if (!b) throw new Error('No LLM client. Please add an API key.');

    await db.collection('users').doc(userId)
        .collection('briefings').doc(todayKey())
        .set(b, { merge: true });

    return b;
}