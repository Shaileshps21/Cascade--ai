/**
 * scheduler_agent/schema.js
 * Schema v1.0.0 for the Scheduler Agent output.
 *
 * Shape:
 * {
 *   "schemaVersion": "1.0.0",
 *   "scheduledTasks": [{
 *     taskId, taskName, startTime, endTime, estimatedDuration, adjustedDuration,
 *     adjustmentReason, priority, energyLevel, isBuffer, isReview, isDeepWork,
 *     dependencies, confidence
 *   }],
 *   "bufferSlots": [{ startTime, endTime, durationMinutes }],
 *   "schedulingScore": 88,
 *   "confidenceScore": 85,
 *   "warnings": [],
 *   "recommendations": [],
 *   "isFeasible": true,
 *   "failureConditions": null
 * }
 *
 * When `isFeasible` is false, `scheduledTasks`/`bufferSlots` are not required —
 * `failureConditions` must instead be a fully populated object.
 */

import { registerSchema, isNonEmptyString, isNumberInRange, isIsoDate, isEnum } from '../shared/validator.js';

const ENERGY_LEVELS = ['high', 'medium', 'low'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

function validateScheduledTask(t, idx, errors) {
    const prefix = `scheduledTasks[${idx}]`;
    if (!isNonEmptyString(t?.taskId)) errors.push(`${prefix}.taskId must be a non-empty string`);
    if (!isNonEmptyString(t?.taskName)) errors.push(`${prefix}.taskName must be a non-empty string`);
    if (!isIsoDate(t?.startTime)) errors.push(`${prefix}.startTime must be a valid ISO 8601 date string`);
    if (!isIsoDate(t?.endTime)) errors.push(`${prefix}.endTime must be a valid ISO 8601 date string`);
    if (isIsoDate(t?.startTime) && isIsoDate(t?.endTime) && new Date(t.startTime).getTime() >= new Date(t.endTime).getTime()) {
        errors.push(`${prefix}: startTime must be strictly before endTime`);
    }
    if (typeof t?.estimatedDuration !== 'number' || t.estimatedDuration < 0) {
        errors.push(`${prefix}.estimatedDuration must be a non-negative number`);
    }
    if (typeof t?.adjustedDuration !== 'number' || t.adjustedDuration < 0) {
        errors.push(`${prefix}.adjustedDuration must be a non-negative number`);
    }
    if (t?.priority !== undefined && t?.priority !== null && !isEnum(t.priority, PRIORITIES)) {
        errors.push(`${prefix}.priority must be one of: ${PRIORITIES.join(', ')}`);
    }
    if (t?.energyLevel !== undefined && t?.energyLevel !== null && !isEnum(t.energyLevel, ENERGY_LEVELS)) {
        errors.push(`${prefix}.energyLevel must be one of: ${ENERGY_LEVELS.join(', ')}`);
    }
    if (!Array.isArray(t?.dependencies)) errors.push(`${prefix}.dependencies must be an array`);
    if (typeof t?.confidence !== 'number' || t.confidence < 0 || t.confidence > 1) {
        errors.push(`${prefix}.confidence must be a number between 0 and 1`);
    }
}

function validateFailureConditions(fc, errors) {
    if (!fc || typeof fc !== 'object') {
        errors.push('failureConditions must be an object when isFeasible is false');
        return;
    }
    if (typeof fc.requiredAdditionalHours !== 'number') {
        errors.push('failureConditions.requiredAdditionalHours must be a number');
    }
    if (!isIsoDate(fc.suggestedDeadline)) {
        errors.push('failureConditions.suggestedDeadline must be a valid ISO 8601 date string');
    }
    if (!Array.isArray(fc.tasksToDefer)) {
        errors.push('failureConditions.tasksToDefer must be an array');
    }
    if (typeof fc.completionProbability !== 'number' || fc.completionProbability < 0 || fc.completionProbability > 1) {
        errors.push('failureConditions.completionProbability must be a number between 0 and 1');
    }
    if (!isNonEmptyString(fc.reasoning)) {
        errors.push('failureConditions.reasoning must be a non-empty string');
    }
}

function validateSchedulerOutput(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['output must be an object'], warnings };
    }

    if (typeof data.isFeasible !== 'boolean') {
        errors.push('isFeasible must be a boolean');
    }

    if (data.isFeasible === false) {
        validateFailureConditions(data.failureConditions, errors);
        if (data.scheduledTasks !== undefined && !Array.isArray(data.scheduledTasks)) {
            errors.push('scheduledTasks must be an array when present');
        }
    } else {
        if (!Array.isArray(data.scheduledTasks)) {
            errors.push('scheduledTasks must be an array');
        } else {
            data.scheduledTasks.forEach((t, i) => validateScheduledTask(t, i, errors));
        }
        if (!Array.isArray(data.bufferSlots)) {
            warnings.push('bufferSlots should be an array');
        }
        if (data.failureConditions !== null && data.failureConditions !== undefined) {
            warnings.push('failureConditions should be null when isFeasible is true');
        }
    }

    if (!isNumberInRange(data.schedulingScore, 0, 100)) errors.push('schedulingScore must be a number between 0 and 100');
    if (!isNumberInRange(data.confidenceScore, 0, 100)) errors.push('confidenceScore must be a number between 0 and 100');
    if (!Array.isArray(data.warnings)) warnings.push('warnings should be an array');
    if (!Array.isArray(data.recommendations)) warnings.push('recommendations should be an array');

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('scheduler_agent', '1.0.0', validateSchedulerOutput);

export { validateSchedulerOutput, ENERGY_LEVELS, PRIORITIES };
