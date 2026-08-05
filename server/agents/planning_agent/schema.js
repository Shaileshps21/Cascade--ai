/**
 * planning_agent/schema.js
 * Schema v1.0.0 for the Planning Agent — validates that the final merged
 * planning object matches the `planning` namespace shape documented in
 * contextManager.js:
 *
 *   { schemaVersion, milestones[], tasks[], dependencyGraph, criticalPath,
 *     riskSummary, planningNotes, realGoal }
 *
 * This is a shallow "shape" check (fields present, right types, non-empty
 * arrays). Deeper structural/cross-reference rules (milestone/module/task
 * counts, dependency validity, orphan modules, etc.) live in validator.js's
 * validatePlanningHierarchy() and are run separately as the agentRunner
 * quality evaluator.
 */

import { registerSchema, isNonEmptyString, isNonEmptyArray, isEnum } from '../shared/validator.js';

const RISK_LEVELS = ['low', 'medium', 'high'];
const DIFFICULTIES = ['low', 'medium', 'high', 'very_high'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

function validateModuleShape(mod, mi, modi, errors, warnings) {
    const label = `milestones[${mi}].modules[${modi}]`;
    if (!isNonEmptyString(mod?.id)) errors.push(`${label}.id must be a non-empty string`);
    if (!isNonEmptyString(mod?.title)) errors.push(`${label}.title must be a non-empty string`);
    if (!Array.isArray(mod?.acceptanceCriteria)) warnings.push(`${label}.acceptanceCriteria should be an array`);
    if (!Array.isArray(mod?.tasks)) errors.push(`${label}.tasks must be an array of taskIds`);
    if (!Array.isArray(mod?.dependencies)) warnings.push(`${label}.dependencies should be an array`);
}

function validateMilestoneShape(m, mi, errors, warnings) {
    const label = `milestones[${mi}]`;
    if (!isNonEmptyString(m?.id)) errors.push(`${label}.id must be a non-empty string`);
    if (!isNonEmptyString(m?.title)) errors.push(`${label}.title must be a non-empty string`);
    if (!isNonEmptyString(m?.estimatedOutcome)) warnings.push(`${label}.estimatedOutcome should be a non-empty string`);
    if (!Array.isArray(m?.completionCriteria)) warnings.push(`${label}.completionCriteria should be an array`);
    if (!isEnum(m?.riskLevel, RISK_LEVELS)) warnings.push(`${label}.riskLevel should be one of: ${RISK_LEVELS.join(', ')}`);
    if (!isNonEmptyArray(m?.modules)) {
        errors.push(`${label}.modules must be a non-empty array`);
    } else {
        m.modules.forEach((mod, modi) => validateModuleShape(mod, mi, modi, errors, warnings));
    }
}

function validateTaskShape(t, ti, errors, warnings) {
    const label = t?.taskId ? `tasks[${ti}] (${t.taskId})` : `tasks[${ti}]`;
    if (!isNonEmptyString(t?.taskId)) errors.push(`${label}.taskId must be a non-empty string`);
    if (!isNonEmptyString(t?.milestoneId)) errors.push(`${label}.milestoneId must be a non-empty string`);
    if (!isNonEmptyString(t?.moduleId)) errors.push(`${label}.moduleId must be a non-empty string`);
    if (!isNonEmptyString(t?.title)) errors.push(`${label}.title must be a non-empty string`);

    // ── Task workspace fields (Stage 3 output) ──────────────────────────────
    if (!isNonEmptyString(t?.overview)) errors.push(`${label}.overview must be a non-empty string`);
    if (!isNonEmptyArray(t?.objectives)) errors.push(`${label}.objectives must be a non-empty array`);
    if (!isNonEmptyArray(t?.executionSteps)) {
        errors.push(`${label}.executionSteps must be a non-empty array`);
    } else {
        t.executionSteps.forEach((s, si) => {
            if (!isNonEmptyString(s?.id ?? s?.stepId)) warnings.push(`${label}.executionSteps[${si}].id should be a non-empty string`);
            if (!isNonEmptyString(s?.title)) errors.push(`${label}.executionSteps[${si}].title must be a non-empty string`);
            if (typeof s?.order !== 'number') warnings.push(`${label}.executionSteps[${si}].order should be a number`);
        });
    }
    if (!isNonEmptyArray(t?.deliverables)) warnings.push(`${label}.deliverables should be a non-empty array`);
    if (!isNonEmptyArray(t?.successCriteria)) warnings.push(`${label}.successCriteria should be a non-empty array`);
    if (!isNonEmptyArray(t?.commonMistakes)) warnings.push(`${label}.commonMistakes should be a non-empty array`);
    if (!isNonEmptyArray(t?.aiGuidance)) warnings.push(`${label}.aiGuidance should be a non-empty array`);
    if (!isNonEmptyArray(t?.reflectionQuestions)) warnings.push(`${label}.reflectionQuestions should be a non-empty array`);
    if (!Array.isArray(t?.resources)) warnings.push(`${label}.resources should be an array`);
    if (!Array.isArray(t?.notes)) warnings.push(`${label}.notes should be an array`);

    // ── Metadata fields (Stage 2 output) ────────────────────────────────────
    if (!isEnum(t?.difficulty, DIFFICULTIES)) warnings.push(`${label}.difficulty should be one of: ${DIFFICULTIES.join(', ')}`);
    if (!isEnum(t?.priority, PRIORITIES)) warnings.push(`${label}.priority should be one of: ${PRIORITIES.join(', ')}`);
    if (!Array.isArray(t?.requiredSkills)) warnings.push(`${label}.requiredSkills should be an array`);
    if (!Array.isArray(t?.dependencies)) warnings.push(`${label}.dependencies should be an array`);
    if (typeof t?.estimatedMinutes !== 'number' || t.estimatedMinutes <= 0) warnings.push(`${label}.estimatedMinutes should be a positive number`);

    if (!t?.progress || typeof t.progress !== 'object') {
        warnings.push(`${label}.progress should be an object`);
    }
}

function validatePlanningOutput(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['planning output must be an object'], warnings: [] };
    }

    if (!isNonEmptyArray(data.milestones)) {
        errors.push('milestones must be a non-empty array');
    } else {
        data.milestones.forEach((m, mi) => validateMilestoneShape(m, mi, errors, warnings));
    }

    if (!isNonEmptyArray(data.tasks)) {
        errors.push('tasks must be a non-empty array');
    } else {
        data.tasks.forEach((t, ti) => validateTaskShape(t, ti, errors, warnings));
    }

    if (data.dependencyGraph !== undefined && typeof data.dependencyGraph !== 'object') {
        warnings.push('dependencyGraph should be an object');
    }
    if (!Array.isArray(data.criticalPath)) warnings.push('criticalPath should be an array');
    if (!Array.isArray(data.riskSummary)) warnings.push('riskSummary should be an array');
    if (!isNonEmptyString(data.planningNotes)) warnings.push('planningNotes should be a non-empty string');
    if (!isNonEmptyString(data.realGoal)) warnings.push('realGoal should be a non-empty string');

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('planning_agent', '1.0.0', validatePlanningOutput);

export { validatePlanningOutput, RISK_LEVELS, DIFFICULTIES, PRIORITIES };
