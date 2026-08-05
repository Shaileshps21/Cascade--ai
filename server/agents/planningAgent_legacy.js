// import { v4 as uuidv4 } from 'uuid';
// import { geminiPro, parseGeminiJSON } from '../config/gemini.js';

// const PLANNING_PROMPT = `You are an expert productivity planner. Break this task into 3-8 concrete, actionable subtasks.

// Rules:
// - Be specific, not vague ("Read 3 papers and take notes" not "Research topic")
// - Order logically — dependencies first, review last
// - Each subtask completable in one sitting (max 2 hours)
// - Realistic time estimates

// Respond ONLY with valid JSON:
// {
//   "subtasks": [{
//     "title": string,
//     "description": string,
//     "estimatedMinutes": number,
//     "order": number,
//     "tips": string[],
//     "type": "setup|research|execution|review|communication|other"
//   }],
//   "totalEstimatedMinutes": number,
//   "planningNotes": string,
//   "criticalPath": string
// }`;

// export async function runPlanningAgent(task, emit = null, clients = null) {
//   const pro = clients?.pro || geminiPro;

//   emit?.({ agent: 'planning', status: 'thinking', message: '📝 Designing your action plan...' });

//   const now = new Date();
//   const hoursAvail = ((new Date(task.deadline) - now) / 3_600_000).toFixed(1);
//   const fullPrompt = `${PLANNING_PROMPT}\n\nTASK:\n${JSON.stringify({
//     title: task.title, category: task.category, complexity: task.complexity,
//     estimatedHours: task.estimatedHours + (task.bufferHoursNeeded || 0),
//     tags: task.tags, dependencies: task.dependencies,
//     priorityScore: task.priorityScore, riskScore: task.riskScore,
//   }, null, 2)}\n\nCURRENT TIME: ${now.toISOString()}\nDEADLINE: ${task.deadline}\nHOURS AVAILABLE: ${hoursAvail}h\n\nDo NOT exceed ${Math.round(hoursAvail * 60)} total minutes.`;

//   const result = await pro.generateContent(fullPrompt);
//   let plan;
//   try {
//     plan = parseGeminiJSON(result.response.text());
//   } catch {
//     throw new Error('Planning agent returned invalid JSON');
//   }

//   const subtasks = (plan.subtasks || []).map((s, i) => ({
//     id: uuidv4(), title: s.title || `Step ${i + 1}`,
//     description: s.description || '', estimatedMinutes: Math.max(5, Math.round(s.estimatedMinutes || 30)),
//     order: s.order || i + 1, tips: s.tips || [], type: s.type || 'other',
//     completed: false, completedAt: null, scheduledStart: null, scheduledEnd: null, calendarEventId: null,
//   })).sort((a, b) => a.order - b.order);

//   emit?.({
//     agent: 'planning', status: 'done',
//     message: `✅ Plan ready: ${subtasks.map((s) => s.title).join(' → ')}`,
//     data: { subtasks: subtasks.map((s) => ({ title: s.title, estimatedMinutes: s.estimatedMinutes })), planningNotes: plan.planningNotes, criticalPath: plan.criticalPath },
//   });

//   return {
//     subtasks,
//     totalEstimatedMinutes: plan.totalEstimatedMinutes || subtasks.reduce((s, t) => s + t.estimatedMinutes, 0),
//     planningNotes: plan.planningNotes || '',
//     criticalPath: plan.criticalPath || '',
//   };
// }



// // ----------------------------------------------NEW FILE------------------------------------------------------------
// /**
//  * Agent 3: Planning Agent
//  * Uses clients.pro (Gemini Pro or Groq llama-3.3-70b-versatile)
//  */

// import { v4 as uuidv4 } from 'uuid';
// import { defaultClients, parseJSON } from '../config/llm.js';

// const PLANNING_PROMPT = `You are an expert productivity planner and time estimator.

// Break the task into 3-8 concrete, actionable subtasks.

// Rules:
// 1. Be specific — "Read 3 key papers and take notes" not "Research topic"
// 2. Order logically — dependencies first, review/check last
// 3. Each subtask max 2 hours (120 minutes)
// 4. Time estimates must be realistic — include buffer time
// 5. Total minutes must NOT exceed {MAX_MINUTES}

// Respond ONLY with valid JSON:
// {
//   "subtasks": [
//     {
//       "title": "string",
//       "description": "1-2 sentence specific instruction",
//       "estimatedMinutes": number,
//       "order": number,
//       "tips": ["actionable tip"],
//       "type": "setup|research|execution|review|communication|other"
//     }
//   ],
//   "totalEstimatedMinutes": number,
//   "planningNotes": "1-2 sentence strategy note",
//   "criticalPath": "most important/gating subtask title"
// }`;

// export async function runPlanningAgent(task, emit = null, clients = null) {
//   const pro = (clients || defaultClients)?.pro;
//   if (!pro) throw new Error('No LLM client available.');

//   emit?.({ agent: 'planning', status: 'thinking', message: '📝 Designing your action plan...' });

//   const now = new Date();
//   const deadline = new Date(task.deadline);
//   const hoursAvail = ((deadline - now) / 3_600_000).toFixed(1);
//   const maxMinutes = Math.round(Number(hoursAvail) * 60);

//   const fullPrompt = PLANNING_PROMPT.replace('{MAX_MINUTES}', maxMinutes) + `

// TASK:
// ${JSON.stringify({
//     title: task.title,
//     category: task.category,
//     complexity: task.complexity,
//     estimatedHours: (task.estimatedHours || 1) + (task.bufferHoursNeeded || 0),
//     tags: task.tags,
//     dependencies: task.dependencies,
//     priorityScore: task.priorityScore,
//     riskScore: task.riskScore,
//     warningFlags: task.warningFlags,
//   }, null, 2)}

// CURRENT TIME: ${now.toISOString()}
// DEADLINE:     ${deadline.toISOString()}
// HOURS AVAILABLE: ${hoursAvail}h`;

//   const response = await pro.generateText(fullPrompt);

//   let plan;
//   try {
//     plan = parseJSON(response);
//   } catch {
//     throw new Error('Planning agent returned invalid JSON.');
//   }

//   emit?.({
//     agent: 'planning', status: 'thinking',
//     message: `🗂️ Created ${plan.subtasks?.length || 0} subtasks — ${((plan.totalEstimatedMinutes || 0) / 60).toFixed(1)}h total`,
//   });

//   const subtasks = (plan.subtasks || [])
//     .map((s, i) => ({
//       id: uuidv4(),
//       title: s.title || `Step ${i + 1}`,
//       description: s.description || '',
//       estimatedMinutes: Math.max(5, Math.round(s.estimatedMinutes || 30)),
//       order: s.order || i + 1,
//       tips: s.tips || [],
//       type: s.type || 'other',
//       completed: false,
//       completedAt: null,
//       scheduledStart: null,
//       scheduledEnd: null,
//       calendarEventId: null,
//     }))
//     .sort((a, b) => a.order - b.order);

//   emit?.({
//     agent: 'planning', status: 'done',
//     message: `✅ Plan ready: ${subtasks.map((s) => s.title).join(' → ')}`,
//     data: {
//       subtasks: subtasks.map((s) => ({ title: s.title, estimatedMinutes: s.estimatedMinutes })),
//       planningNotes: plan.planningNotes,
//       criticalPath: plan.criticalPath,
//     },
//   });

//   return {
//     subtasks,
//     totalEstimatedMinutes: plan.totalEstimatedMinutes
//       || subtasks.reduce((acc, s) => acc + s.estimatedMinutes, 0),
//     planningNotes: plan.planningNotes || '',
//     criticalPath: plan.criticalPath || '',
//   };
// }

// // -----------------------------------------------------------new file----------------------------------------------
// /**
//  * Agent 3: Planning Agent
//  * Generates 3-6 focused subtasks. Two of them are flagged as
//  * "calendar priority" for Google Calendar booking.
//  */

// import { v4 as uuidv4 } from 'uuid';
// import { defaultClients, parseJSON } from '../config/llm.js';

// const PLANNING_PROMPT = `You are an expert productivity planner and time estimator.

// Break the task into exactly 3 to 6 concrete, actionable subtasks.

// Rules:
// 1. Be specific — "Read 3 key papers and take notes" not "Research topic"
// 2. Order logically — dependencies first, review/check last
// 3. Each subtask max 2 hours (120 minutes)
// 4. Time estimates must be realistic
// 5. Total minutes must NOT exceed {MAX_MINUTES}
// 6. Generate NO MORE than 6 subtasks — merge minor steps together
// 7. Mark exactly 2 subtasks as calendarPriority: true — these are the most
//    critical steps that must be protected as dedicated time blocks.
//    Choose the single most important execution step and the final review step.

// Respond ONLY with valid JSON:
// {
//   "subtasks": [
//     {
//       "title": "string",
//       "description": "1-2 sentence specific instruction",
//       "estimatedMinutes": number,
//       "order": number,
//       "tips": ["actionable tip"],
//       "type": "setup|research|execution|review|communication|other",
//       "calendarPriority": true | false
//     }
//   ],
//   "totalEstimatedMinutes": number,
//   "planningNotes": "1-2 sentence strategy note",
//   "criticalPath": "title of most critical subtask"
// }`;

// export async function runPlanningAgent(task, emit = null, clients = null) {
//   const pro = (clients || defaultClients)?.pro;
//   if (!pro) throw new Error('No LLM client available.');

//   emit?.({ agent: 'planning', status: 'thinking', message: '📝 Designing your action plan...' });

//   const now = new Date();
//   const deadline = new Date(task.deadline);
//   const hoursAvail = ((deadline - now) / 3_600_000).toFixed(1);
//   const maxMinutes = Math.round(Number(hoursAvail) * 60);

//   const fullPrompt = PLANNING_PROMPT.replace('{MAX_MINUTES}', maxMinutes) + `

// TASK:
// ${JSON.stringify({
//     title: task.title,
//     category: task.category,
//     complexity: task.complexity,
//     estimatedHours: (task.estimatedHours || 1) + (task.bufferHoursNeeded || 0),
//     tags: task.tags,
//     dependencies: task.dependencies,
//     priorityScore: task.priorityScore,
//     riskScore: task.riskScore,
//     warningFlags: task.warningFlags,
//   }, null, 2)}

// CURRENT TIME: ${now.toISOString()}
// DEADLINE:     ${deadline.toISOString()}
// HOURS AVAILABLE: ${hoursAvail}h`;

//   const response = await pro.generateText(fullPrompt);

//   let plan;
//   try {
//     plan = parseJSON(response);
//   } catch {
//     throw new Error('Planning agent returned invalid JSON.');
//   }

//   // ── Build subtasks ────────────────────────────────────────────────────────
//   let subtasks = (plan.subtasks || [])
//     .slice(0, 6) // hard cap at 6
//     .map((s, i) => ({
//       id: uuidv4(),
//       title: s.title || `Step ${i + 1}`,
//       description: s.description || '',
//       estimatedMinutes: Math.max(5, Math.round(s.estimatedMinutes || 30)),
//       order: s.order || i + 1,
//       tips: s.tips || [],
//       type: s.type || 'other',
//       calendarPriority: !!s.calendarPriority,
//       completed: false,
//       completedAt: null,
//       scheduledStart: null,
//       scheduledEnd: null,
//       calendarEventId: null,
//     }))
//     .sort((a, b) => a.order - b.order);

//   // ── Ensure exactly 2 calendarPriority subtasks ────────────────────────────
//   const priorityCount = subtasks.filter((s) => s.calendarPriority).length;

//   if (priorityCount === 0) {
//     // AI didn't flag any — pick the main execution + last review
//     const execIdx = subtasks.findIndex((s) => s.type === 'execution');
//     const reviewIdx = subtasks.findLastIndex((s) => s.type === 'review') !== -1
//       ? subtasks.findLastIndex((s) => s.type === 'review')
//       : subtasks.length - 1;

//     subtasks = subtasks.map((s, i) => ({
//       ...s,
//       calendarPriority: i === (execIdx >= 0 ? execIdx : 0) || i === reviewIdx,
//     }));
//   } else if (priorityCount > 2) {
//     // AI flagged too many — keep only first 2 by order
//     let kept = 0;
//     subtasks = subtasks.map((s) => {
//       if (s.calendarPriority && kept < 2) { kept++; return s; }
//       return { ...s, calendarPriority: false };
//     });
//   } else if (priorityCount === 1) {
//     // Only 1 flagged — add the last subtask as second priority
//     const firstPriorityIdx = subtasks.findIndex((s) => s.calendarPriority);
//     const lastIdx = subtasks.length - 1;
//     if (firstPriorityIdx !== lastIdx) {
//       subtasks[lastIdx] = { ...subtasks[lastIdx], calendarPriority: true };
//     } else if (subtasks.length > 1) {
//       subtasks[0] = { ...subtasks[0], calendarPriority: true };
//     }
//   }

//   const priorityTitles = subtasks.filter((s) => s.calendarPriority).map((s) => s.title);

//   emit?.({
//     agent: 'planning', status: 'done',
//     message: `✅ ${subtasks.length} subtasks — calendar blocks: "${priorityTitles.join('" & "')}"`,
//     data: {
//       subtasks: subtasks.map((s) => ({ title: s.title, estimatedMinutes: s.estimatedMinutes, calendarPriority: s.calendarPriority })),
//       planningNotes: plan.planningNotes,
//       criticalPath: plan.criticalPath,
//       calendarPrioritySubtasks: priorityTitles,
//     },
//   });

//   return {
//     subtasks,
//     totalEstimatedMinutes: plan.totalEstimatedMinutes
//       || subtasks.reduce((acc, s) => acc + s.estimatedMinutes, 0),
//     planningNotes: plan.planningNotes || '',
//     criticalPath: plan.criticalPath || '',
//   };
// }


// // ---------------------------------new file 2.0-------------------------------------------------
// /**
//  * Agent 3: Planning Agent
//  * Generates 3-6 focused subtasks.
//  * No calendarPriority flag — scheduler picks first & last by order.
//  */

// import { v4 as uuidv4 } from 'uuid';
// import { defaultClients, parseJSON } from '../config/llm.js';

// const PLANNING_PROMPT = `You are an expert productivity planner and time estimator.

// Break the task into exactly 3 to 6 concrete, actionable subtasks.

// Rules:
// 1. Be specific — "Read 3 key papers and take notes" not "Research topic"
// 2. Order logically — setup first, final review/submit last
// 3. Each subtask max 2 hours (120 minutes)
// 4. Time estimates must be realistic
// 5. Total minutes must NOT exceed {MAX_MINUTES}
// 6. Generate NO MORE than 6 subtasks — merge minor steps
// 7. The FIRST subtask must be something the user can start immediately
// 8. The LAST subtask must be the final review or submission step

// Respond ONLY with valid JSON:
// {
//   "subtasks": [
//     {
//       "title": "string",
//       "description": "1-2 sentence specific instruction",
//       "estimatedMinutes": number,
//       "order": number,
//       "tips": ["actionable tip"],
//       "type": "setup|research|execution|review|communication|other"
//     }
//   ],
//   "totalEstimatedMinutes": number,
//   "planningNotes": "1-2 sentence strategy note",
//   "criticalPath": "title of most critical subtask"
// }`;

// export async function runPlanningAgent(task, emit = null, clients = null) {
//   const pro = (clients || defaultClients)?.pro;
//   if (!pro) throw new Error('No LLM client available.');

//   emit?.({ agent: 'planning', status: 'thinking', message: '📝 Designing your action plan...' });

//   const now = new Date();
//   const deadline = new Date(task.deadline);
//   const hoursAvail = ((deadline - now) / 3_600_000).toFixed(1);
//   const maxMinutes = Math.round(Number(hoursAvail) * 60);

//   const fullPrompt = PLANNING_PROMPT.replace('{MAX_MINUTES}', maxMinutes) + `

// TASK:
// ${JSON.stringify({
//     title: task.title,
//     category: task.category,
//     complexity: task.complexity,
//     estimatedHours: (task.estimatedHours || 1) + (task.bufferHoursNeeded || 0),
//     tags: task.tags,
//     dependencies: task.dependencies,
//     priorityScore: task.priorityScore,
//     riskScore: task.riskScore,
//     warningFlags: task.warningFlags,
//   }, null, 2)}

// CURRENT TIME: ${now.toISOString()}
// DEADLINE:     ${deadline.toISOString()}
// HOURS AVAILABLE: ${hoursAvail}h`;

//   const response = await pro.generateText(fullPrompt);

//   let plan;
//   try {
//     plan = parseJSON(response);
//   } catch {
//     throw new Error('Planning agent returned invalid JSON.');
//   }

//   const subtasks = (plan.subtasks || [])
//     .slice(0, 6)
//     .map((s, i) => ({
//       id: uuidv4(),
//       title: s.title || `Step ${i + 1}`,
//       description: s.description || '',
//       estimatedMinutes: Math.max(5, Math.round(s.estimatedMinutes || 30)),
//       order: s.order || i + 1,
//       tips: s.tips || [],
//       type: s.type || 'other',
//       completed: false,
//       completedAt: null,
//       scheduledStart: null,
//       scheduledEnd: null,
//       calendarEventId: null,
//     }))
//     .sort((a, b) => a.order - b.order);

//   emit?.({
//     agent: 'planning', status: 'done',
//     message: `✅ ${subtasks.length} subtasks: "${subtasks[0]?.title}" → ... → "${subtasks[subtasks.length - 1]?.title}"`,
//     data: {
//       subtasks: subtasks.map((s) => ({ title: s.title, estimatedMinutes: s.estimatedMinutes })),
//       planningNotes: plan.planningNotes,
//       criticalPath: plan.criticalPath,
//     },
//   });

//   return {
//     subtasks,
//     totalEstimatedMinutes: plan.totalEstimatedMinutes
//       || subtasks.reduce((acc, s) => acc + s.estimatedMinutes, 0),
//     planningNotes: plan.planningNotes || '',
//     criticalPath: plan.criticalPath || '',
//   };
// }


// // ---------------------------------------------------------new file---------------------------------------------------------------------------
// /**
//  * Agent 3: Planning Agent
//  * ─────────────────────────────────────────────────────────────────────────────
//  * Generates 3-6 subtasks with session durations appropriate to the deadline.
//  *
//  * Key fix: for long-deadline tasks (3+ days), each subtask is a focused
//  * work SESSION (1-3h) that will be scheduled on a DIFFERENT DAY — not
//  * all crammed into one day.
//  */

// import { v4 as uuidv4 } from 'uuid';
// import { defaultClients, parseJSON } from '../config/llm.js';

// function buildPlanningPrompt(task, now, deadline, hoursAvail) {
//   const totalDays = (deadline - now) / (24 * 3_600_000);

//   // Session guidance based on how much time is available
//   let sessionGuidance;
//   if (totalDays >= 7) {
//     sessionGuidance = `
// SCHEDULING CONTEXT: The user has ${totalDays.toFixed(0)} days.
// Each subtask will be scheduled on a SEPARATE DAY as a dedicated work session.
// Make each subtask a meaningful day's work: 60-180 minutes.
// Do NOT create micro-tasks under 30 minutes.`;
//   } else if (totalDays >= 3) {
//     sessionGuidance = `
// SCHEDULING CONTEXT: The user has ${totalDays.toFixed(1)} days.
// Each subtask will be spread across different days.
// Session length: 45-120 minutes per subtask.`;
//   } else if (totalDays >= 1) {
//     sessionGuidance = `
// SCHEDULING CONTEXT: The user has ${totalDays.toFixed(1)} days (${Math.round(hoursAvail)} hours).
// Sessions will be spread across available hours.
// Session length: 30-90 minutes per subtask.`;
//   } else {
//     sessionGuidance = `
// SCHEDULING CONTEXT: URGENT — only ${Math.round(hoursAvail)} hours left.
// Keep subtasks short and focused: 15-45 minutes each.
// Maximum 4 subtasks total.`;
//   }

//   return `You are an expert productivity planner.

// Break this task into 3-6 concrete, actionable subtasks.${sessionGuidance}

// Rules:
// 1. Be specific — "Draft the introduction paragraph" not "Write introduction"
// 2. Order logically — setup first, review/submit last
// 3. 3 subtasks minimum, 6 maximum — merge small steps into larger ones
// 4. The FIRST subtask must be something the user can start immediately
// 5. The LAST subtask must be the final review or submission step
// 6. Total estimated minutes must NOT exceed ${Math.round(hoursAvail * 60)}

// Respond ONLY with valid JSON — no markdown:
// {
//   "subtasks": [
//     {
//       "title": "string",
//       "description": "1-2 sentence specific action",
//       "estimatedMinutes": number,
//       "order": number,
//       "tips": ["one actionable tip"],
//       "type": "setup|research|execution|review|communication|other"
//     }
//   ],
//   "totalEstimatedMinutes": number,
//   "planningNotes": "1 sentence strategy",
//   "criticalPath": "most important subtask title"
// }`;
// }

// export async function runPlanningAgent(task, emit = null, clients = null) {
//   const pro = (clients || defaultClients)?.pro;
//   if (!pro) throw new Error('No LLM client available.');

//   emit?.({ agent: 'planning', status: 'thinking', message: '📝 Designing your action plan...' });

//   const now = new Date();
//   const deadline = new Date(task.deadline);
//   const hoursAvail = Math.max(1, (deadline - now) / 3_600_000);
//   const totalDays = hoursAvail / 24;

//   const prompt = buildPlanningPrompt(task, now, deadline, hoursAvail);
//   const fullPrompt = `${prompt}

// TASK:
// ${JSON.stringify({
//     title: task.title,
//     category: task.category,
//     complexity: task.complexity,
//     estimatedHours: (task.estimatedHours || 1) + (task.bufferHoursNeeded || 0),
//     tags: task.tags,
//     dependencies: task.dependencies,
//     priorityScore: task.priorityScore,
//     riskScore: task.riskScore,
//   }, null, 2)}

// NOW:      ${now.toISOString()}
// DEADLINE: ${deadline.toISOString()}
// DAYS AVAILABLE: ${totalDays.toFixed(1)}`;

//   const response = await pro.generateText(fullPrompt);

//   let plan;
//   try {
//     plan = parseJSON(response);
//   } catch {
//     throw new Error('Planning agent returned invalid JSON.');
//   }

//   // ── Build and validate subtasks ───────────────────────────────────────────
//   const subtasks = (plan.subtasks || [])
//     .slice(0, 6)
//     .map((s, i) => ({
//       id: uuidv4(),
//       title: s.title || `Step ${i + 1}`,
//       description: s.description || '',
//       estimatedMinutes: Math.max(15, Math.round(s.estimatedMinutes || 60)),
//       order: s.order || i + 1,
//       tips: (s.tips || []).slice(0, 2),
//       type: s.type || 'other',
//       completed: false,
//       completedAt: null,
//       scheduledStart: null,
//       scheduledEnd: null,
//       calendarEventId: null,
//       calendarLabel: null,
//     }))
//     .sort((a, b) => a.order - b.order);

//   // Enforce minimum 3 subtasks
//   if (subtasks.length < 3) {
//     console.warn(`[Planning] Only ${subtasks.length} subtasks generated, expected 3-6`);
//   }

//   const totalMins = subtasks.reduce((acc, s) => acc + s.estimatedMinutes, 0);

//   emit?.({
//     agent: 'planning',
//     status: 'done',
//     message: `✅ ${subtasks.length} subtasks across ~${totalDays.toFixed(1)} days — total ${Math.round(totalMins / 60 * 10) / 10}h of work`,
//     data: {
//       subtasks: subtasks.map((s) => ({ title: s.title, estimatedMinutes: s.estimatedMinutes })),
//       planningNotes: plan.planningNotes,
//       criticalPath: plan.criticalPath,
//       totalDays: totalDays.toFixed(1),
//     },
//   });

//   return {
//     subtasks,
//     totalEstimatedMinutes: plan.totalEstimatedMinutes || totalMins,
//     planningNotes: plan.planningNotes || '',
//     criticalPath: plan.criticalPath || '',
//   };
// }





// ---------------------------------------------------new file----------------------------------------------------------------------------
/**
 * Agent 3: Planning Agent — Domain-Aware Task Decomposition
 * ─────────────────────────────────────────────────────────────────────────────
 * Two-stage reasoning:
 *   Stage 1: Deep analysis of what the task actually requires
 *   Stage 2: Generate subtasks grounded in that analysis
 *
 * The AI is forced to think like a domain expert, not a generic productivity
 * bot. Each subtask must produce a tangible, verifiable output.
 */

import { v4 as uuidv4 } from 'uuid';
import { defaultClients, parseJSON } from '../config/llm.js';

// ── Category-specific expert personas ─────────────────────────────────────────
const CATEGORY_CONTEXT = {
  academic: `You are an experienced academic who has guided hundreds of students.
You know exactly what each step of a research/assignment workflow looks like in practice.
You understand the difference between "reading about X" (vague) and "read chapters 3-4
of [source], extract the 3 key algorithms, write 200-word summary" (concrete).`,

  work: `You are a senior professional who has managed complex work projects.
You break work into deliverables with clear owners, inputs, and outputs.
You know that "prepare presentation" is useless — "build 8-slide deck covering
Q3 metrics, competitor analysis, and 3 recommendations" is actionable.`,

  personal: `You are a life coach who specializes in personal goal execution.
You understand human motivation and break personal goals into low-friction,
immediately startable steps with built-in accountability checkpoints.`,

  health: `You are a health professional who understands how to make health goals stick.
You create specific, measurable action steps tied to habits and schedules,
not vague intentions like "exercise more" or "eat better".`,

  finance: `You are a financial advisor who translates financial goals into concrete actions.
Each step has a specific number, account, deadline, or decision point attached to it.`,

  creative: `You are a creative director who has shipped hundreds of creative projects.
You know the creative process has distinct phases: ideation, drafting, refinement,
and production — and each requires different mental states and time blocks.`,

  other: `You are an expert project manager who handles diverse tasks.
You translate ambiguous goals into concrete, measurable steps with clear outputs.`,
};

// ── Time-context guidance ─────────────────────────────────────────────────────
function timeContext(totalDays, hoursAvail) {
  if (totalDays >= 7) {
    return `TIME CONTEXT: ${Math.round(totalDays)} days available.
Each subtask = one focused work session scheduled on a DIFFERENT DAY.
Session size: 60-180 min. Don't over-schedule — leave room for life.`;
  }
  if (totalDays >= 3) {
    return `TIME CONTEXT: ${totalDays.toFixed(1)} days available.
Subtasks will be spread across days, 1-2 per day.
Session size: 45-120 min each.`;
  }
  if (totalDays >= 1) {
    return `TIME CONTEXT: ${totalDays.toFixed(1)} days (${Math.round(hoursAvail)} hrs) available.
Subtasks spread across today and tomorrow.
Session size: 30-90 min each.`;
  }
  return `TIME CONTEXT: URGENT — only ${Math.round(hoursAvail)} hours left.
Subtasks must be short, decisive, high-impact.
Session size: 15-45 min max. 3-4 subtasks only.`;
}

// ── Stage 1 prompt: deep task analysis ────────────────────────────────────────
function buildAnalysisPrompt(task, totalDays, hoursAvail, rawInput) {
  const persona = CATEGORY_CONTEXT[task.category] || CATEGORY_CONTEXT.other;

  return `${persona}

A user needs help breaking down this task. Before creating subtasks, you MUST
deeply analyze what this task actually requires.

TASK: "${rawInput}"
CATEGORY: ${task.category}
COMPLEXITY: ${task.complexity}
${timeContext(totalDays, hoursAvail)}

Think through these questions:
1. What is the REAL goal the user is trying to achieve? (not the surface request)
2. What domain expertise is required? What does someone competent in this area
   actually DO when executing this kind of task?
3. What are the natural phases or stages of this type of work?
4. What dependencies exist — what MUST happen before what else?
5. What are the most common failure points for this type of task?
6. What does "done" look like — what is the tangible final output?

Respond ONLY with valid JSON:
{
  "realGoal": "the actual outcome the user needs (1 sentence)",
  "domainWorkflow": "how an expert actually approaches this type of task (2-3 sentences)",
  "naturalPhases": ["phase 1", "phase 2", "phase 3"],
  "criticalDependency": "the single most important prerequisite",
  "doneDefinition": "what the completed task looks like concretely",
  "timeRealism": "honest assessment of whether the deadline is realistic (1 sentence)"
}`;
}

// ── Stage 2 prompt: generate subtasks grounded in analysis ────────────────────
function buildSubtaskPrompt(task, analysis, totalDays, hoursAvail, rawInput) {
  const maxMinutes = Math.round(hoursAvail * 60);

  return `You are planning concrete subtasks for this task.

TASK: "${rawInput}"
REAL GOAL: ${analysis.realGoal}
HOW EXPERTS DO THIS: ${analysis.domainWorkflow}
NATURAL PHASES: ${analysis.naturalPhases?.join(' → ')}
DEFINITION OF DONE: ${analysis.doneDefinition}
${timeContext(totalDays, hoursAvail)}

CRITICAL RULES — every subtask MUST:
✓ Produce a TANGIBLE, VERIFIABLE output (a document, decision, code file, list, call, etc.)
✓ Be specific to THIS exact task — no generic steps like "Research topic" or "Review work"
✓ Be something a competent person can START without further clarification
✓ Follow the natural workflow of this domain

FORBIDDEN SUBTASK PATTERNS (do not use these):
✗ "Research [topic]" — replace with "Read [specific source], extract [specific thing]"
✗ "Work on [thing]" — replace with "Complete [specific deliverable] to [specific standard]"
✗ "Review and revise" — replace with "Check [specific criteria]: [item1], [item2], [item3]"
✗ "Gather information" — replace with "Collect [specific items] from [specific sources]"
✗ "Plan [thing]" — replace with "[Thing] decision: choose between X, Y, Z and document rationale"

Generate 3-6 subtasks. Total must NOT exceed ${maxMinutes} minutes.

Respond ONLY with valid JSON:
{
  "subtasks": [
    {
      "title": "Action verb + specific deliverable (max 8 words)",
      "description": "Exactly what to do and what the output looks like (2 sentences max)",
      "estimatedMinutes": number,
      "order": number,
      "tips": ["one specific, non-obvious tip for this exact subtask"],
      "type": "setup|research|execution|review|communication|other"
    }
  ],
  "totalEstimatedMinutes": number,
  "planningNotes": "One sentence about the core strategy for this specific task",
  "criticalPath": "title of the subtask that everything else depends on"
}`;
}

export async function runPlanningAgent(task, emit = null, clients = null) {
  const pro = (clients || defaultClients)?.pro;
  if (!pro) throw new Error('No LLM client available.');

  const now = new Date();
  const deadline = new Date(task.deadline);
  const hoursAvail = Math.max(1, (deadline - now) / 3_600_000);
  const totalDays = hoursAvail / 24;
  const rawInput = task.rawInput || task.title;

  // ── Stage 1: Analyze the task deeply ─────────────────────────────────────
  emit?.({ agent: 'planning', status: 'thinking', message: '🔎 Analyzing what this task actually requires...' });

  let analysis = {};
  try {
    const analysisPrompt = buildAnalysisPrompt(task, totalDays, hoursAvail, rawInput);
    const analysisResponse = await pro.generateText(analysisPrompt);
    analysis = parseJSON(analysisResponse);

    emit?.({
      agent: 'planning', status: 'thinking',
      message: `💡 Goal: ${analysis.realGoal || 'analyzing...'}`,
    });

    if (analysis.timeRealism) {
      console.log(`[Planning] Time realism check: ${analysis.timeRealism}`);
    }
  } catch (err) {
    console.warn('[Planning] Stage 1 analysis failed, proceeding:', err.message);
    analysis = {
      realGoal: task.title,
      domainWorkflow: `Complete the ${task.category} task systematically.`,
      naturalPhases: ['Prepare', 'Execute', 'Review'],
      criticalDependency: 'None identified',
      doneDefinition: `${task.title} completed and submitted`,
    };
  }

  // ── Stage 2: Generate grounded subtasks ───────────────────────────────────
  emit?.({ agent: 'planning', status: 'thinking', message: '📝 Building your specific action plan...' });

  const subtaskPrompt = buildSubtaskPrompt(task, analysis, totalDays, hoursAvail, rawInput);
  const response = await pro.generateText(subtaskPrompt);

  let plan;
  try {
    plan = parseJSON(response);
  } catch {
    throw new Error('Planning agent returned invalid JSON.');
  }

  // ── Build subtask objects ─────────────────────────────────────────────────
  const subtasks = (plan.subtasks || [])
    .slice(0, 6)
    .map((s, i) => ({
      id: uuidv4(),
      title: s.title || `Step ${i + 1}`,
      description: s.description || '',
      estimatedMinutes: Math.max(15, Math.round(s.estimatedMinutes || 60)),
      order: s.order || i + 1,
      tips: (s.tips || []).slice(0, 2),
      type: s.type || 'other',
      completed: false,
      completedAt: null,
      scheduledStart: null,
      scheduledEnd: null,
      calendarEventId: null,
      calendarLabel: null,
    }))
    .sort((a, b) => a.order - b.order);

  if (subtasks.length < 3) {
    console.warn(`[Planning] Only ${subtasks.length} subtasks — expected 3-6`);
  }

  const totalMins = subtasks.reduce((acc, s) => acc + s.estimatedMinutes, 0);

  emit?.({
    agent: 'planning',
    status: 'done',
    message: `✅ ${subtasks.length} targeted subtasks — ${(totalMins / 60).toFixed(1)}h total across ${totalDays.toFixed(1)} days`,
    data: {
      realGoal: analysis.realGoal,
      subtasks: subtasks.map((s) => ({ title: s.title, estimatedMinutes: s.estimatedMinutes })),
      planningNotes: plan.planningNotes,
      criticalPath: plan.criticalPath,
    },
  });

  return {
    subtasks,
    totalEstimatedMinutes: plan.totalEstimatedMinutes || totalMins,
    planningNotes: plan.planningNotes || '',
    criticalPath: plan.criticalPath || '',
    realGoal: analysis.realGoal || '',
  };
}