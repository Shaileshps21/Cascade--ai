/**
 * scheduler_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * LLM-assisted scheduling agent (full redesign of the old, purely
 * deterministic schedulerAgent.js). The deterministic slot-management logic
 * (working hours, conflict avoidance, spreading tasks across days) from the
 * old scheduler is preserved here as small, pure, exported helper functions.
 * Google Calendar sync is NOT performed here — this agent is pure with
 * respect to calendar I/O. The orchestrator fetches busy times via
 * google_calendar_agent.getFreeBusy() and passes them in as `busySlots`.
 *
 * Reads:  context.planning (tasks[]), context.dependency (topologicalOrdering,
 *         criticalPath), context.estimation (estimations[].finalEstimateMinutes
 *         — supersedes the raw planning.estimatedMinutes), context.feasibility,
 *         context.memory, context.metadata.createdAt, context.intent.deadline /
 *         context.explicitDeadline.
 * Writes: context.schedule
 */

import './schema.js'; // registers schema
import { buildSchedulerPrompt } from './prompt_v1.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';
import {
    computeBufferPercent,
    validateNoDependencyViolations,
    validateBufferPercent,
} from './validator.js';

const AGENT_NAME = 'scheduler_agent';
const SSE_NAME = 'scheduler';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

// ── Constants (documented defaults — see plan Part A) ─────────────────────────
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 21;
export const FIRST_TASK_DELAY_MINUTES = 30;
export const DEFAULT_TASK_DURATION_MINUTES = 30;
export const SLOT_GAP_MINUTES = 10;
// Per-user availability: default 2 hours/day. Overridden by
// context.preferences.availableHoursPerDay (set from SchedulePreferences).
// Deliberately conservative — see comment history for reasoning.
export const DEFAULT_DAILY_AVAILABLE_HOURS = 2;
export const DEFAULT_DAILY_AVAILABLE_MINUTES = DEFAULT_DAILY_AVAILABLE_HOURS * 60;
// Rule: never schedule more than 70% of daily available time.
export const MAX_DAILY_UTILIZATION = 0.7;
export const LOW_SCHEDULING_SCORE_THRESHOLD = 70;

// ── Weekend scheduling modes ──────────────────────────────────────────────────
// 'skip'   → Skip weekends entirely; cursor jumps to Monday. (default)
// 'light'  → Allow weekends but cap at WEEKEND_LIGHT_BUDGET_FRACTION of daily budget.
// 'normal' → Weekends are treated identically to weekdays — full capacity.
// 'heavy'  → Weekends receive WEEKEND_HEAVY_BUDGET_FRACTION of daily budget (more tasks than weekdays).
export const WEEKEND_MODES = ['skip', 'light', 'normal', 'heavy'];
export const DEFAULT_WEEKEND_MODE = 'skip';
// Fraction of weekday capacity used on Sat/Sun in 'light' mode (50%).
export const WEEKEND_LIGHT_BUDGET_FRACTION = 0.5;
// Fraction of weekday capacity used on Sat/Sun in 'heavy' mode (150%).
// The scheduler places 50% MORE work on weekends so the user can use
// their free weekend days to make the most progress.
export const WEEKEND_HEAVY_BUDGET_FRACTION = 1.5;

// ── Day-person / night-person working-hour presets ────────────────────────
// 24 as an end hour is deliberate and safe: JS `Date#setHours(24, 0, 0, 0)`
// normalizes to midnight of the FOLLOWING day, which is exactly "end of
// today" — so a 'night' window of noon-to-midnight works with all the
// existing same-day slot math below with no wraparound handling needed.
export const WORK_STYLE_PRESETS = {
    day: { workStartHour: 7, workEndHour: 19 },
    flexible: { workStartHour: WORK_START_HOUR, workEndHour: WORK_END_HOUR },
    night: { workStartHour: 12, workEndHour: 24 },
};

/**
 * Resolve all scheduling preferences from context.preferences, with a
 * per-request override from context.intent when the user explicitly stated a
 * working-hours window in THIS request's raw text (e.g. "working hours 09:00
 * to 18:00 tomorrow") — extracted by intent_context_agent as
 * intent.workStartHour/workEndHour. That's a stronger, more specific signal
 * than a saved day/night profile preference, which was only ever a fallback
 * guess for requests that said nothing about hours:
 *  - workStartHour / workEndHour  (intent override > day/flexible/night style)
 *  - weekendMode                  ('skip' | 'light' | 'normal')
 *  - dailyAvailableMinutes        (from the stated window, or availableHoursPerDay, defaults to 2h)
 *
 * Falls back to safe defaults when no preference has been saved.
 * @param {object} context - PlanningContext
 * @returns {{ workStartHour: number, workEndHour: number, workStyle: string, weekendMode: string, dailyAvailableMinutes: number, explicitWindowStated: boolean }}
 */
export function resolveWorkingHours(context) {
    const prefs = context?.preferences ?? {};
    const intent = context?.intent ?? {};
    const preset = WORK_STYLE_PRESETS[prefs.workStyle] ?? WORK_STYLE_PRESETS.flexible;

    const intentStart = intent.workStartHour;
    const intentEnd = intent.workEndHour;
    const explicitWindowStated = typeof intentStart === 'number' && typeof intentEnd === 'number' && intentEnd > intentStart;

    const workStartHour = explicitWindowStated
        ? intentStart
        : (typeof prefs.workStartHour === 'number' ? prefs.workStartHour : preset.workStartHour);
    const workEndHour = explicitWindowStated
        ? intentEnd
        : (typeof prefs.workEndHour === 'number' ? prefs.workEndHour : preset.workEndHour);

    const weekendMode = WEEKEND_MODES.includes(prefs.weekendMode)
        ? prefs.weekendMode
        : DEFAULT_WEEKEND_MODE;

    // availableHoursPerDay set by user in SchedulePreferences (0.5–12h).
    // Clamped to [0.5, 12] in case of stale/bad data. Converts to minutes.
    const rawHours = prefs.availableHoursPerDay;
    const dailyAvailableMinutes = explicitWindowStated
        // The user told us their real capacity for this specific window —
        // use it in full. The conservative 2h/day default below exists only
        // to keep an AI-*inferred* multi-day project humane when we have no
        // idea how much time the user actually has; it would otherwise throw
        // away hours the user explicitly said they have (e.g. a stated
        // 9-hour working day would be capped at 2 hours of placement/day).
        ? (workEndHour - workStartHour) * 60
        : (typeof rawHours === 'number' && rawHours > 0
            ? Math.round(Math.min(12, Math.max(0.5, rawHours)) * 60)
            : DEFAULT_DAILY_AVAILABLE_MINUTES);

    return { workStartHour, workEndHour, workStyle: prefs.workStyle ?? 'flexible', weekendMode, dailyAvailableMinutes, explicitWindowStated };
}


// Re-export the buffer/dependency validators so callers of agent.js (and
// agent.test.js) can import everything from a single place if convenient.
export { computeBufferPercent, validateNoDependencyViolations, validateBufferPercent };

// ═════════════════════════════════════════════════════════════════════════
// Pure, deterministic helpers (unit-tested, no network/LLM/Firestore access)
// ═════════════════════════════════════════════════════════════════════════

/**
 * True if `date` falls within the configured working-hour window on its day.
 * @param {string|Date} date
 * @param {number} [workStartHour]
 * @param {number} [workEndHour]
 * @returns {boolean}
 */
export function isWithinWorkingHours(date, workStartHour = WORK_START_HOUR, workEndHour = WORK_END_HOUR) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return false;
    const hourFraction = d.getHours() + d.getMinutes() / 60;
    return hourFraction >= workStartHour && hourFraction < workEndHour;
}

/**
 * True if `date` falls on a Saturday (6) or Sunday (0).
 * @param {string|Date} date
 * @returns {boolean}
 */
export function isWeekend(date) {
    const d = new Date(date);
    const day = d.getDay();
    return day === 0 || day === 6; // Sunday=0, Saturday=6
}

/**
 * Push a date forward to the next working-hours window if it currently
 * falls outside one (before work-start → same day at work-start; at/after
 * work-end → next day at work-start). In 'skip' weekend mode, Saturday and
 * Sunday are advanced to the following Monday before the hour check.
 * @param {Date} date
 * @param {number} workStartHour
 * @param {number} workEndHour
 * @param {string} [weekendMode] - 'skip' | 'light' | 'normal'
 * @returns {Date}
 */
function clampToWorkingHours(date, workStartHour, workEndHour, weekendMode = DEFAULT_WEEKEND_MODE) {
    let cursor = new Date(date);

    // In skip mode advance any weekend day to the following Monday.
    if (weekendMode === 'skip') {
        while (isWeekend(cursor)) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(workStartHour, 0, 0, 0);
        }
    }

    const dayStart = new Date(cursor);
    dayStart.setHours(workStartHour, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(workEndHour, 0, 0, 0);

    if (cursor < dayStart) return new Date(dayStart);
    if (cursor >= dayEnd) {
        // Roll to next day, then re-check for weekends in skip mode.
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(workStartHour, 0, 0, 0);
        return clampToWorkingHours(cursor, workStartHour, workEndHour, weekendMode);
    }
    return new Date(cursor);
}

/**
 * Find the next free slot of `durationMinutes` starting at/after `fromDate`,
 * respecting working hours, weekend mode, and avoiding `busySlots` (Google
 * Calendar free/busy blocks [{start, end}] as ISO strings or Dates).
 *
 * @param {string|Date} fromDate
 * @param {number} durationMinutes
 * @param {Array<{start:string|Date, end:string|Date}>} [busySlots]
 * @param {number} [workStartHour]
 * @param {number} [workEndHour]
 * @param {string} [weekendMode] - 'skip' | 'light' | 'normal'
 * @returns {{ start: Date, end: Date }}
 */
export function findNextFreeSlot(fromDate, durationMinutes, busySlots = [], workStartHour = WORK_START_HOUR, workEndHour = WORK_END_HOUR, weekendMode = DEFAULT_WEEKEND_MODE) {
    const sortedBusy = (busySlots ?? [])
        .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
        .filter(b => !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()))
        .sort((a, b) => a.start - b.start);

    let cursor = clampToWorkingHours(new Date(fromDate), workStartHour, workEndHour, weekendMode);
    const maxIterations = 2000; // safety guard against pathological input

    for (let i = 0; i < maxIterations; i++) {
        const dayEnd = new Date(cursor);
        dayEnd.setHours(workEndHour, 0, 0, 0);
        const candidateEnd = new Date(cursor.getTime() + durationMinutes * 60_000);

        if (candidateEnd > dayEnd) {
            // Doesn't fit before end of working day — try next valid day.
            // clampToWorkingHours handles both after-hours clamping AND weekend skip.
            const next = new Date(cursor);
            next.setDate(next.getDate() + 1);
            next.setHours(workStartHour, 0, 0, 0);
            cursor = clampToWorkingHours(next, workStartHour, workEndHour, weekendMode);
            continue;
        }

        const conflict = sortedBusy.find(b => cursor < b.end && candidateEnd > b.start);
        if (conflict) {
            cursor = clampToWorkingHours(
                new Date(Math.max(conflict.end.getTime(), cursor.getTime() + 60_000)),
                workStartHour,
                workEndHour,
                weekendMode,
            );
            continue;
        }

        return { start: new Date(cursor), end: candidateEnd };
    }

    // Fallback — should be unreachable in practice.
    return { start: new Date(cursor), end: new Date(cursor.getTime() + durationMinutes * 60_000) };
}

/**
 * Total effort minutes across all planning tasks, preferring
 * `context.estimation.estimations[].finalEstimateMinutes` (already computed
 * by time_estimation_agent's multi-factor adjustment chain) over the raw
 * `planning.tasks[].estimatedMinutes`.
 * @param {object} context
 * @returns {number}
 */
export function computeTotalEffortMinutes(context) {
    const tasks = context?.planning?.tasks ?? [];
    const estimationMap = new Map((context?.estimation?.estimations ?? []).map(e => [e.taskId, e]));
    return tasks.reduce((sum, t) => {
        const finalEstimate = estimationMap.get(t.taskId)?.finalEstimateMinutes;
        const minutes = typeof finalEstimate === 'number' ? finalEstimate
            : (typeof t.estimatedMinutes === 'number' ? t.estimatedMinutes : DEFAULT_TASK_DURATION_MINUTES);
        return sum + minutes;
    }, 0);
}

/**
 * Project duration in days between context.metadata.createdAt and the
 * resolved deadline (context.intent.deadline ?? context.explicitDeadline).
 * @param {object} context
 * @returns {number|null} null when no deadline is known
 */
export function computeProjectDurationDays(context) {
    const deadline = context?.intent?.deadline ?? context?.explicitDeadline;
    if (!deadline) return null;
    const createdAt = new Date(context?.metadata?.createdAt ?? Date.now());
    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) return null;
    return Math.max(0, (deadlineDate.getTime() - createdAt.getTime()) / (24 * 3_600_000));
}

/**
 * Effective schedulable capacity (minutes) between two dates, at
 * MAX_DAILY_UTILIZATION of dailyAvailableMinutes/day.
 * @param {string|Date} fromDate
 * @param {string|Date} toDate
 * @param {number} [dailyAvailableMinutes]
 * @returns {number}
 */
export function computeAvailableMinutes(fromDate, toDate, dailyAvailableMinutes = DEFAULT_DAILY_AVAILABLE_MINUTES) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return 0;
    const days = (to.getTime() - from.getTime()) / (24 * 3_600_000);
    return days * dailyAvailableMinutes * MAX_DAILY_UTILIZATION;
}

/**
 * Deterministic feasibility pre-check, run BEFORE calling the LLM so that a
 * grossly impossible deadline never even reaches the model — per the spec,
 * an unrealistic schedule must never be produced.
 * @param {object} context
 * @param {number} [dailyAvailableMinutes] - resolved from user preferences; defaults to constant
 * @returns {{
 *   isFeasible: boolean, totalEffortMinutes: number, availableMinutes: number|null,
 *   requiredAdditionalMinutes: number, createdAt: Date, deadlineDate: Date|null
 * }}
 */
export function checkDeadlineFeasibility(context, dailyAvailableMinutes = DEFAULT_DAILY_AVAILABLE_MINUTES) {
    const createdAt = new Date(context?.metadata?.createdAt ?? Date.now());
    const deadline = context?.intent?.deadline ?? context?.explicitDeadline;
    const totalEffortMinutes = computeTotalEffortMinutes(context);

    if (!deadline) {
        return { isFeasible: true, totalEffortMinutes, availableMinutes: null, requiredAdditionalMinutes: 0, createdAt, deadlineDate: null };
    }

    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) {
        return { isFeasible: true, totalEffortMinutes, availableMinutes: null, requiredAdditionalMinutes: 0, createdAt, deadlineDate: null };
    }

    const availableMinutes = computeAvailableMinutes(createdAt, deadlineDate, dailyAvailableMinutes);
    const isFeasible = totalEffortMinutes <= availableMinutes;
    const requiredAdditionalMinutes = Math.max(0, totalEffortMinutes - availableMinutes);

    return { isFeasible, totalEffortMinutes, availableMinutes, requiredAdditionalMinutes, createdAt, deadlineDate };
}

/**
 * Build the `failureConditions` object for an infeasible schedule.
 * @param {ReturnType<typeof checkDeadlineFeasibility>} feasibilityCheck
 * @param {object} context
 * @returns {object} failureConditions matching schema.js
 */
export function buildFailureConditions(feasibilityCheck, context) {
    const { totalEffortMinutes, availableMinutes, requiredAdditionalMinutes, deadlineDate, createdAt } = feasibilityCheck;
    const requiredAdditionalHours = Math.round((requiredAdditionalMinutes / 60) * 10) / 10;

    const effectiveDailyMinutes = DEFAULT_DAILY_AVAILABLE_MINUTES * MAX_DAILY_UTILIZATION;
    const extraDays = effectiveDailyMinutes > 0 ? Math.ceil(requiredAdditionalMinutes / effectiveDailyMinutes) : 1;
    const baseDate = deadlineDate ?? new Date();
    const suggestedDeadline = new Date(baseDate.getTime() + extraDays * 24 * 3_600_000).toISOString();

    const estimationMap = new Map((context?.estimation?.estimations ?? []).map(e => [e.taskId, e]));
    const priorityRank = { low: 0, medium: 1, high: 2, critical: 3 };
    const deferrable = (context?.planning?.tasks ?? [])
        .filter(t => !t.isBuffer && !t.isReview)
        .slice()
        .sort((a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1));

    const tasksToDefer = [];
    let deferredMinutes = 0;
    for (const t of deferrable) {
        if (deferredMinutes >= requiredAdditionalMinutes) break;
        tasksToDefer.push(t.taskId);
        const minutes = estimationMap.get(t.taskId)?.finalEstimateMinutes ?? t.estimatedMinutes ?? DEFAULT_TASK_DURATION_MINUTES;
        deferredMinutes += minutes;
    }

    const completionProbability = availableMinutes && totalEffortMinutes > 0
        ? Math.round(Math.max(0.05, Math.min(0.95, availableMinutes / totalEffortMinutes)) * 100) / 100
        : 0.05;

    const totalHours = Math.round((totalEffortMinutes / 60) * 10) / 10;
    const availableHours = availableMinutes !== null ? Math.round((availableMinutes / 60) * 10) / 10 : null;

    return {
        requiredAdditionalHours,
        suggestedDeadline,
        tasksToDefer,
        completionProbability,
        reasoning: `Total estimated effort (${totalHours}h) exceeds the available working time before the deadline` +
            (availableHours !== null ? ` (${availableHours}h at ${Math.round(MAX_DAILY_UTILIZATION * 100)}% daily utilization)` : '') +
            ` by ${requiredAdditionalHours}h, measured from project creation at ${createdAt.toISOString()}. ` +
            `Deferring ${tasksToDefer.length} lower-priority task(s) or extending the deadline to ${suggestedDeadline} is recommended.`,
    };
}

/**
 * Sequentially place `orderedTaskIds`, each finding the next free slot after
 * the previous task's end + a small gap, avoiding busySlots and
 * outside-working-hours placement. The first task is anchored to
 * FIRST_TASK_DELAY_MINUTES after project creation (Rule 1).
 *
 * Spreads work across days rather than packing every task back-to-back
 * within the 9am–9pm working-hours window: once a day's `dailyBudgetMinutes`
 * is used up, the cursor rolls forward to the next day's work-start hour
 * before placing the next task. This is what actually makes a 7-day project
 * use all 7 days instead of finishing in the first one or two.
 *
 * Extracted out of buildScheduleSkeleton() so it can be run twice: once in
 * dependency/topological order, and — for Priority-Weighted Within-Day
 * Ordering (suggestions.md #21) — a second time over that same task set with
 * only the within-day order changed. Running the identical placement logic
 * both times (rather than patching times after the fact) means real
 * durations, busy-slot conflicts and day budgets stay correct in both passes.
 *
 * @param {string[]} orderedTaskIds
 * @param {Map<string,object>} taskById
 * @param {Map<string,object>} estimationMap
 * @param {Date} createdAt
 * @param {Array<{start:string|Date, end:string|Date}>} busySlots
 * @param {number} dailyBudgetMinutes
 * @param {number} workStartHour
 * @param {number} workEndHour
 * @param {string} weekendMode
 * @param {number|null} [maxContinuousFocusMinutes] - if set, a break is inserted
 *   once this much continuous work has accumulated since the last break/day-start.
 *   Absent/null preserves prior behavior exactly (no breaks inserted).
 * @param {number} [breakMinutes] - break duration when maxContinuousFocusMinutes triggers.
 * @returns {Array<object>} skeleton entries (see shape below)
 */
function placeTasksInOrder(orderedTaskIds, taskById, estimationMap, createdAt, busySlots, dailyBudgetMinutes, workStartHour, workEndHour, weekendMode, maxContinuousFocusMinutes = null, breakMinutes = 15) {
    let cursor = new Date(createdAt.getTime() + FIRST_TASK_DELAY_MINUTES * 60_000);
    let dayKey = cursor.toDateString();
    let minutesScheduledToday = 0;
    // Only tracked/used when maxContinuousFocusMinutes is set — otherwise this
    // whole mechanism is inert and placement behaves exactly as before.
    let continuousMinutesSinceBreak = 0;

    const skeleton = [];
    for (const taskId of orderedTaskIds) {
        const task = taskById.get(taskId);
        if (!task) continue;

        const est = estimationMap.get(taskId);
        const adjustedDuration = typeof est?.finalEstimateMinutes === 'number'
            ? est.finalEstimateMinutes
            : (typeof task.estimatedMinutes === 'number' ? task.estimatedMinutes : DEFAULT_TASK_DURATION_MINUTES);
        const estimatedDuration = typeof task.estimatedMinutes === 'number' ? task.estimatedMinutes : adjustedDuration;

        // Effective daily budget per weekend mode:
        //   skip   → clampToWorkingHours already prevents landing on weekends; budget unchanged.
        //   light  → 50% of weekday budget on Sat/Sun.
        //   normal → same as weekday (unchanged).
        //   heavy  → 150% of weekday budget on Sat/Sun (more tasks than a typical weekday).
        const effectiveBudget = isWeekend(cursor)
            ? (weekendMode === 'light'  ? Math.round(dailyBudgetMinutes * WEEKEND_LIGHT_BUDGET_FRACTION)
            :  weekendMode === 'heavy'  ? Math.round(dailyBudgetMinutes * WEEKEND_HEAVY_BUDGET_FRACTION)
            :                            dailyBudgetMinutes)   // 'normal' or 'skip' (skip never lands here)
            : dailyBudgetMinutes;

        // Today's budget is spent (or this task alone would blow past it) —
        // roll forward to the next valid work-start before looking for a slot.
        if (minutesScheduledToday > 0 && minutesScheduledToday + adjustedDuration > effectiveBudget) {
            const next = new Date(cursor);
            next.setDate(next.getDate() + 1);
            next.setHours(workStartHour, 0, 0, 0);
            cursor = clampToWorkingHours(next, workStartHour, workEndHour, weekendMode);
            continuousMinutesSinceBreak = 0; // a new day is itself a break
        }

        // Max-continuous-focus rule (only active when the user stated one):
        // placing this task would exceed the continuous-work ceiling, so
        // insert an explicit break slot first and reset the counter.
        if (maxContinuousFocusMinutes && continuousMinutesSinceBreak > 0
            && continuousMinutesSinceBreak + adjustedDuration > maxContinuousFocusMinutes) {
            const breakSlot = findNextFreeSlot(cursor, breakMinutes, busySlots, workStartHour, workEndHour, weekendMode);
            skeleton.push({
                taskId: `break-${skeleton.length}`,
                taskName: 'Break',
                startTime: breakSlot.start.toISOString(),
                endTime: breakSlot.end.toISOString(),
                estimatedDuration: breakMinutes,
                adjustedDuration: breakMinutes,
                adjustmentReason: `Inserted after ${continuousMinutesSinceBreak}m of continuous work (limit: ${maxContinuousFocusMinutes}m).`,
                priority: 'low',
                difficulty: 'low',
                dependencies: [],
                isBuffer: true,
                isReview: false,
                confidence: 1,
            });
            cursor = new Date(breakSlot.end.getTime() + SLOT_GAP_MINUTES * 60_000);
            continuousMinutesSinceBreak = 0;
        }

        const slot = findNextFreeSlot(cursor, adjustedDuration, busySlots, workStartHour, workEndHour, weekendMode);

        const slotDayKey = slot.start.toDateString();
        if (slotDayKey !== dayKey) {
            dayKey = slotDayKey;
            minutesScheduledToday = 0;
            continuousMinutesSinceBreak = 0;
        }
        minutesScheduledToday += adjustedDuration;
        continuousMinutesSinceBreak += adjustedDuration;

        skeleton.push({
            taskId,
            taskName: task.title ?? taskId,
            startTime: slot.start.toISOString(),
            endTime: slot.end.toISOString(),
            estimatedDuration,
            adjustedDuration,
            adjustmentReason: est?.adjustmentReason ?? (est ? 'Adjusted per time_estimation_agent multi-factor chain' : ''),
            priority: task.priority ?? 'medium',
            difficulty: task.difficulty ?? 'medium',
            dependencies: task.dependencies ?? [],
            isBuffer: !!task.isBuffer,
            isReview: !!task.isReview,
            confidence: est?.confidence ?? 0.7,
        });

        cursor = new Date(slot.end.getTime() + SLOT_GAP_MINUTES * 60_000);
    }

    return skeleton;
}

// ── Priority-Weighted Within-Day Ordering (suggestions.md #21) ────────────────
// The placement pass above places tasks in dependency/topological order
// across days; within a single day they land in whatever order the topo-sort
// produced, ignoring priority. The scheduler prompt already asks the LLM for
// priority-aware, energy-aware ordering (Rule 5 / "Energy-aware scheduling"),
// but a prompted preference isn't a guarantee. This is a deterministic,
// zero-LLM-call pass applied to the skeleton before it's ever shown to the
// LLM, so the LLM is nudged to preserve an already-correct order rather than
// invent one.
const PRIORITY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };
const DIFFICULTY_RANK = { very_high: 3, high: 2, medium: 1, low: 0 };

/**
 * Comparator for same-day skeleton entries: critical > high > medium > low
 * priority first, then harder-difficulty tasks earlier (mirrors the
 * scheduler prompt's own difficulty → energyLevel convention, since skeleton
 * entries don't carry an energyLevel of their own yet — that's assigned
 * later, by the LLM or the fallback conversion). Buffer/review slots are
 * structural padding/verification, not user-prioritized work, so they always
 * sink to the end of the day regardless of their nominal priority field.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareForDayOrder(a, b) {
    const aStructural = a.isBuffer || a.isReview;
    const bStructural = b.isBuffer || b.isReview;
    if (aStructural !== bStructural) return aStructural ? 1 : -1;

    const priorityDiff = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
    if (priorityDiff !== 0) return priorityDiff;

    return (DIFFICULTY_RANK[b.difficulty] ?? 1) - (DIFFICULTY_RANK[a.difficulty] ?? 1);
}

/**
 * Given an already-placed skeleton, group entries by the calendar day their
 * slot starts on and return a new taskId order with each day's tasks sorted
 * by `compareForDayOrder` (day-to-day order, and each day's total task
 * membership, is unchanged — only the order WITHIN a day changes).
 * `Array.prototype.sort` is stable, so ties preserve the original
 * dependency-safe order.
 * @param {Array<object>} skeleton
 * @returns {string[]} taskIds in the new order
 */
function reorderTaskIdsByPriorityWithinDay(skeleton) {
    const dayOrder = [];
    const byDay = new Map();
    for (const entry of skeleton) {
        const key = new Date(entry.startTime).toDateString();
        if (!byDay.has(key)) { byDay.set(key, []); dayOrder.push(key); }
        byDay.get(key).push(entry);
    }

    const result = [];
    for (const key of dayOrder) {
        const dayEntries = byDay.get(key).slice().sort(compareForDayOrder);
        result.push(...dayEntries.map((e) => e.taskId));
    }
    return result;
}

/**
 * Build the deterministic candidate skeleton (see placeTasksInOrder for the
 * placement rules), then apply Priority-Weighted Within-Day Ordering: derive
 * which day each task landed on from that first pass, sort each day's tasks
 * by priority/difficulty, and re-run the identical placement pass over the
 * reordered sequence so real durations/busy-slot conflicts/day budgets are
 * respected exactly as before — only WHICH task lands in which position
 * within a day changes, never the total time used per day.
 *
 * @param {object} context
 * @param {Array<{start:string|Date, end:string|Date}>} [busySlots]
 * @param {number} [dailyBudgetMinutes] - max minutes of work placed per calendar day (weekdays)
 * @param {number} [workStartHour] - start of the user's working-hours window (day/night preference)
 * @param {number} [workEndHour] - end of the user's working-hours window (day/night preference)
 * @param {string} [weekendMode] - 'skip' | 'light' | 'normal'
 * @returns {Array<object>} skeleton entries
 */
export function buildScheduleSkeleton(context, busySlots = [], dailyBudgetMinutes = DEFAULT_DAILY_AVAILABLE_MINUTES, workStartHour = WORK_START_HOUR, workEndHour = WORK_END_HOUR, weekendMode = DEFAULT_WEEKEND_MODE) {
    const planningTasks = context?.planning?.tasks ?? [];
    if (planningTasks.length === 0) return [];

    const estimationMap = new Map((context?.estimation?.estimations ?? []).map(e => [e.taskId, e]));
    const taskById = new Map(planningTasks.map(t => [t.taskId, t]));

    const topoOrder = context?.dependency?.topologicalOrdering;
    const orderedTaskIds = Array.isArray(topoOrder) && topoOrder.length > 0
        ? [
            ...topoOrder.filter(id => taskById.has(id)),
            ...planningTasks.map(t => t.taskId).filter(id => !topoOrder.includes(id)),
        ]
        : planningTasks.map(t => t.taskId);

    const createdAt = new Date(context?.metadata?.createdAt ?? Date.now());

    // Only present when the user explicitly stated a focus/break rule in
    // their raw goal text (intent_context_agent); absent for every other
    // request, which preserves prior placement behavior exactly.
    const maxContinuousFocusMinutes = typeof context?.intent?.maxContinuousFocusMinutes === 'number'
        && context.intent.maxContinuousFocusMinutes > 0
        ? context.intent.maxContinuousFocusMinutes
        : null;
    const breakMinutes = typeof context?.intent?.breakMinutes === 'number' && context.intent.breakMinutes > 0
        ? context.intent.breakMinutes
        : 15;

    const firstPass = placeTasksInOrder(orderedTaskIds, taskById, estimationMap, createdAt, busySlots, dailyBudgetMinutes, workStartHour, workEndHour, weekendMode, maxContinuousFocusMinutes, breakMinutes);

    const priorityOrderedIds = reorderTaskIdsByPriorityWithinDay(firstPass);
    const unchanged = priorityOrderedIds.length === orderedTaskIds.length
        && priorityOrderedIds.every((id, i) => id === orderedTaskIds[i]);
    if (unchanged) return firstPass;

    const secondPass = placeTasksInOrder(priorityOrderedIds, taskById, estimationMap, createdAt, busySlots, dailyBudgetMinutes, workStartHour, workEndHour, weekendMode, maxContinuousFocusMinutes, breakMinutes);

    // Safety net: reordering by priority can, in rare cases (e.g. a busy-slot
    // gap only one of two candidate tasks fits into), push a task across a
    // dependency edge the original topological order respected.
    // fixDependencyViolations() deterministically repairs any such case.
    const { scheduledTasks: fixed } = fixDependencyViolations(secondPass, 3, busySlots, workStartHour, workEndHour, weekendMode);
    return fixed;
}

/**
 * Ensure the earliest non-buffer scheduled task starts no earlier than
 * FIRST_TASK_DELAY_MINUTES after `createdAt` (Rule 1). Mutates and returns
 * the array; shifts only the single earliest task (a cheap, local nudge —
 * matching the "fix small violations automatically" post-processing rule).
 * @param {Array<{taskId:string, startTime:string, endTime:string, isBuffer?:boolean}>} scheduledTasks
 * @param {string|Date} createdAt
 * @returns {Array<object>}
 */
export function enforceFirstTaskDelay(scheduledTasks, createdAt) {
    const nonBuffer = (scheduledTasks ?? []).filter(t => !t.isBuffer);
    if (nonBuffer.length === 0) return scheduledTasks;

    const earliest = nonBuffer.reduce((a, b) => (new Date(a.startTime) < new Date(b.startTime) ? a : b));
    const minStart = new Date(new Date(createdAt).getTime() + FIRST_TASK_DELAY_MINUTES * 60_000);

    if (new Date(earliest.startTime).getTime() < minStart.getTime()) {
        const duration = new Date(earliest.endTime).getTime() - new Date(earliest.startTime).getTime();
        earliest.startTime = minStart.toISOString();
        earliest.endTime = new Date(minStart.getTime() + duration).toISOString();
    }

    return scheduledTasks;
}

/**
 * Cheap, local repair for dependency ordering violations: if a task starts
 * before one of its dependencies ends, re-anchor it to the next free slot
 * at/after the dependency's end (preserving duration) via findNextFreeSlot —
 * NOT blind pointer arithmetic — so the repaired placement still respects
 * working hours, weekend mode, and busy slots instead of potentially
 * spilling past the working day's cutoff (e.g. a dependency ending at 17:05
 * must not push a 2-hour task to end at 19:15 when work ends at 18:00).
 * Runs a few passes to propagate chained fixes. Larger/irreconcilable
 * violations are left in place for the caller to flag via a lowered
 * schedulingScore + warning.
 * @param {Array<{taskId:string, startTime:string, endTime:string, dependencies?:string[]}>} scheduledTasks
 * @param {number} [maxPasses]
 * @param {Array<{start:string|Date, end:string|Date}>} [busySlots]
 * @param {number} [workStartHour]
 * @param {number} [workEndHour]
 * @param {string} [weekendMode]
 * @returns {{ scheduledTasks: Array<object>, fixedCount: number }}
 */
export function fixDependencyViolations(scheduledTasks, maxPasses = 3, busySlots = [], workStartHour = WORK_START_HOUR, workEndHour = WORK_END_HOUR, weekendMode = DEFAULT_WEEKEND_MODE) {
    const byId = new Map((scheduledTasks ?? []).map(t => [t.taskId, t]));
    let fixedCount = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
        let changed = false;
        for (const task of scheduledTasks ?? []) {
            for (const depId of task.dependencies ?? []) {
                const dep = byId.get(depId);
                if (!dep) continue;

                const depEnd = new Date(dep.endTime).getTime();
                const taskStart = new Date(task.startTime).getTime();
                if (Number.isNaN(depEnd) || Number.isNaN(taskStart)) continue;

                if (depEnd > taskStart) {
                    const durationMinutes = Math.max(1, Math.round((new Date(task.endTime).getTime() - taskStart) / 60_000));
                    const earliestStart = new Date(depEnd + SLOT_GAP_MINUTES * 60_000);
                    const slot = findNextFreeSlot(earliestStart, durationMinutes, busySlots, workStartHour, workEndHour, weekendMode);
                    task.startTime = slot.start.toISOString();
                    task.endTime = slot.end.toISOString();
                    changed = true;
                    fixedCount++;
                }
            }
        }
        if (!changed) break;
    }

    return { scheduledTasks, fixedCount };
}

/**
 * Non-mutating check for working-hours compliance across non-buffer tasks.
 * @param {Array<{taskId:string, startTime:string, endTime:string, isBuffer?:boolean}>} scheduledTasks
 * @param {number} [workStartHour]
 * @param {number} [workEndHour]
 * @returns {string[]} taskIds that violate working-hours constraints
 */
export function checkWorkingHoursCompliance(scheduledTasks, workStartHour = WORK_START_HOUR, workEndHour = WORK_END_HOUR) {
    const violations = [];
    for (const t of scheduledTasks ?? []) {
        if (t.isBuffer) continue;
        const start = new Date(t.startTime);
        const end = new Date(t.endTime);
        const startOk = isWithinWorkingHours(start, workStartHour, workEndHour);
        const endHourFraction = end.getHours() + end.getMinutes() / 60;
        const endOk = endHourFraction <= workEndHour;
        if (!startOk || !endOk) violations.push(t.taskId);
    }
    return violations;
}

/**
 * Convert deterministic skeleton entries into full `scheduledTasks` shape by
 * deriving the two fields only the LLM path would otherwise add:
 * `energyLevel` and `isDeepWork`, both inferred from `difficulty` using the
 * same convention documented in the scheduler prompt's "Energy-aware
 * scheduling" rule. Shared by every place that hands back a schedule without
 * LLM refinement (deadline-infeasible fallback, unparsable-LLM fallback, and
 * the deterministic-only fast path for requests with an explicit,
 * fully-specified working window).
 * @param {Array<object>} skeleton
 * @returns {Array<object>}
 */
function skeletonToScheduledTasks(skeleton) {
    return skeleton.map(s => ({
        ...s,
        energyLevel: s.difficulty === 'high' || s.difficulty === 'very_high' ? 'high' : (s.difficulty === 'low' ? 'low' : 'medium'),
        isDeepWork: s.difficulty === 'high' || s.difficulty === 'very_high',
    }));
}

/**
 * Build a compact { taskId -> metadata } map fed to the LLM prompt.
 * @param {object} context
 * @returns {Record<string, object>}
 */
function buildTaskMeta(context) {
    const meta = {};
    for (const t of context?.planning?.tasks ?? []) {
        meta[t.taskId] = {
            title: t.title,
            difficulty: t.difficulty ?? 'medium',
            priority: t.priority ?? 'medium',
            dependencies: t.dependencies ?? [],
            isBuffer: !!t.isBuffer,
            isReview: !!t.isReview,
        };
    }
    return meta;
}

/**
 * Merge the user's explicitly-stated fixed/non-negotiable time commitments
 * (context.intent.fixedEvents — extracted by intent_context_agent from raw
 * goal text, e.g. "11:30-12:30 client call") into the busySlots array so the
 * existing, already-tested slot-carving logic (findNextFreeSlot,
 * buildScheduleSkeleton) treats them exactly like a Google Calendar busy
 * block — no separate carve-out code path needed. Malformed/unparsable
 * entries are silently dropped rather than corrupting the schedule.
 * @param {object|null} intent - context.intent
 * @param {Array<{start:string|Date, end:string|Date}>} busySlots
 * @returns {Array<{start:string|Date, end:string|Date}>}
 */
export function mergeFixedEventsIntoBusySlots(intent, busySlots = []) {
    const fixedEvents = Array.isArray(intent?.fixedEvents) ? intent.fixedEvents : [];
    if (fixedEvents.length === 0) return busySlots;

    const validEvents = fixedEvents
        .filter(e => e?.startTime && e?.endTime)
        .map(e => ({ start: e.startTime, end: e.endTime }))
        .filter(e => {
            const s = new Date(e.start).getTime();
            const en = new Date(e.end).getTime();
            return !Number.isNaN(s) && !Number.isNaN(en) && en > s;
        });

    return [...(busySlots ?? []), ...validEvents];
}

// ═════════════════════════════════════════════════════════════════════════
// Main agent entry point
// ═════════════════════════════════════════════════════════════════════════

/**
 * Run the Scheduler Agent.
 *
 * NOTE: this agent does NOT talk to Google Calendar. `busySlots` must be
 * fetched by the caller (the orchestrator) via
 * google_calendar_agent.getFreeBusy(userId, timeMinISO, timeMaxISO) and
 * passed in here.
 *
 * @param {object} context - PlanningContext
 * @param {object} clients - LLM clients { pro, flash, embedding }
 * @param {object|null} [eventBus]
 * @param {function|null} [sseEmit]
 * @param {Array<{start:string, end:string}>} [busySlots] - Google Calendar free/busy blocks
 * @returns {Promise<object>} the parsed and validated schedule output (also written to context.schedule)
 */
export async function runSchedulerAgent(context, clients, eventBus = null, sseEmit = null, busySlots = []) {
    const projectDurationDays = computeProjectDurationDays(context);
    const bufferPercent = computeBufferPercent(projectDurationDays);

    return runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'schedule',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 1,
        agentFn: async (ctx, llm) => {
            // ── Resolve all scheduling preferences at once ────────────────────
            // resolveWorkingHours now returns workStartHour, workEndHour,
            // workStyle, weekendMode, dailyAvailableMinutes, and
            // explicitWindowStated — derived from context.intent (this
            // request's stated hours, if any) falling back to
            // context.preferences (saved via SchedulePreferences UI).
            const resolved = resolveWorkingHours(ctx);
            const { workStartHour, workEndHour, weekendMode, dailyAvailableMinutes } = resolved;

            // ── Carve out user-declared fixed/non-negotiable time blocks ───────
            // (e.g. "11:30-12:30 client call") alongside real Google Calendar
            // busy times, using the same slot-avoidance logic for both.
            const effectiveBusySlots = mergeFixedEventsIntoBusySlots(ctx.intent, busySlots);

            // ── Deterministic feasibility guard — never let the LLM invent an
            //    unrealistic schedule when the deadline is already impossible.
            //    IMPORTANT: infeasible does not mean "don't schedule anything".
            //    The user still needs a concrete day-by-day plan — it will just
            //    run past the deadline. Build the deterministic skeleton (which
            //    keeps placing tasks on later and later days once earlier days'
            //    budgets are used up, with no upper bound) and hand that back as
            //    the real schedule, alongside the infeasibility warnings. ──
            const feasibilityCheck = checkDeadlineFeasibility(ctx, dailyAvailableMinutes);
            if (!feasibilityCheck.isFeasible) {
                const failureConditions = buildFailureConditions(feasibilityCheck, ctx);
                const fallbackSkeleton = buildScheduleSkeleton(ctx, effectiveBusySlots, dailyAvailableMinutes, workStartHour, workEndHour, weekendMode);
                return {
                    schemaVersion: SCHEMA_VERSION,
                    scheduledTasks: skeletonToScheduledTasks(fallbackSkeleton),
                    bufferSlots: [],
                    schedulingScore: 30,
                    confidenceScore: 90,
                    warnings: ['Deadline is not achievable given the estimated total effort — see failureConditions. Schedule below runs past the deadline.'],
                    recommendations: [`Consider extending the deadline to ${failureConditions.suggestedDeadline} or deferring lower-priority tasks.`],
                    isFeasible: false,
                    failureConditions,
                    reasoning: {
                        confidence: 0.9,
                        assumptions: [`Assumed ${Math.round(dailyAvailableMinutes / 60 * 10) / 10}h/day available capacity at ${Math.round(MAX_DAILY_UTILIZATION * 100)}% utilization, within the ${workStartHour}:00–${workEndHour}:00 window. Weekend mode: ${weekendMode}.`],
                        warnings: ['Deadline determined infeasible by deterministic pre-check — used the deterministic skeleton (no LLM refinement) so the schedule still spreads work across real days instead of being empty.'],
                        promptVersion: PROMPT_VERSION,
                    },
                };
            }

            // ── Build deterministic skeleton ───────────────────────────────────
            const skeleton = buildScheduleSkeleton(ctx, effectiveBusySlots, dailyAvailableMinutes, workStartHour, workEndHour, weekendMode);
            const taskMeta = buildTaskMeta(ctx);
            const createdAt = new Date(ctx?.metadata?.createdAt ?? Date.now());
            const deadline = ctx?.intent?.deadline ?? ctx?.explicitDeadline ?? null;
            const fixedEvents = ctx.intent?.fixedEvents ?? [];
            const maxContinuousFocusMinutes = ctx.intent?.maxContinuousFocusMinutes ?? null;

            // ── Deterministic-only fast path ──────────────────────────────────
            // When the user stated BOTH a concrete working-hours window AND
            // another hard constraint the skeleton already fully enforces
            // (fixed non-negotiable events, or a continuous-focus/break rule),
            // this is a "plan my day/window precisely" request, not an
            // open-ended "turn my goal into a project" one. LLM improvisation
            // is a liability here, not a refinement — the model's only
            // instruction for workload spread (Rule 4) is tuned for spreading
            // an AI-*inferred* multi-day project thin, which is exactly wrong
            // for a single stated window, and every constraint that matters
            // (working hours, fixed events, focus/break, dependency order,
            // priority order) is already satisfied by buildScheduleSkeleton.
            // Skipping the LLM call here also saves two full LLM round-trips
            // (generateText + parseJSONWithRepair) per run for this common case.
            const useDeterministicOnly = resolved.explicitWindowStated
                && (fixedEvents.length > 0 || !!maxContinuousFocusMinutes);

            let parsed;
            if (useDeterministicOnly) {
                parsed = {
                    schemaVersion: SCHEMA_VERSION,
                    scheduledTasks: skeletonToScheduledTasks(skeleton),
                    bufferSlots: [],
                    schedulingScore: 92,
                    confidenceScore: 95,
                    warnings: [],
                    recommendations: [],
                    isFeasible: true,
                    failureConditions: null,
                    reasoning: {
                        confidence: 0.95,
                        assumptions: [`User stated an explicit ${workStartHour}:00–${workEndHour}:00 working window plus fixed events/focus rules, so the deterministic skeleton was used directly (no LLM refinement) — it already satisfies every stated constraint.`],
                        warnings: [],
                        promptVersion: PROMPT_VERSION,
                    },
                };
            } else {
                const prompt = buildSchedulerPrompt({
                    skeleton,
                    taskMeta,
                    memory: ctx.memory ?? null,
                    estimation: ctx.estimation ?? null,
                    bufferPercent,
                    projectDurationDays,
                    createdAtISO: createdAt.toISOString(),
                    deadlineISO: deadline,
                    dailyAvailableMinutes,
                    weekendMode,
                    workStartHour,
                    workEndHour,
                    explicitWindowStated: resolved.explicitWindowStated,
                    fixedEvents,
                    maxContinuousFocusMinutes,
                    breakMinutes: ctx.intent?.breakMinutes ?? null,
                });

                const result = await llm.pro.generateText(prompt, { promptVersion: PROMPT_VERSION });
                const text = extractText(result);
                try {
                    parsed = await parseJSONWithRepair(text, llm.flash);
                } catch (err) {
                    console.warn(`[${AGENT_NAME}] LLM output unparsable, using deterministic skeleton fallback: ${err.message?.slice(0, 120)}`);
                    parsed = null;
                }

                // ── Fallback: if the LLM failed entirely, use the raw skeleton ──
                if (!parsed || !Array.isArray(parsed.scheduledTasks)) {
                    parsed = {
                        schemaVersion: SCHEMA_VERSION,
                        scheduledTasks: skeletonToScheduledTasks(skeleton),
                        bufferSlots: [],
                        schedulingScore: 60,
                        confidenceScore: 50,
                        warnings: ['LLM scheduling response was invalid/unparsable — used deterministic fallback skeleton with no LLM refinement.'],
                        recommendations: [],
                        isFeasible: true,
                        failureConditions: null,
                    };
                }
            }

            parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
            parsed.recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
            parsed.bufferSlots = Array.isArray(parsed.bufferSlots) ? parsed.bufferSlots : [];

            // If the LLM itself decided the plan is infeasible, respect that —
            // but still ensure the failureConditions object is well-formed.
            if (parsed.isFeasible === false) {
                if (!parsed.failureConditions) {
                    parsed.failureConditions = buildFailureConditions(feasibilityCheck, ctx);
                }
                return parsed;
            }

            // ── Deterministic post-processing ─────────────────────────────────
            enforceFirstTaskDelay(parsed.scheduledTasks, createdAt);
            const { fixedCount } = fixDependencyViolations(parsed.scheduledTasks, 3, effectiveBusySlots, workStartHour, workEndHour, weekendMode);
            if (fixedCount > 0) {
                parsed.warnings.push(`Auto-corrected ${fixedCount} dependency-ordering violation(s) in the LLM's proposed schedule.`);
            }

            let schedulingScore = typeof parsed.schedulingScore === 'number' ? parsed.schedulingScore : 80;

            const depCheck = validateNoDependencyViolations(parsed.scheduledTasks, ctx.dependency);
            if (!depCheck.valid) {
                schedulingScore -= 15;
                parsed.warnings.push(`${depCheck.violations.length} dependency-ordering issue(s) remain after auto-fix.`);
            }

            const hoursViolations = checkWorkingHoursCompliance(parsed.scheduledTasks, workStartHour, workEndHour);
            if (hoursViolations.length > 0) {
                schedulingScore -= Math.min(20, hoursViolations.length * 5);
                parsed.warnings.push(`${hoursViolations.length} task(s) scheduled outside working hours (${workStartHour}:00–${workEndHour}:00).`);
            }

            const bufferCheck = validateBufferPercent(parsed.scheduledTasks, projectDurationDays);
            if (!bufferCheck.valid) {
                schedulingScore -= 10;
                parsed.warnings.push(
                    `Buffer allocation (${(bufferCheck.actualPct * 100).toFixed(1)}%) is below the required ${(bufferCheck.requiredPct * 100).toFixed(0)}% for a ${projectDurationDays !== null ? projectDurationDays.toFixed(1) : '?'}-day project.`
                );
            }

            parsed.schedulingScore = Math.max(0, Math.min(100, Math.round(schedulingScore)));

            if (parsed.schedulingScore < LOW_SCHEDULING_SCORE_THRESHOLD) {
                parsed.recommendations.push('schedulingScore below 70 — orchestrator should route this schedule to review_agent.');
            }

            return parsed;
        },
    });
}
