/**
 * prioritization_agent/validator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Structural checks beyond the plain schema.js field-range validation.
 *
 * schema.js registers the version used by agentRunner's `validateAgentOutput`
 * call. This module re-exposes that same validation for direct use (e.g. in
 * tests or other agents) and layers on a few cross-field sanity checks that
 * don't belong in the raw schema (internal consistency between scores rather
 * than single-field bounds).
 */

import './schema.js';
import { validateAgentOutput } from '../shared/validator.js';
import { validatePrioritizationOutput as validateSchema } from './schema.js';

const AGENT_NAME = 'prioritization_agent';
const SCHEMA_VERSION = '1.0.0';

/**
 * Validate a Prioritization Agent output, combining the registered schema
 * check with additional cross-field consistency warnings.
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePrioritizationOutput(data) {
    const base = validateSchema(data);
    const errors = [...base.errors];
    const warnings = [...base.warnings];

    if (data && typeof data === 'object') {
        // Internal consistency: a high riskScore alongside a high deadlineConfidence
        // is contradictory — flag it rather than reject it.
        if (
            typeof data.riskScore === 'number' &&
            typeof data.deadlineConfidence === 'number' &&
            data.riskScore >= 70 &&
            data.deadlineConfidence >= 0.7
        ) {
            warnings.push('riskScore is high but deadlineConfidence is also high — scores may be inconsistent');
        }

        // If estimatedUncertainty is very high, bufferHoursNeeded of 0 is suspicious.
        if (
            typeof data.estimatedUncertainty === 'number' &&
            data.estimatedUncertainty >= 70 &&
            (data.bufferHoursNeeded === undefined || data.bufferHoursNeeded === 0)
        ) {
            warnings.push('estimatedUncertainty is high but no bufferHoursNeeded was reserved');
        }

        // priorityScore should not be dramatically lower than both urgency and importance.
        if (
            typeof data.priorityScore === 'number' &&
            typeof data.urgencyScore === 'number' &&
            typeof data.importanceScore === 'number'
        ) {
            const maxDriver = Math.max(data.urgencyScore, data.importanceScore);
            if (maxDriver - data.priorityScore > 40) {
                warnings.push('priorityScore is much lower than urgencyScore/importanceScore — verify weighting');
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Thin passthrough to the generic registry-based validator, for callers that
 * want the exact same path agentRunner.js uses.
 * @param {object} data
 */
export function validateViaRegistry(data) {
    return validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, data);
}
