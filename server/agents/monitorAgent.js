/**
 * Agent 5: Monitor & Re-Planner Agent
 * ────────────────────────────────────────────────────────────────────────────
 * Called by the cron job in index.js every 30 minutes.
 *
 * For every active task across all users it:
 *   1. Checks how many subtasks are overdue (scheduled time passed, not complete)
 *   2. Recomputes the live risk score
 *   3. If risk score spikes (> 80), autonomously re-plans the remaining subtasks
 *   4. Updates Firestore with the new schedule
 *   5. Sets escalation flag if deadline is < 2h away and task isn't done
 *
 * This is the "autonomous" part — it acts without the user asking.
 */

import { db } from '../config/firebase.js';
import { geminiFlash, parseGeminiJSON } from '../config/gemini.js';
import { runPlanningAgent } from './planningAgent.js';
import { runSchedulerAgent, deleteCalendarEvents } from './schedulerAgent.js';

/**
 * Compute a live risk score for a task based on current progress.
 * @param {object} task – Firestore task document
 * @returns {number} 0–100
 */
function computeLiveRiskScore(task) {
  const now = Date.now();
  const deadline = new Date(task.deadline).getTime();
  const created = task.createdAt?.toDate?.()?.getTime() || now - 3600000;

  const totalTime = deadline - created;
  const elapsed = now - created;
  const timeProgress = Math.min(1, elapsed / totalTime); // 0→1 as we approach deadline

  const subtasks = task.subtasks || [];
  const completed = subtasks.filter((s) => s.completed).length;
  const taskProgress = subtasks.length > 0 ? completed / subtasks.length : 0;

  // If time progress outpaces task progress → risk rises
  const gap = timeProgress - taskProgress;

  // Base score on gap
  let risk = Math.round(gap * 120); // 120% → capped at 100

  // Boost if deadline is very close
  const hoursLeft = (deadline - now) / 3600000;
  if (hoursLeft < 2 && taskProgress < 1) risk = Math.max(risk, 90);
  else if (hoursLeft < 6 && taskProgress < 0.5) risk = Math.max(risk, 75);

  // Count overdue slots
  const overdueCount = subtasks.filter((s) => {
    if (s.completed || !s.scheduledEnd) return false;
    return new Date(s.scheduledEnd) < new Date();
  }).length;
  risk += overdueCount * 15;

  return Math.min(100, Math.max(0, risk));
}

/**
 * Re-plan a task's remaining (incomplete) subtasks.
 * Deletes old calendar events, creates new ones.
 *
 * @param {object} task – Firestore task doc data
 * @param {string} taskId
 * @param {string} userId
 */
async function replanTask(task, taskId, userId) {
  console.log(`[Monitor] Re-planning task "${task.title}" for user ${userId}`);

  const pendingSubtasks = (task.subtasks || []).filter((s) => !s.completed);
  if (pendingSubtasks.length === 0) return;

  // Delete existing calendar events for pending subtasks
  const eventIdsToDelete = pendingSubtasks
    .map((s) => s.calendarEventId)
    .filter(Boolean);
  await deleteCalendarEvents(userId, eventIdsToDelete);

  // Re-schedule pending subtasks
  const { scheduledSlots } = await runSchedulerAgent(
    pendingSubtasks,
    userId,
    task.deadline,
    task.title
  );

  // Merge new schedule back into subtasks array
  const updatedSubtasks = task.subtasks.map((s) => {
    if (s.completed) return s;
    const slot = scheduledSlots.find((sl) => sl.subtaskId === s.id);
    if (!slot) return s;
    return {
      ...s,
      scheduledStart: slot.startTime,
      scheduledEnd: slot.endTime,
      calendarEventId: slot.calendarEventId,
    };
  });

  await db.collection('tasks').doc(taskId).update({
    subtasks: updatedSubtasks,
    scheduledSlots,
    rePlannedCount: (task.rePlannedCount || 0) + 1,
    lastRePlannedAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`[Monitor] Re-plan complete for "${task.title}" — ${scheduledSlots.length} slots rescheduled`);
}

/**
 * Main monitor sweep — called by cron every 30 minutes.
 */
export async function runMonitorAgent() {
  const now = new Date();
  let processed = 0;

  // Get all active tasks across all users
  const snapshot = await db
    .collection('tasks')
    .where('status', '==', 'active')
    .where('deadline', '>', now.toISOString())
    .get();

  if (snapshot.empty) {
    console.log('[Monitor] No active tasks to check');
    return;
  }

  for (const doc of snapshot.docs) {
    const task = doc.data();
    const taskId = doc.id;
    const userId = task.userId;

    try {
      const liveRisk = computeLiveRiskScore(task);
      const hoursLeft = (new Date(task.deadline) - now) / 3600000;

      const updates = {
        riskScore: liveRisk,
        lastChecked: now,
        updatedAt: now,
      };

      // ── Escalate if very close to deadline ──────────────────────────────
      if (hoursLeft < 2 && !task.escalated) {
        updates.escalated = true;
        updates.escalationMessage = `⚠️ Only ${Math.round(hoursLeft * 60)} minutes until deadline for "${task.title}"!`;
        console.warn(`[Monitor] ESCALATION: "${task.title}" has ${Math.round(hoursLeft * 60)}m left`);
      }

      // ── Status update ─────────────────────────────────────────────────
      const allDone = (task.subtasks || []).every((s) => s.completed);
      if (allDone) {
        updates.status = 'completed';
        updates.progress = 100;
      } else if (hoursLeft <= 0) {
        updates.status = 'overdue';
      } else if (liveRisk >= 70) {
        updates.status = 'at_risk';
      }

      // Compute progress %
      const subtasks = task.subtasks || [];
      if (subtasks.length > 0) {
        const done = subtasks.filter((s) => s.completed).length;
        updates.progress = Math.round((done / subtasks.length) * 100);
      }

      await doc.ref.update(updates);

      // ── Autonomous re-plan if high risk and enough time left ─────────
      if (liveRisk >= 80 && hoursLeft > 1 && (task.rePlannedCount || 0) < 3) {
        await replanTask(task, taskId, userId);
      }

      processed++;
    } catch (err) {
      console.error(`[Monitor] Error processing task ${taskId}:`, err.message);
    }
  }

  console.log(`[Monitor] Sweep complete — checked ${processed} tasks`);
}

/**
 * Single-task monitor check (called when user marks a subtask complete).
 */
export async function checkSingleTask(taskId, userId) {
  const doc = await db.collection('tasks').doc(taskId).get();
  if (!doc.exists) return;

  const task = doc.data();
  const liveRisk = computeLiveRiskScore(task);
  const hoursLeft = (new Date(task.deadline) - new Date()) / 3600000;

  const allDone = (task.subtasks || []).every((s) => s.completed);

  await doc.ref.update({
    riskScore: liveRisk,
    status: allDone ? 'completed' : hoursLeft < 0 ? 'overdue' : liveRisk >= 70 ? 'at_risk' : 'active',
    progress: Math.round(((task.subtasks || []).filter((s) => s.completed).length / (task.subtasks?.length || 1)) * 100),
    updatedAt: new Date(),
  });

  // Re-plan if high risk
  if (liveRisk >= 80 && hoursLeft > 1 && !allDone && (task.rePlannedCount || 0) < 3) {
    await replanTask(task, taskId, userId);
    return { replanTriggered: true, newRiskScore: liveRisk };
  }

  return { replanTriggered: false, newRiskScore: liveRisk };
}
