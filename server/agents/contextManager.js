/**
 * contextManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PlanningContext factory and helpers.
 *
 * The PlanningContext is the single shared object passed through the entire
 * 15-agent pipeline. Each agent reads only its relevant sections and writes
 * exclusively to its designated namespace.
 *
 * Hierarchy:
 *   Project → Milestones (4–8) → Modules (2–6) → Tasks (2–8) → Execution Steps
 *
 * Task workspaces:
 *   Each Task is a full workspace blueprint with:
 *   overview, objectives, executionSteps, deliverables, successCriteria,
 *   commonMistakes, aiGuidance, reflectionQuestions, resources, notes, progress
 */

// ─────────────────────────────────────────────────────────────────────────────
// Factory — create a fresh PlanningContext
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new blank PlanningContext for a task planning session.
 * @param {string} taskId       - Firestore task document ID
 * @param {string} userId       - Firebase Auth UID
 * @param {string} rawGoal      - raw user input string
 * @param {string} [planningMode] - 'standard' | 'fast' | 'detailed'
 * @param {string|null} [explicitDeadline] - ISO 8601 deadline if provided
 * @returns {object} PlanningContext
 */
export function createContext(taskId, userId, rawGoal, planningMode = 'standard', explicitDeadline = null) {
    return {
        // ── Identity ──────────────────────────────────────────────────────────
        taskId,
        userId,
        rawGoal,
        planningMode,
        explicitDeadline,

        // ── Agent namespaces (written by each agent) ──────────────────────────

        /** Written by: Intent Context Agent */
        intent: null,

        /** Written by: Memory Agent */
        memory: null,

        /** Written by: Knowledge Acquisition Agent */
        knowledge: null,

        /** Written by: Prioritization Agent */
        priority: null,

        /** Written by: Planning Agent — contains full 5-level hierarchy */
        planning: null,

        /** Written by: Review Agent */
        review: null,

        /** Written by: Dependency Analysis Agent */
        dependency: null,

        /** Written by: Time Estimation Agent */
        estimation: null,

        /** Written by: Deadline Feasibility Agent */
        feasibility: null,

        /** Written by: Scheduler Agent */
        schedule: null,

        /** Written by: Evaluation Benchmark Agent (read-only at start, updated at end) */
        benchmark: null,

        // ── Metadata (populated across the pipeline) ──────────────────────────
        metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pipelineVersion: '3.0.0',
            observabilityLogs: [],     // per-agent execution logs
            revisionCount: 0,          // number of plan revisions triggered by review agent
            calendarConnected: false,
            warnings: [],
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Read/Write helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a namespace from the context (returns a deep copy to prevent mutation).
 * @param {object} context
 * @param {string} namespace  - e.g. 'intent', 'planning', 'schedule'
 * @returns {object|null}
 */
export function readNamespace(context, namespace) {
    const value = context[namespace];
    if (value === null || value === undefined) return null;
    return JSON.parse(JSON.stringify(value)); // deep copy
}

/**
 * Write to a specific namespace in the context.
 * Merges data into the namespace (shallow merge at top level).
 * @param {object} context
 * @param {string} namespace
 * @param {object} data
 */
export function writeNamespace(context, namespace, data) {
    context[namespace] = data;
    context.metadata.updatedAt = new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Firestore Serialization
// ─────────────────────────────────────────────────────────────────────────────

// Firestore rejects arrays-of-arrays ("nested arrays are not supported") —
// dependency_analysis_agent's `parallelGroups` is exactly that in memory
// (`[[taskIdA, taskIdB], [taskIdC], ...]`), which otherwise fails the write
// with "Property dependency contains an invalid nested entity". Every
// in-memory consumer (evaluation_benchmark_agent, this agent's own schema/
// tests) keeps using the plain array-of-arrays shape — only the Firestore
// boundary needs to know about the encoding.
function encodeParallelGroups(dependency) {
    if (!dependency || !Array.isArray(dependency.parallelGroups)) return dependency;
    return {
        ...dependency,
        parallelGroups: dependency.parallelGroups.map((group) => ({ taskIds: group })),
    };
}

function decodeParallelGroups(dependency) {
    if (!dependency || !Array.isArray(dependency.parallelGroups)) return dependency;
    return {
        ...dependency,
        parallelGroups: dependency.parallelGroups.map((entry) => (Array.isArray(entry) ? entry : entry?.taskIds ?? [])),
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// Document size guard
// ═════════════════════════════════════════════════════════════════════════════

/** Firestore's hard per-document ceiling, in bytes. */
export const FIRESTORE_MAX_DOC_BYTES = 1_048_576;

/**
 * Write threshold. Deliberately well under the hard limit: Firestore bills a
 * document's size by its own accounting (field-name lengths, per-type overhead,
 * index entries), which runs somewhat above a plain JSON byte count, so the
 * estimate below is a lower bound and needs headroom to stay honest.
 */
export const SAFE_DOC_BYTES = 900_000;

/**
 * Fields shed, in order, when a context is too large to store — least valuable
 * first. Everything here is either regenerable on the next run or historical
 * commentary; nothing the UI needs to render the project is listed.
 *
 * Ordering rationale:
 *   review        — prose feedback about a plan that has already been revised.
 *   benchmark     — a read-only snapshot; the authoritative copy lives in the
 *                   user_benchmarks collection, and it is reloaded every run.
 *   memory        — rebuilt from task_history at the start of every pipeline.
 *   knowledge     — learning resources; genuinely useful to the user, so it is
 *                   shed last, but it is also by far the largest optional field
 *                   and can be re-fetched.
 *
 * planning, schedule, intent, estimation, dependency and metadata are never
 * shed: without them the stored project cannot be displayed or worked at all.
 */
export const SHEDDABLE_FIELDS = ['review', 'benchmark', 'memory', 'knowledge'];

/**
 * Approximate the stored size of a document in bytes.
 * @param {object} doc
 * @returns {number} byte length, or Infinity if the value cannot be serialized
 */
export function estimateDocumentBytes(doc) {
    try {
        return Buffer.byteLength(JSON.stringify(doc) ?? '', 'utf8');
    } catch {
        return Infinity; // circular or otherwise unserializable — treat as oversized
    }
}

/**
 * Ensure a context will fit in one Firestore document, dropping optional fields
 * in SHEDDABLE_FIELDS order until it does.
 *
 * Without this, a large project runs the full pipeline, spends the LLM budget for
 * every agent, and only then fails on the final write — losing the entire run. It
 * is much better to persist a slightly reduced project than nothing at all.
 *
 * @param {object} context
 * @param {number} [limitBytes]
 * @returns {{context: object, bytes: number, droppedFields: string[], stillTooLarge: boolean}}
 */
export function shrinkContextForWrite(context, limitBytes = SAFE_DOC_BYTES) {
    let candidate = context;
    let bytes = estimateDocumentBytes(toFirestoreDocument(candidate));
    if (bytes <= limitBytes) {
        return { context: candidate, bytes, droppedFields: [], stillTooLarge: false };
    }

    const droppedFields = [];
    for (const field of SHEDDABLE_FIELDS) {
        if (candidate[field] == null) continue;
        candidate = { ...candidate, [field]: null };
        droppedFields.push(field);
        bytes = estimateDocumentBytes(toFirestoreDocument(candidate));
        if (bytes <= limitBytes) break;
    }

    return { context: candidate, bytes, droppedFields, stillTooLarge: bytes > limitBytes };
}

/**
 * Convert PlanningContext to a Firestore-safe document.
 * Firestore doesn't support undefined values — all nulls are preserved.
 * @param {object} context
 * @returns {object} Firestore document
 */
export function toFirestoreDocument(context) {
    return {
        ...context,
        dependency: encodeParallelGroups(context.dependency),
        // Mirrored to the top level because routes/tasks.js and routes/projects.js
        // both do `.orderBy('createdAt', ...)`, which Firestore can only apply to
        // a top-level field — without this, saved tasks are silently excluded
        // from every list query even though the document itself writes fine.
        createdAt: context.metadata?.createdAt ?? context.createdAt,
        _schemaVersion: '3.0.0',
        _savedAt: new Date().toISOString(),
    };
}

/**
 * Reconstruct a PlanningContext from a Firestore document.
 * @param {object} doc - Firestore document data
 * @returns {object} PlanningContext
 */
export function fromFirestoreDocument(doc) {
    // Strip Firestore metadata fields
    const { _schemaVersion, _savedAt, ...context } = doc;
    return { ...context, dependency: decodeParallelGroups(context.dependency) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Compatibility — toClientTask()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a PlanningContext to the flat task shape the existing client expects.
 *
 * The client (Dashboard.jsx, TaskCard.jsx, Timeline.jsx) uses:
 *   { id, title, status, deadline, riskScore, progress, subtasks: [...],
 *     scheduledCount, warnings, priorityScore, category, urgency,
 *     rePlannedCount, completedAt, createdAt }
 *
 * Each "subtask" maps to a Task from the 5-level hierarchy.
 * All scheduling fields (scheduledStart, scheduledEnd, calendarEventId, etc.)
 * are merged in from context.schedule.
 *
 * @param {object} context - PlanningContext
 * @returns {object} client task shape
 */
export function toClientTask(context) {
    const intent = context.intent ?? {};
    const priority = context.priority ?? {};
    const planning = context.planning ?? {};
    const schedule = context.schedule ?? {};
    const feasibility = context.feasibility ?? {};

    // Build a slot lookup: taskId → scheduled slot
    const slotMap = {};
    if (Array.isArray(schedule.scheduledTasks)) {
        for (const slot of schedule.scheduledTasks) {
            slotMap[slot.taskId] = slot;
        }
    }

    // taskId → time_estimation_agent's adjusted estimate. Used as the
    // "remaining work" duration even when nothing got scheduled (e.g. an
    // infeasible deadline), so the client shows the same effort figure the
    // scheduler itself used to reach that verdict, instead of silently
    // falling back to the pre-adjustment planning estimate.
    const estimationMap = new Map(
        (context.estimation?.estimations ?? []).map((e) => [e.taskId, e]),
    );

    // Flatten tasks from all milestones/modules into a subtask-like list
    const subtasks = [];
    if (Array.isArray(planning.tasks)) {
        for (const task of planning.tasks) {
            const slot = slotMap[task.taskId] ?? {};
            subtasks.push({
                // Core task workspace fields
                id: task.taskId,
                title: task.title,
                overview: task.overview ?? '',
                objectives: task.objectives ?? [],
                executionSteps: task.executionSteps ?? [],
                deliverables: task.deliverables ?? [],
                successCriteria: task.successCriteria ?? [],
                commonMistakes: task.commonMistakes ?? [],
                aiGuidance: task.aiGuidance ?? [],
                reflectionQuestions: task.reflectionQuestions ?? [],
                resources: task.resources ?? [],
                notes: task.notes ?? [],
                difficulty: task.difficulty ?? 'medium',
                requiredSkills: task.requiredSkills ?? [],
                dependencies: task.dependencies ?? [],
                priority: task.priority ?? 'medium',
                reviewRequired: task.reviewRequired ?? false,
                isBuffer: task.isBuffer ?? false,
                isReview: task.isReview ?? false,
                milestoneId: task.milestoneId,
                moduleId: task.moduleId,
                // User-entered deadline on a manually-created subtask (Manual
                // Project Builder). AI-planned tasks never set this — only the
                // overall project deadline (`intent.deadline`) applies to them.
                deadline: task.deadline ?? null,

                // Progress (mutable by progress_tracking_agent)
                completed: task.progress?.status === 'completed',
                completedAt: task.progress?.completedAt ?? null,
                actualMinutes: task.progress?.actualMinutes ?? null,
                status: task.progress?.status ?? 'not_started',

                // Scheduling (from scheduler_agent)
                scheduledStart: slot.startTime ?? null,
                scheduledEnd: slot.endTime ?? null,
                estimatedMinutes: slot.adjustedDuration
                    ?? estimationMap.get(task.taskId)?.finalEstimateMinutes
                    ?? task.estimatedMinutes
                    ?? null,
                calendarEventId: slot.calendarEventId ?? null,
                calendarLabel: slot.calendarLabel ?? null,
                energyLevel: slot.energyLevel ?? null,
                confidence: slot.confidence ?? null,

                // Legacy fields for backward compatibility
                tips: [],
                type: task.type ?? 'implementation',
                order: task.order ?? subtasks.length + 1,
            });
        }
    }

    // Compute overall progress
    const completedCount = subtasks.filter(s => s.completed).length;
    const progress = subtasks.length > 0 ? Math.round((completedCount / subtasks.length) * 100) : 0;

    // Collect scheduled events count
    const scheduledCount = Object.keys(slotMap).filter(id => slotMap[id].calendarEventId).length;

    return {
        id: context.taskId,
        userId: context.userId,
        title: intent.title ?? context.rawGoal?.slice(0, 50) ?? 'Untitled project',
        rawGoal: context.rawGoal,
        deadline: intent.deadline ?? context.explicitDeadline,
        category: intent.category ?? 'other',
        complexity: intent.complexity ?? 'medium',
        urgency: intent.urgency ?? 'Medium',
        status: _computeTaskStatus(context),
        progress,
        riskScore: priority.riskScore ?? 0,
        priorityScore: priority.priorityScore ?? 0,
        subtasks,
        subtaskCount: subtasks.length,
        milestones: planning.milestones ?? [],
        scheduledCount,
        planningNotes: planning.planningNotes ?? '',
        criticalPath: planning.criticalPath ?? [],
        isFeasible: feasibility.isFeasible ?? true,
        feasibilitySuggestions: feasibility.reconciliationSuggestions ?? null,
        schedulingScore: schedule.schedulingScore ?? null,
        schedulingWarnings: schedule.warnings ?? [],
        warnings: context.metadata.warnings ?? [],
        rePlannedCount: context.metadata.revisionCount ?? 0,
        createdAt: context.metadata.createdAt,
        updatedAt: context.metadata.updatedAt,
        pipelineVersion: context.metadata.pipelineVersion,
        // Manual Todo Mode (AI-optional fallback — see suggestions.md #26):
        // `manualMode` marks a project created via POST /api/tasks/manual
        // (bypassed the 15-agent pipeline entirely). `hasSchedule` tells the
        // client whether an AI schedule has since been generated — once the
        // user runs "Let AI enhance" (which reuses the existing resume/
        // checkpoint flow) this flips true and the manual badge/CTA retire.
        manualMode: context.metadata?.manualMode ?? false,
        hasSchedule: !!context.schedule,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Compatibility — toClientProject()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a 0-100 completion percentage for a task from its execution steps.
 * A step counts as "resolved" if completed or (optionally) skipped-as-blocked;
 * falls back to the task's own progress.status when it has no steps at all.
 * @param {object} task - a `toClientTask().subtasks[]` entry
 * @returns {number} 0-100
 */
function computeTaskStepProgress(task) {
    const steps = task.executionSteps ?? [];
    if (steps.length === 0) return task.completed ? 100 : 0;
    const resolved = steps.filter((s) => s.status === 'completed' || (s.isOptional && s.status === 'skipped')).length;
    return Math.round((resolved / steps.length) * 100);
}

function average(nums) {
    const valid = nums.filter((n) => Number.isFinite(n));
    if (valid.length === 0) return 0;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/**
 * Map a PlanningContext to the nested Project Workspace shape the client's
 * Dashboard → Project Workspace → Task Workspace navigation uses.
 *
 * Unlike `toClientTask()` (flat `subtasks[]`, kept for any remaining
 * flat-list consumers), this nests tasks under modules under milestones —
 * the "Roadmap" tree — and derives progress bottom-up at every level from
 * the execution-step data so there is a single source of truth (the steps
 * themselves) rather than separately-stored, driftable progress counters.
 *
 * @param {object} context - PlanningContext
 * @returns {object} nested project workspace shape
 */
export function toClientProject(context) {
    const flat = toClientTask(context);
    const planning = context.planning ?? {};
    const tasksById = new Map(flat.subtasks.map((t) => [t.id, t]));

    const milestones = (planning.milestones ?? []).map((m) => {
        const modules = (m.modules ?? []).map((mod) => {
            const tasks = (mod.tasks ?? [])
                .map((taskId) => tasksById.get(taskId))
                .filter(Boolean)
                .map((t) => ({ ...t, progress: computeTaskStepProgress(t) }));
            return {
                id: mod.id,
                title: mod.title,
                description: mod.description,
                acceptanceCriteria: mod.acceptanceCriteria ?? [],
                dependencies: mod.dependencies ?? [],
                progress: average(tasks.map((t) => t.progress)),
                tasks,
            };
        });
        return {
            id: m.id,
            title: m.title,
            description: m.description,
            estimatedOutcome: m.estimatedOutcome,
            completionCriteria: m.completionCriteria ?? [],
            riskLevel: m.riskLevel ?? 'medium',
            dependencies: m.dependencies ?? [],
            progress: average(modules.map((mod) => mod.progress)),
            modules,
        };
    });

    const overallProgress = milestones.length > 0 ? average(milestones.map((m) => m.progress)) : flat.progress;

    // "Current" milestone = first one that isn't fully done yet (fallback: last one).
    const currentMilestone = milestones.find((m) => m.progress < 100) ?? milestones[milestones.length - 1] ?? null;

    return {
        ...flat,
        progress: overallProgress,
        milestones,
        currentMilestoneId: currentMilestone?.id ?? null,
        currentMilestoneTitle: currentMilestone?.title ?? null,
        nextBestAction: computeNextBestAction(flat),
    };
}

/**
 * Determine the single next actionable item — the first not-completed
 * execution step, on the first not-completed task, in dependency/order
 * order. Powers the "Continue Working" / Next Best Action card.
 * @param {object} flatProject - a `toClientTask()` result
 * @returns {object|null} { taskId, taskTitle, stepId, stepTitle, estimatedMinutes } or null when everything is done
 */
export function computeNextBestAction(flatProject) {
    const tasks = [...(flatProject.subtasks ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Prefer a task that's already in progress, so users resume rather than
    // jump to a "closer to the top" but untouched task.
    const inProgress = tasks.find((t) => t.status === 'in_progress');
    const candidateTask = inProgress ?? tasks.find((t) => t.status !== 'completed');
    if (!candidateTask) return null;

    const steps = [...(candidateTask.executionSteps ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const nextStep = steps.find((s) => s.status !== 'completed' && !(s.isOptional && s.status === 'skipped'));

    return {
        taskId: candidateTask.id,
        taskTitle: candidateTask.title,
        stepId: nextStep?.id ?? null,
        stepTitle: nextStep?.title ?? null,
        estimatedMinutes: nextStep?.estimatedMinutes ?? candidateTask.estimatedMinutes ?? null,
    };
}

/**
 * Compute the Project Health summary block (Overview tab).
 * Pure, deterministic — the schedule-risk/completion-probability numbers
 * are passed in by the caller (routes/projects.js) from
 * progress_tracking_agent's live risk model, keeping that formula defined
 * in exactly one place and avoiding a contextManager <-> progress_tracking_agent
 * circular import.
 * @param {object} context
 * @param {object} flatProject - `toClientTask()` result
 * @param {{ scheduleRisk?: number, completionProbability?: number }} [live]
 * @returns {object} project health summary
 */
export function computeProjectHealth(context, flatProject, live = {}) {
    const knowledge = context.knowledge ?? {};
    const estimation = context.estimation ?? {};
    const tasks = flatProject.subtasks ?? [];

    const remainingMinutes = tasks
        .filter((t) => t.status !== 'completed')
        .reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);

    // Bottleneck = highest-risk not-yet-done milestone, else the longest
    // remaining not-started task.
    const openMilestones = (flatProject.milestones ?? []).filter((m) => m.progress < 100);
    const riskOrder = { high: 2, medium: 1, low: 0 };
    const riskiestMilestone = openMilestones
        .slice()
        .sort((a, b) => (riskOrder[b.riskLevel] ?? 0) - (riskOrder[a.riskLevel] ?? 0))[0];

    return {
        overallProgress: flatProject.progress,
        scheduleRisk: live.scheduleRisk ?? flatProject.riskScore ?? 0,
        planningConfidence: context.intent?.confidence ?? estimation.confidence ?? 70,
        knowledgeCompletion: knowledge.requiresLearning
            ? Math.round(((knowledge.resources ?? []).length > 0 ? 1 : 0.5) * 100)
            : 100,
        estimatedRemainingMinutes: remainingMinutes,
        completionProbability: live.completionProbability ?? Math.max(0, 100 - (flatProject.riskScore ?? 0)),
        currentBottleneck: riskiestMilestone
            ? `${riskiestMilestone.title} (${riskiestMilestone.riskLevel} risk, ${riskiestMilestone.progress}% done)`
            : (tasks.find((t) => t.status !== 'completed')?.title ?? null),
    };
}

function _computeTaskStatus(context) {
    const schedule = context.schedule ?? {};
    const planning = context.planning ?? {};
    const tasks = planning.tasks ?? [];

    if (tasks.length === 0) return 'pending';

    const allDone = tasks.every(t => t.progress?.status === 'completed');
    if (allDone) return 'completed';

    const anyInProgress = tasks.some(t => t.progress?.status === 'in_progress');
    if (anyInProgress) return 'active';

    const deadline = context.intent?.deadline ?? context.explicitDeadline;
    if (deadline && new Date(deadline) < new Date()) return 'overdue';

    return 'active';
}

// ─────────────────────────────────────────────────────────────────────────────
// Task History — for Memory Agent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a task_history entry from a completed PlanningContext.
 * Stored in Firestore `task_history` collection after task completion.
 * @param {object} context
 * @returns {object} task history entry
 */
export function toTaskHistoryEntry(context) {
    const intent = context.intent ?? {};
    const planning = context.planning ?? {};
    const estimation = context.estimation ?? {};
    const schedule = context.schedule ?? {};

    const tasks = planning.tasks ?? [];
    const estimations = estimation.estimations ?? [];

    // Compute actual vs estimated per task
    const taskPerformance = tasks.map(task => {
        const est = estimations.find(e => e.taskId === task.taskId);
        return {
            taskId: task.taskId,
            title: task.title,
            difficulty: task.difficulty,
            estimatedMinutes: est?.finalEstimateMinutes ?? null,
            actualMinutes: task.progress?.actualMinutes ?? null,
            status: task.progress?.status ?? 'not_started',
        };
    });

    return {
        taskId: context.taskId,
        userId: context.userId,
        title: intent.title ?? context.rawGoal?.slice(0, 50) ?? 'Untitled project',
        rawGoal: context.rawGoal,
        category: intent.category ?? 'other',
        complexity: intent.complexity ?? 'medium',
        deadline: intent.deadline ?? context.explicitDeadline,
        milestoneCount: (planning.milestones ?? []).length,
        taskCount: tasks.length,
        taskPerformance,
        schedulingScore: schedule.schedulingScore ?? null,
        revisionCount: context.metadata.revisionCount ?? 0,
        createdAt: context.metadata.createdAt,
        completedAt: new Date().toISOString(),
        pipelineVersion: context.metadata.pipelineVersion,
    };
}
