/**
 * memory_agent/agent.test.js
 * Schema validation tests only — no network/Firestore/LLM calls.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import './schema.js'; // registers the schema
import { validateAgentOutput } from '../shared/validator.js';
import { computeAverageSpeedsFromHistory } from './agent.js';
import { DEFAULT_AVERAGE_SPEEDS } from '../shared/taskCategory.js';

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

// ── computeAverageSpeedsFromHistory (suggestions.md #24 prerequisite) ────────
// Real per-category average speeds, computed directly from task_history's
// taskPerformance[] entries — replaces a lookup that always silently
// returned undefined in production (see agent.js's doc comment on this
// function for why).
describe('computeAverageSpeedsFromHistory', () => {
  test('empty history returns exactly the defaults with zero sample counts', () => {
    const { averageSpeeds, sampleCounts } = computeAverageSpeedsFromHistory([]);
    assert.deepEqual(averageSpeeds, DEFAULT_AVERAGE_SPEEDS);
    assert.deepEqual(sampleCounts, {});
  });

  test('computes a real average for a category with enough completed samples', () => {
    const history = [
      { taskPerformance: [
        { title: 'Implement the login API', status: 'completed', actualMinutes: 50 },
        { title: 'Build the checkout flow', status: 'completed', actualMinutes: 70 },
      ] },
    ];
    const { averageSpeeds, sampleCounts } = computeAverageSpeedsFromHistory(history);
    assert.equal(averageSpeeds.coding, 60); // (50 + 70) / 2
    assert.equal(sampleCounts.coding, 2);
    // Untouched categories keep the default.
    assert.equal(averageSpeeds.writing, DEFAULT_AVERAGE_SPEEDS.writing);
  });

  test('a single sample is not enough to override the default', () => {
    const history = [
      { taskPerformance: [{ title: 'Implement the login API', status: 'completed', actualMinutes: 999 }] },
    ];
    const { averageSpeeds, sampleCounts } = computeAverageSpeedsFromHistory(history);
    assert.equal(averageSpeeds.coding, DEFAULT_AVERAGE_SPEEDS.coding);
    assert.equal(sampleCounts.coding, 1);
  });

  test('ignores incomplete tasks, missing/invalid actualMinutes, and unclassifiable titles', () => {
    const history = [
      { taskPerformance: [
        { title: 'Implement the login API', status: 'in_progress', actualMinutes: 50 },
        { title: 'Implement the signup API', status: 'completed', actualMinutes: null },
        { title: 'Implement the reset API', status: 'completed', actualMinutes: -5 },
        { title: 'zzz qqq xyz', status: 'completed', actualMinutes: 40 },
      ] },
    ];
    const { averageSpeeds, sampleCounts } = computeAverageSpeedsFromHistory(history);
    assert.equal(averageSpeeds.coding, DEFAULT_AVERAGE_SPEEDS.coding);
    assert.deepEqual(sampleCounts, {});
  });

  test('pools samples across multiple past projects', () => {
    const history = [
      { taskPerformance: [{ title: 'Debug the payment bug', status: 'completed', actualMinutes: 20 }] },
      { taskPerformance: [{ title: 'Fix bug in the parser', status: 'completed', actualMinutes: 30 }] },
    ];
    const { averageSpeeds, sampleCounts } = computeAverageSpeedsFromHistory(history);
    assert.equal(sampleCounts.debugging, 2);
    assert.equal(averageSpeeds.debugging, 25);
  });
});
