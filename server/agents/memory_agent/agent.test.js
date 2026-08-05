/**
 * memory_agent/agent.test.js
 * Schema validation tests only — no network/Firestore/LLM calls.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import './schema.js'; // registers the schema
import { validateAgentOutput } from '../shared/validator.js';

function validMemory(overrides = {}) {
  return {
    similarProjects: [],
    averageSuccessRate: 0.75,
    commonFailures: ['Underestimating complexity'],
    bestWorkflowModules: ['Research', 'Design', 'Implementation', 'Testing'],
    averageSpeeds: { coding: 30, writing: 45, research: 60, reading: 40, design: 50, debugging: 35, revision: 25 },
    optimalWorkHours: [9, 10, 14, 15],
    reliabilityScore: 0.7,
    ...overrides,
  };
}

describe('memory_agent schema', () => {
  test('valid memory output passes', () => {
    const result = validateAgentOutput('memory_agent', '1.0.0', validMemory());
    assert.equal(result.valid, true);
  });

  test('non-array similarProjects produces a warning', () => {
    const data = validMemory({ similarProjects: 'nope' });
    const result = validateAgentOutput('memory_agent', '1.0.0', data);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes('similarProjects')));
  });

  test('non-object averageSpeeds fails', () => {
    const data = validMemory({ averageSpeeds: 'nope' });
    const result = validateAgentOutput('memory_agent', '1.0.0', data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('averageSpeeds')));
  });

  test('reliabilityScore out of range produces a warning', () => {
    const data = validMemory({ reliabilityScore: 1.5 });
    const result = validateAgentOutput('memory_agent', '1.0.0', data);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes('reliabilityScore')));
  });

  test('missing averageSuccessRate produces a warning', () => {
    const data = validMemory();
    delete data.averageSuccessRate;
    const result = validateAgentOutput('memory_agent', '1.0.0', data);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes('averageSuccessRate')));
  });
});
