/**
 * review_agent/agent.js
 * QA review of plan quality. Called by the orchestrator:
 *   - after Planning Agent (target = 'planning', step 9)
 *   - after Scheduler Agent when schedulingScore < 70 (target = 'schedule', step 13)
 *
 * Hybrid implementation:
 *   1. Deterministic checks (pure function, no I/O): duplicate task titles,
 *      orphan modules / dangling references, overloaded scheduled days,
 *      dependency violations, missing task-workspace fields.
 *   2. LLM holistic review via clients.pro: hierarchy balance, milestone
 *      coverage, task atomicity, dependency correctness, workload
 *      distribution — asked to report NEW issues beyond the deterministic
 *      findings.
 *   3. Merge + dedupe (by message), then cap qualityScore at 70 if the
 *      deterministic pass found any high-severity issue. This is a
 *      deliberate business rule: the orchestrator treats qualityScore < 80
 *      as "needs a Planning Agent revision", so a real structural problem
 *      found deterministically must reliably fail that gate even if the
 *      LLM is overly generous.
 *
 * Reads: context.planning (target='planning') or context.schedule (target='schedule')
 * Writes: context.review
 */

import './schema.js';
import { buildReviewPrompt } from './prompt_v1.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';

const AGENT_NAME = 'review_agent';
const SSE_NAME = 'review';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

const REQUIRED_WORKSPACE_FIELDS = [
    'overview',
    'objectives',
    'executionSteps',
    'deliverables',
    'successCriteria',
    'commonMistakes',
    'aiGuidance',
    'reflectionQuestions',
];

const HOURS_8_IN_MINUTES = 8 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic checks (pure — no I/O, no LLM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run deterministic quality checks against the PlanningContext.
 * Pure function — no side effects, no network calls.
 *
 * @param {object} context - PlanningContext (reads context.planning / context.schedule)
 * @param {'planning'|'schedule'} [target] - which review pass this is for
 * @returns {{ issues: Array<{ type: string, severity: 'low'|'medium'|'high', message: string, entityId: string }> }}
 */
export function runDeterministicChecks(context, target = 'planning') {
    const issues = [];

    const planning = context?.planning ?? null;
    const schedule = context?.schedule ?? null;

    const milestones = Array.isArray(planning?.milestones) ? planning.milestones : [];
    const tasks = Array.isArray(planning?.tasks) ? planning.tasks : [];

    _checkDuplicateTaskTitles(tasks, issues);
    _checkOrphansAndDanglingReferences(milestones, tasks, issues);

    if (target === 'planning') {
        _checkMissingWorkspaceFields(tasks, issues);
    }

    if (target === 'schedule' && schedule) {
        _checkOverloadedDays(schedule, issues);
    }

    // Dependency violations only make sense once a schedule exists.
    if (schedule && Array.isArray(schedule.scheduledTasks) && schedule.scheduledTasks.length > 0) {
        _checkDependencyViolations(schedule, issues);
    }

    return { issues };
}

function _checkDuplicateTaskTitles(tasks, issues) {
    const seen = new Map(); // lowercased title -> first taskId
    for (const task of tasks) {
        const key = (task?.title ?? '').trim().toLowerCase();
        if (!key) continue;
        if (seen.has(key)) {
            issues.push({
                type: 'duplicate_task_title',
                severity: 'medium',
                message: `Duplicate task title "${task.title}" (tasks "${seen.get(key)}" and "${task.taskId ?? ''}")`,
                entityId: task.taskId ?? '',
            });
        } else {
            seen.set(key, task.taskId ?? '');
        }
    }
}

function _checkOrphansAndDanglingReferences(milestones, tasks, issues) {
    const milestoneIds = new Set(milestones.map(m => m.id));
    const moduleIds = new Set();
    const moduleTaskCounts = new Map(); // moduleId -> number of tasks referencing it
    const moduleTitleById = new Map();

    for (const m of milestones) {
        const modules = Array.isArray(m.modules) ? m.modules : [];
        for (const mod of modules) {
            moduleIds.add(mod.id);
            moduleTaskCounts.set(mod.id, 0);
            moduleTitleById.set(mod.id, mod.title ?? mod.id);
        }
    }

    for (const task of tasks) {
        if (task?.moduleId) {
            if (moduleTaskCounts.has(task.moduleId)) {
                moduleTaskCounts.set(task.moduleId, moduleTaskCounts.get(task.moduleId) + 1);
            } else {
                issues.push({
                    type: 'orphan_task_reference',
                    severity: 'high',
                    message: `Task "${task.title ?? task.taskId}" references non-existent moduleId "${task.moduleId}"`,
                    entityId: task.taskId ?? '',
                });
            }
        }
        if (task?.milestoneId && !milestoneIds.has(task.milestoneId)) {
            issues.push({
                type: 'orphan_task_reference',
                severity: 'high',
                message: `Task "${task.title ?? task.taskId}" references non-existent milestoneId "${task.milestoneId}"`,
                entityId: task.taskId ?? '',
            });
        }
    }

    for (const [moduleId, count] of moduleTaskCounts.entries()) {
        if (count === 0) {
            issues.push({
                type: 'orphan_module',
                severity: 'high',
                message: `Module "${moduleTitleById.get(moduleId)}" (${moduleId}) has no tasks assigned to it`,
                entityId: moduleId,
            });
        }
    }
}

function _checkMissingWorkspaceFields(tasks, issues) {
    for (const task of tasks) {
        const missing = REQUIRED_WORKSPACE_FIELDS.filter(field => _isEmptyField(task?.[field]));
        if (missing.length > 0) {
            issues.push({
                type: 'missing_workspace_fields',
                severity: 'medium',
                message: `Task "${task.title ?? task.taskId}" is missing workspace fields: ${missing.join(', ')}`,
                entityId: task.taskId ?? '',
            });
        }
    }
}

function _isEmptyField(value) {
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
}

function _checkOverloadedDays(schedule, issues) {
    const scheduledTasks = Array.isArray(schedule.scheduledTasks) ? schedule.scheduledTasks : [];
    const dayTotals = new Map(); // ISO day (YYYY-MM-DD) -> total minutes

    for (const slot of scheduledTasks) {
        if (!slot?.startTime) continue;
        const start = new Date(slot.startTime);
        if (Number.isNaN(start.getTime())) continue;

        const dayKey = start.toISOString().slice(0, 10);
        const minutes = _slotDurationMinutes(slot);
        dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + minutes);
    }

    for (const [day, minutes] of dayTotals.entries()) {
        if (minutes > HOURS_8_IN_MINUTES) {
            issues.push({
                type: 'overloaded_day',
                severity: 'high',
                message: `Day ${day} has ${(minutes / 60).toFixed(1)}h scheduled, exceeding the 8h daily limit`,
                entityId: day,
            });
        }
    }
}

function _slotDurationMinutes(slot) {
    if (typeof slot.adjustedDuration === 'number') return slot.adjustedDuration;
    if (typeof slot.estimatedDuration === 'number') return slot.estimatedDuration;
    if (slot.startTime && slot.endTime) {
        const start = new Date(slot.startTime);
        const end = new Date(slot.endTime);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
            return (end.getTime() - start.getTime()) / 60000;
        }
    }
    return 0;
}

function _checkDependencyViolations(schedule, issues) {
    const scheduledTasks = Array.isArray(schedule.scheduledTasks) ? schedule.scheduledTasks : [];
    const slotByTaskId = new Map(scheduledTasks.map(s => [s.taskId, s]));

    for (const slot of scheduledTasks) {
        const deps = Array.isArray(slot.dependencies) ? slot.dependencies : [];
        if (!slot.startTime) continue;
        const taskStart = new Date(slot.startTime);
        if (Number.isNaN(taskStart.getTime())) continue;

        for (const depId of deps) {
            const depSlot = slotByTaskId.get(depId);
            if (!depSlot?.startTime) continue;
            const depStart = new Date(depSlot.startTime);
            if (Number.isNaN(depStart.getTime())) continue;

            if (depStart.getTime() > taskStart.getTime()) {
                issues.push({
                    type: 'dependency_violation',
                    severity: 'high',
                    message: `Task "${slot.taskName ?? slot.taskId}" is scheduled to start before its dependency "${depSlot.taskName ?? depId}" begins`,
                    entityId: slot.taskId ?? '',
                });
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue merging (deterministic + LLM, deduped by message)
// ─────────────────────────────────────────────────────────────────────────────

function _mergeIssues(deterministicIssues, llmIssues) {
    const merged = [];
    const seenMessages = new Set();

    const all = [...deterministicIssues, ...(Array.isArray(llmIssues) ? llmIssues : [])];
    for (const issue of all) {
        if (!issue || typeof issue.message !== 'string' || !issue.message.trim()) continue;
        const key = issue.message.trim().toLowerCase();
        if (seenMessages.has(key)) continue;
        seenMessages.add(key);
        merged.push({
            type: typeof issue.type === 'string' && issue.type ? issue.type : 'general',
            severity: ['low', 'medium', 'high'].includes(issue.severity) ? issue.severity : 'medium',
            message: issue.message,
            entityId: typeof issue.entityId === 'string' ? issue.entityId : '',
        });
    }
    return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the Review Agent.
 * @param {object} context - PlanningContext
 * @param {object} clients - LLM clients { pro, flash, embedding }
 * @param {object|null} [eventBus]
 * @param {function|null} [sseEmit]
 * @param {'planning'|'schedule'} [target] - which namespace to review
 * @returns {Promise<object>} the review output (also written to context.review)
 */
export async function runReviewAgent(context, clients, eventBus = null, sseEmit = null, target = 'planning') {
    const { issues: deterministicIssues } = runDeterministicChecks(context, target);
    const hasHighSeverity = deterministicIssues.some(i => i.severity === 'high');

    return runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'review',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 2,
        agentFn: async (ctx, llm) => {
            const prompt = buildReviewPrompt(ctx, target, deterministicIssues);
            // qualityScore + a bounded issues/suggestedFixes list — 2000 tokens
            // is ample without reserving the 10240-token pro default, and this
            // agent can be invoked up to 4x per task (initial + revisions).
            const result = await llm.pro.generateText(prompt, { promptVersion: PROMPT_VERSION, maxOutputTokens: 2000 });
            const text = extractText(result);
            const llmParsed = await parseJSONWithRepair(text, llm.flash);

            const mergedIssues = _mergeIssues(deterministicIssues, llmParsed?.issues);
            const suggestedFixes = Array.isArray(llmParsed?.suggestedFixes) ? llmParsed.suggestedFixes : [];

            let qualityScore = typeof llmParsed?.qualityScore === 'number' ? llmParsed.qualityScore : 0;
            if (hasHighSeverity) {
                // Business rule: any deterministically-found high-severity issue
                // must reliably fail the qualityScore < 80 revision gate.
                qualityScore = Math.min(qualityScore, 70);
            }
            qualityScore = Math.max(0, Math.min(100, qualityScore));

            let confidenceScore = typeof llmParsed?.confidenceScore === 'number' ? llmParsed.confidenceScore : 0;
            confidenceScore = Math.max(0, Math.min(100, confidenceScore));

            const merged = {
                schemaVersion: SCHEMA_VERSION,
                target,
                qualityScore,
                confidenceScore,
                issues: mergedIssues,
                suggestedFixes,
                reasoning: llmParsed?.reasoning ?? {
                    confidence: confidenceScore / 100,
                    assumptions: [],
                    warnings: [],
                    promptVersion: PROMPT_VERSION,
                },
            };

            if (hasHighSeverity) {
                merged.reasoning.warnings = Array.isArray(merged.reasoning.warnings)
                    ? [...merged.reasoning.warnings, 'qualityScore capped at 70 due to deterministically-found high-severity issue(s)']
                    : ['qualityScore capped at 70 due to deterministically-found high-severity issue(s)'];
            }

            // Attach token usage for agentRunner/logger (matches intent_context_agent pattern)
            if (result?.usage) {
                merged.__usage = result.usage;
                merged.__cost = result.estimatedCost;
                merged.__provider = result.provider;
                merged.__model = result.model;
            }

            return merged;
        },
    });
}
