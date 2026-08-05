/**
 * deadline_feasibility_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Primarily deterministic agent. Sums `finalEstimateMinutes` across all
 * `context.estimation.estimations[]` entries and compares against the working
 * minutes available between now and the deadline. Only calls an LLM
 * (`clients.flash`) for a small reconciliation-suggestions prompt, and only
 * when the plan is infeasible.
 *
 * Reads:  context.intent.deadline (or context.explicitDeadline),
 *         context.estimation.estimations[].finalEstimateMinutes,
 *         context.userPreferences.workingHours (optional, not yet populated
 *         by any upstream agent — see WORKING_HOURS_MODEL note below)
 * Writes: context.feasibility
 */

import './schema.js'; // registers schema
import { buildReconciliationPrompt } from './prompt_v1.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';
import { writeNamespace } from '../contextManager.js';
import { validateAgentOutput } from '../shared/validator.js';
import { createAgentLog, completeAgentLog, attachToContext } from '../shared/logger.js';

const AGENT_NAME = 'deadline_feasibility_agent';
const SSE_NAME = 'feasibility';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// Working-hours model
// ─────────────────────────────────────────────────────────────────────────────
//
// No upstream agent currently populates user working-hours preferences on the
// PlanningContext (there is no `context.preferences.workingHours` yet — see
// implementation_plan.md Phase 1). Until that lands, this agent defaults to a
// simple, deterministic assumption:
//
//   - Weekdays (Mon–Fri): MINUTES_PER_WORKDAY productive minutes available.
//   - Weekends (Sat/Sun): MINUTES_PER_WEEKEND_DAY productive minutes (0 by default).
//
// This capacity is modeled as spread uniformly across each calendar day rather
// than pinned to a specific clock-hour window (e.g. "9am-1pm"). That keeps the
// partial-day math for the first/last day of a range simple and exact: any
// two timestamps exactly 24h apart that are both weekdays yield exactly
// MINUTES_PER_WORKDAY of available time, regardless of what hour they start at.
//
// If/when real user working-hours preferences are added to the context (e.g.
// `context.preferences.workingHours = { weekdayMinutes, weekendMinutes }`),
// swap the constants below for those values — the shape of computeAvailableMinutes()
// does not need to change, only where DEFAULT_WEEKDAY_MINUTES/DEFAULT_WEEKEND_MINUTES
// are sourced from.

/** Default productive minutes available per weekday (Mon–Fri). 4h/day. */
export const MINUTES_PER_WORKDAY = 4 * 60; // 240

/** Default productive minutes available per weekend day (Sat/Sun). None by default. */
export const MINUTES_PER_WEEKEND_DAY = 0;

/**
 * Deterministic daily capacity (in minutes) for a given calendar date, using
 * the default working-hours model. Weekends contribute 0 by default.
 *
 * Uses UTC day-of-week (getUTCDay) rather than local time so the result is
 * independent of the host server's timezone — ISO 8601 deadline strings are
 * UTC ("Z"-suffixed), and computations must be stable regardless of where
 * the Node process happens to run.
 *
 * @param {Date} date
 * @param {{ weekdayMinutes?: number, weekendMinutes?: number }} [prefs]
 * @returns {number}
 */
function dailyCapacityMinutes(date, prefs = {}) {
    const weekdayMinutes = typeof prefs.weekdayMinutes === 'number' ? prefs.weekdayMinutes : MINUTES_PER_WORKDAY;
    const weekendMinutes = typeof prefs.weekendMinutes === 'number' ? prefs.weekendMinutes : MINUTES_PER_WEEKEND_DAY;
    const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
    return (day === 0 || day === 6) ? weekendMinutes : weekdayMinutes;
}

/**
 * Pure function: compute total available working minutes between `fromDate`
 * (inclusive) and `deadlineDate` (exclusive-ish — the deadline instant caps
 * the last partial day). Weekends contribute `weekendMinutes` (0 by default);
 * weekdays contribute `weekdayMinutes` (240 by default), prorated by the
 * fraction of that calendar day that actually falls within [fromDate, deadlineDate].
 *
 * Exported for unit testing independent of any agent/context wiring.
 *
 * @param {Date|string} fromDate      - start instant (usually "now")
 * @param {Date|string} deadlineDate  - end instant (the deadline)
 * @param {{ weekdayMinutes?: number, weekendMinutes?: number }} [prefs] - optional override of the default working-hours model
 * @returns {number} available minutes, rounded to the nearest whole minute (never negative)
 */
export function computeAvailableMinutes(fromDate, deadlineDate, prefs = {}) {
    const from = new Date(fromDate);
    const to = new Date(deadlineDate);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
    if (to <= from) return 0;

    let totalMinutes = 0;
    const cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);

    const endDay = new Date(to);
    endDay.setUTCHours(0, 0, 0, 0);

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    while (cursor <= endDay) {
        const dayStart = new Date(cursor);
        const dayEnd = new Date(cursor.getTime() + ONE_DAY_MS);

        // The portion of THIS calendar day that falls within [from, to]
        const segStart = from > dayStart ? from : dayStart;
        const segEnd = to < dayEnd ? to : dayEnd;

        if (segEnd > segStart) {
            const fraction = (segEnd.getTime() - segStart.getTime()) / ONE_DAY_MS;
            totalMinutes += dailyCapacityMinutes(cursor, prefs) * fraction;
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return Math.max(0, Math.round(totalMinutes));
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation suggestion helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeSuggestions(parsed) {
    return {
        suggestedDeadline: typeof parsed?.suggestedDeadline === 'string' && !Number.isNaN(new Date(parsed.suggestedDeadline).getTime())
            ? parsed.suggestedDeadline
            : null,
        reducedScope: Array.isArray(parsed?.reducedScope) ? parsed.reducedScope.filter(s => typeof s === 'string') : [],
        additionalWorkHoursNeeded: typeof parsed?.additionalWorkHoursNeeded === 'number' && !Number.isNaN(parsed.additionalWorkHoursNeeded)
            ? parsed.additionalWorkHoursNeeded
            : null,
        priorityReductions: Array.isArray(parsed?.priorityReductions) ? parsed.priorityReductions.filter(s => typeof s === 'string') : [],
    };
}

/**
 * Deterministic fallback reconciliation suggestions, used if the LLM call
 * fails or returns unusable output. Never leaves reconciliationSuggestions
 * null when the plan is infeasible.
 */
function buildFallbackSuggestions({ totalEffortMinutes, availableMinutes, now, deadlineDate }) {
    const shortfallMinutes = Math.max(0, totalEffortMinutes - availableMinutes);
    const additionalWorkHoursNeeded = parseFloat((shortfallMinutes / 60).toFixed(2));

    const extraDaysNeeded = Math.max(1, Math.ceil(shortfallMinutes / MINUTES_PER_WORKDAY) || 1);
    const base = deadlineDate && !Number.isNaN(deadlineDate.getTime()) ? deadlineDate : now;
    const suggestedDeadline = new Date(base.getTime());
    suggestedDeadline.setUTCDate(suggestedDeadline.getUTCDate() + extraDaysNeeded);

    return {
        suggestedDeadline: suggestedDeadline.toISOString(),
        reducedScope: ['Defer lower-priority tasks to a follow-up phase to fit the current deadline.'],
        additionalWorkHoursNeeded,
        priorityReductions: ['Lower the priority of non-critical tasks so core deliverables are completed first.'],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the Deadline Feasibility Agent.
 * Reads: context.estimation.estimations[], context.intent.deadline / context.explicitDeadline
 * Writes: context.feasibility
 *
 * @param {object} context
 * @param {object} clients      - LLM clients { pro, flash, embedding }
 * @param {object|null} [eventBus]
 * @param {function|null} [sseEmit] - (agentName, status, message, data) => void
 * @returns {Promise<object>} the feasibility output written to context.feasibility
 */
export async function runDeadlineFeasibilityAgent(context, clients, eventBus = null, sseEmit = null) {
    const log = createAgentLog(AGENT_NAME, PROMPT_VERSION);
    eventBus?.agentStart(AGENT_NAME, `${AGENT_NAME} started`);
    sseEmit?.(SSE_NAME, 'thinking', 'Checking whether the deadline is realistic...', null);

    const now = new Date();

    try {
        // ── Step 1: Sum estimated effort ──────────────────────────────────────
        const estimations = context?.estimation?.estimations ?? [];
        const totalEffortMinutes = estimations.reduce((sum, e) => {
            const mins = Number(e?.finalEstimateMinutes);
            return sum + (Number.isFinite(mins) ? mins : 0);
        }, 0);

        // ── Step 2: Resolve deadline & compute available minutes ─────────────
        const deadlineStr = context?.intent?.deadline ?? context?.explicitDeadline ?? null;
        const deadlineDate = deadlineStr ? new Date(deadlineStr) : null;
        const hasValidDeadline = deadlineDate && !Number.isNaN(deadlineDate.getTime());

        // Optional future hook: user working-hours preferences (not yet populated
        // by any upstream agent). See WORKING_HOURS_MODEL comment above.
        const workingHoursPrefs = context?.preferences?.workingHours ?? {};

        let availableMinutes;
        let isFeasible;

        if (hasValidDeadline) {
            availableMinutes = computeAvailableMinutes(now, deadlineDate, workingHoursPrefs);
            isFeasible = availableMinutes >= totalEffortMinutes;
        } else {
            // No deadline at all — nothing to be infeasible against. Model
            // "available" as exactly matching effort so slack is 0 rather than
            // fabricating an arbitrarily large number.
            availableMinutes = totalEffortMinutes;
            isFeasible = true;
        }

        const slackMinutes = availableMinutes - totalEffortMinutes;

        const output = {
            schemaVersion: SCHEMA_VERSION,
            isFeasible,
            totalEffortMinutes,
            availableMinutes,
            slackMinutes,
            reconciliationSuggestions: null,
        };

        // ── Step 3: LLM reconciliation only when infeasible ───────────────────
        if (!isFeasible) {
            sseEmit?.(SSE_NAME, 'thinking', 'Deadline looks tight — generating reconciliation options...', null);
            try {
                const estimationMap = new Map(estimations.map(e => [e.taskId, e]));
                const tasks = (context?.planning?.tasks ?? []).map((t) => ({
                    title: t.title,
                    priority: t.priority,
                    minutes: estimationMap.get(t.taskId)?.finalEstimateMinutes ?? t.estimatedMinutes,
                }));

                const prompt = buildReconciliationPrompt({
                    taskTitle: context?.intent?.title ?? context?.rawGoal ?? 'this project',
                    totalEffortMinutes,
                    availableMinutes,
                    slackMinutes,
                    deadline: deadlineStr,
                    now: now.toISOString(),
                    tasks,
                });
                const result = await clients.flash.generateText(prompt, { promptVersion: PROMPT_VERSION });
                const text = extractText(result);
                const parsed = await parseJSONWithRepair(text, clients.flash);
                output.reconciliationSuggestions = normalizeSuggestions(parsed);

                if (result?.usage) {
                    log.tokens = {
                        prompt: result.usage.promptTokens ?? 0,
                        completion: result.usage.completionTokens ?? 0,
                        total: result.usage.totalTokens ?? 0,
                    };
                    log.estimatedCost = result.estimatedCost ?? 0;
                    log.provider = result.provider ?? null;
                    log.model = result.model ?? null;
                }
            } catch (llmErr) {
                console.warn(`[${AGENT_NAME}] Reconciliation LLM call failed, using deterministic fallback: ${llmErr.message?.slice(0, 120)}`);
                output.reconciliationSuggestions = buildFallbackSuggestions({
                    totalEffortMinutes,
                    availableMinutes,
                    now,
                    deadlineDate,
                });
                context?.metadata?.warnings?.push(`${AGENT_NAME}: reconciliation LLM call failed, used deterministic fallback suggestions`);
            }
        }

        // ── Step 4: Validate before writing ────────────────────────────────────
        const validation = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        if (!validation.valid) {
            console.warn(`[${AGENT_NAME}] Output failed schema validation: ${validation.errors.join('; ')}`);
            context?.metadata?.warnings?.push(`${AGENT_NAME}: schema validation errors: ${validation.errors.join('; ')}`);
        }

        // ── Step 5: Write to context ────────────────────────────────────────────
        writeNamespace(context, 'feasibility', output);

        completeAgentLog(log, {
            confidence: isFeasible ? 0.95 : 0.75,
            status: 'success',
            provider: log.provider,
            model: log.model,
        });
        attachToContext(context, log);

        eventBus?.agentComplete(AGENT_NAME, `feasibility computed: ${isFeasible ? 'feasible' : 'infeasible'}`, { isFeasible, slackMinutes });
        sseEmit?.(SSE_NAME, 'done', isFeasible
            ? 'Deadline is feasible given the current plan.'
            : 'Deadline is tight — reconciliation suggestions generated.', { isFeasible, totalEffortMinutes, availableMinutes, slackMinutes });

        return output;
    } catch (err) {
        // Non-fatal by design: this agent should never crash the pipeline.
        // Fall back to a safe, schema-valid "feasible" default so downstream
        // agents (scheduler) still receive a usable context.feasibility.
        console.warn(`[${AGENT_NAME}] Unexpected error, writing safe fallback: ${err.message?.slice(0, 160)}`);

        const fallback = {
            schemaVersion: SCHEMA_VERSION,
            isFeasible: true,
            totalEffortMinutes: 0,
            availableMinutes: 0,
            slackMinutes: 0,
            reconciliationSuggestions: null,
        };
        writeNamespace(context, 'feasibility', fallback);

        completeAgentLog(log, { status: 'failed', errors: [err.message] });
        attachToContext(context, log);

        eventBus?.agentError(AGENT_NAME, err, `${AGENT_NAME} failed: ${err.message}`);
        sseEmit?.(SSE_NAME, 'error', `Feasibility check failed, continuing with defaults: ${err.message?.slice(0, 120)}`, null);

        return fallback;
    }
}
