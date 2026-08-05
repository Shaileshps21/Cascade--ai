/**
 * prioritization_agent/agent.test.js
 * Tests the schema validator only — no live network/LLM calls.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import './schema.js';
import { validateAgentOutput } from '../shared/validator.js';
import { validatePrioritizationOutput } from './validator.js';

const AGENT_NAME = 'prioritization_agent';
const SCHEMA_VERSION = '1.0.0';

function buildValidOutput(overrides = {}) {
    return {
        schemaVersion: '1.0.0',
        priorityScore: 78,
        urgencyScore: 65,
        importanceScore: 82,
        riskScore: 40,
        businessValue: 70,
        projectImportance: 75,
        deadlineConfidence: 0.72,
        estimatedUncertainty: 35,
        expectedInterruptionScore: 30,
        personalizationInsights: ["User historically completes similar 'work' tasks on time"],
        recommendedStartTime: '2026-07-18T09:00:00.000Z',
        bufferHoursNeeded: 2,
        warningFlags: [],
        reasoning: {
            confidence: 0.82,
            summary: 'Deadline is comfortable and user has a strong track record.',
            assumptions: ['Memory profile reflects current work capacity'],
            warnings: [],
            promptVersion: 'v1.0.0',
        },
        ...overrides,
    };
}

describe('prioritization_agent schema validation', () => {
    test('accepts a fully valid output', () => {
        const output = buildValidOutput();
        const result = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        assert.equal(result.valid, true);
        assert.deepEqual(result.errors, []);
    });

    test('rejects output missing required score fields', () => {
        const output = buildValidOutput();
        delete output.priorityScore;
        const result = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('priorityScore')));
    });

    test('rejects riskScore out of 0-100 range', () => {
        const output = buildValidOutput({ riskScore: 150 });
        const result = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('riskScore')));
    });

    test('rejects negative scores', () => {
        const output = buildValidOutput({ urgencyScore: -5 });
        const result = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('urgencyScore')));
    });

    test('requires the new v3 fields (businessValue, projectImportance, etc.)', () => {
        const output = buildValidOutput();
        delete output.businessValue;
        delete output.projectImportance;
        delete output.deadlineConfidence;
        delete output.estimatedUncertainty;
        delete output.expectedInterruptionScore;

        const result = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        assert.equal(result.valid, false);
        for (const field of ['businessValue', 'projectImportance', 'deadlineConfidence', 'estimatedUncertainty', 'expectedInterruptionScore']) {
            assert.ok(result.errors.some((e) => e.includes(field)), `expected error mentioning ${field}`);
        }
    });

    test('deadlineConfidence must be within 0-1, not 0-100', () => {
        const output = buildValidOutput({ deadlineConfidence: 72 }); // looks like a 0-100 value by mistake
        const result = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('deadlineConfidence')));
    });

    test('warns (but does not fail) when personalizationInsights/warningFlags are missing', () => {
        const output = buildValidOutput();
        delete output.personalizationInsights;
        delete output.warningFlags;
        const result = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, output);
        assert.equal(result.valid, true);
        assert.ok(result.warnings.length >= 2);
    });

    test('errors when no schema is registered for an unknown version', () => {
        const result = validateAgentOutput(AGENT_NAME, '9.9.9', buildValidOutput());
        assert.equal(result.valid, false);
        assert.ok(result.errors[0].includes('No schema version'));
    });
});

describe('prioritization_agent validator.js cross-field checks', () => {
    test('flags contradictory high risk + high deadline confidence', () => {
        const output = buildValidOutput({ riskScore: 85, deadlineConfidence: 0.9 });
        const result = validatePrioritizationOutput(output);
        assert.equal(result.valid, true); // still valid, just a warning
        assert.ok(result.warnings.some((w) => w.includes('riskScore is high but deadlineConfidence')));
    });

    test('flags high uncertainty with zero buffer hours', () => {
        const output = buildValidOutput({ estimatedUncertainty: 80, bufferHoursNeeded: 0 });
        const result = validatePrioritizationOutput(output);
        assert.ok(result.warnings.some((w) => w.includes('estimatedUncertainty is high')));
    });

    test('flags priorityScore far below its drivers', () => {
        const output = buildValidOutput({ priorityScore: 10, urgencyScore: 90, importanceScore: 95 });
        const result = validatePrioritizationOutput(output);
        assert.ok(result.warnings.some((w) => w.includes('priorityScore is much lower')));
    });

    test('propagates base schema errors through validatePrioritizationOutput', () => {
        const output = buildValidOutput();
        delete output.riskScore;
        const result = validatePrioritizationOutput(output);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('riskScore')));
    });
});
