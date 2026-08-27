/**
 * time_estimation_agent/agent.test.js
 * Unit tests — no live LLM/network calls.
 *
 *  - applyEstimationConstraints(): clamps ordering violations, recomputes
 *    missing finalEstimateMinutes.
 *  - schema validator: valid/invalid cases, including the hard ordering
 *    constraint (optimistic <= expected <= worstCase).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEstimationConstraints, applyHistoricalCalibration, LLM_ESTIMATE_WEIGHT, HISTORICAL_CALIBRATION_WEIGHT } from './agent.js';
import './schema.js'; // registers the schema
import { validateAgentOutput } from '../shared/validator.js';

function validEntry(overrides = {}) {
    return {
        taskId: 'T1',
        baseEstimateMinutes: 60,
        historicalAdjustmentPct: 40,
        complexityAdjustmentPct: 20,
        confidenceAdjustmentPct: -10,
        riskAdjustmentPct: 15,
        finalEstimateMinutes: 109,
        optimisticMinutes: 45,
        expectedMinutes: 90,
        worstCaseMinutes: 150,
        difficulty: 'medium',
        confidence: 0.75,
        riskFactors: ['dependency risk'],
        similarTasksFound: true,
        adjustmentReason: 'Historical bias observed for this skill type.',
        ...overrides,
    };
}

test('applyEstimationConstraints: leaves a valid entry untouched', () => {
    const entry = validEntry();
    const [result] = applyEstimationConstraints([entry]);
    assert.equal(result.optimisticMinutes, 45);
    assert.equal(result.expectedMinutes, 90);
    assert.equal(result.worstCaseMinutes, 150);
    assert.equal(result.finalEstimateMinutes, 109);
});

test('applyEstimationConstraints: clamps optimisticMinutes > expectedMinutes', () => {
    const entry = validEntry({ optimisticMinutes: 120, expectedMinutes: 90, worstCaseMinutes: 150 });
    const [result] = applyEstimationConstraints([entry]);
    assert.ok(result.optimisticMinutes <= result.expectedMinutes);
    assert.equal(result.optimisticMinutes, 90);
    assert.equal(result.expectedMinutes, 90);
    assert.equal(result.worstCaseMinutes, 150);
});

test('applyEstimationConstraints: clamps worstCaseMinutes < expectedMinutes', () => {
    const entry = validEntry({ optimisticMinutes: 45, expectedMinutes: 90, worstCaseMinutes: 60 });
    const [result] = applyEstimationConstraints([entry]);
    assert.ok(result.expectedMinutes <= result.worstCaseMinutes);
    assert.equal(result.worstCaseMinutes, 90);
    assert.equal(result.optimisticMinutes, 45);
});

test('applyEstimationConstraints: clamps both bounds when both violate', () => {
    const entry = validEntry({ optimisticMinutes: 200, expectedMinutes: 90, worstCaseMinutes: 10 });
    const [result] = applyEstimationConstraints([entry]);
    assert.ok(result.optimisticMinutes <= result.expectedMinutes);
    assert.ok(result.expectedMinutes <= result.worstCaseMinutes);
    assert.equal(result.optimisticMinutes, 90);
    assert.equal(result.worstCaseMinutes, 90);
});

test('applyEstimationConstraints: recomputes missing finalEstimateMinutes', () => {
    const entry = validEntry({ finalEstimateMinutes: undefined });
    const [result] = applyEstimationConstraints([entry]);
    // 60 * (1 + (40+20-10+15)/100) = 60 * 1.65 = 99
    assert.equal(result.finalEstimateMinutes, 99);
});

test('applyEstimationConstraints: recomputes non-finite finalEstimateMinutes (NaN)', () => {
    const entry = validEntry({ finalEstimateMinutes: NaN });
    const [result] = applyEstimationConstraints([entry]);
    assert.equal(result.finalEstimateMinutes, 99);
});

test('applyEstimationConstraints: backfills missing three-point fields from finalEstimateMinutes', () => {
    const entry = {
        taskId: 'T2',
        baseEstimateMinutes: 60,
        historicalAdjustmentPct: 0,
        complexityAdjustmentPct: 0,
        confidenceAdjustmentPct: 0,
        riskAdjustmentPct: 0,
        finalEstimateMinutes: 60,
        difficulty: 'low',
        confidence: 0.5,
        riskFactors: [],
        similarTasksFound: false,
        adjustmentReason: 'No historical data available.',
    };
    const [result] = applyEstimationConstraints([entry]);
    assert.equal(result.expectedMinutes, 60);
    assert.equal(result.optimisticMinutes, 60);
    assert.equal(result.worstCaseMinutes, 60);
});

test('applyEstimationConstraints: handles non-array input gracefully', () => {
    assert.deepEqual(applyEstimationConstraints(null), []);
    assert.deepEqual(applyEstimationConstraints(undefined), []);
    assert.deepEqual(applyEstimationConstraints('nope'), []);
});

test('applyEstimationConstraints: does not mutate the input array/objects', () => {
    const entry = validEntry({ optimisticMinutes: 200 });
    const original = { ...entry };
    applyEstimationConstraints([entry]);
    assert.deepEqual(entry, original);
});

// ── applyHistoricalCalibration (suggestions.md #24) ─────────────────────────

function makeTask(overrides = {}) {
    return { taskId: 'T1', title: 'Implement the login API', requiredSkills: [], ...overrides };
}

test('applyHistoricalCalibration: no-op when memory has no averageSpeeds data', () => {
    const estimations = [validEntry({ finalEstimateMinutes: 100 })];
    const result = applyHistoricalCalibration(estimations, [makeTask()], null);
    assert.deepEqual(result, estimations);
});

test('applyHistoricalCalibration: no-op when the category has too few samples (still on the default)', () => {
    const estimations = [validEntry({ finalEstimateMinutes: 100 })];
    const memory = {
        averageSpeeds: { coding: 45 }, // differs from the default (30) but...
        averageSpeedSampleCounts: { coding: 1 }, // ...only 1 sample, below MIN_SAMPLES_PER_CATEGORY
    };
    const result = applyHistoricalCalibration(estimations, [makeTask()], memory);
    assert.equal(result[0].finalEstimateMinutes, 100);
    assert.equal(result[0].historicalCalibration, undefined);
});

test('applyHistoricalCalibration: no-op when the task title matches no known category', () => {
    const estimations = [validEntry({ finalEstimateMinutes: 100 })];
    const memory = { averageSpeeds: { coding: 60 }, averageSpeedSampleCounts: { coding: 5 } };
    const result = applyHistoricalCalibration(estimations, [makeTask({ title: 'xyz zzz qqq' })], memory);
    assert.equal(result[0].finalEstimateMinutes, 100);
});

test('applyHistoricalCalibration: blends toward a slower-than-default historical pace', () => {
    // Default coding speed is 30 min; this user's real average is 60 min
    // (2x slower) with plenty of samples.
    const estimations = [validEntry({
        finalEstimateMinutes: 100, expectedMinutes: 100, optimisticMinutes: 50, worstCaseMinutes: 150,
    })];
    const memory = { averageSpeeds: { coding: 60 }, averageSpeedSampleCounts: { coding: 5 } };
    const [result] = applyHistoricalCalibration(estimations, [makeTask({ title: 'Implement the login API' })], memory);

    const paceRatio = 60 / 30; // 2
    const expectedFinal = Math.round(LLM_ESTIMATE_WEIGHT * 100 + HISTORICAL_CALIBRATION_WEIGHT * (100 * paceRatio));
    assert.equal(result.finalEstimateMinutes, expectedFinal);
    assert.ok(result.finalEstimateMinutes > 100, 'a 2x-slower historical pace should raise the estimate');
    assert.equal(result.historicalCalibration.category, 'coding');
    assert.equal(result.historicalCalibration.paceRatio, 2);

    // Three-point ordering must still hold after scaling.
    assert.ok(result.optimisticMinutes <= result.expectedMinutes);
    assert.ok(result.expectedMinutes <= result.worstCaseMinutes);
});

test('applyHistoricalCalibration: blends toward a faster-than-default historical pace', () => {
    // This user's real debugging average is 17.5 min vs. the 35 min default — twice as fast.
    const estimations = [validEntry({ taskId: 'T2', finalEstimateMinutes: 40 })];
    const memory = { averageSpeeds: { debugging: 17.5 }, averageSpeedSampleCounts: { debugging: 4 } };
    const [result] = applyHistoricalCalibration(estimations, [makeTask({ taskId: 'T2', title: 'Debug the checkout bug' })], memory);

    assert.ok(result.finalEstimateMinutes < 40, 'a faster historical pace should lower the estimate');
    assert.equal(result.historicalCalibration.paceRatio, 0.5);
});

// ── Schema validation ───────────────────────────────────────────────────────

test('schema: valid estimations array passes validation', () => {
    const data = { estimations: [validEntry()] };
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', data);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
});

test('schema: empty estimations array fails validation', () => {
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', { estimations: [] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('non-empty array')));
});

test('schema: missing estimations field fails validation', () => {
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', {});
    assert.equal(result.valid, false);
});

test('schema: entry violating optimistic <= expected <= worstCase fails validation', () => {
    const badEntry = validEntry({ optimisticMinutes: 200, expectedMinutes: 90, worstCaseMinutes: 150 });
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', { estimations: [badEntry] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('violates ordering constraint')));
});

test('schema: entry with invalid difficulty enum fails validation', () => {
    const badEntry = validEntry({ difficulty: 'impossible' });
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', { estimations: [badEntry] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('difficulty')));
});

test('schema: entry with out-of-range confidence fails validation', () => {
    const badEntry = validEntry({ confidence: 1.5 });
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', { estimations: [badEntry] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('confidence')));
});

test('schema: entry missing required numeric field fails validation', () => {
    const badEntry = validEntry();
    delete badEntry.baseEstimateMinutes;
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', { estimations: [badEntry] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('baseEstimateMinutes')));
});

test('schema: valid entry produced after applyEstimationConstraints passes validation', () => {
    const violating = validEntry({ optimisticMinutes: 999, worstCaseMinutes: 1 });
    const [fixed] = applyEstimationConstraints([violating]);
    const result = validateAgentOutput('time_estimation_agent', '1.0.0', { estimations: [fixed] });
    assert.equal(result.valid, true);
});
