/**
 * planning_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Full redesign from planningAgent.js — the most complex agent in the
 * pipeline. Three sequential LLM stages, all using clients.pro:
 *
 *   Stage 1 — Domain Analysis        (preserved persona-based analysis)
 *   Stage 2 — Hierarchy Generation   (Milestones → Modules → Tasks)
 *   Stage 3 — Task Workspace Gen.    (batched — full blueprint per task)
 *
 * Reads:  context.intent, context.priority, context.knowledge, context.memory
 * Writes: context.planning (matches the `planning` namespace shape documented
 *         in contextManager.js)
 *
 * Reflection loop: the orchestrator may re-invoke this function with
 * `reviewFeedback` (from review_agent) when qualityScore < 80, up to 2
 * revisions. When present, the feedback issues are appended to the Stage 2
 * hierarchy prompt so the LLM fixes them directly.
 */

import './schema.js'; // registers schema
import {
    buildDomainAnalysisPrompt,
    buildHierarchyPrompt,
    buildTaskWorkspacePrompt,
} from './prompt_v1.js';
import { validatePlanningHierarchy } from './validator.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';

const AGENT_NAME = 'planning_agent';
const SSE_NAME = 'planning';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

// ── Stage 3 batching ──────────────────────────────────────────────────────────
// Engineering call: a single mega-prompt covering every task in a large plan
// (potentially 8 milestones x 6 modules x 8 tasks = up to 384 tasks) risks
// output truncation and makes JSON-repair unreliable on a huge payload. One
// LLM call per task is wasteful (per-call latency/overhead dominates for a
// tiny per-task prompt, and it multiplies rate-limit exposure — each call
// counts against the provider's requests-per-minute/day quota regardless of
// its size). Raised from 8 to 14: a 14-task workspace batch still comfortably
// fits well under any tier's output ceiling, and nearly halves the number of
// Stage 3 round-trips (and therefore request-quota exposure) for a large plan.
const WORKSPACE_BATCH_SIZE = 14;

const DIFFICULTIES = ['low', 'medium', 'high', 'very_high'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const RISK_LEVELS = ['low', 'medium', 'high'];

function fallbackDomainAnalysis(category, title) {
    return {
        realGoal: title,
        domainWorkflow: `Complete the ${category} task systematically, following standard best practices for this domain.`,
        naturalPhases: ['Prepare', 'Execute', 'Review'],
        criticalDependency: 'None identified',
        doneDefinition: `${title} completed and verified`,
        timeRealism: 'Timeline assessment unavailable — proceeding with standard estimates.',
    };
}

/**
 * Run the Planning Agent.
 * @param {object} context        - PlanningContext
 * @param {object} clients        - LLM clients { pro, flash, embedding }
 * @param {object} [eventBus]     - optional eventBus instance
 * @param {function} [sseEmit]    - optional (agentName, status, message, data) => void
 * @param {object|Array|null} [reviewFeedback] - review_agent feedback for a revision pass
 * @returns {Promise<object>} the final planning object (also written to context.planning)
 */
export async function runPlanningAgent(context, clients, eventBus = null, sseEmit = null, reviewFeedback = null) {
    return runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'planning',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 1,
        evaluator: (parsed) => {
            const { valid, errors } = validatePlanningHierarchy(parsed);
            return { score: valid ? 100 : 50, issues: errors };
        },
        agentFn: async (ctx, llm) => {
            const intent = ctx.intent ?? {};
            const priority = ctx.priority ?? {};
            const knowledge = ctx.knowledge ?? {};
            const memory = ctx.memory ?? {};
            const rawGoal = ctx.rawGoal ?? intent.title ?? 'Untitled task';
            const category = intent.category ?? 'other';
            const complexity = intent.complexity ?? 'medium';
            const nowISO = new Date().toISOString();
            const deadlineISO = intent.deadline ?? ctx.explicitDeadline ?? new Date(Date.now() + 7 * 86_400_000).toISOString();

            // ── Stage 1: Domain Analysis ──────────────────────────────────────
            sseEmit?.(SSE_NAME, 'thinking', '🔎 Analyzing what this task actually requires...', null);
            let domainAnalysis;
            try {
                const prompt1 = buildDomainAnalysisPrompt(rawGoal, category, complexity, deadlineISO, nowISO);
                // Small flat JSON (6 short fields) — 700 tokens is generous headroom.
                const result1 = await llm.pro.generateText(prompt1, { promptVersion: PROMPT_VERSION, maxOutputTokens: 700 });
                domainAnalysis = await parseJSONWithRepair(extractText(result1), llm.flash);
            } catch (err) {
                console.warn(`[${AGENT_NAME}] Stage 1 domain analysis failed, using fallback: ${err.message}`);
                domainAnalysis = fallbackDomainAnalysis(category, intent.title ?? rawGoal);
            }

            // ── Stage 2: Hierarchy Generation ─────────────────────────────────
            sseEmit?.(SSE_NAME, 'thinking', '🏗️ Designing milestones, modules and tasks...', null);
            const prompt2 = buildHierarchyPrompt(domainAnalysis, intent, priority, knowledge, memory, reviewFeedback);
            const result2 = await llm.pro.generateText(prompt2, { promptVersion: PROMPT_VERSION });
            const rawHierarchy = await parseJSONWithRepair(extractText(result2), llm.flash);

            const { milestones, tasks: taskStubs, warnings: hierarchyWarnings } = normalizeHierarchy(rawHierarchy);

            // ── Stage 3: Task Workspace Generation (batched) ──────────────────
            sseEmit?.(SSE_NAME, 'thinking', `📋 Building ${taskStubs.length} task workspaces...`, null);
            const fullTasks = await generateTaskWorkspaces(taskStubs, domainAnalysis, knowledge, llm);

            // ── Attach topic-matched resources from the Knowledge Agent ───────
            const tasksWithResources = attachResourcesToTasks(fullTasks, knowledge.resources ?? []);

            const planning = {
                schemaVersion: SCHEMA_VERSION,
                milestones,
                tasks: tasksWithResources,
                dependencyGraph: {},
                criticalPath: [],
                riskSummary: buildRiskSummary(milestones),
                planningNotes: rawHierarchy.planningNotes ?? '',
                realGoal: domainAnalysis.realGoal ?? rawGoal,
            };

            if (hierarchyWarnings.length && ctx.metadata?.warnings) {
                ctx.metadata.warnings.push(...hierarchyWarnings.map((w) => `${AGENT_NAME}: ${w}`));
            }

            return planning;
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize the raw Stage 2 LLM output into the canonical hierarchy shape
 * with clean, sequential ids (M1.., MOD1.., T1..) and dependency arrays
 * remapped from the LLM's zero-based-index format into real id strings.
 * Also clamps hierarchy sizes that exceed the documented maximums.
 *
 * @param {object} raw - parsed Stage 2 LLM output
 * @returns {{ milestones: object[], tasks: object[], warnings: string[] }}
 */
function normalizeHierarchy(raw) {
    const warnings = [];
    let rawMilestones = Array.isArray(raw?.milestones) ? raw.milestones : [];

    if (rawMilestones.length > 8) {
        warnings.push(`LLM produced ${rawMilestones.length} milestones — truncated to 8`);
        rawMilestones = rawMilestones.slice(0, 8);
    }
    if (rawMilestones.length < 4) {
        warnings.push(`LLM produced only ${rawMilestones.length} milestones (expected 4-8)`);
    }

    // Flatten modules/tasks in document order — the LLM's dependency indices
    // refer to positions in these flattened lists (see prompt_v1.js).
    const flatModules = [];
    const flatTasks = [];

    rawMilestones.forEach((m, mi) => {
        let mods = Array.isArray(m?.modules) ? m.modules : [];
        if (mods.length > 6) {
            warnings.push(`milestone ${mi} had ${mods.length} modules — truncated to 6`);
            mods = mods.slice(0, 6);
        }
        mods.forEach((mod) => {
            let mTasks = Array.isArray(mod?.tasks) ? mod.tasks : [];
            if (mTasks.length > 8) {
                warnings.push(`a module in milestone ${mi} had ${mTasks.length} tasks — truncated to 8`);
                mTasks = mTasks.slice(0, 8);
            }
            const moduleIndex = flatModules.length;
            const taskIndices = [];
            mTasks.forEach((t) => {
                taskIndices.push(flatTasks.length);
                flatTasks.push({ ...t, __moduleIndex: moduleIndex, __milestoneIndex: mi });
            });
            flatModules.push({ ...mod, __milestoneIndex: mi, __taskIndices: taskIndices });
        });
    });

    const milestoneIds = rawMilestones.map((_, i) => `M${i + 1}`);
    const moduleIds = flatModules.map((_, i) => `MOD${i + 1}`);
    const taskIds = flatTasks.map((_, i) => `T${i + 1}`);

    const clampIndex = (idx, len) => (Number.isInteger(idx) && idx >= 0 && idx < len ? idx : null);

    const milestones = rawMilestones.map((m, mi) => {
        const modulesForThisMilestone = flatModules
            .map((mod, gi) => ({ mod, gi }))
            .filter(({ mod }) => mod.__milestoneIndex === mi);

        return {
            id: milestoneIds[mi],
            title: m?.title ?? `Milestone ${mi + 1}`,
            description: m?.description ?? '',
            estimatedOutcome: m?.estimatedOutcome ?? '',
            completionCriteria: Array.isArray(m?.completionCriteria) ? m.completionCriteria : [],
            riskLevel: RISK_LEVELS.includes(m?.riskLevel) ? m.riskLevel : 'medium',
            dependencies: (Array.isArray(m?.dependencies) ? m.dependencies : [])
                .map((idx) => clampIndex(idx, rawMilestones.length))
                .filter((idx) => idx !== null && idx !== mi)
                .map((idx) => milestoneIds[idx]),
            modules: modulesForThisMilestone.map(({ mod, gi }) => ({
                id: moduleIds[gi],
                title: mod.title ?? 'Module',
                description: mod.description ?? '',
                acceptanceCriteria: Array.isArray(mod.acceptanceCriteria) ? mod.acceptanceCriteria : [],
                dependencies: (Array.isArray(mod.dependencies) ? mod.dependencies : [])
                    .map((idx) => clampIndex(idx, flatModules.length))
                    .filter((idx) => idx !== null && idx !== gi)
                    .map((idx) => moduleIds[idx]),
                tasks: mod.__taskIndices.map((ti) => taskIds[ti]),
            })),
        };
    });

    const tasks = flatTasks.map((t, ti) => ({
        taskId: taskIds[ti],
        milestoneId: milestoneIds[t.__milestoneIndex],
        moduleId: moduleIds[t.__moduleIndex],
        title: t.title ?? `Task ${ti + 1}`,
        difficulty: DIFFICULTIES.includes(t.difficulty) ? t.difficulty : 'medium',
        requiredSkills: Array.isArray(t.requiredSkills) ? t.requiredSkills : [],
        dependencies: (Array.isArray(t.dependencies) ? t.dependencies : [])
            .map((idx) => clampIndex(idx, flatTasks.length))
            .filter((idx) => idx !== null && idx !== ti)
            .map((idx) => taskIds[idx]),
        priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
        estimatedMinutes: Number.isFinite(t.estimatedMinutes) ? Math.max(5, Math.round(t.estimatedMinutes)) : 60,
        reviewRequired: !!t.reviewRequired,
        isBuffer: !!t.isBuffer,
        isReview: !!t.isReview,
    }));

    return { milestones, tasks, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — batched task workspace generation
// ─────────────────────────────────────────────────────────────────────────────

function fallbackExecutionSteps(stub) {
    return [
        { stepId: 'S1', action: `Prepare for ${stub.title}`, order: 1 },
        { stepId: 'S2', action: `Execute ${stub.title}`, order: 2 },
        { stepId: 'S3', action: `Verify ${stub.title} is complete`, order: 3 },
    ].map((s) => normalizeExecutionStep(s, stub));
}

/**
 * Normalize a raw (LLM or fallback) execution step into the first-class
 * interactive step object the client's Task Workspace operates on.
 * `action` (legacy Stage-3 field) becomes `title` when no explicit title
 * is present. All mutable fields default to their "not started" state.
 * @param {object} s     - raw step { stepId, action|title, description?, order, estimatedMinutes?, dependencies?, isOptional? }
 * @param {object} stub  - owning task stub (for estimatedMinutes fallback)
 * @param {number} [i]   - index, used to derive a fallback stepId/order
 * @returns {object} interactive execution step
 */
function normalizeExecutionStep(s, stub, i = 0) {
    const stepId = s?.stepId ?? `S${i + 1}`;
    return {
        id: stepId,
        stepId, // kept for backward compatibility with existing readers
        title: s?.title ?? s?.action ?? `Step ${i + 1}`,
        description: s?.description ?? '',
        order: Number.isFinite(s?.order) ? s.order : i + 1,
        estimatedMinutes: Number.isFinite(s?.estimatedMinutes)
            ? s.estimatedMinutes
            : Math.max(5, Math.round((stub?.estimatedMinutes ?? 30) / 3)),
        status: 'pending', // pending | in_progress | completed | blocked
        dependencies: Array.isArray(s?.dependencies) ? s.dependencies : [],
        resources: [],
        notes: '',
        completionEvidence: '',
        isOptional: !!s?.isOptional,
        progress: 0,
        startedAt: null,
        completedAt: null,
        blockedReason: null,
        blockedSince: null,
    };
}

function nonEmptyArrayOr(arr, fallback) {
    return Array.isArray(arr) && arr.length > 0 ? arr : fallback;
}

/**
 * Call Stage 3 in batches and merge the resulting workspace blueprints back
 * onto the Stage 2 task stubs, applying safe fallbacks for anything the LLM
 * omitted or a failed batch.
 * @param {object[]} taskStubs
 * @param {object} domainAnalysis
 * @param {object} knowledge
 * @param {object} llm - clients { pro, flash }
 * @returns {Promise<object[]>} full task workspace objects (without resources/progress finalized — those are added by the caller)
 */
async function generateTaskWorkspaces(taskStubs, domainAnalysis, knowledge, llm) {
    const batches = [];
    for (let i = 0; i < taskStubs.length; i += WORKSPACE_BATCH_SIZE) {
        batches.push(taskStubs.slice(i, i + WORKSPACE_BATCH_SIZE));
    }

    const workspacesByTaskId = new Map();

    for (const batch of batches) {
        if (batch.length === 0) continue;
        try {
            const prompt = buildTaskWorkspacePrompt(batch, domainAnalysis, knowledge);
            const result = await llm.pro.generateText(prompt, { promptVersion: PROMPT_VERSION });
            const parsed = await parseJSONWithRepair(extractText(result), llm.flash);
            const workspaces = Array.isArray(parsed?.workspaces) ? parsed.workspaces : [];
            for (const ws of workspaces) {
                if (ws?.taskId) workspacesByTaskId.set(ws.taskId, ws);
            }
        } catch (err) {
            console.warn(`[${AGENT_NAME}] Stage 3 batch failed, falling back to defaults for ${batch.length} task(s): ${err.message}`);
        }
    }

    return taskStubs.map((stub) => {
        const ws = workspacesByTaskId.get(stub.taskId) ?? {};
        const rawSteps = Array.isArray(ws.executionSteps) ? ws.executionSteps : [];
        const executionSteps = rawSteps.length > 0
            ? rawSteps.map((s, i) => normalizeExecutionStep(s, stub, i))
            : fallbackExecutionSteps(stub);

        return {
            ...stub,
            overview: ws.overview ?? `Part of "${stub.title}" — contributes to the surrounding module's goals.`,
            objectives: nonEmptyArrayOr(ws.objectives, [`Complete ${stub.title}`]),
            executionSteps,
            deliverables: nonEmptyArrayOr(ws.deliverables, ['Completed task output']),
            successCriteria: nonEmptyArrayOr(ws.successCriteria, [`✓ ${stub.title} is complete and verified`]),
            commonMistakes: nonEmptyArrayOr(ws.commonMistakes, ['Skipping verification before marking the task complete']),
            aiGuidance: nonEmptyArrayOr(ws.aiGuidance, ['Break the task into smaller steps if it feels overwhelming.']),
            reflectionQuestions: nonEmptyArrayOr(ws.reflectionQuestions, [`What would make "${stub.title}" verifiably complete?`]),
            resources: [],
            notes: [],
            progress: { status: 'not_started', completedAt: null, actualMinutes: null },
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource attachment (exported — pure function, used by agent.test.js)
// ─────────────────────────────────────────────────────────────────────────────

// Generic verbs/connectors that would otherwise create false-positive topic
// matches between unrelated tasks and resources (e.g. every task title
// contains "implement" or "write").
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'using', 'use',
    'build', 'create', 'implement', 'write', 'develop', 'design', 'setup', 'set', 'up',
    'review', 'update', 'add', 'make', 'this', 'that', 'into', 'from', 'your', 'you',
    'it', 'is', 'are', 'be', 'will', 'can', 'how', 'what', 'task', 'step', 'complete',
]);

function tokenize(text) {
    return new Set(
        String(text ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    );
}

/**
 * Attach relevant knowledge resources to each task by simple keyword overlap
 * between the task's title/objectives and the resource's title/keyTopics.
 * Pure function — no LLM calls — so it's directly unit-testable.
 *
 * @param {object[]} tasks              - full task objects (with title, objectives)
 * @param {object[]} knowledgeResources - context.knowledge.resources
 * @returns {object[]} tasks with `.resources` populated (topic-matched subset)
 */
export function attachResourcesToTasks(tasks, knowledgeResources = []) {
    if (!Array.isArray(tasks)) return [];
    if (!Array.isArray(knowledgeResources) || knowledgeResources.length === 0) {
        return tasks.map((t) => ({ ...t, resources: t.resources ?? [] }));
    }

    return tasks.map((task) => {
        const taskTokens = tokenize(`${task.title ?? ''} ${(task.objectives ?? []).join(' ')}`);
        const matched = knowledgeResources.filter((res) => {
            const resTokens = tokenize(`${res.title ?? ''} ${(res.keyTopics ?? []).join(' ')}`);
            for (const tok of resTokens) {
                if (taskTokens.has(tok)) return true;
            }
            return false;
        });

        // Also attach the subset of the task's matched resources that are
        // topically relevant to each individual execution step, so a user
        // opening "Understand JWT" sees the JWT docs, not the whole task's
        // resource pile (per the plan's step-level knowledge integration).
        const executionSteps = (task.executionSteps ?? []).map((step) => {
            if (matched.length === 0) return step;
            const stepTokens = tokenize(`${step.title ?? ''} ${step.description ?? ''}`);
            const stepMatched = matched.filter((res) => {
                const resTokens = tokenize(`${res.title ?? ''} ${(res.keyTopics ?? []).join(' ')}`);
                for (const tok of resTokens) {
                    if (stepTokens.has(tok)) return true;
                }
                return false;
            });
            return stepMatched.length > 0 ? { ...step, resources: stepMatched } : step;
        });

        return { ...task, resources: matched, executionSteps };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk summary
// ─────────────────────────────────────────────────────────────────────────────

function buildRiskSummary(milestones) {
    return milestones
        .filter((m) => m.riskLevel === 'high' || m.riskLevel === 'medium')
        .map((m) => ({ milestoneId: m.id, title: m.title, riskLevel: m.riskLevel }));
}
