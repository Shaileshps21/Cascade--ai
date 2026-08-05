/**
 * progress_tracking_agent/schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Schema v1.0.0 for the Progress Tracking Agent's per-task-check result.
 *
 * "taskId" here is the Firestore `tasks/{taskId}` document id (the whole
 * project), matching the id used by the legacy `monitorAgent.js`'s
 * `checkSingleTask(taskId, userId)` — NOT a leaf task inside
 * `context.planning.tasks[]`.
 *
 * Shape:
 * {
 *   taskId: string,
 *   status: 'not_started' | 'in_progress' | 'completed' | 'overdue' | 'at_risk',
 *   riskScore: number (0-100),
 *   escalate: boolean,
 *   dailyCompletionRates: [{ date: 'YYYY-MM-DD', count: number }],   // trailing 7 days
 *   productivityTrend: { slope: number, label: 'improving'|'declining'|'stable' },
 *   delayProbability: number (0-1),
 *   focusMinutesLast7Days: number (>=0),
 * }
 *
 * Extra (non-validated, additive) fields the agent also attaches:
 *   taskPerformance: [{ taskId, title, estimatedMinutes, actualMinutes, status, deltaMinutes }]
 *   replanTriggered / newRiskScore — backward-compat aliases for legacy callers
 */

import { registerSchema, isNonEmptyString, isNumberInRange, isEnum, isNonEmptyArray } from '../shared/validator.js';

const STATUS_ENUM = ['not_started', 'in_progress', 'completed', 'overdue', 'at_risk'];
const TREND_LABEL_ENUM = ['improving', 'declining', 'stable'];

function validateDailyCompletionRates(entries) {
    const errors = [];
    if (!Array.isArray(entries)) {
        errors.push('dailyCompletionRates must be an array');
        return errors;
    }
    entries.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') {
            errors.push(`dailyCompletionRates[${i}] must be an object`);
            return;
        }
        if (!isNonEmptyString(entry.date)) {
            errors.push(`dailyCompletionRates[${i}].date must be a non-empty string`);
        }
        if (typeof entry.count !== 'number' || Number.isNaN(entry.count) || entry.count < 0) {
            errors.push(`dailyCompletionRates[${i}].count must be a non-negative number`);
        }
    });
    return errors;
}

function validateProductivityTrend(trend) {
    const errors = [];
    if (!trend || typeof trend !== 'object') {
        errors.push('productivityTrend must be an object');
        return errors;
    }
    if (typeof trend.slope !== 'number' || Number.isNaN(trend.slope)) {
        errors.push('productivityTrend.slope must be a number');
    }
    if (!isEnum(trend.label, TREND_LABEL_ENUM)) {
        errors.push(`productivityTrend.label must be one of ${TREND_LABEL_ENUM.join(', ')}`);
    }
    return errors;
}

function validateProgressTrackingOutput(data) {
    const errors = [];
    const warnings = [];

    if (!isNonEmptyString(data?.taskId)) {
        errors.push('taskId must be a non-empty string');
    }
    if (!isEnum(data?.status, STATUS_ENUM)) {
        errors.push(`status must be one of ${STATUS_ENUM.join(', ')}`);
    }
    if (!isNumberInRange(data?.riskScore, 0, 100)) {
        errors.push('riskScore must be a number between 0 and 100');
    }
    if (typeof data?.escalate !== 'boolean') {
        errors.push('escalate must be a boolean');
    }
    if (!isNonEmptyArray(data?.dailyCompletionRates, 1)) {
        errors.push('dailyCompletionRates must be a non-empty array');
    } else {
        errors.push(...validateDailyCompletionRates(data.dailyCompletionRates));
    }
    errors.push(...validateProductivityTrend(data?.productivityTrend));
    if (!isNumberInRange(data?.delayProbability, 0, 1)) {
        errors.push('delayProbability must be a number between 0 and 1');
    }
    if (typeof data?.focusMinutesLast7Days !== 'number' || Number.isNaN(data.focusMinutesLast7Days) || data.focusMinutesLast7Days < 0) {
        errors.push('focusMinutesLast7Days must be a non-negative number');
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('progress_tracking_agent', '1.0.0', validateProgressTrackingOutput);

export { validateProgressTrackingOutput, STATUS_ENUM, TREND_LABEL_ENUM };
