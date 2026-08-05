/**
 * deadline_feasibility_agent/schema.js
 * Schema v1.0.0 for the Deadline Feasibility Agent output.
 *
 * Shape:
 * {
 *   isFeasible: boolean,
 *   totalEffortMinutes: number,
 *   availableMinutes: number,
 *   slackMinutes: number,
 *   reconciliationSuggestions: null | {
 *     suggestedDeadline: string|null,
 *     reducedScope: string[],
 *     additionalWorkHoursNeeded: number|null,
 *     priorityReductions: string[],
 *   }
 * }
 */

import { registerSchema } from '../shared/validator.js';

function isIsoDateString(v) {
    if (typeof v !== 'string') return false;
    const d = new Date(v);
    return !Number.isNaN(d.getTime());
}

function validateReconciliationSuggestions(data) {
    const errors = [];

    if (data.suggestedDeadline !== null && !isIsoDateString(data.suggestedDeadline)) {
        errors.push('reconciliationSuggestions.suggestedDeadline must be a valid ISO date string or null');
    }
    if (!Array.isArray(data.reducedScope)) {
        errors.push('reconciliationSuggestions.reducedScope must be an array');
    }
    if (data.additionalWorkHoursNeeded !== null && typeof data.additionalWorkHoursNeeded !== 'number') {
        errors.push('reconciliationSuggestions.additionalWorkHoursNeeded must be a number or null');
    }
    if (!Array.isArray(data.priorityReductions)) {
        errors.push('reconciliationSuggestions.priorityReductions must be an array');
    }

    return errors;
}

function validateFeasibilityOutput(data) {
    const errors = [];
    const warnings = [];

    if (typeof data?.isFeasible !== 'boolean') {
        errors.push('isFeasible must be a boolean');
    }
    if (typeof data?.totalEffortMinutes !== 'number' || Number.isNaN(data.totalEffortMinutes) || data.totalEffortMinutes < 0) {
        errors.push('totalEffortMinutes must be a non-negative number');
    }
    if (typeof data?.availableMinutes !== 'number' || Number.isNaN(data.availableMinutes) || data.availableMinutes < 0) {
        errors.push('availableMinutes must be a non-negative number');
    }
    if (typeof data?.slackMinutes !== 'number' || Number.isNaN(data.slackMinutes)) {
        errors.push('slackMinutes must be a number');
    }

    if (data?.reconciliationSuggestions === null || data?.reconciliationSuggestions === undefined) {
        if (data?.isFeasible === false) {
            warnings.push('reconciliationSuggestions should be present when isFeasible is false');
        }
    } else if (typeof data.reconciliationSuggestions !== 'object') {
        errors.push('reconciliationSuggestions must be an object or null');
    } else {
        errors.push(...validateReconciliationSuggestions(data.reconciliationSuggestions));
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('deadline_feasibility_agent', '1.0.0', validateFeasibilityOutput);

export { validateFeasibilityOutput };
