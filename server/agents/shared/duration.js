/**
 * duration.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure helpers for deriving *measured* work durations from execution-step
 * timestamps.
 *
 * The distinction that matters here is measured vs. assumed. A step only has a
 * real duration if the user actually started it (`startedAt`) and later finished
 * it (`completedAt`). Two cases deliberately produce "unmeasured" instead of a
 * number:
 *
 *   1. The step was ticked straight from pending to completed (the checkbox path
 *      in ExecutionStepItem). There is no elapsed time to measure. Backfilling
 *      the estimate here would be self-confirming: estimation accuracy is scored
 *      against these actuals, so feeding estimates back in as actuals would make
 *      the system grade its own homework and always look perfect.
 *
 *   2. The elapsed time is implausibly long — the user hit "Start", walked away,
 *      and completed the step two days later. That measures tab-open time, not
 *      work, and a single such value would badly skew a user's learned profile.
 *
 * Callers get both the summed minutes and the coverage, so a consumer that needs
 * a clean signal (estimation accuracy) can require full coverage, while one that
 * just wants a rough figure (progress display) can use a partial sum.
 */

// Strict parsing is essential here: toMillis() maps missing values to epoch 0
// for sort stability, which in a subtraction would turn an absent timestamp
// into a ~56-year "duration" rather than an absent one.
import { toMillisOrNull } from './firestoreUtil.js';

/**
 * Longest elapsed span still treated as real work, in minutes. Beyond this the
 * timestamp pair reflects an abandoned session rather than effort, so the step
 * is reported as unmeasured. 16h comfortably covers even an extreme single-day
 * push while excluding anything left running overnight.
 */
export const MAX_PLAUSIBLE_SESSION_MINUTES = 16 * 60;

/** Statuses meaning "this step never had to be worked", excluded from coverage. */
const UNWORKED_STATUSES = new Set(['skipped']);

/**
 * Measured duration of a single execution step, or null when it cannot be
 * trusted. Accepts Firestore Timestamps, ISO strings or Dates.
 *
 * @param {object} step
 * @param {number} [maxPlausibleMinutes]
 * @returns {number|null} whole minutes, or null if unmeasured/implausible
 */
export function computeStepActualMinutes(step, maxPlausibleMinutes = MAX_PLAUSIBLE_SESSION_MINUTES) {
    const started = toMillisOrNull(step?.startedAt);
    const completed = toMillisOrNull(step?.completedAt);
    if (started === null || completed === null) return null;

    const minutes = Math.round((completed - started) / 60_000);
    // Negative spans mean clock skew or edited data — not measurable.
    if (minutes < 0) return null;
    if (minutes > maxPlausibleMinutes) return null;
    return minutes;
}

/**
 * Roll a task's execution steps up into a single actual-effort figure plus the
 * coverage needed to judge how much that figure can be trusted.
 *
 * Each step's own `actualMinutes`, when already a finite number, is trusted
 * as-is instead of being re-derived from timestamps — that field may hold a
 * client-measured value (e.g. a Pomodoro-style focus timer's active seconds,
 * which excludes paused time — suggestions.md #5) that is more accurate than
 * the raw startedAt/completedAt span. Only falls back to the timestamp
 * derivation when the step doesn't already carry one.
 *
 * @param {object[]} steps
 * @param {number} [maxPlausibleMinutes]
 * @returns {{actualMinutes: number|null, measuredSteps: number, workedSteps: number, isComplete: boolean}}
 *   actualMinutes  sum over measured steps, or null when nothing was measured
 *   measuredSteps  how many steps yielded a trustworthy duration
 *   workedSteps    how many steps needed working at all (skipped ones excluded)
 *   isComplete     every worked step was measured — the signal is safe to score
 *                  estimation accuracy against
 */
export function summarizeTaskActuals(steps, maxPlausibleMinutes = MAX_PLAUSIBLE_SESSION_MINUTES) {
    const list = Array.isArray(steps) ? steps : [];
    const worked = list.filter((s) => !UNWORKED_STATUSES.has(s?.status));

    let total = 0;
    let measuredSteps = 0;
    for (const step of worked) {
        const minutes = Number.isFinite(step?.actualMinutes)
            ? step.actualMinutes
            : computeStepActualMinutes(step, maxPlausibleMinutes);
        if (minutes === null) continue;
        total += minutes;
        measuredSteps++;
    }

    return {
        actualMinutes: measuredSteps > 0 ? total : null,
        measuredSteps,
        workedSteps: worked.length,
        isComplete: worked.length > 0 && measuredSteps === worked.length,
    };
}
