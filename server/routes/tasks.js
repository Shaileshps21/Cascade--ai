import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { registerClient } from '../rag/sseManager.js';
import { orchestrateTask, replanTask, resumeTask } from '../agents/orchestrator.js';
import { checkSingleTask } from '../agents/progress_tracking_agent/agent.js';
import { deleteCalendarEvents } from '../agents/google_calendar_agent/agent.js';
import { fromFirestoreDocument, toFirestoreDocument, toClientTask, toTaskHistoryEntry } from '../agents/contextManager.js';

const router = express.Router();

// ── POST /api/tasks/initiate ────────────────────────────────────────────────
router.post('/initiate', requireAuth, async (req, res) => {
  const { rawInput, deadline } = req.body;

  if (!rawInput?.trim()) {
    return res.status(400).json({ error: 'rawInput is required' });
  }

  // ── Deadline validation & logging ─────────────────────────────────────────
  let resolvedDeadline = null;

  if (deadline) {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'Invalid deadline format.' });
    }
    if (d <= new Date()) {
      return res.status(400).json({ error: 'Deadline must be in the future.' });
    }
    resolvedDeadline = d.toISOString(); // normalise to ISO string
    console.log(`[Tasks] Explicit deadline received → ${resolvedDeadline} (${d.toLocaleString()})`);
  } else {
    console.log('[Tasks] No explicit deadline — AI will infer from task text');
  }

  const processId = uuidv4();

  setImmediate(() =>
    orchestrateTask(processId, rawInput.trim(), req.user.uid, resolvedDeadline)
  );

  res.json({ processId });
});

// ── GET /api/tasks/stream/:processId ───────────────────────────────────────
router.get('/stream/:processId', (req, res) => {
  registerClient(req.params.processId, res);
});

// ── POST /api/tasks/:taskId/replan ──────────────────────────────────────────
// Manual trigger for the same replanning flow the progress-tracking cron
// runs automatically when a task's risk escalates (e.g. a missed/overrun
// task) — gives the user the freedom to force a reschedule on demand
// (e.g. right after they notice they've fallen behind, without waiting for
// the next 30-minute sweep). Streams progress over the same SSE channel
// /initiate uses.
router.post('/:taskId/replan', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }
  } catch {
    return res.status(500).json({ error: 'Failed to look up task' });
  }

  const processId = uuidv4();
  setImmediate(() => replanTask(taskId, req.user.uid, processId));
  res.json({ processId });
});

// ── POST /api/tasks/:taskId/resume ──────────────────────────────────────────
// Continue a planning run that failed part-way. The orchestrator checkpoints
// after its expensive stages, so this reuses the completed ones instead of
// re-paying for a dozen LLM calls. Streams over the same SSE channel.
router.post('/:taskId/resume', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (doc.data().metadata?.pipelineStage === 'complete') {
      return res.status(409).json({ error: 'This project already finished planning.' });
    }
  } catch {
    return res.status(500).json({ error: 'Failed to look up task' });
  }

  const processId = uuidv4();
  setImmediate(() => resumeTask(taskId, req.user.uid, processId));
  res.json({ processId });
});

// ── GET /api/tasks/failed ────────────────────────────────────────────────────
// Returns tasks where the pipeline failed mid-run and left a checkpoint.
// These are excluded from GET /api/tasks and GET /api/projects because a
// partial document should not render as a real project card. This endpoint
// exposes them explicitly so the Dashboard can offer a "Resume" button.
router.get('/failed', requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection('tasks')
      .where('userId', '==', req.user.uid)
      .where('metadata.pipelineFailed', '==', true)
      .limit(10)
      .get();

    const failed = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        taskId: doc.id,
        rawGoal: data.rawGoal ?? data.intent?.title ?? 'Untitled task',
        pipelineStage: data.metadata?.pipelineStage ?? 'unknown',
        pipelineError: data.metadata?.pipelineError ?? null,
        checkpointedAt: data.metadata?.checkpointedAt ?? null,
      };
    });

    res.json({ failed });
  } catch (err) {
    console.error('[Tasks GET /failed]', err);
    res.status(500).json({ error: 'Failed to fetch interrupted tasks' });
  }
});


router.get('/', requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection('tasks')
      .where('userId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const now = new Date();
    const tasks = snapshot.docs
      // Partial documents left by a failed run are resumable, not real tasks.
      .filter((doc) => doc.data()?.metadata?.pipelineFailed !== true)
      .map((doc) => {
      const clientTask = toClientTask(fromFirestoreDocument(doc.data()));
      const deadline = new Date(clientTask.deadline);
      return {
        ...clientTask,
        hoursRemaining: Math.max(0, Math.round((deadline - now) / 3_600_000 * 10) / 10),
      };
    });

    res.json({ tasks });
  } catch (err) {
    console.error('[Tasks GET]', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ── GET /api/tasks/:taskId ──────────────────────────────────────────────────
router.get('/:taskId', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });
    res.json({ task: toClientTask(fromFirestoreDocument(doc.data())) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// ── PATCH /api/tasks/:taskId/subtask/:subtaskId/complete ────────────────────
router.patch('/:taskId/subtask/:subtaskId/complete', requireAuth, async (req, res) => {
  const { taskId, subtaskId } = req.params;
  const { actualMinutes = null } = req.body ?? {};
  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });

    const context = fromFirestoreDocument(doc.data());
    const scheduledSlot = context.schedule?.scheduledTasks?.find((s) => s.taskId === subtaskId);

    // Delete Google Calendar event if present (non-fatal)
    let calendarEventDeleted = false;
    if (scheduledSlot?.calendarEventId) {
      try {
        await deleteCalendarEvents(req.user.uid, [scheduledSlot.calendarEventId]);
        calendarEventDeleted = true;
      } catch (calErr) {
        console.warn('[Tasks] Calendar delete failed (non-fatal):', calErr.message);
      }
    }

    const result = await checkSingleTask(taskId, req.user.uid, subtaskId, actualMinutes);

    res.json({ success: true, calendarEventDeleted, ...result });
  } catch (err) {
    console.error('[Subtask Complete]', err);
    res.status(500).json({ error: 'Failed to complete subtask' });
  }
});

// ── PATCH /api/tasks/:taskId/complete ──────────────────────────────────────
router.patch('/:taskId/complete', requireAuth, async (req, res) => {
  const { actualHours } = req.body ?? {};
  try {
    const doc = await db.collection('tasks').doc(req.params.taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });

    const context = fromFirestoreDocument(doc.data());
    const nowISO = new Date().toISOString();

    for (const task of context.planning?.tasks ?? []) {
      if (task.progress?.status !== 'completed') {
        task.progress = {
          ...task.progress,
          status: 'completed',
          completedAt: nowISO,
          actualMinutes: task.progress?.actualMinutes
            ?? (actualHours ? actualHours * 60 : task.estimatedMinutes ?? null),
        };
      }
    }
    context.metadata.updatedAt = nowISO;

    await doc.ref.set(toFirestoreDocument(context));

    try {
      const { recordBenchmarkSnapshot } = await import('../agents/evaluation_benchmark_agent/agent.js');
      await recordBenchmarkSnapshot(context);
    } catch (benchErr) {
      console.warn('[Task Complete] Benchmark snapshot skipped (non-fatal):', benchErr.message);
    }
    try {
      await db.collection('task_history').doc(req.params.taskId).set(toTaskHistoryEntry(context), { merge: true });
    } catch (histErr) {
      console.warn('[Task Complete] History write skipped (non-fatal):', histErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Task Complete]', err);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// ── DELETE /api/tasks/:taskId ───────────────────────────────────────────────
router.delete('/:taskId', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid)
      return res.status(404).json({ error: 'Task not found' });

    const context = fromFirestoreDocument(doc.data());
    const eventIds = (context.schedule?.scheduledTasks ?? [])
      .map((s) => s.calendarEventId)
      .filter(Boolean);
    if (eventIds.length) {
      try {
        await deleteCalendarEvents(req.user.uid, eventIds);
      } catch (calErr) {
        console.warn('[Tasks] Calendar cleanup failed (non-fatal):', calErr.message);
      }
    }

    await doc.ref.delete();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;