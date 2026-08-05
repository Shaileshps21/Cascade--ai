/**
 * duration.test.js — pure-logic coverage for measured work durations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeStepActualMinutes,
    summarizeTaskActuals,
    MAX_PLAUSIBLE_SESSION_MINUTES,
} from './duration.js';

const BASE = '2026-07-22T09:00:00.000Z';
/** ISO string `mins` after BASE. */
const after = (mins) => new Date(new Date(BASE).getTime() + mins * 60_000).toISOString();

const step = (over = {}) => ({ status: 'completed', startedAt: BASE, completedAt: after(30), ...over });

// ── computeStepActualMinutes ────────────────────────────────────────────────

test('computeStepActualMinutes measures a normal start→complete span', () => {
    assert.equal(computeStepActualMinutes(step()), 30);
});

test('computeStepActualMinutes returns null when the step was never started', () => {
    // The straight-to-completed checkbox path: completedAt exists, startedAt does not.
    assert.equal(computeStepActualMinutes(step({ startedAt: null })), null);
});

test('computeStepActualMinutes returns null when the step is not yet complete', () => {
    assert.equal(computeStepActualMinutes(step({ completedAt: null })), null);
});

test('computeStepActualMinutes returns null for a negative span (clock skew)', () => {
    assert.equal(computeStepActualMinutes({ startedAt: after(30), completedAt: BASE }), null);
});

test('computeStepActualMinutes accepts a zero-length span', () => {
    assert.equal(computeStepActualMinutes({ startedAt: BASE, completedAt: BASE }), 0);
});

test('computeStepActualMinutes rejects an implausibly long span as abandoned', () => {
    // Started, walked away, completed two days later — tab-open time, not work.
    assert.equal(computeStepActualMinutes(step({ completedAt: after(48 * 60) })), null);
});

test('computeStepActualMinutes keeps the exact plausibility boundary', () => {
    assert.equal(
        computeStepActualMinutes(step({ completedAt: after(MAX_PLAUSIBLE_SESSION_MINUTES) })),
        MAX_PLAUSIBLE_SESSION_MINUTES,
    );
    assert.equal(computeStepActualMinutes(step({ completedAt: after(MAX_PLAUSIBLE_SESSION_MINUTES + 1) })), null);
});

test('computeStepActualMinutes handles Date objects and missing input', () => {
    assert.equal(computeStepActualMinutes({ startedAt: new Date(BASE), completedAt: new Date(after(15)) }), 15);
    assert.equal(computeStepActualMinutes(null), null);
    assert.equal(computeStepActualMinutes({}), null);
});

// ── summarizeTaskActuals ────────────────────────────────────────────────────

test('summarizeTaskActuals sums measured steps and reports full coverage', () => {
    const result = summarizeTaskActuals([
        step({ completedAt: after(30) }),
        step({ startedAt: after(60), completedAt: after(105) }),
    ]);
    assert.deepEqual(result, { actualMinutes: 75, measuredSteps: 2, workedSteps: 2, isComplete: true });
});

test('summarizeTaskActuals flags partial coverage so it is not scored', () => {
    const result = summarizeTaskActuals([
        step({ completedAt: after(30) }),
        step({ startedAt: null }), // ticked complete without starting
    ]);
    assert.equal(result.actualMinutes, 30);
    assert.equal(result.measuredSteps, 1);
    assert.equal(result.workedSteps, 2);
    assert.equal(result.isComplete, false, 'partial data must not claim completeness');
});

test('summarizeTaskActuals excludes skipped steps from coverage', () => {
    const result = summarizeTaskActuals([
        step({ completedAt: after(20) }),
        { status: 'skipped', startedAt: null, completedAt: null },
    ]);
    assert.equal(result.workedSteps, 1);
    assert.equal(result.isComplete, true, 'a skipped step never needed measuring');
    assert.equal(result.actualMinutes, 20);
});

test('summarizeTaskActuals returns null rather than 0 when nothing was measured', () => {
    // Null is the honest answer — 0 would read as "took no time at all" and
    // drag the learned estimation profile toward zero.
    const result = summarizeTaskActuals([step({ startedAt: null }), step({ startedAt: null })]);
    assert.equal(result.actualMinutes, null);
    assert.equal(result.isComplete, false);
});

test('summarizeTaskActuals handles empty and non-array input', () => {
    assert.deepEqual(summarizeTaskActuals([]), {
        actualMinutes: null, measuredSteps: 0, workedSteps: 0, isComplete: false,
    });
    assert.deepEqual(summarizeTaskActuals(undefined), {
        actualMinutes: null, measuredSteps: 0, workedSteps: 0, isComplete: false,
    });
});

test('summarizeTaskActuals ignores an abandoned step but still counts it as worked', () => {
    const result = summarizeTaskActuals([
        step({ completedAt: after(25) }),
        step({ startedAt: after(100), completedAt: after(100 + 30 * 60) }), // 30h
    ]);
    assert.equal(result.actualMinutes, 25);
    assert.equal(result.workedSteps, 2);
    assert.equal(result.isComplete, false);
});
