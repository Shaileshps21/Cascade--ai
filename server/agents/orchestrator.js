/**
 * Orchestrator
 * ────────────────────────────────────────────────────────────────────────────
 * Chains all 5 agents in sequence and coordinates:
 *   - SSE event streaming to the client
 *   - Firestore persistence
 *   - RAG outcome recording
 *
 * Called asynchronously from the POST /api/tasks/initiate route.
 * The processId is returned immediately to the client who then
 * opens an SSE connection to watch the agents work in real-time.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/firebase.js';
import { emit, close, closeWithError } from '../rag/sseManager.js';
import { runParserAgent } from './parserAgent.js';
import { runPrioritizationAgent } from './prioritizationAgent.js';
import { runPlanningAgent } from './planningAgent.js';
import { runSchedulerAgent } from './schedulerAgent.js';
import { generateEmbedding } from '../rag/embeddings.js';
import { addEntry } from '../rag/vectorStore.js';

/**
 * Build the SSE emitter for a specific processId.
 * Wraps the sseManager.emit to include a timestamp automatically.
 */
function makeEmitter(processId) {
  return (event) => {
    emit(processId, { ...event, ts: Date.now() });
  };
}

/**
 * Run the full agent pipeline for a new task.
 *
 * @param {string} processId – SSE stream identifier
 * @param {string} rawInput  – user's natural language task
 * @param {string} userId    – Firebase UID
 */
export async function orchestrateTask(processId, rawInput, userId) {
  const emitter = makeEmitter(processId);

  try {
    // ── System Start ─────────────────────────────────────────────────────
    emitter({
      agent: 'system',
      status: 'start',
      message: '🚀 LifeSaver activated — launching agents...',
    });

    // ── Agent 1: Parse ───────────────────────────────────────────────────
    const parsedTask = await runParserAgent(rawInput, emitter);

    // ── Agent 2: Prioritize (RAG) ─────────────────────────────────────────
    const priorityScores = await runPrioritizationAgent(parsedTask, userId, emitter);

    // Merge parsed + priority into one task object
    const enrichedTask = {
      ...parsedTask,
      ...priorityScores,
    };

    // ── Agent 3: Plan ─────────────────────────────────────────────────────
    const { subtasks, totalEstimatedMinutes, planningNotes, criticalPath } =
      await runPlanningAgent(enrichedTask, emitter);

    // ── Agent 4: Schedule ─────────────────────────────────────────────────
    const { scheduledSlots, calendarConnected, warnings } =
      await runSchedulerAgent(subtasks, userId, enrichedTask.deadline, enrichedTask.title, emitter);

    // Merge schedule back into subtasks
    const scheduledSubtasks = subtasks.map((s) => {
      const slot = scheduledSlots.find((sl) => sl.subtaskId === s.id);
      if (!slot) return s;
      return {
        ...s,
        scheduledStart: slot.startTime,
        scheduledEnd: slot.endTime,
        calendarEventId: slot.calendarEventId,
      };
    });

    // ── Save to Firestore ─────────────────────────────────────────────────
    emitter({ agent: 'system', status: 'thinking', message: '💾 Saving your task...' });

    const taskId = uuidv4();
    const taskDoc = {
      id: taskId,
      userId,
      rawInput,

      // Parser output
      title: enrichedTask.title,
      deadline: enrichedTask.deadline,
      estimatedHours: enrichedTask.estimatedHours,
      category: enrichedTask.category,
      complexity: enrichedTask.complexity,
      dependencies: enrichedTask.dependencies || [],
      tags: enrichedTask.tags || [],
      confidence: enrichedTask.confidence,

      // Prioritization output
      priorityScore: enrichedTask.priorityScore,
      urgencyScore: enrichedTask.urgencyScore,
      importanceScore: enrichedTask.importanceScore,
      riskScore: enrichedTask.riskScore,
      reasoning: enrichedTask.reasoning,
      personalizationInsights: enrichedTask.personalizationInsights || [],
      recommendedStartTime: enrichedTask.recommendedStartTime,
      bufferHoursNeeded: enrichedTask.bufferHoursNeeded || 0,
      warningFlags: enrichedTask.warningFlags || [],
      ragContextUsed: enrichedTask.ragContextUsed || [],

      // Planning output
      subtasks: scheduledSubtasks,
      totalEstimatedMinutes,
      planningNotes,
      criticalPath,

      // Scheduler output
      scheduledSlots,
      calendarConnected,
      schedulerWarnings: warnings,

      // Status
      status: 'active',
      progress: 0,
      escalated: false,
      rePlannedCount: 0,
      lastChecked: null,
      lastRePlannedAt: null,

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('tasks').doc(taskId).set(taskDoc);

    // ── Add to RAG store for future personalization ───────────────────────
    try {
      const embeddingText = `${enrichedTask.category} task "${enrichedTask.title}" with ${enrichedTask.complexity} complexity`;
      const embedding = await generateEmbedding(embeddingText);
      await addEntry(userId, embeddingText, embedding, {
        taskId,
        category: enrichedTask.category,
        complexity: enrichedTask.complexity,
        estimatedHours: enrichedTask.estimatedHours,
        type: 'active_task',
      });
    } catch (ragErr) {
      console.warn('[Orchestrator] RAG store update failed (non-fatal):', ragErr.message);
    }

    // ── Done ──────────────────────────────────────────────────────────────
    close(processId, {
      taskId,
      title: enrichedTask.title,
      deadline: enrichedTask.deadline,
      priorityScore: enrichedTask.priorityScore,
      riskScore: enrichedTask.riskScore,
      subtaskCount: subtasks.length,
      calendarConnected,
      scheduledCount: scheduledSlots.length,
      warnings,
    });

  } catch (err) {
    console.error(`[Orchestrator] Pipeline failed for processId ${processId}:`, err);
    closeWithError(processId, err.message || 'An unexpected error occurred in the agent pipeline');
  }
}
