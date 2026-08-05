/**
 * knowledge_acquisition_agent/schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Schema v1.0.0 for the Knowledge Acquisition Agent output.
 *
 * {
 *   schemaVersion, requiresLearning, reason, learningObjectives[],
 *   knowledgeGraph: { concepts[], paths[] },
 *   resources[], recommendedLearningTime, confidence
 * }
 */

import {
    registerSchema,
    isNonEmptyString,
    isNumberInRange,
    isEnum,
} from '../shared/validator.js';

export const RESOURCE_TYPES = [
    'Official Documentation',
    'Books',
    'Research Papers',
    'YouTube Courses',
    'Interactive Platforms',
    'Community Articles',
    'GitHub Repositories',
    'Practice Websites',
];

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

/**
 * Validate a knowledge_acquisition_agent output object.
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateKnowledgeOutput(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['output must be an object'], warnings: [] };
    }

    if (typeof data.requiresLearning !== 'boolean') {
        errors.push('requiresLearning must be a boolean');
    }

    if (typeof data.reason !== 'string') {
        warnings.push('reason should be a string');
    }

    if (!Array.isArray(data.learningObjectives)) {
        warnings.push('learningObjectives should be an array');
    }

    // ── Knowledge graph ──────────────────────────────────────────────────────
    const graph = data.knowledgeGraph;
    if (!graph || typeof graph !== 'object') {
        errors.push('knowledgeGraph is required and must be an object');
    } else {
        if (!Array.isArray(graph.concepts)) {
            errors.push('knowledgeGraph.concepts must be an array');
        } else {
            graph.concepts.forEach((concept, idx) => {
                if (!isNonEmptyString(concept?.id)) {
                    errors.push(`knowledgeGraph.concepts[${idx}].id must be a non-empty string`);
                }
                if (!isNonEmptyString(concept?.name)) {
                    errors.push(`knowledgeGraph.concepts[${idx}].name must be a non-empty string`);
                }
                if (!isNonEmptyString(concept?.summary)) {
                    errors.push(`knowledgeGraph.concepts[${idx}].summary must be a non-empty string`);
                }
                if (!isEnum(concept?.difficulty, DIFFICULTIES)) {
                    errors.push(`knowledgeGraph.concepts[${idx}].difficulty must be one of: ${DIFFICULTIES.join(', ')}`);
                }
                if (!Array.isArray(concept?.prerequisites)) {
                    warnings.push(`knowledgeGraph.concepts[${idx}].prerequisites should be an array`);
                }
            });
        }

        if (!Array.isArray(graph.paths)) {
            warnings.push('knowledgeGraph.paths should be an array');
        } else {
            graph.paths.forEach((edge, idx) => {
                if (!isNonEmptyString(edge?.from)) {
                    errors.push(`knowledgeGraph.paths[${idx}].from must be a non-empty string`);
                }
                if (!isNonEmptyString(edge?.to)) {
                    errors.push(`knowledgeGraph.paths[${idx}].to must be a non-empty string`);
                }
            });
        }
    }

    // ── Resources ────────────────────────────────────────────────────────────
    if (!Array.isArray(data.resources)) {
        errors.push('resources must be an array');
    } else {
        data.resources.forEach((resource, idx) => {
            if (!isNonEmptyString(resource?.title)) {
                errors.push(`resources[${idx}].title must be a non-empty string`);
            }
            if (!isEnum(resource?.type, RESOURCE_TYPES)) {
                errors.push(`resources[${idx}].type must be one of: ${RESOURCE_TYPES.join(', ')}`);
            }
            if (!isEnum(resource?.difficulty, DIFFICULTIES)) {
                errors.push(`resources[${idx}].difficulty must be one of: ${DIFFICULTIES.join(', ')}`);
            }
            if (typeof resource?.estimatedHours !== 'number' || resource.estimatedHours <= 0) {
                errors.push(`resources[${idx}].estimatedHours must be a number > 0`);
            }
            if (!isNonEmptyString(resource?.reason)) {
                warnings.push(`resources[${idx}].reason should be a non-empty string`);
            }
            if (!isNonEmptyString(resource?.summary)) {
                warnings.push(`resources[${idx}].summary should be a non-empty string`);
            }
            if (!Array.isArray(resource?.keyTopics)) {
                warnings.push(`resources[${idx}].keyTopics should be an array`);
            }
            if (typeof resource?.bestFor !== 'string') {
                warnings.push(`resources[${idx}].bestFor should be a string`);
            }
            if (!Array.isArray(resource?.prerequisites)) {
                warnings.push(`resources[${idx}].prerequisites should be an array`);
            }
            if (typeof resource?.url !== 'string') {
                warnings.push(`resources[${idx}].url should be a string`);
            }
            if (typeof resource?.priority !== 'number') {
                warnings.push(`resources[${idx}].priority should be a number`);
            }
        });
    }

    if (typeof data.recommendedLearningTime !== 'number') {
        warnings.push('recommendedLearningTime should be a number');
    }

    if (!isNumberInRange(data.confidence, 0, 1)) {
        warnings.push('confidence should be a number between 0 and 1');
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('knowledge_acquisition_agent', '1.0.0', validateKnowledgeOutput);
