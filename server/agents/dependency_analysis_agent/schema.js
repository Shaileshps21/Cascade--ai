/**
 * dependency_analysis_agent/schema.js
 * Schema v1.0.0 for the Dependency Analysis Agent output.
 *
 * Shape:
 * {
 *   "schemaVersion": "1.0.0",
 *   "dependencyGraph": { "nodes": [], "edges": [{"from":"","to":""}] },
 *   "parallelGroups": [[]],
 *   "criticalPath": [],
 *   "blockedTasks": [],
 *   "topologicalOrdering": [],
 *   "milestoneOrder": [],
 *   "moduleOrder": []
 * }
 */

import { registerSchema, isNonEmptyString } from '../shared/validator.js';

function isStringArray(v) {
    return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function validateDependencyOutput(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['output must be an object'], warnings };
    }

    const graph = data.dependencyGraph;
    if (!graph || typeof graph !== 'object') {
        errors.push('dependencyGraph must be an object');
    } else {
        if (!isStringArray(graph.nodes)) errors.push('dependencyGraph.nodes must be an array of strings');
        if (!Array.isArray(graph.edges)) {
            errors.push('dependencyGraph.edges must be an array');
        } else {
            for (const [i, edge] of graph.edges.entries()) {
                if (!edge || typeof edge !== 'object' || !isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) {
                    errors.push(`dependencyGraph.edges[${i}] must have non-empty string "from" and "to"`);
                    break;
                }
            }
        }
    }

    if (!Array.isArray(data.parallelGroups) || !data.parallelGroups.every(g => Array.isArray(g))) {
        errors.push('parallelGroups must be an array of arrays');
    }

    if (!isStringArray(data.criticalPath)) errors.push('criticalPath must be an array of strings');
    if (!isStringArray(data.blockedTasks)) errors.push('blockedTasks must be an array of strings');
    if (!isStringArray(data.topologicalOrdering)) errors.push('topologicalOrdering must be an array of strings');
    if (!isStringArray(data.milestoneOrder)) warnings.push('milestoneOrder should be an array of strings');
    if (!isStringArray(data.moduleOrder)) warnings.push('moduleOrder should be an array of strings');

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('dependency_analysis_agent', '1.0.0', validateDependencyOutput);

export { validateDependencyOutput };
