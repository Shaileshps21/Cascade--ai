// import { geminiPro, embeddingModel, parseGeminiJSON } from '../config/gemini.js';
// import { cosineSimilarity } from '../rag/embeddings.js';
// import { search } from '../rag/vectorStore.js';

// const PRIORITY_PROMPT = `You are a task prioritization AI. Score this task based on urgency, importance, and the user's personal history.

// Respond ONLY with valid JSON:
// {
//   "priorityScore": <0-100>,
//   "urgencyScore": <0-100>,
//   "importanceScore": <0-100>,
//   "riskScore": <0-100>,
//   "reasoning": "<2-3 sentences>",
//   "personalizationInsights": ["<insight from history>"],
//   "recommendedStartTime": "<ISO 8601>",
//   "bufferHoursNeeded": <number>,
//   "warningFlags": ["<warning>"]
// }

// Guidelines:
// - urgencyScore: 90+ if deadline <12h, 70+ if <24h, 50+ if <48h
// - riskScore: boost if user historically underestimates similar tasks
// - If no history, base scores on task attributes only`;

// export async function runPrioritizationAgent(parsedTask, userId, emit = null, clients = null) {
//   const pro = clients?.pro || geminiPro;

//   emit?.({ agent: 'prioritization', status: 'thinking', message: '🧠 Searching your task history...' });

//   let ragContext = [];
//   try {
//     // Use user's embedding client if available, else default
//     const embedder = clients?.embedding || embeddingModel;
//     const queryText = `${parsedTask.category} task: ${parsedTask.title}. Complexity: ${parsedTask.complexity}`;
//     const embResult = await embedder.embedContent(queryText);
//     const embedding = embResult.embedding.values;
//     const results = await search(userId, embedding, 5);
//     ragContext = results.filter((r) => r.similarity > 0.5);

//     emit?.({
//       agent: 'prioritization', status: 'thinking',
//       message: `📚 Found ${ragContext.length} relevant past tasks in your history`
//     });
//   } catch (err) {
//     console.warn('[Prioritization] RAG skipped:', err.message);
//     emit?.({ agent: 'prioritization', status: 'thinking', message: '📚 No history found — using task attributes only' });
//   }

//   const now = new Date();
//   const hoursUntilDeadline = ((new Date(parsedTask.deadline) - now) / 3_600_000).toFixed(1);
//   const historyContext = ragContext.length > 0
//     ? `USER HISTORY:\n${ragContext.map((r, i) => `${i + 1}. ${r.text} (similarity: ${(r.similarity * 100).toFixed(0)}%)`).join('\n')}`
//     : 'USER HISTORY: None yet — score based on task attributes only.';

//   const fullPrompt = `${PRIORITY_PROMPT}\n\nTASK:\n${JSON.stringify(parsedTask, null, 2)}\n\nCURRENT TIME: ${now.toISOString()}\nHOURS UNTIL DEADLINE: ${hoursUntilDeadline}\n\n${historyContext}`;

//   emit?.({ agent: 'prioritization', status: 'thinking', message: '⚖️ Computing urgency, importance, and risk scores...' });

//   const result = await pro.generateContent(fullPrompt);
//   let scores;
//   try {
//     scores = parseGeminiJSON(result.response.text());
//   } catch {
//     throw new Error('Prioritization agent returned invalid JSON');
//   }

//   const clamp = (v) => Math.max(0, Math.min(100, Math.round(v ?? 50)));
//   scores.priorityScore = clamp(scores.priorityScore);
//   scores.urgencyScore = clamp(scores.urgencyScore);
//   scores.importanceScore = clamp(scores.importanceScore);
//   scores.riskScore = clamp(scores.riskScore);
//   scores.bufferHoursNeeded = Math.max(0, scores.bufferHoursNeeded ?? 0);
//   scores.ragContextUsed = ragContext.map((r) => ({ text: r.text, similarity: r.similarity }));

//   const riskLabel = scores.riskScore >= 80 ? '🔴 HIGH' : scores.riskScore >= 50 ? '🟡 MEDIUM' : '🟢 LOW';
//   emit?.({
//     agent: 'prioritization', status: 'done',
//     message: `✅ Priority: ${scores.priorityScore}/100 — Risk: ${riskLabel} (${scores.riskScore}/100)`,
//     data: { priorityScore: scores.priorityScore, urgencyScore: scores.urgencyScore, riskScore: scores.riskScore, reasoning: scores.reasoning, insights: scores.personalizationInsights },
//   });

//   return scores;
// }



// ---------------------------------------------------------NEW FILE--------------------------------------------------------------------------------
/**
 * Agent 2: Prioritization Agent (RAG-Powered)
 * Uses clients.pro for scoring + clients.embedding for RAG (Gemini only).
 * Gracefully skips RAG when using Groq (no embedding support).
 */

import { defaultClients, parseJSON } from '../config/llm.js';
import { search } from '../rag/vectorStore.js';

const PRIORITY_PROMPT = `You are a task prioritization AI with insight into human productivity patterns.

Analyze the task and user history below. Respond ONLY with valid JSON:

{
  "priorityScore": <0-100 overall priority>,
  "urgencyScore":  <0-100 how time-critical>,
  "importanceScore": <0-100 how impactful>,
  "riskScore":     <0-100 likelihood of missing deadline>,
  "reasoning":     "<2-3 sentence explanation>",
  "personalizationInsights": ["<insight from user history if available>"],
  "recommendedStartTime": "<ISO 8601 — latest safe start time>",
  "bufferHoursNeeded": <extra hours based on past underestimation, default 0>,
  "warningFlags": ["<critical warning if any>"]
}

Scoring rules:
- urgencyScore: 90+ if <12h left, 70+ if <24h, 50+ if <48h, 30+ if <72h
- riskScore: increase if user historically underestimates this type of task
- If no user history, base on task attributes only and note it`;

export async function runPrioritizationAgent(parsedTask, userId, emit = null, clients = null) {
  const activeClients = clients || defaultClients;
  const pro = activeClients?.pro;
  if (!pro) throw new Error('No LLM client available.');

  emit?.({ agent: 'prioritization', status: 'thinking', message: '🧠 Searching your task history...' });

  // ── RAG: only works if embedding client can actually embed ────────────────
  let ragContext = [];
  try {
    const embedder = activeClients?.embedding;
    const queryText = `${parsedTask.category} task: ${parsedTask.title}. Complexity: ${parsedTask.complexity}`;
    const vector = await embedder?.embed(queryText);

    if (vector) {
      const results = await search(userId, vector, 5);
      ragContext = results.filter((r) => r.similarity > 0.5);
      emit?.({
        agent: 'prioritization', status: 'thinking',
        message: `📚 Found ${ragContext.length} relevant past tasks in your history`,
      });
    } else {
      // Groq path — no embeddings
      emit?.({ agent: 'prioritization', status: 'thinking', message: '📚 Scoring from task attributes (RAG unavailable with Groq)' });
    }
  } catch (err) {
    console.warn('[Prioritization] RAG skipped:', err.message);
    emit?.({ agent: 'prioritization', status: 'thinking', message: '📚 No history found — scoring from task attributes' });
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  const now = new Date();
  const hoursUntilDeadline = ((new Date(parsedTask.deadline) - now) / 3_600_000).toFixed(1);
  const historySection = ragContext.length > 0
    ? `USER HISTORY (most relevant past tasks):\n${ragContext.map((r, i) =>
      `${i + 1}. ${r.text}  [similarity: ${(r.similarity * 100).toFixed(0)}%]`
    ).join('\n')}`
    : 'USER HISTORY: None available — base scores on task attributes only.';

  const fullPrompt = `${PRIORITY_PROMPT}

TASK:
${JSON.stringify(parsedTask, null, 2)}

CURRENT TIME: ${now.toISOString()}
HOURS UNTIL DEADLINE: ${hoursUntilDeadline}

${historySection}`;

  emit?.({ agent: 'prioritization', status: 'thinking', message: '⚖️ Computing urgency, importance, and risk scores...' });

  const response = await pro.generateText(fullPrompt);

  let scores;
  try {
    scores = parseJSON(response);
  } catch {
    throw new Error('Prioritization agent returned invalid JSON.');
  }

  const clamp = (v, d = 50) => Math.max(0, Math.min(100, Math.round(v ?? d)));
  scores.priorityScore = clamp(scores.priorityScore);
  scores.urgencyScore = clamp(scores.urgencyScore);
  scores.importanceScore = clamp(scores.importanceScore);
  scores.riskScore = clamp(scores.riskScore);
  scores.bufferHoursNeeded = Math.max(0, Number(scores.bufferHoursNeeded) || 0);
  scores.ragContextUsed = ragContext.map((r) => ({ text: r.text, similarity: r.similarity }));

  const riskLabel = scores.riskScore >= 80 ? '🔴 HIGH' : scores.riskScore >= 50 ? '🟡 MEDIUM' : '🟢 LOW';
  emit?.({
    agent: 'prioritization', status: 'done',
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