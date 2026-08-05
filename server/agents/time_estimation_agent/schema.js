/**
 * time_estimation_agent/schema.js
 * Schema v1.0.0 for the Time Estimation Agent output.
 *
 * Validates:
 *  - `estimations` is a non-empty array
 *  - each entry has the required numeric/string/enum fields
 *  - the ordering constraint: optimisticMinutes <= expectedMinutes <= worstCaseMinutes
 */

import { registerSchema, isNonEmptyString, isEnum, isNumberInRange, isNonEmptyArray } from '../shared/validator.js';

const DIFFICULTIES = ['low', 'medium', 'high', 'very_high'];

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate a single estimation entry.
 * @param {object} entry
 * @param {number} index
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEstimationEntry(entry, index = 0) {
    const errors = [];
    const warnings = [];
    const prefix = `estimations[${index}]`;

    if (!entry || typeof entry !== 'object') {
        errors.push(`${prefix} must be an object`);
        return { errors, warnings };
    }

    if (!isNonEmptyString(entry.taskId)) errors.push(`${prefix}.taskId must be a non-empty string`);

    for (const field of [
        'baseEstimateMinutes',
        'historicalAdjustmentPct',
        'complexityAdjustmentPct',
        'confidenceAdjustmentPct',
        'riskAdjustmentPct',
        'finalEstimateMinutes',
        'optimisticMinutes',
        'expectedMinutes',
        'worstCaseMinutes',
    ]) {
        if (!isFiniteNumber(entry[field])) errors.push(`${prefix}.${field} must be a finite number`);
    }

    if (!isEnum(entry.difficulty, DIFFICULTIES)) {
        errors.push(`${prefix}.difficulty must be one of: ${DIFFICULTIES.join(', ')}`);
    }

    if (!isNumberInRange(entry.confidence, 0, 1)) {
        errors.push(`${prefix}.confidence must be a number between 0 and 1`);
    }

    if (!Array.isArray(entry.riskFactors)) warnings.push(`${prefix}.riskFactors should be an array`);
    if (typeof entry.similarTasksFound !== 'boolean') warnings.push(`${prefix}.similarTasksFound should be a boolean`);
    if (!isNonEmptyString(entry.adjustmentReason)) warnings.push(`${prefix}.adjustmentReason should be a non-empty string`);

    // Hard ordering constraint
    if (
        isFiniteNumber(entry.optimisticMinutes) &&
        isFiniteNumber(entry.expectedMinutes) &&
        isFiniteNumber(entry.worstCaseMinutes)
    ) {
        if (!(entry.optimisticMinutes <= entry.expectedMinutes && entry.expectedMinutes <= entry.worstCaseMinutes)) {
            errors.push(
                `${prefix} violates ordering constraint: optimisticMinutes (${entry.optimisticMinutes}) <= expectedMinutes (${entry.expectedMinutes}) <= worstCaseMinutes (${entry.worstCaseMinutes})`
            );
        }
    }

    return { errors, warnings };
}

function validateTimeEstimationOutput(data) {
    const errors = [];
    const warnings = [];

    if (!isNonEmptyArray(data?.estimations)) {
        errors.push('estimations must be a non-empty array');
        return { valid: false, errors, warnings };
    }

    data.estimations.forEach((entry, index) => {
        const result = validateEstimationEntry(entry, index);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
    });

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('time_estimation_agent', '1.0.0', validateTimeEstimationOutput);

export { DIFFICULTIES, validateTimeEstimationOutput };
