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

import { applyEstimationConstraints } from './agent.js';
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
