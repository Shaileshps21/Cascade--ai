/**
 * briefing_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Refactored from the legacy `briefingAgent.js` (monolithic, flat Firestore
 * task shape). This version reconstructs each task document as a
 * PlanningContext via `fromFirestoreDocument()` and reads the new nested
 * shape instead of the old flat `subtasks[]` / `scheduledSlots[]`:
 *
 *   OLD field                          NEW field
 *   ─────────────────────────────────  ──────────────────────────────────────
 *   task.title                         context.intent?.title ?? context.rawGoal
 *   task.deadline                      context.intent?.deadline ?? context.explicitDeadline
 *   task.subtasks[]                    context.planning?.tasks[]
 *   subtask.completed                  planningTask.progress?.status === 'completed'
 *   subtask.estimatedMinutes           planningTask.estimatedMinutes
 *   task.riskScore                     context.priority?.riskScore
 *   task.scheduledSlots[]              context.schedule?.scheduledTasks[]
 *   slot.startTime / slot.endTime      scheduledTask.startTime / .endTime (unchanged)
 *   (n/a)                              scheduledTask.energyLevel
 *
 * WHEN:  Cron sweep via `runBriefingCron()` (was `runBriefingAgent()`).
 *        Also on-demand via `generateBriefingNow(userId)` — unchanged signature
 *        so `server/routes/briefings.js` stays a drop-in replacement once its
 *        import path is updated to `../agents/briefing_agent/agent.js`.
 * WHERE: Firestore → users/{userId}/briefings/{YYYY-MM-DD}
 *
 * THREE STAGES (preserved from the original architecture):
 *   Stage 1 — Triage:    deterministic. Classify each user's active projects
 *                        (task documents) into urgency buckets from deadline
 *                        + progress data. No AI cost.
 *   Stage 2 — Schedule:  deterministic. Build today's focus schedule,
 *                        preferring the already-computed `context.schedule
 *                        .scheduledTasks[]` (written by scheduler_agent) and
 *                        falling back to simple working-hours slotting for
 *                        any project the scheduler hasn't run for yet. No AI
 *                        cost.
 *   Stage 3 — Narrative: the only stage that calls an LLM (`clients.pro`,
 *                        matching the original architecture). Writes ONLY
 *                        the narrative text fields — it never re-schedules
 *                        or re-analyzes the data it is given.
 *
 * Enhanced output schema v1.0.0 (per implementation_plan.md):
 *   {
 *     greeting, headline,
 *     urgencyLevel: 'low'|'medium'|'high'|'critical',
 *     todayFocusBlock: { time, task, duration } | null,
 *     riskAlerts: string[],
 *     insights: string[],
 *     motivationText,
 *   }
 * `urgencyLevel` and `todayFocusBlock` are computed deterministically in
 * Stages 1–2 (never left to the LLM) so the enum/shape is always valid.
 * Additional backward-compatible detail fields (`focusSchedule`, `triage`,
 * etc.) are appended alongside the required schema fields.
 */

import { db } from '../../config/firebase.js';
import { defaultClients, createClients, extractText, parseJSONWithRepair } from '../../config/Llm.js';
import { decryptSecret } from '../../config/secrets.js';
import { fromFirestoreDocument } from '../contextManager.js';

const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

// Working hours used ONLY as a fallback when a project has no computed
// schedule yet (context.schedule is null — scheduler_agent hasn't run for
// it). Modeled in UTC so results are deterministic regardless of server
// timezone (same rationale as deadline_feasibility_agent).
const WORK_START_UTC_HOUR = 9;
const WORK_END_UTC_HOUR = 19;
const BUFFER_MINUTES = 15;

// ─────────────────────────────────────────────────────────────────────────────
// PlanningContext field-access helpers
// ─────────────────────────────────────────────────────────────────────────────

function getProjectTitle(context) {
    return context?.intent?.title ?? (context?.rawGoal ? String(context.rawGoal).slice(0, 50) : 'Untitled task');
}

function getProjectDeadline(context) {
    return context?.intent?.deadline ?? context?.explicitDeadline ?? null;
}

function getPlanningTasks(context) {
    return Array.isArray(context?.planning?.tasks) ? context.planning.tasks : [];
}

function getScheduledTasks(context) {
    return Array.isArray(context?.schedule?.scheduledTasks) ? context.schedule.scheduledTasks : [];
}

function getRiskScore(context) {
    return typeof context?.priority?.riskScore === 'number' ? context.priority.riskScore : 0;
}

/**
 * A project (task document) counts as "active" for briefing purposes when it
 * has at least one planning task that isn't completed yet. Projects with no
 * planning tasks at all (still mid-pipeline, or genuinely empty) are skipped
 * — there is nothing concrete to brief on.
 * @param {object} context - PlanningContext
 * @returns {boolean}
 */
export function isProjectActive(context) {
    const tasks = getPlanningTasks(context);
    if (tasks.length === 0) return false;
    return tasks.some((t) => t?.progress?.status !== 'completed');
}

function isSameUTCDate(a, b) {
    return (
        a.getUTCFullYear() === b.getUTCFullYear() &&
        a.getUTCMonth() === b.getUTCMonth() &&
        a.getUTCDate() === b.getUTCDate()
    );
}

/** Format a Date as a deterministic 24h "HH:MM" string in UTC. */
function formatTimeUTC(date) {
    return date.toISOString().slice(11, 16);
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Triage (deterministic, no AI cost)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a list of PlanningContexts (one per active project/task document)
 * into urgency buckets based on deadline proximity and progress.
 * Pure function — no I/O.
 * @param {object[]} contexts - array of PlanningContext
 * @param {Date} [now]
 * @returns {{ buckets: object, enriched: object[] }}
 */
export function triageProjects(contexts, now = new Date()) {
    const endOfToday = new Date(now);
    endOfToday.setUTCHours(23, 59, 59, 999);
    const endOfWeek = new Date(now.getTime() + 7 * 24 * 3_600_000);

    const buckets = { fireNow: [], dueToday: [], dueWeek: [], onTrack: [], overdue: [] };

    const enriched = (contexts || []).map((context) => {
        const deadlineStr = getProjectDeadline(context);
        const deadline = deadlineStr ? new Date(deadlineStr) : null;
        const hasDeadline = !!deadline && !Number.isNaN(deadline.getTime());
        const hoursLeft = hasDeadline ? (deadline - now) / 3_600_000 : null;

        const tasks = getPlanningTasks(context);
        const done = tasks.filter((t) => t?.progress?.status === 'completed').length;
        const total = tasks.length;
        const progress = total > 0 ? Math.round((done / total) * 100) : 0;
        const pending = tasks.filter((t) => t?.progress?.status !== 'completed');
        const workMinLeft = pending.reduce((sum, t) => sum + (Number(t?.estimatedMinutes) || 60), 0);
        const nextTask = pending[0] ?? null;

        return {
            taskId: context?.taskId ?? null,
            title: getProjectTitle(context),
            deadline: deadlineStr,
            hoursLeft: hasDeadline ? Math.round(hoursLeft * 10) / 10 : null,
            daysLeft: hasDeadline ? Math.round((hoursLeft / 24) * 10) / 10 : null,
            progress,
            workMinLeft,
            done,
            total,
            nextTask: nextTask ? { taskId: nextTask.taskId, title: nextTask.title } : null,
            riskScore: getRiskScore(context),
            isPastDue: hasDeadline ? deadline < now : false,
            isDueToday: hasDeadline ? deadline <= endOfToday && deadline >= now : false,
            isDueWeek: hasDeadline ? deadline <= endOfWeek && deadline > endOfToday : false,
            context,
        };
    });

    enriched.forEach((p) => {
        if (p.isPastDue) buckets.overdue.push(p);
        else if (p.hoursLeft !== null && p.hoursLeft <= 12) buckets.fireNow.push(p);
        else if (p.isDueToday) buckets.dueToday.push(p);
        else if (p.isDueWeek) buckets.dueWeek.push(p);
        else buckets.onTrack.push(p);
    });

    Object.values(buckets).forEach((b) =>
        b.sort((a, c) => (a.hoursLeft ?? Infinity) - (c.hoursLeft ?? Infinity))
    );

    return { buckets, enriched };
}

/**
 * Classify overall urgency from triage buckets. Pure function.
 * @param {object} buckets - { overdue, fireNow, dueToday, dueWeek, onTrack }
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function classifyUrgencyLevel(buckets) {
    const overdue = buckets?.overdue ?? [];
    const fireNow = buckets?.fireNow ?? [];
    const dueToday = buckets?.dueToday ?? [];
    const dueWeek = buckets?.dueWeek ?? [];

    if (overdue.length > 0) return 'critical';
    if (fireNow.some((p) => (p.hoursLeft ?? Infinity) <= 6)) return 'critical';
    if (fireNow.length > 0 || dueToday.length > 0) return 'high';
    if (dueWeek.length > 0) return 'medium';
    return 'low';
}

function slimProject(p) {
    return {
        taskId: p.taskId,
        title: p.title,
        hoursLeft: p.hoursLeft,
        daysLeft: p.daysLeft,
        progress: p.progress,
        riskScore: p.riskScore,
        nextTask: p.nextTask?.title ?? null,
        workMinLeft: p.workMinLeft,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Schedule (deterministic, no AI cost)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic fallback slotting for projects that have no computed
 * `context.schedule` yet (scheduler_agent hasn't run). Mirrors the original
 * `buildSchedule()` logic from the legacy file, adapted to read
 * `planningTask.estimatedMinutes` / `.title` instead of the old flat
 * `subtask.estimatedMinutes` / `.title`.
 */
function buildFallbackSchedule(projects, now) {
    let cursor = new Date(now);
    const schedule = [];

    if (cursor.getUTCHours() < WORK_START_UTC_HOUR) cursor.setUTCHours(WORK_START_UTC_HOUR, 0, 0, 0);
    if (cursor.getUTCHours() >= WORK_END_UTC_HOUR) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        cursor.setUTCHours(WORK_START_UTC_HOUR, 0, 0, 0);
    }

    const dayEnd = new Date(cursor);
    dayEnd.setUTCHours(WORK_END_UTC_HOUR, 0, 0, 0);
    let minsLeft = (dayEnd - cursor) / 60_000;

    for (const project of projects) {
        if (minsLeft < 30) break;
        const pending = getPlanningTasks(project.context).filter((t) => t?.progress?.status !== 'completed');
        let addedCnt = 0;

        for (const t of pending) {
            if (addedCnt >= 2 || minsLeft < 20) break;
            const dur = Math.min(Number(t.estimatedMinutes) || 60, minsLeft - BUFFER_MINUTES, 120);
            const start = new Date(cursor);
            const end = new Date(cursor.getTime() + dur * 60_000);

            schedule.push({
                startISO: start.toISOString(),
                endISO: end.toISOString(),
                time: formatTimeUTC(start),
                endTime: formatTimeUTC(end),
                subtask: t.title ?? 'Untitled task',
                task: project.title,
                duration: Math.round(dur),
                urgency: project.isPastDue ? 'overdue' : (project.hoursLeft ?? Infinity) <= 12 ? 'critical' : project.isDueToday ? 'urgent' : 'normal',
                hoursLeft: project.hoursLeft,
                energyLevel: t.difficulty === 'high' || t.difficulty === 'very_high' ? 'high' : t.difficulty === 'low' ? 'low' : 'medium',
            });

            cursor = new Date(cursor.getTime() + (dur + BUFFER_MINUTES) * 60_000);
            minsLeft -= dur + BUFFER_MINUTES;
            addedCnt++;
        }
    }

    return schedule;
}

/**
 * Build today's focus schedule across a user's active projects.
 * Prefers each project's already-computed `context.schedule.scheduledTasks[]`
 * (populated by scheduler_agent); falls back to deterministic slotting for
 * any project without one yet. Pure function — no I/O.
 * @param {object} buckets - triage buckets from triageProjects()
 * @param {Date} [now]
 * @returns {object[]} schedule entries sorted by start time
 */
export function buildTodaysSchedule(buckets, now = new Date()) {
    const candidateProjects = [
        ...(buckets?.overdue ?? []),
        ...(buckets?.fireNow ?? []),
        ...(buckets?.dueToday ?? []),
        ...(buckets?.dueWeek ?? []),
    ];

    const schedule = [];
    const unscheduledProjects = [];

    for (const project of candidateProjects) {
        const scheduledTasks = getScheduledTasks(project.context);
        if (scheduledTasks.length === 0) {
            unscheduledProjects.push(project);
            continue;
        }

        const planningTasks = getPlanningTasks(project.context);

        for (const slot of scheduledTasks) {
            if (!slot || slot.isBuffer) continue;
            const start = new Date(slot.startTime);
            const end = new Date(slot.endTime);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
            if (!isSameUTCDate(start, now)) continue;

            const planTask = planningTasks.find((t) => t.taskId === slot.taskId);
            if (planTask?.progress?.status === 'completed') continue;

            schedule.push({
                startISO: start.toISOString(),
                endISO: end.toISOString(),
                time: formatTimeUTC(start),
                endTime: formatTimeUTC(end),
                subtask: slot.taskName ?? planTask?.title ?? 'Untitled task',
                task: project.title,
                duration: Math.round((end - start) / 60_000),
                urgency: project.isPastDue ? 'overdue' : (project.hoursLeft ?? Infinity) <= 12 ? 'critical' : project.isDueToday ? 'urgent' : 'normal',
                hoursLeft: project.hoursLeft,
                energyLevel: slot.energyLevel ?? null,
            });
        }
    }

    if (unscheduledProjects.length > 0) {
        schedule.push(...buildFallbackSchedule(unscheduledProjects, now));
    }

    schedule.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
    return schedule;
}

/**
 * Pick "today's focus block" from a list of schedule entries (as produced by
 * buildTodaysSchedule()), given the current time: prefers the block that is
 * currently active, otherwise the next upcoming block, otherwise null.
 * Pure function — no I/O.
 * @param {object[]} schedule - entries with { startISO, endISO, time, subtask, duration }
 * @param {Date} [now]
 * @returns {{ time: string, task: string, duration: number } | null}
 */
export function pickTodaysFocusBlock(schedule, now = new Date()) {
    if (!Array.isArray(schedule) || schedule.length === 0) return null;

    const parsed = schedule
        .map((s) => ({ ...s, _start: new Date(s.startISO), _end: new Date(s.endISO) }))
        .filter((s) => !Number.isNaN(s._start.getTime()) && !Number.isNaN(s._end.getTime()))
        .sort((a, b) => a._start - b._start);

    if (parsed.length === 0) return null;

    const active = parsed.find((s) => s._start <= now && now < s._end);
    const chosen = active ?? parsed.find((s) => s._start > now) ?? null;
    if (!chosen) return null;

    return { time: chosen.time, task: chosen.subtask, duration: chosen.duration };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Narrative (the only stage that calls an LLM)
// ─────────────────────────────────────────────────────────────────────────────

const NARRATIVE_PROMPT_HEADER = `You are a sharp, direct productivity coach.
You receive pre-analyzed task data and a focus schedule.
Write ONLY the narrative text fields — do not re-schedule or re-analyze.

RULES:
- Name actual projects and tasks. Never write generic advice.
- The deterministic urgency level is already computed — echo it exactly, do not invent a different one.
- riskAlerts: specific, concrete risks (e.g. named overdue projects, tasks with very little time left). Empty array if genuinely none.
- insights: 1-3 data-driven observations FROM the data below (progress rate, time patterns, risk trends). Never generic filler.
- motivationText: honest and energising, one to two sentences — not a cliché.
- headline: a single punchy sentence — what matters most right now.
- greeting: personalised good morning, referencing the user's name and the day.

Respond with ONLY valid JSON:
{
  "greeting": "string",
  "headline": "string",
  "urgencyLevel": "low|medium|high|critical",
  "riskAlerts": ["string"],
  "insights": ["string"],
  "motivationText": "string"
}`;

/**
 * Build the Stage 3 narrative prompt from the deterministic Stage 1/2 output.
 * Exported for testability/inspection — does not itself call an LLM.
 */
export function buildNarrativePrompt(userName, buckets, schedule, enriched, urgencyLevel, now = new Date()) {
    const fmt = (list) =>
        list.map((p) => `"${p.title}" ${p.hoursLeft != null ? `${p.hoursLeft}h left` : 'no deadline'} ${p.progress}% done`).join(' | ') || 'none';

    const scheduleBlock = schedule.length > 0
        ? schedule.map((b, i) => `  ${i + 1}. ${b.time}-${b.endTime}: "${b.subtask}" (${b.task}) ${b.duration}m [${b.urgency}]`).join('\n')
        : '  Rest day — no urgent work required today';

    const workRemaining = enriched.map((p) => `  "${p.title}": ${p.done}/${p.total} tasks done, ${p.workMinLeft}min remaining, risk ${p.riskScore}/100`).join('\n') || '  none';

    return `${NARRATIVE_PROMPT_HEADER}

---
USER: ${userName}
TIME (UTC): ${now.toISOString()}
DETERMINISTIC URGENCY LEVEL (use exactly this value): ${urgencyLevel}

TRIAGE:
  Overdue:      ${fmt(buckets.overdue)}
  Fire (<12h):  ${fmt(buckets.fireNow)}
  Due today:    ${fmt(buckets.dueToday)}
  This week:    ${fmt(buckets.dueWeek)}
  On track:     ${fmt(buckets.onTrack)}

TODAY'S FOCUS SCHEDULE:
${scheduleBlock}

WORK REMAINING per project:
${workRemaining}
---`;
}

/**
 * Deterministic, LLM-free narrative used both as a resilience fallback (LLM
 * call failed) and as a directly testable pure function.
 */
export function buildFallbackNarrative(userName, buckets, urgencyLevel) {
    const topRisk = buckets.overdue?.[0] ?? buckets.fireNow?.[0] ?? null;
    const riskAlerts = [
        ...(buckets.overdue ?? []).map((p) => `"${p.title}" is overdue.`),
        ...(buckets.fireNow ?? []).map((p) => `"${p.title}" has less than 12 hours left.`),
    ];
    const attentionCount = (buckets.overdue?.length ?? 0) + (buckets.fireNow?.length ?? 0) + (buckets.dueToday?.length ?? 0);

    return {
        greeting: `Good morning, ${userName}!`,
        headline: topRisk ? `"${topRisk.title}" needs your attention today.` : 'Steady day ahead — keep the momentum going.',
        urgencyLevel,
        riskAlerts,
        insights: [`You have ${attentionCount} project(s) needing attention today.`],
        motivationText: 'One focused block at a time gets it done.',
    };
}

async function generateNarrative(clients, userName, buckets, schedule, enriched, urgencyLevel, now) {
    const prompt = buildNarrativePrompt(userName, buckets, schedule, enriched, urgencyLevel, now);
    const result = await clients.pro.generateText(prompt, { promptVersion: PROMPT_VERSION });
    const text = extractText(result);
    return parseJSONWithRepair(text, clients.flash ?? clients.pro);
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM client resolution — per-user personal key, falling back to server default
// (preserved from the legacy briefingAgent.js, matching orchestrator's
// getUserClients() pattern: users/{userId}/settings/llm_key)
// ─────────────────────────────────────────────────────────────────────────────

async function getClients(userId) {
    try {
        const doc = await db.collection('users').doc(userId).collection('settings').doc('llm_key').get();
        if (doc.exists && doc.data()?.key && doc.data()?.keyType) {
            // Stored encrypted; decryptSecret passes pre-encryption keys through.
            return createClients(doc.data().keyType, decryptSecret(doc.data().key));
        }
    } catch (err) {
        console.warn(`[BriefingAgent] Could not load personal LLM key for ${userId}:`, err.message);
    }
    return defaultClients;
}

// ─────────────────────────────────────────────────────────────────────────────
// "Nothing due" briefing — no LLM call, per-task-instructions requirement
// ─────────────────────────────────────────────────────────────────────────────

function emptyBriefing(userId, userName) {
    return {
        greeting: `Good morning, ${userName}!`,
        headline: 'No active tasks — enjoy a clear day.',
        urgencyLevel: 'low',
        todayFocusBlock: null,
        riskAlerts: [],
        insights: ['Add tasks to get personalized briefings.'],
        motivationText: 'A clear plate is a fresh start — plan what you want to tackle next.',
        schemaVersion: SCHEMA_VERSION,
        focusSchedule: [],
        triage: { fireNow: [], dueToday: [], dueWeek: [], onTrack: [], overdue: [] },
        userId,
        userName,
        date: todayKey(),
        generatedAt: new Date().toISOString(),
        seen: false,
        dismissed: false,
        taskCount: 0,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full briefing assembly — runs all 3 stages for one user
// ─────────────────────────────────────────────────────────────────────────────

async function buildBriefing(userId, activeContexts, now = new Date()) {
    const clients = await getClients(userId);
    if (!clients) return null;

    const userDoc = await db.collection('users').doc(userId).get();
    const userName = userDoc.data()?.name || userDoc.data()?.email?.split('@')[0] || 'there';

    // ── Stage 1: Triage ────────────────────────────────────────────────────
    const { buckets, enriched } = triageProjects(activeContexts, now);
    const urgencyLevel = classifyUrgencyLevel(buckets);

    // ── Stage 2: Schedule ──────────────────────────────────────────────────
    const schedule = buildTodaysSchedule(buckets, now);
    const todayFocusBlock = pickTodaysFocusBlock(schedule, now);

    // ── Stage 3: Narrative ─────────────────────────────────────────────────
    let narrative;
    try {
        narrative = await generateNarrative(clients, userName, buckets, schedule, enriched, urgencyLevel, now);
    } catch (err) {
        console.warn(`[BriefingAgent] Narrative generation failed for ${userId}, using deterministic fallback:`, err.message);
        narrative = buildFallbackNarrative(userName, buckets, urgencyLevel);
    }

    return {
        greeting: narrative.greeting ?? `Good morning, ${userName}!`,
        headline: narrative.headline ?? '',
        // Deterministic — always overrides whatever the LLM echoed, guaranteeing a valid enum.
        urgencyLevel,
        todayFocusBlock,
        riskAlerts: Array.isArray(narrative.riskAlerts) ? narrative.riskAlerts : [],
        insights: Array.isArray(narrative.insights) && narrative.insights.length > 0
            ? narrative.insights
            : ['No specific insights available today.'],
        motivationText: narrative.motivationText ?? '',

        // ── Backward-compatible detail fields (non-schema, for client views) ──
        schemaVersion: SCHEMA_VERSION,
        focusSchedule: schedule.map(({ startISO, endISO, ...rest }) => rest),
        triage: {
            overdue: buckets.overdue.map(slimProject),
            fireNow: buckets.fireNow.map(slimProject),
            dueToday: buckets.dueToday.map(slimProject),
            dueWeek: buckets.dueWeek.map(slimProject),
            onTrack: buckets.onTrack.map(slimProject),
        },
        userId,
        userName,
        date: todayKey(),
        generatedAt: new Date().toISOString(),
        seen: false,
        dismissed: false,
        taskCount: activeContexts.length,
        llmProvider: clients.keyType,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore document loading
// ─────────────────────────────────────────────────────────────────────────────

function docToContext(doc) {
    const context = fromFirestoreDocument(doc.data());
    if (!context.taskId) context.taskId = doc.id;
    return context;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron sweep — was runBriefingAgent()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cron entry point (e.g. 3:30 AM UTC). Iterates every user with task
 * documents, generates a briefing for anyone with active projects who
 * doesn't already have one for today, and stores it to Firestore for the
 * client to poll — the same delivery mechanism as the legacy agent.
 * @returns {Promise<{ generated: number, skipped: number, errored: number }>}
 */
export async function runBriefingCron() {
    const date = todayKey();
    let done = 0, skip = 0, errored = 0;
    console.log(`\n[BriefingAgent] Sweep — ${new Date().toISOString()}`);

    const snap = await db.collection('tasks').get();
    if (snap.empty) {
        console.log('[BriefingAgent] No task documents found — nothing to brief');
        return { generated: 0, skipped: 0, errored: 0 };
    }

    const byUser = {};
    snap.docs.forEach((doc) => {
        let context;
        try {
            context = docToContext(doc);
        } catch (err) {
            console.warn(`[BriefingAgent] Skipping malformed task doc ${doc.id}:`, err.message);
            return;
        }
        if (!context?.userId) return;
        (byUser[context.userId] = byUser[context.userId] || []).push(context);
    });

    for (const [userId, contexts] of Object.entries(byUser)) {
        try {
            const ref = db.collection('users').doc(userId).collection('briefings').doc(date);
            if ((await ref.get()).exists) {
                skip++;
                continue;
            }

            const activeContexts = contexts.filter(isProjectActive);

            let briefing;
            if (activeContexts.length === 0) {
                const userDoc = await db.collection('users').doc(userId).get();
                const userName = userDoc.data()?.name || userDoc.data()?.email?.split('@')[0] || 'there';
                briefing = emptyBriefing(userId, userName);
            } else {
                briefing = await buildBriefing(userId, activeContexts);
                if (!briefing) {
                    console.warn(`[BriefingAgent] No LLM client available for ${userId} — skipping`);
                    continue;
                }
            }

            await ref.set(briefing);
            console.log(`[BriefingAgent] Generated for ${userId}: "${briefing.headline}"`);
            done++;
        } catch (err) {
            errored++;
            console.error(`[BriefingAgent] Failed for ${userId}:`, err.message);
        }
    }

    console.log(`[BriefingAgent] Done — ${done} generated, ${skip} skipped, ${errored} errored\n`);
    return { generated: done, skipped: skip, errored };
}

// ─────────────────────────────────────────────────────────────────────────────
// On-demand generation — unchanged signature from the legacy agent so
// server/routes/briefings.js keeps working with only an import-path change.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate (or regenerate) today's briefing for a single user on demand.
 * @param {string} userId
 * @returns {Promise<object>} the briefing document (also persisted to Firestore)
 */
export async function generateBriefingNow(userId) {
    const snap = await db.collection('tasks').where('userId', '==', userId).get();

    const contexts = [];
    snap.docs.forEach((doc) => {
        try {
            contexts.push(docToContext(doc));
        } catch (err) {
            console.warn(`[BriefingAgent] Skipping malformed task doc ${doc.id}:`, err.message);
        }
    });

    const userDoc = await db.collection('users').doc(userId).get();
    const userName = userDoc.data()?.name || userDoc.data()?.email?.split('@')[0] || 'there';

    const activeContexts = contexts.filter(isProjectActive);

    let briefing;
    if (activeContexts.length === 0) {
        briefing = emptyBriefing(userId, userName);
    } else {
        briefing = await buildBriefing(userId, activeContexts);
        if (!briefing) throw new Error('No LLM client available. Please add an API key.');
    }

    await db.collection('users').doc(userId).collection('briefings').doc(todayKey()).set(briefing, { merge: true });

    return briefing;
}
