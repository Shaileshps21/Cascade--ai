/**
 * memory_agent/schema.js
 * Schema v1.0.0 for the Memory Agent output.
 */

import { registerSchema, isNumberInRange, isNonEmptyArray } from '../shared/validator.js';

function validateMemoryOutput(data) {
    const errors = [];
    const warnings = [];

    if (!Array.isArray(data?.similarProjects)) warnings.push('similarProjects should be an array');
    if (typeof data?.averageSuccessRate !== 'number') warnings.push('averageSuccessRate should be a number');
    if (!Array.isArray(data?.commonFailures)) warnings.push('commonFailures should be an array');
    if (!Array.isArray(data?.bestWorkflowModules)) warnings.push('bestWorkflowModules should be an array');

    if (data?.averageSpeeds && typeof data.averageSpeeds !== 'object') {
        errors.push('averageSpeeds must be an object');
    }
    if (typeof data?.reliabilityScore !== 'number' || data.reliabilityScore < 0 || data.reliabilityScore > 1) {
        warnings.push('reliabilityScore should be a number between 0 and 1');
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('memory_agent', '1.0.0', validateMemoryOutput);
