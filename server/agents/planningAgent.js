/**
 * Agent 3: Planning Agent
 * ────────────────────────────────────────────────────────────────────────────
 * Takes a prioritized task and decomposes it into a concrete, actionable
 * subtask plan with realistic time estimates and tips.
 *
 * Uses Gemini Pro for deep reasoning — this is where the "intelligent"
 * part of "intelligent task planning" lives.
 */

import { v4 as uuidv4 } from 'uuid';
import { geminiPro, parseGeminiJSON } from '../config/gemini.js';

const PLANNING_PROMPT = `You are an expert productivity planner and time estimator. Your job is to break a task into specific, actionable subtasks.

You will receive a task object with its priority scores and the current time.

Rules:
1. Subtasks must be concrete — not vague. Bad: "Research topic". Good: "Read 3 key papers on transformer architecture and take notes".
2. Time estimates must be realistic. Include bufferHoursNeeded in the total estimate.
3. Order subtasks logically — dependencies first.
4. Include a "Review" or "Check" subtask at the end.
5. Keep subtask count between 3 and 8.
6. Each subtask should be completable in one sitting (max 2 hours each).

Respond ONLY with valid JSON (no markdown, no preamble):

{
  "subtasks": [
    {
      "title": "<concise action title>",
      "description": "<specific what-to-do in 1-2 sentences>",
      "estimatedMinutes": <number>,
      "order": <1, 2, 3...>,
      "tips": ["<actionable tip>", "<optional second tip>"],
      "type": "one of: [setup, research, execution, review, communication, other]"
    }
  ],
  "totalEstimatedMinutes": <sum of all subtask minutes>,
  "planningNotes": "<1-2 sentence note about the strategy>",
  "criticalPath": "<which subtask is the most important / gating step>"
}`;

/**
 * @param {object} task – merged output from parser + prioritization agents
 * @param {Function} emit – SSE emitter
 */
export async function runPlanningAgent(task, emit = null) {
  emit?.({ agent: 'planning', status: 'thinking', message: '📝 Designing your action plan...' });

  const now = new Date();
  const deadline = new Date(task.deadline);
  const hoursAvailable = ((deadline - now) / (1000 * 60 * 60)).toFixed(1);

  const fullPrompt = `${PLANNING_PROMPT}

---
TASK TO PLAN:
${JSON.stringify({
  title: task.title,
  category: task.category,
  complexity: task.complexity,
  estimatedHours: task.estimatedHours + (task.bufferHoursNeeded || 0),
  tags: task.tags,
  dependencies: task.dependencies,
  priorityScore: task.priorityScore,
  riskScore: task.riskScore,
  warningFlags: task.warningFlags,
}, null, 2)}

CURRENT TIME: ${now.toISOString()}
DEADLINE: ${deadline.toISOString()}
HOURS AVAILABLE: ${hoursAvailable}h

Important: Total estimated minutes should NOT exceed ${Math.round(hoursAvailable * 60)} minutes (available time).
---`;

  const result = await geminiPro.generateContent(fullPrompt);
  const responseText = result.response.text();

  let plan;
  try {
    plan = parseGeminiJSON(responseText);
  } catch {
    throw new Error('Planning agent returned invalid JSON');
  }

  emit?.({
    agent: 'planning',
    status: 'thinking',
    message: `🗂️ Created ${plan.subtasks?.length || 0} subtasks — ${Math.round((plan.totalEstimatedMinutes || 0) / 60 * 10) / 10}h total`,
  });

  // ── Enrich subtasks with IDs and defaults ─────────────────────────────────
  const subtasks = (plan.subtasks || []).map((s, i) => ({
    id: uuidv4(),
    title: s.title || `Step ${i + 1}`,
    description: s.description || '',
    estimatedMinutes: Math.max(5, Math.round(s.estimatedMinutes || 30)),
    order: s.order || i + 1,
    tips: s.tips || [],
    type: s.type || 'other',
    completed: false,
    completedAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    calendarEventId: null,
  }));

  // Sort by order field
  subtasks.sort((a, b) => a.order - b.order);

  emit?.({
    agent: 'planning',
    status: 'done',
    message: `✅ Plan ready: ${subtasks.map((s) => s.title).join(' → ')}`,
    data: {
      subtasks: subtasks.map((s) => ({ title: s.title, estimatedMinutes: s.estimatedMinutes })),
      planningNotes: plan.planningNotes,
      criticalPath: plan.criticalPath,
    },
  });

  return {
    subtasks,
    totalEstimatedMinutes: plan.totalEstimatedMinutes || subtasks.reduce((s, t) => s + t.estimatedMinutes, 0),
    planningNotes: plan.planningNotes || '',
    criticalPath: plan.criticalPath || '',
  };
}
