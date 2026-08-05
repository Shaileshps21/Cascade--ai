/**
 * prioritization_agent/schema.js
 * Schema v1.0.0 for the Prioritization Agent (refactored from prioritizationAgent.js).
 *
 * Preserves the original score fields (priorityScore, urgencyScore,
 * importanceScore, riskScore) — `riskScore` and `priorityScore` are read
 * directly by contextManager.js's toClientTask() so they MUST remain
 * numbers in the 0-100 range for client backward compatibility.
 *
 * Adds new fields: businessValue, projectImportance, deadlineConfidence,
 * estimatedUncertainty, expectedInterruptionScore.
 */

import { registerSchema, isNumberInRange, isIsoDate } from '../shared/validator.js';

function validatePrioritizationOutput(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['output must be an object'], warnings: [] };
    }

    // ── Preserved legacy score fields ──────────────────────────────────────────
    if (!isNumberInRange(data.priorityScore, 0, 100)) errors.push('priorityScore must be a number between 0 and 100');
    if (!isNumberInRange(data.urgencyScore, 0, 100)) errors.push('urgencyScore must be a number between 0 and 100');
    if (!isNumberInRange(data.importanceScore, 0, 100)) errors.push('importanceScore must be a number between 0 and 100');
    if (!isNumberInRange(data.riskScore, 0, 100)) errors.push('riskScore must be a number between 0 and 100');

    // ── New v3 fields ───────────────────────────────────────────────────────────
    if (!isNumberInRange(data.businessValue, 0, 100)) errors.push('businessValue must be a number between 0 and 100');
    if (!isNumberInRange(data.projectImportance, 0, 100)) errors.push('projectImportance must be a number between 0 and 100');
    if (!isNumberInRange(data.deadlineConfidence, 0, 1)) errors.push('deadlineConfidence must be a number between 0 and 1');
    if (!isNumberInRange(data.estimatedUncertainty, 0, 100)) errors.push('estimatedUncertainty must be a number between 0 and 100');
    if (!isNumberInRange(data.expectedInterruptionScore, 0, 100)) errors.push('expectedInterruptionScore must be a number between 0 and 100');

    // ── Supporting fields ────────────────────────────────────────────────────────
    // Note: `reasoning` (confidence/assumptions/warnings/promptVersion) is not
    // strictly validated here — agentRunner.js attaches a default reasoning
    // block if the LLM omits it, same convention as intent_context_agent.
    if (!Array.isArray(data.personalizationInsights)) warnings.push('personalizationInsights should be an array');
    if (!Array.isArray(data.warningFlags)) warnings.push('warningFlags should be an array');

    if (data.bufferHoursNeeded !== undefined && (typeof data.bufferHoursNeeded !== 'number' || data.bufferHoursNeeded < 0)) {
        warnings.push('bufferHoursNeeded should be a non-negative number');
    }

    if (data.recommendedStartTime !== undefined && data.recommendedStartTime !== null && !isIsoDate(data.recommendedStartTime)) {
        warnings.push('recommendedStartTime should be a valid ISO 8601 date string');
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('prioritization_agent', '1.0.0', validatePrioritizationOutput);

export { validatePrioritizationOutput };
