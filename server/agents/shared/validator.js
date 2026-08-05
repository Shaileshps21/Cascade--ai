/**
 * shared/validator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic JSON schema validator used by all 15 agents.
 * Schemas are registered at module import time by each agent's schema.js.
 * Validates agent outputs and reasoning blocks before writing to PlanningContext.
 */

// Registry: { [agentName]: { [version]: schemaFn } }
const schemaRegistry = new Map();

/**
 * Register a JSON schema validator for an agent.
 * @param {string} agentName  - e.g. 'planning', 'scheduler'
 * @param {string} version    - e.g. '1.0.0'
 * @param {function} schemaFn - (data) => { valid: boolean, errors: string[], warnings: string[] }
 */
export function registerSchema(agentName, version, schemaFn) {
  if (!schemaRegistry.has(agentName)) {
    schemaRegistry.set(agentName, new Map());
  }
  schemaRegistry.get(agentName).set(version, schemaFn);
}

/**
 * Validate agent output against its registered schema.
 * @param {string} agentName
 * @param {string} schemaVersion
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateAgentOutput(agentName, schemaVersion, data) {
  const agentSchemas = schemaRegistry.get(agentName);
  if (!agentSchemas) {
    return { valid: false, errors: [`No schema registered for agent: ${agentName}`], warnings: [] };
  }
  const schemaFn = agentSchemas.get(schemaVersion);
  if (!schemaFn) {
    return { valid: false, errors: [`No schema version ${schemaVersion} for agent: ${agentName}`], warnings: [] };
  }

  try {
    return schemaFn(data);
  } catch (err) {
    return { valid: false, errors: [`Schema validation threw: ${err.message}`], warnings: [] };
  }
}

/**
 * Validate the reasoning block every agent must include in its output.
 * @param {object} reasoning
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateReasoningBlock(reasoning) {
  const errors = [];
  const warnings = [];

  if (!reasoning || typeof reasoning !== 'object') {
    errors.push('reasoning block is required and must be an object');
    return { valid: false, errors, warnings };
  }

  if (typeof reasoning.confidence !== 'number' || reasoning.confidence < 0 || reasoning.confidence > 1) {
    errors.push('reasoning.confidence must be a number between 0 and 1');
  }

  if (!Array.isArray(reasoning.assumptions)) {
    warnings.push('reasoning.assumptions should be an array of strings');
  }

  if (!Array.isArray(reasoning.warnings)) {
    warnings.push('reasoning.warnings should be an array of strings');
  }

  if (!reasoning.promptVersion || typeof reasoning.promptVersion !== 'string') {
    warnings.push('reasoning.promptVersion should be a non-empty string (e.g. "v1.0.0")');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Built-in type helpers used by agent schema functions ─────────────────────

/** Returns true if value is a non-empty string */
export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Returns true if value is a number in [min, max] */
export function isNumberInRange(v, min, max) {
  return typeof v === 'number' && !Number.isNaN(v) && v >= min && v <= max;
}

/** Returns true if value is an array with at least minItems elements */
export function isNonEmptyArray(v, minItems = 1) {
  return Array.isArray(v) && v.length >= minItems;
}

/** Returns true if value is one of the allowed enum values */
export function isEnum(v, allowed) {
  return allowed.includes(v);
}

/** Returns true if value is a valid ISO 8601 date string */
export function isIsoDate(v) {
  if (typeof v !== 'string') return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}
