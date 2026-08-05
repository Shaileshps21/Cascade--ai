/**
 * intent_context_agent/agent.test.js
 * Schema validation tests only — no network/LLM calls.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import './schema.js'; // registers the schema
import { validateAgentOutput } from '../shared/validator.js';

const FUTURE_ISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function validIntent(overrides = {}) {
  return {
    title: 'Build REST API',
    deadline: FUTURE_ISO,
    category: 'work',
    complexity: 'high',
    urgency: 'High',
    estimatedHours: 40,
    userConstraints: [],
    assumptions: [],
    preferences: [],
    scope: 'Backend only.',
    ...overrides,
  };
}

describe('intent_context_agent schema', () => {
  test('valid intent passes', () => {
    const result = validateAgentOutput('intent_context_agent', '1.0.0', validIntent());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test('missing title fails', () => {
    const data = validIntent({ title: '' });
    const result = validateAgentOutput('intent_context_agent', '1.0.0', data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('title')));
  });

  test('past deadline fails', () => {
    const data = validIntent({ deadline: PAST_ISO });
    const result = validateAgentOutput('intent_context_agent', '1.0.0', data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('future')));
  });

  test('invalid category fails', () => {
    const data = validIntent({ category: 'not-a-category' });
    const result = validateAgentOutput('intent_context_agent', '1.0.0', data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('category')));
  });

  test('invalid complexity fails', () => {
    const data = validIntent({ complexity: 'extreme' });
    const result = validateAgentOutput('intent_context_agent', '1.0.0', data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('complexity')));
  });

  test('invalid urgency fails', () => {
    const data = validIntent({ urgency: 'urgent' });
    const result = validateAgentOutput('intent_context_agent', '1.0.0', data);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('urgency')));
  });

  test('missing arrays produce warnings, not errors', () => {
    const data = validIntent();
    delete data.userConstraints;
    delete data.assumptions;
    delete data.preferences;
    const result = validateAgentOutput('intent_context_agent', '1.0.0', data);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length >= 3);
  });

  test('unregistered schema version fails cleanly', () => {
    const result = validateAgentOutput('intent_context_agent', '9.9.9', validIntent());
    assert.equal(result.valid, false);
  });
});
