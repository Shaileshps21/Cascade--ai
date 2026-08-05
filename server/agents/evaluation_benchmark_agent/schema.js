/**
 * evaluation_benchmark_agent/schema.js
 * Schema v1.0.0 for the Evaluation Benchmark Agent output.
 *
 * Purely deterministic measurement agent — no LLM, no reasoning block.
 *
 * Shape:
 * {
 *   "schemaVersion": "1.0.0",
 *   "planningQuality": 95, "scheduleAccuracy": 91, "dependencyAccuracy": 97,
 *   "estimationAccuracy": 82, "knowledgeQuality": 90, "calendarReliability": 99,
 *   "averagePlanningError": 18, "completionRate": 94, "averageDelayMinutes": 12,
 *   "plannerConfidence": 93, "weeklyTrend": "Improving", "monthlyTrend": "Stable",
 *   "benchmarkHistory": [], "recommendations": []
 * }
 */

import { registerSchema, isNumberInRange, isEnum } from '../shared/validator.js';

const TREND_VALUES = ['Improving', 'Stable', 'Declining'];

/**
 * Validate a benchmark snapshot output.
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateBenchmarkOutput(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['output must be an object'], warnings };
    }

    const scoreFields = [
        'planningQuality',
        'scheduleAccuracy',
        'dependencyAccuracy',
        'estimationAccuracy',
        'knowledgeQuality',
        'calendarReliability',
        'completionRate',
        'plannerConfidence',
    ];

    for (const field of scoreFields) {
        if (!isNumberInRange(data[field], 0, 100)) {
            errors.push(`${field} must be a number between 0 and 100`);
        }
    }

    if (typeof data.averagePlanningError !== 'number' || Number.isNaN(data.averagePlanningError)) {
        errors.push('averagePlanningError must be a number');
    }

    if (typeof data.averageDelayMinutes !== 'number' || Number.isNaN(data.averageDelayMinutes)) {
        errors.push('averageDelayMinutes must be a number');
    }

    if (!isEnum(data.weeklyTrend, TREND_VALUES)) {
        errors.push(`weeklyTrend must be one of ${TREND_VALUES.join(', ')}`);
    }
    if (!isEnum(data.monthlyTrend, TREND_VALUES)) {
        errors.push(`monthlyTrend must be one of ${TREND_VALUES.join(', ')}`);
    }

    if (!Array.isArray(data.benchmarkHistory)) {
        errors.push('benchmarkHistory must be an array');
    }
    if (!Array.isArray(data.recommendations)) {
        warnings.push('recommendations should be an array of strings');
    } else if (!data.recommendations.every(r => typeof r === 'string')) {
        warnings.push('recommendations should contain only strings');
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('evaluation_benchmark_agent', '1.0.0', validateBenchmarkOutput);
