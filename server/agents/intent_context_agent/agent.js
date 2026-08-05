/**
 * intent_context_agent/agent.js
 * Refactored from parserAgent.js.
 * Extracts structured intent from raw user goal using the flash LLM model.
 */

import './schema.js'; // registers schema
import { buildIntentPrompt } from './prompt_v1.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';

const AGENT_NAME = 'intent_context_agent';
const SSE_NAME = 'parser';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

/**
 * Run the Intent Context Agent.
 * Reads: context.rawGoal, context.explicitDeadline, context.planningMode
 * Writes: context.intent
 */
export async function runIntentContextAgent(context, clients, eventBus = null, sseEmit = null) {
    const hasExplicitDeadline = !!context.explicitDeadline;
    const nowISO = new Date().toISOString();

    return runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'intent',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 2,
        agentFn: async (ctx, llm) => {
            const prompt = buildIntentPrompt(ctx.rawGoal, hasExplicitDeadline, nowISO);
            // Use flash model — fast, good for extraction tasks
            const result = await llm.flash.generateText(prompt, { promptVersion: PROMPT_VERSION });
            const text = extractText(result);
            const parsed = await parseJSONWithRepair(text, llm.flash);

            // Post-process: ensure deadline is in the future if user provided one
            if (hasExplicitDeadline && ctx.explicitDeadline) {
                parsed.deadline = ctx.explicitDeadline;
            }

            // Attach token usage to result for agentRunner logging
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
