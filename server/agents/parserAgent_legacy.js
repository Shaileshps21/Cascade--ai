// import { geminiFlash, parseGeminiJSON } from '../config/gemini.js';

// const PARSER_SYSTEM_PROMPT = `You are a task parsing AI. Extract structured information from a user's natural language task description.

// Always respond with ONLY valid JSON — no markdown, no explanation, no preamble.

// Current date/time context: {CURRENT_DATETIME}

// JSON schema:
// {
//   "title": string (5 words max),
//   "rawInput": string,
//   "deadline": string (ISO 8601 - infer from context, default 72h from now),
//   "estimatedHours": number (minimum 0.5),
//   "category": one of ["work","academic","personal","health","finance","creative","other"],
//   "complexity": one of ["low","medium","high","very_high"],
//   "dependencies": string[],
//   "tags": string[] (2-5 keywords),
//   "confidence": number (0.0-1.0),
//   "clarificationNeeded": string | null
// }`;

// export async function runParserAgent(rawInput, emit = null, clients = null) {
//   const flash = clients?.flash || geminiFlash;
//   const now = new Date();
//   const prompt = PARSER_SYSTEM_PROMPT.replace('{CURRENT_DATETIME}', now.toISOString());

//   emit?.({ agent: 'parser', status: 'thinking', message: '🔍 Reading your task description...' });

//   const chat = flash.startChat({ history: [{ role: 'user', parts: [{ text: prompt }] }] });
//   const result = await chat.sendMessage(rawInput);

//   emit?.({ agent: 'parser', status: 'thinking', message: '📋 Extracting deadline, category, complexity...' });

//   let parsed;
//   try {
//     parsed = parseGeminiJSON(result.response.text());
//   } catch {
//     throw new Error('Parser agent returned invalid JSON');
//   }

//   const deadline = new Date(parsed.deadline);
//   if (isNaN(deadline.getTime()) || deadline < now) {
//     parsed.deadline = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
//   }
//   if (!parsed.estimatedHours || parsed.estimatedHours <= 0) {
//     parsed.estimatedHours = { low: 1, medium: 3, high: 6, very_high: 12 }[parsed.complexity] || 3;
//   }

//   emit?.({
//     agent: 'parser', status: 'done',
//     message: `✅ Parsed: "${parsed.title}" — ${parsed.complexity} complexity, ${parsed.estimatedHours}h estimated`,
//     data: { title: parsed.title, deadline: parsed.deadline, estimatedHours: parsed.estimatedHours, category: parsed.category, complexity: parsed.complexity },
//   });
//   return parsed;
// }



// // -----------------------------------------------NEW FILE---------------------------------------------------
// /**
//  * Agent 1: Task Parser
//  * Uses clients.flash (Gemini Flash or Groq llama-3.1-8b-instant)
//  */

// import { defaultClients, parseJSON } from '../config/llm.js';

// const PARSER_PROMPT = `You are a task parsing AI. Extract structured information from a user's natural language task description.

// Respond with ONLY valid JSON — no markdown, no explanation.

// Current datetime: {NOW}

// JSON schema:
// {
//   "title": "string (5 words max)",
//   "rawInput": "string",
//   "deadline": "ISO 8601 (infer from context — 'Friday'=next Friday 11:59PM, 'tomorrow'=tomorrow 11:59PM, default=72h from now)",
//   "estimatedHours": "number (min 0.5, be realistic)",
//   "category": "work|academic|personal|health|finance|creative|other",
//   "complexity": "low|medium|high|very_high",
//   "dependencies": ["string"],
//   "tags": ["2-5 keywords"],
//   "confidence": "0.0-1.0",
//   "clarificationNeeded": "string or null"
// }`;

// export async function runParserAgent(rawInput, emit = null, clients = null) {
//   const flash = (clients || defaultClients)?.flash;
//   if (!flash) throw new Error('No LLM client available. Please add an API key in settings.');

//   const now = new Date();
//   const prompt = PARSER_PROMPT.replace('{NOW}', now.toISOString());

//   emit?.({ agent: 'parser', status: 'thinking', message: '🔍 Reading your task description...' });

//   const response = await flash.generateText(`${prompt}\n\nTask: ${rawInput}`);

//   emit?.({ agent: 'parser', status: 'thinking', message: '📋 Extracting deadline, category, complexity...' });

//   let parsed;
//   try {
//     parsed = parseJSON(response);
//   } catch {
//     throw new Error('Parser agent returned invalid JSON. Try rephrasing your task.');
//   }

//   // Validate deadline
//   const deadline = new Date(parsed.deadline);
//   if (isNaN(deadline.getTime()) || deadline < now) {
//     parsed.deadline = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
//   }

//   // Validate estimatedHours
//   if (!parsed.estimatedHours || parsed.estimatedHours <= 0) {
//     const defaults = { low: 1, medium: 3, high: 6, very_high: 12 };
//     parsed.estimatedHours = defaults[parsed.complexity] || 3;
//   }

//   const hoursUntilDeadline = Math.round((new Date(parsed.deadline) - now) / 3_600_000);

//   emit?.({
//     agent: 'parser',
//     status: 'done',
//     message: `✅ Parsed: "${parsed.title}" — ${parsed.complexity} complexity, ${parsed.estimatedHours}h estimated`,
//     data: {
//       title: parsed.title,
//       deadline: parsed.deadline,
//       estimatedHours: parsed.estimatedHours,
//       category: parsed.category,
//       complexity: parsed.complexity,
//       hoursUntilDeadline,
//     },
//   });

//   return parsed;
// }




// // --------------------------------------------------new file-------------------------------------------------
// /**
//  * Agent 1: Task Parser
//  * Accepts an optional explicit deadline from the user.
//  * If provided, it is used directly — no inference needed.
//  */

// import { defaultClients, parseJSON } from '../config/llm.js';

// const PARSER_PROMPT = `You are a task parsing AI. Extract structured information from a user's natural language task.

// Respond with ONLY valid JSON — no markdown, no explanation.

// Current datetime: {NOW}
// {DEADLINE_HINT}

// JSON schema:
// {
//   "title": "string (5 words max)",
//   "rawInput": "string",
//   "deadline": "ISO 8601 datetime (use EXPLICIT_DEADLINE if provided, otherwise infer: 'Friday'=next Friday 11:59PM, 'tomorrow'=tomorrow 11:59PM, default=72h from now)",
//   "estimatedHours": "number (min 0.5, realistic for the complexity)",
//   "category": "work|academic|personal|health|finance|creative|other",
//   "complexity": "low|medium|high|very_high",
//   "dependencies": ["string"],
//   "tags": ["2-5 keywords"],
//   "confidence": "0.0-1.0",
//   "clarificationNeeded": "string or null"
// }`;

// export async function runParserAgent(rawInput, emit = null, clients = null, explicitDeadline = null) {
//   const flash = (clients || defaultClients)?.flash;
//   if (!flash) throw new Error('No LLM client available. Please add an API key.');

//   const now = new Date();
//   const hint = explicitDeadline
//     ? `EXPLICIT_DEADLINE (use this exactly): ${explicitDeadline}`
//     : 'EXPLICIT_DEADLINE: none — infer from task description';

//   const prompt = PARSER_PROMPT
//     .replace('{NOW}', now.toISOString())
//     .replace('{DEADLINE_HINT}', hint);

//   emit?.({ agent: 'parser', status: 'thinking', message: '🔍 Reading your task description...' });

//   const response = await flash.generateText(`${prompt}\n\nTask: ${rawInput}`);

//   emit?.({ agent: 'parser', status: 'thinking', message: '📋 Extracting deadline, category, complexity...' });

//   let parsed;
//   try {
//     parsed = parseJSON(response);
//   } catch {
//     throw new Error('Parser agent returned invalid JSON. Try rephrasing your task.');
//   }

//   // If explicit deadline provided, always use it (don't let AI override)
//   if (explicitDeadline) {
//     parsed.deadline = explicitDeadline;
//   } else {
//     // Validate AI-inferred deadline
//     const d = new Date(parsed.deadline);
//     if (isNaN(d.getTime()) || d <= now) {
//       parsed.deadline = new Date(now.getTime() + 48 * 3_600_000).toISOString();
//     }
//   }

//   if (!parsed.estimatedHours || parsed.estimatedHours <= 0) {
//     parsed.estimatedHours = { low: 1, medium: 3, high: 6, very_high: 12 }[parsed.complexity] || 3;
//   }

//   const hoursUntilDeadline = Math.round((new Date(parsed.deadline) - now) / 3_600_000);

//   emit?.({
//     agent: 'parser', status: 'done',
//     message: `✅ Parsed: "${parsed.title}" — ${parsed.complexity} complexity, ${parsed.estimatedHours}h estimated, ${hoursUntilDeadline}h until deadline`,
//     data: {
//       title: parsed.title, deadline: parsed.deadline,
//       estimatedHours: parsed.estimatedHours, category: parsed.category,
//       complexity: parsed.complexity, hoursUntilDeadline,
//       deadlineSource: explicitDeadline ? 'user-set' : 'ai-inferred',
//     },
//   });

//   return parsed;
// }


// -------------------------------------new file to resolve the issue of custom deadline --------------------------------------------
// /**
//  * Agent 1: Task Parser
//  * When an explicit deadline is provided by the user, the AI never touches it.
//  * The deadline is injected after parsing — AI only handles other fields.
//  */

// import { defaultClients, parseJSON } from '../config/llm.js';

// // ── Prompt WITHOUT deadline — used when user provides explicit deadline ────────
// const PARSER_PROMPT_NO_DEADLINE = `You are a task parsing AI. Extract structured information from this task.

// Respond with ONLY valid JSON — no markdown, no preamble.

// Current datetime: {NOW}
// Note: The deadline has already been set by the user — do NOT include a deadline field.

// JSON schema (do not add or remove fields):
// {
//   "title": "string (5 words max)",
//   "rawInput": "string (verbatim user input)",
//   "estimatedHours": "number (min 0.5, realistic for the complexity)",
//   "category": "work|academic|personal|health|finance|creative|other",
//   "complexity": "low|medium|high|very_high",
//   "dependencies": ["array of strings, can be empty"],
//   "tags": ["2-5 keywords"],
//   "confidence": "0.0-1.0",
//   "clarificationNeeded": "string or null"
// }`;

// // ── Prompt WITH deadline inference — used when no explicit deadline ────────────
// const PARSER_PROMPT_WITH_DEADLINE = `You are a task parsing AI. Extract structured information from this task.

// Respond with ONLY valid JSON — no markdown, no preamble.

// Current datetime: {NOW}

// Rules for deadline inference:
// - "today" or "tonight" → today at 11:59 PM
// - "tomorrow" → tomorrow at 11:59 PM
// - "Friday" / day name → next occurrence of that day at 11:59 PM
// - "end of week" → this Sunday at 11:59 PM
// - "2 days" / "in X days" → X days from now at 11:59 PM
// - No mention of deadline → 72 hours from now

// JSON schema:
// {
//   "title": "string (5 words max)",
//   "rawInput": "string (verbatim user input)",
//   "deadline": "ISO 8601 datetime string — infer from description using rules above",
//   "estimatedHours": "number (min 0.5, realistic for the complexity)",
//   "category": "work|academic|personal|health|finance|creative|other",
//   "complexity": "low|medium|high|very_high",
//   "dependencies": ["array of strings, can be empty"],
//   "tags": ["2-5 keywords"],
//   "confidence": "0.0-1.0",
//   "clarificationNeeded": "string or null"
// }`;

// export async function runParserAgent(rawInput, emit = null, clients = null, explicitDeadline = null) {
//   const flash = (clients || defaultClients)?.flash;
//   if (!flash) throw new Error('No LLM client available. Please add an API key.');

//   const now = new Date();

//   emit?.({ agent: 'parser', status: 'thinking', message: '🔍 Reading your task description...' });

//   // ── Choose prompt based on whether deadline was explicitly set ────────────
//   const promptTemplate = explicitDeadline
//     ? PARSER_PROMPT_NO_DEADLINE
//     : PARSER_PROMPT_WITH_DEADLINE;

//   const prompt = promptTemplate.replace('{NOW}', now.toISOString());

//   if (explicitDeadline) {
//     console.log('[Parser] Using explicit deadline:', explicitDeadline,
//       '→', new Date(explicitDeadline).toLocaleString());
//   }

//   const response = await flash.generateText(`${prompt}\n\nTask: ${rawInput}`);

//   emit?.({ agent: 'parser', status: 'thinking', message: '📋 Extracting category, complexity, estimate...' });

//   let parsed;
//   try {
//     parsed = parseJSON(response);
//   } catch {
//     throw new Error('Parser agent returned invalid JSON. Try rephrasing your task.');
//   }

//   // ── Deadline handling ─────────────────────────────────────────────────────
//   if (explicitDeadline) {
//     // User-set deadline: ALWAYS use it, AI has no say
//     parsed.deadline = explicitDeadline;
//     console.log('[Parser] Deadline locked to user input:', parsed.deadline);
//   } else {
//     // AI-inferred: validate it makes sense
//     const d = new Date(parsed.deadline);
//     if (isNaN(d.getTime())) {
//       console.warn('[Parser] AI returned invalid deadline, defaulting to 48h');
//       parsed.deadline = new Date(now.getTime() + 48 * 3_600_000).toISOString();
//     } else if (d <= now) {
//       console.warn('[Parser] AI returned past deadline, defaulting to 48h');
//       parsed.deadline = new Date(now.getTime() + 48 * 3_600_000).toISOString();
//     } else {
//       console.log('[Parser] AI inferred deadline:', parsed.deadline,
//         '→', new Date(parsed.deadline).toLocaleString());
//     }
//   }

//   // ── estimatedHours fallback ───────────────────────────────────────────────
//   if (!parsed.estimatedHours || parsed.estimatedHours <= 0) {
//     parsed.estimatedHours = { low: 1, medium: 3, high: 6, very_high: 12 }[parsed.complexity] || 3;
//   }

//   const hoursUntilDeadline = Math.round((new Date(parsed.deadline) - now) / 3_600_000);

//   emit?.({
//     agent: 'parser', status: 'done',
//     message: `✅ "${parsed.title}" — ${parsed.complexity} · ${parsed.estimatedHours}h · deadline in ${hoursUntilDeadline}h ${explicitDeadline ? '(your deadline)' : '(AI inferred)'}`,
//     data: {
//       title: parsed.title,
//       deadline: parsed.deadline,
//       estimatedHours: parsed.estimatedHours,
//       category: parsed.category,
//       complexity: parsed.complexity,
//       hoursUntilDeadline,
//       deadlineSource: explicitDeadline ? 'user-set' : 'ai-inferred',
//     },
//   });

//   return parsed;
// }











// ------------------------------------new file---------------------------------------------------
/**
 * Agent 1: Task Parser
 * ─────────────────────────────────────────────────────────────────────────────
 * When explicitDeadline is provided:
 *   → Uses a different prompt that has NO deadline field
 *   → Injects the deadline directly after parsing
 *   → Logs at every step so the server terminal shows exactly what happened
 *
 * When no deadline provided:
 *   → AI infers deadline from task text
 */

import { defaultClients, parseJSON } from '../config/llm.js';

// ── Used when user provides a deadline via the picker ─────────────────────────
const PROMPT_NO_DEADLINE = `You are a task parsing AI.

Extract information from the task below. The deadline is already known — do NOT include it.

Current time: {NOW}

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "title": "string (max 5 words)",
  "rawInput": "exact user input verbatim",
  "estimatedHours": number,
  "category": "work|academic|personal|health|finance|creative|other",
  "complexity": "low|medium|high|very_high",
  "dependencies": ["string"],
  "tags": ["2-5 keywords"],
  "confidence": 0.0
}`;

// ── Used when user does NOT provide a deadline ────────────────────────────────
const PROMPT_WITH_DEADLINE = `You are a task parsing AI.

Extract information from the task below. Infer the deadline carefully.

Current time: {NOW}

Deadline inference rules:
- "today" / "tonight" → today at 11:59 PM local time
- "tomorrow" → tomorrow at 11:59 PM local time
- Day name ("Friday") → next occurrence of that day at 11:59 PM
- "end of week" → Sunday 11:59 PM
- "in X days" → X days from now at 11:59 PM
- No time mention → 72 hours from now

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "title": "string (max 5 words)",
  "rawInput": "exact user input verbatim",
  "deadline": "ISO 8601 — use rules above to infer",
  "estimatedHours": number,
  "category": "work|academic|personal|health|finance|creative|other",
  "complexity": "low|medium|high|very_high",
  "dependencies": ["string"],
  "tags": ["2-5 keywords"],
  "confidence": 0.0
}`;

export async function runParserAgent(rawInput, emit = null, clients = null, explicitDeadline = null) {
  const flash = (clients || defaultClients)?.flash;
  if (!flash) throw new Error('No LLM client available. Please add an API key.');

  const now = new Date();

  // ── Log clearly what mode we're in ───────────────────────────────────────
  if (explicitDeadline) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Parser] MODE: explicit deadline provided');
    console.log('[Parser] Deadline (ISO):', explicitDeadline);
    console.log('[Parser] Deadline (local):', new Date(explicitDeadline).toLocaleString());
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } else {
    console.log('[Parser] MODE: AI will infer deadline from task text');
  }

  emit?.({ agent: 'parser', status: 'thinking', message: '🔍 Reading your task description...' });

  // ── Select prompt and call LLM ────────────────────────────────────────────
  const prompt = (explicitDeadline ? PROMPT_NO_DEADLINE : PROMPT_WITH_DEADLINE)
    .replace('{NOW}', now.toISOString());
  const response = await flash.generateText(`${prompt}\n\nTask: ${rawInput}`);

  emit?.({ agent: 'parser', status: 'thinking', message: '📋 Extracting category, complexity, estimate...' });

  let parsed;
  try {
    parsed = parseJSON(response);
  } catch {
    throw new Error('Parser agent returned invalid JSON. Try rephrasing your task.');
  }

  // ── Set deadline — explicit always wins ───────────────────────────────────
  if (explicitDeadline) {
    parsed.deadline = explicitDeadline;
    console.log('[Parser] ✅ Deadline set from user input:', parsed.deadline);

  } else {
    // Validate AI-inferred deadline
    const d = new Date(parsed.deadline);
    if (isNaN(d.getTime()) || d <= now) {
      const fallback = new Date(now.getTime() + 48 * 3_600_000).toISOString();
      console.warn('[Parser] ⚠️ AI returned invalid/past deadline, using 48h fallback');
      parsed.deadline = fallback;
    } else {
      console.log('[Parser] AI inferred deadline:', parsed.deadline,
        '=', new Date(parsed.deadline).toLocaleString());
    }
  }

  // ── estimatedHours default ────────────────────────────────────────────────
  if (!parsed.estimatedHours || parsed.estimatedHours <= 0) {
    parsed.estimatedHours = { low: 1, medium: 3, high: 6, very_high: 12 }[parsed.complexity] || 3;
  }

  const hoursUntilDeadline = Math.round((new Date(parsed.deadline) - now) / 3_600_000);

  emit?.({
    agent: 'parser',
    status: 'done',
    message: `✅ "${parsed.title}" — ${parsed.complexity} · ${parsed.estimatedHours}h · deadline in ${hoursUntilDeadline}h (${explicitDeadline ? 'your deadline ✓' : 'AI inferred'})`,
    data: {
      title: parsed.title,
      deadline: parsed.deadline,
      estimatedHours: parsed.estimatedHours,
      category: parsed.category,
      complexity: parsed.complexity,
      hoursUntilDeadline,
      deadlineSource: explicitDeadline ? 'user-set' : 'ai-inferred',
    },
  });

  return parsed;
}