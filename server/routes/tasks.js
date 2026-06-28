import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { registerClient } from '../rag/sseManager.js';
import { orchestrateTask } from '../agents/orchestrator.js';
import { checkSingleTask } from '../agents/monitorAgent.js';
import { recordOutcome } from '../rag/vectorStore.js';
import { generateEmbedding } from '../rag/embeddings.js';

const router = express.Router();

// ── POST /api/tasks/initiate ────────────────────────────────────────────────
// Starts the agent pipeline. Returns a processId for SSE streaming.
router.post('/initiate', requireAuth, async (req, res) => {
  const { rawInput } = req.body;
  if (!rawInput?.trim()) {
    return res.status(400).json({ error: 'rawInput is required' });
  }

  const processId = uuidv4();

  // Fire and forget — client tracks via SSE
  setImmediate(() => orchestrateTask(processId, rawInput.trim(), req.user.uid));

  res.json({ processId, message: 'Pipeline started. Connect to /stream/:processId for live updates.' });
});

// ── GET /api/tasks/stream/:processId ───────────────────────────────────────
// SSE endpoint — streams real-time agent trace events.
router.get('/stream/:processId', (req, res) => {
  const { processId } = req.params;
  registerClient(processId, res);
  // Connection stays open until orchestrator calls close()
});

// ── GET /api/tasks ──────────────────────────────────────────────────────────
// Return all tasks for the authenticated user.
router.get('/', requireAuth, async (req, res) => {
  try {
    const snapshot = await db
      .collection('tasks')
      .where('userId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const tasks = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      // Convert Firestore timestamps to ISO strings
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
      updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt,
    }));

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
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ task: { id: doc.id, ...doc.data() } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// ── PATCH /api/tasks/:taskId/subtask/:subtaskId/complete ────────────────────
// Mark a subtask as complete and trigger a risk re-evaluation.
router.patch('/:taskId/subtask/:subtaskId/complete', requireAuth, async (req, res) => {
  const { taskId, subtaskId } = req.params;

  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = doc.data();
    const updatedSubtasks = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, completed: true, completedAt: new Date().toISOString() } : s
    );

    await doc.ref.update({ subtasks: updatedSubtasks, updatedAt: new Date() });

    // Trigger monitor check (async, non-blocking)
    const monitorResult = await checkSingleTask(taskId, req.user.uid);

    res.json({
      success: true,
      replanTriggered: monitorResult.replanTriggered,
      newRiskScore: monitorResult.newRiskScore,
    });
  } catch (err) {
    console.error('[Subtask Complete]', err);
    res.status(500).json({ error: 'Failed to complete subtask' });
  }
});

// ── PATCH /api/tasks/:taskId/complete ──────────────────────────────────────
// Mark entire task as complete and record outcome in RAG.
router.patch('/:taskId/complete', requireAuth, async (req, res) => {
  const { taskId } = req.params;
  const { actualHours, minutesLate = 0 } = req.body;

  try {
    const doc = await db.collection('tasks').doc(taskId).get();
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = doc.data();

    await doc.ref.update({
      status: 'completed',
      progress: 100,
      completedAt: new Date().toISOString(),
      actualHours: actualHours || task.estimatedHours,
      minutesLate,
      updatedAt: new Date(),
    });

    // Record outcome in RAG for future personalization
    try {
      const embeddingText = `${task.category} task "${task.title}" complexity ${task.complexity}`;
      const embedding = await generateEmbedding(embeddingText);
      await recordOutcome(
        req.user.uid,
        {
          taskId,
          title: task.title,
          category: task.category,
          estimatedHours: task.estimatedHours,
          actualHours: actualHours || task.estimatedHours,
          completedOnTime: minutesLate <= 0,
          minutesLate: Math.max(0, minutesLate),
        },
        embedding
      );
    } catch (ragErr) {
      console.warn('[Tasks] RAG outcome record failed (non-fatal):', ragErr.message);
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
    if (!doc.exists || doc.data().userId !== req.user.uid) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await doc.ref.delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
