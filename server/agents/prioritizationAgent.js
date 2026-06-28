/**
 * Agent 2: Prioritization Agent  (RAG-Powered)
 * ────────────────────────────────────────────────────────────────────────────
 * Scores and prioritizes a task using:
 *   1. Urgency    – time remaining vs estimated effort
 *   2. Importance – category weight + complexity
 *   3. Personal history – RAG retrieval of past similar tasks
 *
 * This is the "personalization" that makes the system unique vs generic task apps.
 * The agent surfaces insights like: "Last time you had a high-complexity academic task,
 * you underestimated by 3 hours — I've adjusted the risk score accordingly."
 */

import { geminiPro, parseGeminiJSON } from '../config/gemini.js';
import { generateEmbedding } from '../rag/embeddings.js';
import { search } from '../rag/vectorStore.js';

const PRIORITY_PROMPT = `You are a task prioritization AI with deep insight into human productivity patterns.

You will receive:
1. A parsed task object
2. A user's personal history of similar past tasks (retrieved via semantic search)
3. Current timestamp

Using this information, compute a comprehensive priority assessment.

Respond ONLY with valid JSON (no markdown, no preamble):

{
  "priorityScore": <0-100, overall priority>,
  "urgencyScore": <0-100, how time-critical is this>,
  "importanceScore": <0-100, how impactful is this task>,
  "riskScore": <0-100, likelihood of missing deadline or poor outcome>,
  "reasoning": "<2-3 sentence explanation of the scores>",
  "personalizationInsights": [
    "<insight derived from user's past behavior>",
    "<another insight if applicable>"
  ],
  "recommendedStartTime": "<ISO 8601 — when user should START this task at the latest>",
  "bufferHoursNeeded": <extra hours to add as buffer, based on past underestimation patterns>,
  "warningFlags": ["<any critical warnings>"]
}

Scoring guidelines:
- urgencyScore: 90+ if deadline < 12h, 70+ if < 24h, 50+ if < 48h, 30+ if < 72h
- riskScore: increase if user has historically underestimated similar tasks
- If no personal history exists, base on task attributes alone and note "No personalization data yet"`;

/**
 * @param {object} parsedTask – output from parserAgent
 * @param {string} userId
 * @param {Function} emit – SSE emitter
 */
export async function runPrioritizationAgent(parsedTask, userId, emit = null) {
  emit?.({ agent: 'prioritization', status: 'thinking', message: '🧠 Searching your task history...' });

  // ── Step 1: Generate embedding for semantic RAG search ────────────────────
  const queryText = `${parsedTask.category} task: ${parsedTask.title}. Complexity: ${parsedTask.complexity}. Tags: ${parsedTask.tags?.join(', ')}`;
  let ragContext = [];

  try {
    const embedding = await generateEmbedding(queryText);
    const results = await search(userId, embedding, 5);
    ragContext = results.filter((r) => r.similarity > 0.5); // Only highly relevant entries
    emit?.({
      agent: 'prioritization',
      status: 'thinking',
      message: `📚 Found ${ragContext.length} relevant past tasks in your history`,
    });
  } catch (err) {
    // RAG failure is non-fatal — proceed without personalization
    console.warn('[Prioritization] RAG search failed, proceeding without:', err.message);
    emit?.({ agent: 'prioritization', status: 'thinking', message: '📚 No history found — using task attributes only' });
  }

  // ── Step 2: Build prompt with RAG context ─────────────────────────────────
  const now = new Date();
  const deadline = new Date(parsedTask.deadline);
  const hoursUntilDeadline = ((deadline - now) / (1000 * 60 * 60)).toFixed(1);

  const historyContext = ragContext.length > 0
    ? `USER'S RELEVANT PAST TASKS:\n${ragContext.map((r, i) =>
        `${i + 1}. ${r.text}\n   Similarity: ${(r.similarity * 100).toFixed(0)}%`
      ).join('\n')}`
    : 'USER HISTORY: No similar past tasks found. Use task attributes only for scoring.';

  const fullPrompt = `${PRIORITY_PROMPT}

---
CURRENT TASK:
${JSON.stringify(parsedTask, null, 2)}

CURRENT TIME: ${now.toISOString()}
HOURS UNTIL DEADLINE: ${hoursUntilDeadline}

${historyContext}
---`;

  emit?.({ agent: 'prioritization', status: 'thinking', message: '⚖️ Computing urgency, importance, and risk scores...' });

  // ── Step 3: Ask Gemini Pro to score ───────────────────────────────────────
  const result = await geminiPro.generateContent(fullPrompt);
  const responseText = result.response.text();

  let scores;
  try {
    scores = parseGeminiJSON(responseText);
  } catch {
    throw new Error('Prioritization agent returned invalid JSON');
  }

  // ── Step 4: Enforce sane bounds ───────────────────────────────────────────
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  scores.priorityScore = clamp(scores.priorityScore ?? 50);
  scores.urgencyScore = clamp(scores.urgencyScore ?? 50);
  scores.importanceScore = clamp(scores.importanceScore ?? 50);
  scores.riskScore = clamp(scores.riskScore ?? 50);
  scores.bufferHoursNeeded = Math.max(0, scores.bufferHoursNeeded ?? 0);
  scores.ragContextUsed = ragContext.map((r) => ({ text: r.text, similarity: r.similarity }));

  const riskLabel = scores.riskScore >= 80 ? '🔴 HIGH' : scores.riskScore >= 50 ? '🟡 MEDIUM' : '🟢 LOW';

  emit?.({
    agent: 'prioritization',
    status: 'done',
    message: `✅ Priority: ${scores.priorityScore}/100 — Risk: ${riskLabel} (${scores.riskScore}/100)`,
    data: {
      priorityScore: scores.priorityScore,
      urgencyScore: scores.urgencyScore,
      riskScore: scores.riskScore,
      reasoning: scores.reasoning,
      insights: scores.personalizationInsights,
    },
  });

  return scores;
}
