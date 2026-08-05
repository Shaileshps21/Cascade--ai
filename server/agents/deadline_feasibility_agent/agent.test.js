/**
 * deadline_feasibility_agent/agent.test.js
 * Unit tests for the deterministic parts of the Deadline Feasibility Agent:
 *   - computeAvailableMinutes() pure function
 *   - schema validation of the agent output shape
 *
 * No live LLM/network calls are made in this file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAvailableMinutes, MINUTES_PER_WORKDAY, MINUTES_PER_WEEKEND_DAY } from './agent.js';
import './schema.js'; // registers the schema
import { validateAgentOutput } from '../shared/validator.js';

// 2024-01-01 is a Monday — used as a fixed, known anchor for all date math below.
const MONDAY = '2024-01-01T00:00:00.000Z';
const TUESDAY = '2024-01-02T00:00:00.000Z';
const SATURDAY = '2024-01-06T00:00:00.000Z';
const NEXT_MONDAY = '2024-01-08T00:00:00.000Z';

test('computeAvailableMinutes: exactly one week (Mon 00:00 -> next Mon 00:00) counts 5 weekdays only', () => {
    const result = computeAvailableMinutes(MONDAY, NEXT_MONDAY);
    assert.equal(result, 5 * MINUTES_PER_WORKDAY);
});

test('computeAvailableMinutes: exactly one day (24h) spanning two weekdays equals one full workday capacity', () => {
    const from = '2024-01-01T09:00:00.000Z'; // Monday 9am
    const to = '2024-01-02T09:00:00.000Z';   // Tuesday 9am, exactly 24h later
    const result = computeAvailableMinutes(from, to);
    assert.equal(result, MINUTES_PER_WORKDAY);
});

test('computeAvailableMinutes: a range fully inside a weekend yields 0 minutes', () => {
    const result = computeAvailableMinutes(SATURDAY, NEXT_MONDAY); // Sat 00:00 -> Mon 00:00 (Sat+Sun)
    assert.equal(result, 2 * MINUTES_PER_WEEKEND_DAY);
    assert.equal(result, 0);
});

test('computeAvailableMinutes: deadline at or before "from" returns 0', () => {
    assert.equal(computeAvailableMinutes(MONDAY, MONDAY), 0);
    assert.equal(computeAvailableMinutes(TUESDAY, MONDAY), 0);
});

test('computeAvailableMinutes: invalid dates return 0 instead of throwing', () => {
    assert.equal(computeAvailableMinutes('not-a-date', NEXT_MONDAY), 0);
    assert.equal(computeAvailableMinutes(MONDAY, 'not-a-date'), 0);
});

test('computeAvailableMinutes: respects custom working-hours preferences override', () => {
    const result = computeAvailableMinutes(MONDAY, TUESDAY, { weekdayMinutes: 480, weekendMinutes: 0 });
    assert.equal(result, 480);
});

test('computeAvailableMinutes: never returns a negative number', () => {
    const result = computeAvailableMinutes(NEXT_MONDAY, MONDAY); // reversed range
    assert.ok(result >= 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema validation
// ─────────────────────────────────────────────────────────────────────────────

test('schema: a feasible output with reconciliationSuggestions=null is valid', () => {
    const output = {
        schemaVersion: '1.0.0',
        isFeasible: true,
        totalEffortMinutes: 500,
        availableMinutes: 1200,
        slackMinutes: 700,
        reconciliationSuggestions: null,
    };
    const result = validateAgentOutput('deadline_feasibility_agent', '1.0.0', output);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
});

test('schema: an infeasible output without reconciliationSuggestions is valid but produces a warning', () => {
    const output = {
        schemaVersion: '1.0.0',
        isFeasible: false,
        totalEffortMinutes: 2000,
        availableMinutes: 1200,
        slackMinutes: -800,
        reconciliationSuggestions: null,
    };
    const result = validateAgentOutput('deadline_feasibility_agent', '1.0.0', output);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
});

test('schema: a well-formed reconciliationSuggestions object is valid', () => {
    const output = {
        schemaVersion: '1.0.0',
        isFeasible: false,
        totalEffortMinutes: 2000,
        availableMinutes: 1200,
        slackMinutes: -800,
        reconciliationSuggestions: {
            suggestedDeadline: '2024-02-01T00:00:00.000Z',
            reducedScope: ['Defer polish tasks'],
            additionalWorkHoursNeeded: 13.3,
            priorityReductions: ['Lower priority of documentation tasks'],
        },
    };
    const result = validateAgentOutput('deadline_feasibility_agent', '1.0.0', output);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
});

test('schema: missing required numeric fields is invalid', () => {
    const output = {
        schemaVersion: '1.0.0',
        isFeasible: true,
        // totalEffortMinutes missing
        availableMinutes: 1200,
        slackMinutes: 1200,
        reconciliationSuggestions: null,
    };
    const result = validateAgentOutput('deadline_feasibility_agent', '1.0.0', output);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('totalEffortMinutes')));
});

test('schema: malformed reconciliationSuggestions is invalid', () => {
    const output = {
        schemaVersion: '1.0.0',
        isFeasible: false,
        totalEffortMinutes: 2000,
        availableMinutes: 1200,
        slackMinutes: -800,
        reconciliationSuggestions: {
            suggestedDeadline: 'not-a-real-date',
            reducedScope: 'should be an array, not a string',
            additionalWorkHoursNeeded: null,
            priorityReductions: [],
        },
    };
    const result = validateAgentOutput('deadline_feasibility_agent', '1.0.0', output);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
});
