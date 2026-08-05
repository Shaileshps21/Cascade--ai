/**
 * intent_context_agent/schema.js
 * Schema v1.0.0 for the Intent Context Agent (formerly parserAgent).
 */

import { registerSchema, isNonEmptyString, isEnum, isIsoDate, isNumberInRange } from '../shared/validator.js';

const CATEGORIES = ['work', 'academic', 'personal', 'health', 'finance', 'creative', 'other'];
const COMPLEXITIES = ['low', 'medium', 'high', 'very_high'];
const URGENCIES = ['Low', 'Medium', 'High', 'Critical'];

function validateIntentOutput(data) {
    const errors = [];
    const warnings = [];

    if (!isNonEmptyString(data?.title)) errors.push('title must be a non-empty string');
    if (data?.title?.split(' ').length > 7) warnings.push('title should be 5 words or fewer');
    if (!isIsoDate(data?.deadline)) errors.push('deadline must be a valid ISO 8601 date string');
    if (new Date(data?.deadline) < new Date()) errors.push('deadline must be in the future');
    if (!isEnum(data?.category, CATEGORIES)) errors.push(`category must be one of: ${CATEGORIES.join(', ')}`);
    if (!isEnum(data?.complexity, COMPLEXITIES)) errors.push(`complexity must be one of: ${COMPLEXITIES.join(', ')}`);
    if (!isEnum(data?.urgency, URGENCIES)) errors.push(`urgency must be one of: ${URGENCIES.join(', ')}`);
    if (!Array.isArray(data?.userConstraints)) warnings.push('userConstraints should be an array');
    if (!Array.isArray(data?.assumptions)) warnings.push('assumptions should be an array');
    if (!Array.isArray(data?.preferences)) warnings.push('preferences should be an array');
    if (!isNonEmptyString(data?.scope)) warnings.push('scope should be a non-empty string');

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('intent_context_agent', '1.0.0', validateIntentOutput);

export { CATEGORIES, COMPLEXITIES, URGENCIES };
