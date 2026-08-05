/**
 * review_agent/schema.js
 * Schema v1.0.0 for the Review Agent.
 *
 * Output shape:
 * {
 *   qualityScore: 0-100,
 *   confidenceScore: 0-100,
 *   issues: [{ type, severity: 'low'|'medium'|'high', message, entityId }],
 *   suggestedFixes: [{ type, description }]
 * }
 */

import { registerSchema, isNumberInRange, isNonEmptyString } from '../shared/validator.js';

const SEVERITIES = ['low', 'medium', 'high'];

function validateIssue(issue, index, errors, warnings) {
    if (!issue || typeof issue !== 'object') {
        errors.push(`issues[${index}] must be an object`);
        return;
    }
    if (!isNonEmptyString(issue.type)) warnings.push(`issues[${index}].type should be a non-empty string`);
    if (!SEVERITIES.includes(issue.severity)) warnings.push(`issues[${index}].severity should be one of: ${SEVERITIES.join(', ')}`);
    if (!isNonEmptyString(issue.message)) errors.push(`issues[${index}].message must be a non-empty string`);
    if (issue.entityId !== undefined && typeof issue.entityId !== 'string') {
        warnings.push(`issues[${index}].entityId should be a string`);
    }
}

function validateSuggestedFix(fix, index, errors, warnings) {
    if (!fix || typeof fix !== 'object') {
        errors.push(`suggestedFixes[${index}] must be an object`);
        return;
    }
    if (!isNonEmptyString(fix.type)) warnings.push(`suggestedFixes[${index}].type should be a non-empty string`);
    if (!isNonEmptyString(fix.description)) errors.push(`suggestedFixes[${index}].description must be a non-empty string`);
}

function validateReviewOutput(data) {
    const errors = [];
    const warnings = [];

    if (!isNumberInRange(data?.qualityScore, 0, 100)) {
        errors.push('qualityScore must be a number between 0 and 100');
    }
    if (!isNumberInRange(data?.confidenceScore, 0, 100)) {
        errors.push('confidenceScore must be a number between 0 and 100');
    }

    if (!Array.isArray(data?.issues)) {
        errors.push('issues must be an array');
    } else {
        data.issues.forEach((issue, i) => validateIssue(issue, i, errors, warnings));
    }

    if (!Array.isArray(data?.suggestedFixes)) {
        errors.push('suggestedFixes must be an array');
    } else {
        data.suggestedFixes.forEach((fix, i) => validateSuggestedFix(fix, i, errors, warnings));
    }

    if (data?.target && !['planning', 'schedule'].includes(data.target)) {
        warnings.push('target should be one of: planning, schedule');
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('review_agent', '1.0.0', validateReviewOutput);

export { SEVERITIES };
