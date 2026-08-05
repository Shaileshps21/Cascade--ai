/**
 * prioritization_agent/agent.js
 * Refactored from prioritizationAgent.js.
 *
 * Scores task priority/urgency/risk (preserving the original scoring rubric)
 * plus the new v3 fields: businessValue, projectImportance, deadlineConfidence,
 * estimatedUncertainty, expectedInterruptionScore.
 *
 * Reads: context.intent (title, category, complexity, urgency, deadline)
 *        context.memory (reliabilityScore, averageSuccessRate, etc. — already
 *        computed by memory_agent from task_history/user_benchmarks; no direct
 *        RAG/Firestore queries here)
 * Writes: context.priority
 */

import './schema.js'; // registers schema
import { buildPrioritizationPrompt } from './prompt_v1.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';

const AGENT_NAME = 'prioritization_agent';
const SSE_NAME = 'prioritization';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
};

/**
 * Run the Prioritization Agent.
 * @param {object} context - PlanningContext
 * @param {object} clients - LLM clients { pro, flash, embedding }
 * @param {object|null} eventBus - optional eventBus instance
 * @param {function|null} sseEmit - optional (agentName, status, message, data) => void
 */
export async function runPrioritizationAgent(context, clients, eventBus = null, sseEmit = null) {
    const nowISO = new Date().toISOString();

    return runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'priority',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 2,
        agentFn: async (ctx, llm) => {
            const intent = ctx.intent ?? {};
            const memory = ctx.memory ?? {};

            const deadline = intent.deadline ?? ctx.explicitDeadline;
            const hoursUntilDeadline = deadline
                ? (new Date(deadline).getTime() - Date.now()) / 3_600_000
                : null;

            const prompt = buildPrioritizationPrompt(intent, memory, nowISO, hoursUntilDeadline, ctx.rawGoal);

            // Uses clients.pro — prioritization is a higher-stakes scoring task.
            const result = await llm.pro.generateText(prompt, { promptVersion: PROMPT_VERSION });
            const text = extractText(result);
            const parsed = await parseJSONWithRepair(text, llm.flash);

            // ── Clamp / normalize numeric fields (preserves old file's clamp()) ────
            parsed.priorityScore = Math.round(clamp(parsed.priorityScore, 0, 100, 50));
            parsed.urgencyScore = Math.round(clamp(parsed.urgencyScore, 0, 100, 50));
            parsed.importanceScore = Math.round(clamp(parsed.importanceScore, 0, 100, 50));
            parsed.riskScore = Math.round(clamp(parsed.riskScore, 0, 100, 50));
            parsed.businessValue = Math.round(clamp(parsed.businessValue, 0, 100, 50));
            parsed.projectImportance = Math.round(clamp(parsed.projectImportance, 0, 100, 50));
            parsed.estimatedUncertainty = Math.round(clamp(parsed.estimatedUncertainty, 0, 100, 50));
            parsed.expectedInterruptionScore = Math.round(clamp(parsed.expectedInterruptionScore, 0, 100, 30));
            parsed.deadlineConfidence = parseFloat(clamp(parsed.deadlineConfidence, 0, 1, 0.6).toFixed(3));
            parsed.bufferHoursNeeded = Math.max(0, Number(parsed.bufferHoursNeeded) || 0);

            parsed.warningFlags = Array.isArray(parsed.warningFlags) ? parsed.warningFlags : [];
            parsed.personalizationInsights = Array.isArray(parsed.personalizationInsights)
                ? parsed.personalizationInsights
                : [];

            // Fallback recommendedStartTime if missing/invalid: deadline minus buffer,
            // else a few hours from now.
            const recommended = new Date(parsed.recommendedStartTime);
            if (Number.isNaN(recommended.getTime())) {
                if (deadline) {
                    const bufferMs = parsed.bufferHoursNeeded * 3_600_000;
                    parsed.recommendedStartTime = new Date(new Date(deadline).getTime() - bufferMs).toISOString();
                } else {
                    parsed.recommendedStartTime = new Date(Date.now() + 2 * 3_600_000).toISOString();
                }
            }

            // Note when no meaningful memory profile was available (mirrors the old
            // file's RAG-unavailable messaging, now driven by context.memory instead).
            const hasMemory = Array.isArray(memory.similarProjects) && memory.similarProjects.length > 0;
            if (!hasMemory && !parsed.warningFlags.some((w) => /history|memory/i.test(w))) {
                parsed.warningFlags.push('No historical memory available — scores based on task attributes only');
            }

            parsed.schemaVersion = SCHEMA_VERSION;

            // Attach usage metadata (same convention as intent_context_agent/agent.js)
            if (result?.usage) {
                parsed.__usage = result.usage;
                parsed.__cost = result.estimatedCost;
                parsed.__provider = result.provider;
                parsed.__model = result.model;
            }

            return parsed;
        },
    });
}
