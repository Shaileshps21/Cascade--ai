/**
 * Agent 1: Task Parser
 * ────────────────────────────────────────────────────────────────────────────
 * Converts freeform natural language input into a structured task object.
 * Uses Gemini Flash for speed (this is the first in the pipeline).
 *
 * Input  : "Submit ML assignment before Friday, it's really complex"
 * Output : {
 *   title: "ML Assignment Submission",
 *   rawInput: "...",
 *   deadline: "2024-01-19T23:59:00",
 *   estimatedHours: 8,
 *   category: "academic",
 *   complexity: "high",
 *   priority: null,           // filled by prioritization agent
 *   dependencies: [],
 *   tags: ["ml", "assignment"],
 *   confidence: 0.92
 * }
 */

import { geminiFlash, parseGeminiJSON } from '../config/gemini.js';

const PARSER_SYSTEM_PROMPT = `You are a task parsing AI. Your job is to extract structured information from a user's natural language task description.

Always respond with ONLY valid JSON — no markdown, no explanation, no preamble.

Current date/time context: {CURRENT_DATETIME}

Extract the following fields:
- title: concise task title (5 words max)
- rawInput: the original user input verbatim
- deadline: ISO 8601 datetime string for the deadline. If user says "Friday", infer the upcoming Friday. If "tomorrow", infer tomorrow at 11:59 PM. If no deadline mentioned, set to 72 hours from now.
- estimatedHours: realistic estimate (number). Consider complexity. Minimum 0.5.
- category: one of ["work", "academic", "personal", "health", "finance", "creative", "other"]
- complexity: one of ["low", "medium", "high", "very_high"]
- dependencies: array of strings describing things the user needs before starting (e.g. ["access to dataset", "supervisor approval"])
- tags: array of 2-5 relevant keywords
- confidence: 0.0-1.0 how confident you are in the parsing (lower if input is vague)
- clarificationNeeded: null or string with a clarifying question if critical info is missing

JSON schema:
{
  "title": string,
  "rawInput": string,
  "deadline": string (ISO 8601),
  "estimatedHours": number,
  "category": string,
  "complexity": string,
  "dependencies": string[],
  "tags": string[],
  "confidence": number,
  "clarificationNeeded": string | null
}`;

/**
 * Parse a natural language task description into structured data.
 *
 * @param {string} rawInput – user's freeform input
 * @param {Function} emit   – SSE emitter function (optional) for real-time trace
 * @returns {object} structured task
 */
export async function runParserAgent(rawInput, emit = null) {
  const now = new Date();
  const prompt = PARSER_SYSTEM_PROMPT.replace(
    '{CURRENT_DATETIME}',
    now.toISOString()
  );

  emit?.({ agent: 'parser', status: 'thinking', message: '🔍 Reading your task description...' });

  const chat = geminiFlash.startChat({
    history: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const result = await chat.sendMessage(rawInput);
  const responseText = result.response.text();

  emit?.({ agent: 'parser', status: 'thinking', message: '📋 Extracting deadline, category, complexity...' });

  let parsed;
  try {
    parsed = parseGeminiJSON(responseText);
  } catch (err) {
    console.error('[Parser Agent] JSON parse failed:', responseText);
    throw new Error('Parser agent returned invalid JSON');
  }

  // Validate deadline is in the future
  const deadline = new Date(parsed.deadline);
  if (isNaN(deadline.getTime()) || deadline < now) {
    // Default to 48 hours from now if deadline is invalid
    parsed.deadline = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  }

  // Ensure estimatedHours is a positive number
  if (!parsed.estimatedHours || parsed.estimatedHours <= 0) {
    parsed.estimatedHours = getDefaultHours(parsed.complexity);
  }

  const hoursUntilDeadline = (deadline - now) / (1000 * 60 * 60);

  emit?.({
    agent: 'parser',
    status: 'done',
    message: `✅ Parsed: "${parsed.title}" — ${parsed.complexity} complexity, ${parsed.estimatedHours}h estimated`,
    data: {
      title: parsed.title,
      deadline: parsed.deadline,
      estimatedHours: parsed.estimatedHours,
      category: parsed.category,
      complexity: parsed.complexity,
      hoursUntilDeadline: Math.round(hoursUntilDeadline),
    },
  });

  return parsed;
}

function getDefaultHours(complexity) {
  const map = { low: 1, medium: 3, high: 6, very_high: 12 };
  return map[complexity] || 3;
}
