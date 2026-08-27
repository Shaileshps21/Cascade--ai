/**
 * stepProgress.test.js — the execution-step state machine and its rollup.
 *
 * This is the logic behind every "Start" / "Complete" / "Block" click in the Task
 * Workspace, and the only place task-level actual effort is ever written.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyStepUpdate, ALLOWED_STEP_STATUSES } from './stepProgress.js';

const T0 = '2026-07-22T09:00:00.000Z';
const at = (mins) => new Date(new Date(T0).getTime() + mins * 60_000).toISOString();

const makeStep = (over = {}) => ({
    id: 's1', status: 'pending', progress: 0,
    startedAt: null, completedAt: null, blockedSince: null, blockedReason: null,
    notes: '', completionEvidence: '', isOptional: false, ...over,
});
const makeTask = (steps) => ({ taskId: 'task-1', executionSteps: steps, progress: {} });

// ── Status transitions ──────────────────────────────────────────────────────

test('starting a step stamps startedAt and moves the task to in_progress', () => {
    const step = makeStep();
    const task = makeTask([step]);
    const result = applyStepUpdate(task, step, { status: 'in_progress' }, T0);

    assert.equal(step.startedAt, T0);
    assert.equal(result.taskStatus, 'in_progress');
});

test('startedAt is not overwritten when a step is restarted', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);
    applyStepUpdate(task, step, { status: 'in_progress' }, at(60));
    assert.equal(step.startedAt, T0, 'the original start must survive a pause/resume');
});

test('completing a started step measures its duration and completes the task', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);
    const result = applyStepUpdate(task, step, { status: 'completed' }, at(45));

    assert.equal(step.progress, 100);
    assert.equal(step.actualMinutes, 45);
    assert.equal(result.taskStatus, 'completed');
    assert.equal(result.actualMinutes, 45);
    assert.equal(result.isComplete, true);
});

test('the straight-to-completed checkbox path records no fabricated duration', () => {
    const step = makeStep(); // never started
    const task = makeTask([step]);
    const result = applyStepUpdate(task, step, { status: 'completed' }, at(45));

    assert.equal(step.actualMinutes, null, 'must not invent a duration');
    assert.equal(result.actualMinutes, null);
    assert.equal(result.isComplete, false, 'unmeasured work cannot score estimation accuracy');
    assert.equal(result.taskStatus, 'completed', 'the task is still genuinely done');
});

test('reopening a completed step clears its completion trail', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);
    applyStepUpdate(task, step, { status: 'completed' }, at(30));
    assert.equal(step.actualMinutes, 30);

    applyStepUpdate(task, step, { status: 'pending' }, at(40));
    assert.equal(step.completedAt, null, 'a stale completedAt would later yield a nonsense span');
    assert.equal(step.actualMinutes, null);
    assert.equal(task.progress.completedAt, null);
    assert.equal(task.progress.status, 'not_started');
});

// ── Explicit actualMinutes override (suggestions.md #5 — focus timer) ───────

test('an explicit actualMinutes takes precedence over the timestamp-derived duration', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);
    // Wall-clock span is 45 min, but the focus timer (which excludes paused
    // time) measured only 20 min of real focus.
    const result = applyStepUpdate(task, step, { status: 'completed', actualMinutes: 20 }, at(45));

    assert.equal(step.actualMinutes, 20);
    assert.equal(result.actualMinutes, 20);
    assert.equal(result.isComplete, true);
});

test('an explicit actualMinutes also applies on the straight-to-completed path', () => {
    const step = makeStep(); // never started — no timestamps to derive from
    const task = makeTask([step]);
    const result = applyStepUpdate(task, step, { status: 'completed', actualMinutes: 12.4 }, at(45));

    assert.equal(step.actualMinutes, 12, 'rounded to the nearest minute');
    assert.equal(result.isComplete, true);
});

test('a non-positive or implausibly large actualMinutes is ignored, falling back to the timestamp derivation', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);

    const zero = applyStepUpdate(makeTask([step]), step, { status: 'completed', actualMinutes: 0 }, at(45));
    assert.equal(zero.actualMinutes, 45);

    step.status = 'in_progress'; step.completedAt = null; step.actualMinutes = null;
    const tooLarge = applyStepUpdate(task, step, { status: 'completed', actualMinutes: 999999 }, at(45));
    assert.equal(tooLarge.actualMinutes, 45);
});

test('actualMinutes is ignored when the patch does not also complete the step', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);
    applyStepUpdate(task, step, { notes: 'still working', actualMinutes: 20 }, at(10));

    assert.equal(step.actualMinutes, undefined, 'actualMinutes is only ever set by a completion transition');
    assert.equal(step.status, 'in_progress');
});

// ── Blocking ────────────────────────────────────────────────────────────────

test('blocking records the reason and timestamp', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);
    applyStepUpdate(task, step, { status: 'blocked', blockedReason: 'Waiting on API access' }, at(10));

    assert.equal(step.blockedSince, at(10));
    assert.equal(step.blockedReason, 'Waiting on API access');
});

test('unblocking clears both blocked fields', () => {
    const step = makeStep({ status: 'blocked', blockedSince: T0, blockedReason: 'stuck' });
    const task = makeTask([step]);
    applyStepUpdate(task, step, { status: 'in_progress' }, at(20));

    assert.equal(step.blockedSince, null);
    assert.equal(step.blockedReason, null);
});

// ── Task-level rollup ───────────────────────────────────────────────────────

test('a task is only complete when every step is resolved', () => {
    const a = makeStep({ id: 'a', status: 'in_progress', startedAt: T0 });
    const b = makeStep({ id: 'b' });
    const task = makeTask([a, b]);

    assert.equal(applyStepUpdate(task, a, { status: 'completed' }, at(20)).taskStatus, 'in_progress');
    assert.equal(applyStepUpdate(task, b, { status: 'completed' }, at(30)).taskStatus, 'completed');
});

test('an optional skipped step still counts as resolved', () => {
    const a = makeStep({ id: 'a', status: 'in_progress', startedAt: T0 });
    const b = makeStep({ id: 'b', isOptional: true });
    const task = makeTask([a, b]);

    applyStepUpdate(task, b, { status: 'skipped' }, at(5));
    const result = applyStepUpdate(task, a, { status: 'completed' }, at(25));
    assert.equal(result.taskStatus, 'completed');
    assert.equal(result.isComplete, true, 'a skipped step never needed measuring');
});

test('durations sum across steps and partial coverage is flagged', () => {
    const a = makeStep({ id: 'a', status: 'in_progress', startedAt: T0 });
    const b = makeStep({ id: 'b' });
    const task = makeTask([a, b]);

    applyStepUpdate(task, a, { status: 'completed' }, at(30));
    const result = applyStepUpdate(task, b, { status: 'completed' }, at(50)); // never started

    assert.equal(result.actualMinutes, 30, 'only the measured step contributes');
    assert.equal(result.isComplete, false, 'a partial sum must not be scored against a full estimate');
    assert.equal(task.progress.actualMinutesIsComplete, false);
});

// ── Field patches ───────────────────────────────────────────────────────────

test('progress is clamped to 0..100', () => {
    const step = makeStep();
    const task = makeTask([step]);
    applyStepUpdate(task, step, { progress: 250 }, T0);
    assert.equal(step.progress, 100);
    applyStepUpdate(task, step, { progress: -40 }, T0);
    assert.equal(step.progress, 0);
});

test('notes and evidence update without touching status', () => {
    const step = makeStep({ status: 'in_progress', startedAt: T0 });
    const task = makeTask([step]);
    applyStepUpdate(task, step, { notes: 'read chapter 3', completionEvidence: 'repo link' }, at(5));

    assert.equal(step.notes, 'read chapter 3');
    assert.equal(step.completionEvidence, 'repo link');
    assert.equal(step.status, 'in_progress', 'an unrelated patch must not change status');
});

test('a non-numeric progress value is ignored rather than stored', () => {
    const step = makeStep({ progress: 42 });
    const task = makeTask([step]);
    applyStepUpdate(task, step, { progress: 'lots' }, T0);
    assert.equal(step.progress, 42);
});

test('ALLOWED_STEP_STATUSES is the single source of truth for validation', () => {
    assert.deepEqual(ALLOWED_STEP_STATUSES, ['pending', 'in_progress', 'completed', 'blocked', 'skipped']);
});
