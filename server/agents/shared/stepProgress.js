/**
 * stepProgress.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The state machine behind a single execution-step update, and how that update
 * propagates up to the owning task.
 *
 * Extracted from routes/projects.js so it can be tested directly. It carries the
 * only genuinely stateful rules in the Project Workspace — status transitions,
 * the completion trail, and the actual-effort rollup that feeds estimation
 * accuracy — and previously those were inline in an Express handler wrapped
 * around Firestore I/O, which made them effectively untestable.
 *
 * Pure and mutating: it edits the `task`/`step` objects it is given (they are
 * already part of a loaded PlanningContext the caller is about to persist) and
 * performs no I/O of its own.
 */

import { computeStepActualMinutes, summarizeTaskActuals, MAX_PLAUSIBLE_SESSION_MINUTES } from './duration.js';

export const ALLOWED_STEP_STATUSES = ['pending', 'in_progress', 'completed', 'blocked', 'skipped'];

/**
 * Apply a patch to one execution step, then re-derive the owning task's status
 * and actual effort from the full step list.
 *
 * @param {object} task - the owning task (mutated)
 * @param {object} step - the step being updated (mutated)
 * @param {{status?: string, progress?: number, notes?: string, completionEvidence?: string, blockedReason?: string, actualMinutes?: number}} patch
 *   `actualMinutes`, when provided alongside `status: 'completed'`, is a client-measured
 *   duration (e.g. a Pomodoro-style focus timer's active seconds — suggestions.md #5) that
 *   takes precedence over the timestamp-derived measurement below, since it excludes any
 *   time the user paused. Ignored unless finite, positive, and within the same plausibility
 *   cap the timestamp-derived path already enforces.
 * @param {string} [nowISO] - injected clock, so tests are deterministic
 * @returns {{actualMinutes: number|null, isComplete: boolean, taskStatus: string}}
 */
export function applyStepUpdate(task, step, patch = {}, nowISO = new Date().toISOString()) {
    const { status, progress, notes, completionEvidence, blockedReason, actualMinutes } = patch;

    if (status !== undefined) {
        const wasCompleted = step.status === 'completed';
        step.status = status;

        if (status === 'in_progress' && !step.startedAt) step.startedAt = nowISO;

        if (status === 'completed') {
            step.completedAt = nowISO;
            step.progress = 100;
            const explicitMinutes = Number.isFinite(actualMinutes) && actualMinutes > 0 && actualMinutes <= MAX_PLAUSIBLE_SESSION_MINUTES
                ? Math.round(actualMinutes)
                : null;
            // Ground truth for estimation accuracy — null unless the step was
            // actually started first (or the caller measured it directly),
            // rather than inventing a duration.
            step.actualMinutes = explicitMinutes ?? computeStepActualMinutes(step);
        } else if (wasCompleted) {
            // Reopening must clear the completion trail: a stale completedAt
            // would later pair with a fresh startedAt and yield a nonsense span.
            step.completedAt = null;
            step.actualMinutes = null;
        }

        if (status === 'blocked') {
            step.blockedSince = nowISO;
            step.blockedReason = blockedReason ?? step.blockedReason ?? null;
        } else {
            step.blockedSince = null;
            step.blockedReason = null;
        }
    }

    if (Number.isFinite(progress)) step.progress = Math.max(0, Math.min(100, progress));
    if (typeof notes === 'string') step.notes = notes;
    if (typeof completionEvidence === 'string') step.completionEvidence = completionEvidence;

    // ── Propagate: the steps are the single source of truth for task state ──
    const steps = task.executionSteps ?? [];
    const resolvedCount = steps.filter(
        (s) => s.status === 'completed' || (s.isOptional && s.status === 'skipped'),
    ).length;
    const anyStarted = steps.some((s) => s.status === 'in_progress' || s.status === 'completed');

    task.progress = task.progress ?? {};
    if (steps.length > 0 && resolvedCount === steps.length) {
        task.progress.status = 'completed';
        task.progress.completedAt = task.progress.completedAt ?? nowISO;
    } else if (anyStarted) {
        task.progress.status = 'in_progress';
    } else {
        task.progress.status = 'not_started';
        task.progress.completedAt = null;
    }

    // ── Roll measured durations up into the task's actual effort ───────────
    // This is what feeds the personalisation loop: Memory, Evaluation Benchmark
    // and Time Estimation all read task.progress.actualMinutes.
    const actuals = summarizeTaskActuals(steps);
    task.progress.actualMinutes = actuals.actualMinutes;
    task.progress.actualMinutesIsComplete = actuals.isComplete;

    return {
        actualMinutes: actuals.actualMinutes,
        isComplete: actuals.isComplete,
        taskStatus: task.progress.status,
    };
}
