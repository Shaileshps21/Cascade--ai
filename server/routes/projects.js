/**
 * routes/projects.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Project Workspace API — the read/write surface for the redesigned client
 * navigation (Dashboard → Project Workspace → Task Workspace).
 *
 * A "Project" is the same Firestore `tasks/{taskId}` document the legacy
 * `/api/tasks` routes operate on (one document = one serialized
 * PlanningContext, holding the full Milestones → Modules → Tasks →
 * Execution Steps hierarchy). These routes just expose that hierarchy
 * shaped for the new UI instead of the old flat subtask list, and add the
 * one genuinely new capability: per-execution-step progress updates.
 *
 * `/api/tasks/initiate`, the SSE stream, and delete stay on the legacy
 * router — they're unrelated to how the result is displayed.
 */

import express from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import {
    fromFirestoreDocument,
    toFirestoreDocument,
    toClientTask,
    toClientProject,
    computeProjectHealth,
} from '../agents/contextManager.js';
import { computeLiveRiskScore, computeDelayProbability } from '../agents/progress_tracking_agent/agent.js';
import { applyStepUpdate, ALLOWED_STEP_STATUSES } from '../agents/shared/stepProgress.js';
import { nextTaskId, buildQuickAddTask, buildQuickAddScheduleEntry, isEndDateBeforeStartDate } from '../agents/shared/quickAddTask.js';
import { nextModuleId, buildManualModule, resolveModuleSource } from '../agents/shared/quickAddModule.js';
import { syncScheduleToCalendar, deleteCalendarEvents } from '../agents/google_calendar_agent/agent.js';

const router = express.Router();

async function loadOwnedContext(projectId, userId) {
    const doc = await db.collection('tasks').doc(projectId).get();
    if (!doc.exists || doc.data().userId !== userId) return null;
    return { doc, context: fromFirestoreDocument(doc.data()) };
}

function withHealth(context) {
    const project = toClientProject(context);
    const health = computeProjectHealth(context, project, {
        scheduleRisk: computeLiveRiskScore(context),
        completionProbability: Math.max(0, 100 - computeDelayProbability(context)),
    });
    return { ...project, health };
}

// toClientTask() sorts the flat subtask list (Dashboard's "next best
// action", Schedule tab, etc.) by task.order, not by position in
// module.tasks — renumber every task's order to match the tree walk
// whenever the tree itself changes (reorder, or a task being removed from
// it), so the flat views agree with what the Roadmap tab shows.
function renumberTaskOrder(context) {
    const tasksById = new Map((context.planning.tasks ?? []).map((t) => [t.taskId, t]));
    let order = 1;
    for (const milestone of context.planning?.milestones ?? []) {
        for (const mod of milestone.modules ?? []) {
            for (const taskId of mod.tasks ?? []) {
                const task = tasksById.get(taskId);
                if (task) task.order = order++;
            }
        }
    }
}

// ── GET /api/projects — Dashboard project cards ─────────────────────────────
router.get('/', requireAuth, async (req, res) => {
    try {
        const snapshot = await db
            .collection('tasks')
            .where('userId', '==', req.user.uid)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        const projects = snapshot.docs
            // Mid-pipeline checkpoints mean a failed run now leaves a partial
            // document behind (deliberately — it is what makes resuming possible
            // instead of re-paying for every completed stage). Those are not
            // real projects and must not render as half-empty cards; they are
            // reachable through POST /api/tasks/:taskId/resume.
            .filter((doc) => doc.data()?.metadata?.pipelineFailed !== true)
            // Archived (soft-deleted) projects: the archive flow only ever
            // removed these from the /api/tasks list, never from this one —
            // the Dashboard calls this endpoint, so an archived project would
            // silently reappear on the next full page load.
            .filter((doc) => doc.data()?.metadata?.archived !== true)
            .map((doc) => {
            const context = fromFirestoreDocument(doc.data());
            const project = toClientProject(context);

            return {
                id: project.id,
                title: project.title,
                progress: project.progress,
                deadline: project.deadline,
                remainingDays: project.deadline
                    ? Math.max(0, Math.ceil((new Date(project.deadline) - Date.now()) / 86_400_000))
                    : null,
                remainingHours: Math.round((project.subtasks
                    .filter((t) => t.status !== 'completed')
                    .reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0) / 60) * 10) / 10,
                priority: project.priorityScore >= 70 ? 'high' : project.priorityScore >= 40 ? 'medium' : 'low',
                aiConfidence: context.intent?.confidence ?? 70,
                riskLevel: project.riskScore >= 70 ? 'high' : project.riskScore >= 40 ? 'medium' : 'low',
                currentMilestone: project.currentMilestoneTitle,
                nextRecommendedTask: project.nextBestAction?.taskTitle ?? null,
                lastUpdated: project.updatedAt,
                status: project.status,
                manualMode: project.manualMode,
                hasSchedule: project.hasSchedule,
                aiEnhanced: project.aiEnhanced,
                calendarSync: context.metadata?.calendarSync !== false,
            };
        });

        res.json({ projects });
    } catch (err) {
        console.error('[Projects GET]', err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// ── GET /api/projects/:projectId — Project Workspace (Overview + Roadmap) ───
router.get('/:projectId', requireAuth, async (req, res) => {
    try {
        const found = await loadOwnedContext(req.params.projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        res.json({ project: withHealth(found.context) });
    } catch (err) {
        console.error('[Project GET]', err);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// ── GET /api/projects/:projectId/milestones — Roadmap tree only ─────────────
router.get('/:projectId/milestones', requireAuth, async (req, res) => {
    try {
        const found = await loadOwnedContext(req.params.projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const project = toClientProject(found.context);
        res.json({ milestones: project.milestones });
    } catch (err) {
        console.error('[Project Milestones GET]', err);
        res.status(500).json({ error: 'Failed to fetch milestones' });
    }
});

// ── GET /api/projects/:projectId/modules/:moduleId — Task List ──────────────
router.get('/:projectId/modules/:moduleId', requireAuth, async (req, res) => {
    try {
        const found = await loadOwnedContext(req.params.projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const project = toClientProject(found.context);
        for (const milestone of project.milestones) {
            const mod = milestone.modules.find((m) => m.id === req.params.moduleId);
            if (mod) return res.json({ milestone: { id: milestone.id, title: milestone.title }, module: mod });
        }
        res.status(404).json({ error: 'Module not found' });
    } catch (err) {
        console.error('[Project Module GET]', err);
        res.status(500).json({ error: 'Failed to fetch module' });
    }
});

// ── GET /api/projects/:projectId/tasks/:taskId — Task Workspace ─────────────
router.get('/:projectId/tasks/:taskId', requireAuth, async (req, res) => {
    try {
        const found = await loadOwnedContext(req.params.projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const flat = toClientTask(found.context);
        const task = flat.subtasks.find((t) => t.id === req.params.taskId);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({
            project: { id: flat.id, title: flat.title, createdAt: flat.createdAt },
            task: {
                ...task,
                progress: task.executionSteps.length > 0
                    ? Math.round(
                        (task.executionSteps.filter((s) => s.status === 'completed' || (s.isOptional && s.status === 'skipped')).length
                            / task.executionSteps.length) * 100,
                    )
                    : (task.completed ? 100 : 0),
            },
        });
    } catch (err) {
        console.error('[Project Task GET]', err);
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});

// ── PATCH /api/projects/:projectId/tasks/:taskId/steps/:stepId ──────────────
// Updates one execution step and lets task/module/milestone/project progress
// be re-derived from it on the next read (single source of truth: the steps).
router.patch('/:projectId/tasks/:taskId/steps/:stepId', requireAuth, async (req, res) => {
    const { projectId, taskId, stepId } = req.params;
    const { status, progress, notes, completionEvidence, blockedReason, actualMinutes } = req.body ?? {};

    if (status !== undefined && !ALLOWED_STEP_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${ALLOWED_STEP_STATUSES.join(', ')}` });
    }

    try {
        const found = await loadOwnedContext(projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const { doc, context } = found;

        const task = (context.planning?.tasks ?? []).find((t) => t.taskId === taskId);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const step = (task.executionSteps ?? []).find((s) => (s.id ?? s.stepId) === stepId);
        if (!step) return res.status(404).json({ error: 'Execution step not found' });

        const nowISO = new Date().toISOString();
        const wasCompleted = task.progress?.status === 'completed';

        // Status transitions, the completion trail and the actual-effort rollup
        // all live in applyStepUpdate() so they can be tested without Firestore.
        applyStepUpdate(task, step, { status, progress, notes, completionEvidence, blockedReason, actualMinutes }, nowISO);

        // Every execution step resolving completes the task — its scheduled
        // calendar event is no longer meaningful, so it's removed the moment
        // that happens (not just when the whole subtask is later deleted).
        if (task.progress.status === 'completed' && !wasCompleted) {
            const scheduledSlot = (context.schedule?.scheduledTasks ?? []).find((s) => s.taskId === taskId);
            if (scheduledSlot?.calendarEventId) {
                try {
                    await deleteCalendarEvents(req.user.uid, [scheduledSlot.calendarEventId]);
                } catch (calErr) {
                    console.warn('[Step PATCH] Calendar cleanup failed (non-fatal):', calErr.message);
                }
                delete scheduledSlot.calendarEventId;
                delete scheduledSlot.calendarLabel;
            }
        }

        context.metadata.updatedAt = nowISO;
        await doc.ref.set(toFirestoreDocument(context));

        const flat = toClientTask(context);
        const updatedTask = flat.subtasks.find((t) => t.id === taskId);
        res.json({ success: true, task: updatedTask, project: withHealth(context) });
    } catch (err) {
        console.error('[Step PATCH]', err);
        res.status(500).json({ error: 'Failed to update execution step' });
    }
});

// ── PATCH /api/projects/:projectId/tasks/:taskId/notes ──────────────────────
// Sets a single free-text markdown note on a task — separate from per-step
// notes and from completionEvidence (suggestions.md #4).
router.patch('/:projectId/tasks/:taskId/notes', requireAuth, async (req, res) => {
    const { projectId, taskId } = req.params;
    const { text } = req.body ?? {};

    if (typeof text !== 'string') {
        return res.status(400).json({ error: '`text` (string) is required.' });
    }

    try {
        const found = await loadOwnedContext(projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const { doc, context } = found;

        const task = (context.planning?.tasks ?? []).find((t) => t.taskId === taskId);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // Single-note-per-task model: stored as a one-element array so it
        // stays compatible with every existing reader of task.notes (an
        // array), which currently only ever holds AI-authored strings.
        task.notes = text.trim() ? [text] : [];
        context.metadata.updatedAt = new Date().toISOString();
        await doc.ref.set(toFirestoreDocument(context));

        const flat = toClientTask(context);
        res.json({ success: true, task: flat.subtasks.find((t) => t.id === taskId) });
    } catch (err) {
        console.error('[Task Notes PATCH]', err);
        res.status(500).json({ error: 'Failed to update task note' });
    }
});

// ── POST /api/projects/:projectId/modules — Add Module ──────────────────────
// Appends a new, empty module to an existing milestone without running any
// agent — works identically on AI-generated and manually-built projects,
// since both store the same Milestones → Modules → Tasks shape. The new
// module is tagged source: 'manual' (see shared/quickAddModule.js), which is
// what lets its subtasks — including ones later Quick-Added into it — be
// deleted, unlike subtasks of an AI-planned module.
// Body: { milestoneId, title }
router.post('/:projectId/modules', requireAuth, async (req, res) => {
    const { projectId } = req.params;
    const { milestoneId, title } = req.body ?? {};

    if (!milestoneId || typeof milestoneId !== 'string') {
        return res.status(400).json({ error: '`milestoneId` is required.' });
    }
    if (!title?.trim()) {
        return res.status(400).json({ error: '`title` is required.' });
    }

    try {
        const found = await loadOwnedContext(projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const { doc, context } = found;

        const targetMilestone = (context.planning?.milestones ?? []).find((m) => m.id === milestoneId);
        if (!targetMilestone) return res.status(404).json({ error: 'Milestone not found' });

        const moduleId = nextModuleId(context.planning.milestones);
        const newModule = buildManualModule({ id: moduleId, title: title.trim() });
        targetMilestone.modules = [...(targetMilestone.modules ?? []), newModule];

        context.metadata.updatedAt = new Date().toISOString();
        await doc.ref.set(toFirestoreDocument(context));

        const project = withHealth(context);
        const clientModule = project.milestones
            .find((m) => m.id === milestoneId)
            ?.modules.find((m) => m.id === moduleId);

        res.json({ success: true, module: clientModule, project });
    } catch (err) {
        console.error('[Project Module POST]', err);
        res.status(500).json({ error: 'Failed to add module' });
    }
});

// ── DELETE /api/projects/:projectId/modules/:moduleId — Delete Module ───────
// Only deletable when the module is manually-added (see resolveModuleSource())
// AND currently empty — deleting a non-empty module would either strand its
// subtasks or require a cascading delete this endpoint doesn't attempt. To
// remove a manually-added module that still has subtasks, delete each
// subtask first (DELETE .../tasks/:taskId), then this becomes a no-op-safe
// empty-module delete.
router.delete('/:projectId/modules/:moduleId', requireAuth, async (req, res) => {
    const { projectId, moduleId } = req.params;

    try {
        const found = await loadOwnedContext(projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const { doc, context } = found;

        let targetMilestone = null;
        let targetModule = null;
        for (const milestone of context.planning?.milestones ?? []) {
            const mod = (milestone.modules ?? []).find((m) => m.id === moduleId);
            if (mod) { targetMilestone = milestone; targetModule = mod; break; }
        }
        if (!targetModule) return res.status(404).json({ error: 'Module not found' });

        if (resolveModuleSource(targetModule, context.metadata) !== 'manual') {
            return res.status(403).json({ error: "This module is AI-generated and can't be deleted." });
        }
        if ((targetModule.tasks ?? []).length > 0) {
            return res.status(400).json({ error: 'Delete this module\'s subtasks first — only an empty module can be deleted.' });
        }

        targetMilestone.modules = targetMilestone.modules.filter((m) => m.id !== moduleId);

        context.metadata.updatedAt = new Date().toISOString();
        await doc.ref.set(toFirestoreDocument(context));

        res.json({ success: true, project: withHealth(context) });
    } catch (err) {
        console.error('[Project Module DELETE]', err);
        res.status(500).json({ error: 'Failed to delete module' });
    }
});

// ── POST /api/projects/:projectId/tasks — Quick-Add Subtask ─────────────────
// Appends one subtask to an existing module without running any agent — for
// when the user notices a step the AI (or their own manual plan) missed and
// wants to add it in one line rather than resubmitting/re-enhancing the whole
// project. Works identically for AI-generated and manually-built projects,
// since both store the same Milestones → Modules → Tasks shape. Same field
// set as the Manual Project Builder's per-subtask form (SubtaskFields.jsx):
// giving the new subtask its own Start Date + Start Time schedules it (and
// syncs it to Google Calendar, if connected and enabled) exactly like a
// fully-timed manual subtask does.
// Body: { moduleId, title, estimatedMinutes?, priority?, deadline?, startTime? }
router.post('/:projectId/tasks', requireAuth, async (req, res) => {
    const { projectId } = req.params;
    const { moduleId, title, estimatedMinutes, priority, deadline, startTime } = req.body ?? {};

    if (!moduleId || typeof moduleId !== 'string') {
        return res.status(400).json({ error: '`moduleId` is required.' });
    }
    if (!title?.trim()) {
        return res.status(400).json({ error: '`title` is required.' });
    }
    if (isEndDateBeforeStartDate(startTime, deadline)) {
        return res.status(400).json({ error: "End Date can't be before Start Date." });
    }

    try {
        const found = await loadOwnedContext(projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const { doc, context } = found;

        let targetModule = null;
        let targetMilestoneId = null;
        for (const milestone of context.planning?.milestones ?? []) {
            const mod = (milestone.modules ?? []).find((m) => m.id === moduleId);
            if (mod) { targetModule = mod; targetMilestoneId = milestone.id; break; }
        }
        if (!targetModule) return res.status(404).json({ error: 'Module not found' });

        const taskId = nextTaskId(context.planning.tasks);
        const newTask = buildQuickAddTask({
            taskId,
            milestoneId: targetMilestoneId,
            moduleId,
            title: title.trim(),
            estimatedMinutes,
            priority,
            deadline,
        });

        context.planning.tasks = [...(context.planning.tasks ?? []), newTask];
        targetModule.tasks = [...(targetModule.tasks ?? []), taskId];

        // A start time schedules just this one task — appended to the
        // project's existing schedule if it has one, or creating a minimal
        // one otherwise (mirrors routes/tasks.js POST /manual's per-subtask
        // scheduling, at single-task granularity).
        if (startTime) {
            const scheduleEntry = buildQuickAddScheduleEntry({
                taskId,
                title: newTask.title,
                estimatedMinutes: newTask.estimatedMinutes,
                priority: newTask.priority,
                startTime,
            });
            if (scheduleEntry) {
                context.schedule = context.schedule ?? {
                    schemaVersion: '1.0.0',
                    scheduledTasks: [],
                    bufferSlots: [],
                    schedulingScore: 100,
                    confidenceScore: 100,
                    warnings: [],
                    recommendations: [],
                    isFeasible: true,
                    failureConditions: null,
                    reasoning: {
                        confidence: 1,
                        assumptions: [],
                        warnings: [],
                        promptVersion: 'manual',
                    },
                };
                context.schedule.scheduledTasks = [...(context.schedule.scheduledTasks ?? []), scheduleEntry];

                if (context.metadata?.calendarSync !== false) {
                    try {
                        const syncResult = await syncScheduleToCalendar(context, req.user.uid);
                        context.schedule.scheduledTasks = syncResult.scheduledTasks;
                        context.metadata.calendarConnected = syncResult.calendarConnected;
                    } catch (err) {
                        console.warn('[Project Task POST] Calendar sync skipped:', err.message);
                    }
                }
            }
        }

        context.metadata.updatedAt = new Date().toISOString();
        await doc.ref.set(toFirestoreDocument(context));

        const flat = toClientTask(context);
        res.json({
            success: true,
            task: flat.subtasks.find((t) => t.id === taskId),
            project: withHealth(context),
        });
    } catch (err) {
        console.error('[Project Task POST]', err);
        res.status(500).json({ error: 'Failed to add subtask' });
    }
});

// ── PATCH /api/projects/:projectId/modules/:moduleId/reorder ────────────────
// Persists a new task order within one module (suggestions.md #2 —
// drag-to-reorder). The AI decides task order today; this lets the user
// override it without re-submitting the whole project. Reordering only —
// the taskIds sent must be an exact permutation of the module's existing
// tasks, never an add/remove, so a client bug can't silently corrupt it.
router.patch('/:projectId/modules/:moduleId/reorder', requireAuth, async (req, res) => {
    const { projectId, moduleId } = req.params;
    const { taskIds } = req.body ?? {};

    if (!Array.isArray(taskIds) || taskIds.some((id) => typeof id !== 'string')) {
        return res.status(400).json({ error: '`taskIds` must be an array of strings.' });
    }

    try {
        const found = await loadOwnedContext(projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const { doc, context } = found;

        let targetModule = null;
        for (const milestone of context.planning?.milestones ?? []) {
            const mod = (milestone.modules ?? []).find((m) => m.id === moduleId);
            if (mod) { targetModule = mod; break; }
        }
        if (!targetModule) return res.status(404).json({ error: 'Module not found' });

        const currentSet = new Set(targetModule.tasks ?? []);
        const newSet = new Set(taskIds);
        const isSamePermutation = currentSet.size === newSet.size && [...currentSet].every((id) => newSet.has(id));
        if (!isSamePermutation) {
            return res.status(400).json({ error: "taskIds must be a reordering of the module's existing tasks — no additions or removals." });
        }

        targetModule.tasks = taskIds;
        renumberTaskOrder(context);

        context.metadata.updatedAt = new Date().toISOString();
        await doc.ref.set(toFirestoreDocument(context));

        res.json({ success: true, project: withHealth(context) });
    } catch (err) {
        console.error('[Module Reorder PATCH]', err);
        res.status(500).json({ error: 'Failed to reorder module tasks' });
    }
});

// ── DELETE /api/projects/:projectId/tasks/:taskId — Delete Subtask ──────────
// Only deletable when the task's owning module is manually-added (Add
// Module, or an original module from a from-scratch Manual Project Builder
// project) — see resolveModuleSource(). A subtask AI-planned OR
// Quick-Added into an AI-generated module is never deletable from here.
router.delete('/:projectId/tasks/:taskId', requireAuth, async (req, res) => {
    const { projectId, taskId } = req.params;

    try {
        const found = await loadOwnedContext(projectId, req.user.uid);
        if (!found) return res.status(404).json({ error: 'Project not found' });
        const { doc, context } = found;

        const task = (context.planning?.tasks ?? []).find((t) => t.taskId === taskId);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        let targetModule = null;
        for (const milestone of context.planning?.milestones ?? []) {
            const mod = (milestone.modules ?? []).find((m) => m.id === task.moduleId);
            if (mod) { targetModule = mod; break; }
        }
        if (!targetModule) return res.status(404).json({ error: 'Module not found' });

        if (resolveModuleSource(targetModule, context.metadata) !== 'manual') {
            return res.status(403).json({ error: "This subtask belongs to an AI-generated module and can't be deleted." });
        }

        // Clean up any calendar event synced for this task before it's gone.
        const scheduledSlot = (context.schedule?.scheduledTasks ?? []).find((s) => s.taskId === taskId);
        if (scheduledSlot?.calendarEventId) {
            try {
                await deleteCalendarEvents(req.user.uid, [scheduledSlot.calendarEventId]);
            } catch (calErr) {
                console.warn('[Project Task DELETE] Calendar cleanup failed (non-fatal):', calErr.message);
            }
        }

        context.planning.tasks = context.planning.tasks.filter((t) => t.taskId !== taskId);
        targetModule.tasks = (targetModule.tasks ?? []).filter((id) => id !== taskId);
        if (context.schedule?.scheduledTasks) {
            context.schedule.scheduledTasks = context.schedule.scheduledTasks.filter((s) => s.taskId !== taskId);
        }
        // Defensive: strip the deleted task out of any other task's
        // dependencies so nothing is left pointing at a taskId that no
        // longer exists.
        for (const t of context.planning.tasks) {
            if (Array.isArray(t.dependencies) && t.dependencies.includes(taskId)) {
                t.dependencies = t.dependencies.filter((id) => id !== taskId);
            }
        }
        renumberTaskOrder(context);

        context.metadata.updatedAt = new Date().toISOString();
        await doc.ref.set(toFirestoreDocument(context));

        res.json({ success: true, project: withHealth(context) });
    } catch (err) {
        console.error('[Project Task DELETE]', err);
        res.status(500).json({ error: 'Failed to delete subtask' });
    }
});

export default router;
