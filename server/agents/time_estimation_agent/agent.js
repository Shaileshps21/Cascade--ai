/**
 * time_estimation_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Three-point time estimation per task using a multi-factor adjustment chain:
 *   Base Estimate → Historical Adjustment → Complexity Adjustment
 *                 → Confidence Adjustment → Risk Adjustment → Final Estimate
 *
 * Reads:  context.planning (task list), context.dependency, context.memory,
 *         context.benchmark
 * Writes: context.estimation
 *
 * A single LLM call handles the entire task list at once (one prompt with the
 * full task array) rather than one call per task — this keeps cost/latency
 * bounded for large plans.
 */

import './schema.js'; // registers schema
import { buildTimeEstimationPrompt } from './prompt_v1.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';

const AGENT_NAME = 'time_estimation_agent';
const SSE_NAME = 'estimation';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';

/**
 * Deterministic post-processing pass applied after LLM parsing.
 *
 * For every estimation entry:
 *   - If `optimisticMinutes <= expectedMinutes <= worstCaseMinutes` is violated,
 *     clamp optimisticMinutes down to expectedMinutes and/or worstCaseMinutes up
 *     to expectedMinutes so the constraint holds. Logs a warning when it fires.
 *   - If `finalEstimateMinutes` is missing/non-finite, recompute it as
 *     `baseEstimateMinutes * (1 + (historical+complexity+confidence+risk)/100)`.
 *
 * Pure function — does not mutate the input array; returns a new array.
 *
 * @param {Array<object>} estimations
 * @returns {Array<object>} corrected estimations
 */
export function applyEstimationConstraints(estimations) {
    if (!Array.isArray(estimations)) return [];

    return estimations.map((entry) => {
        const fixed = { ...entry };

        const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

        // Recompute finalEstimateMinutes if missing/invalid
        if (!isFiniteNum(fixed.finalEstimateMinutes)) {
            const base = isFiniteNum(fixed.baseEstimateMinutes) ? fixed.baseEstimateMinutes : 0;
            const historical = isFiniteNum(fixed.historicalAdjustmentPct) ? fixed.historicalAdjustmentPct : 0;
            const complexity = isFiniteNum(fixed.complexityAdjustmentPct) ? fixed.complexityAdjustmentPct : 0;
            const confidenceAdj = isFiniteNum(fixed.confidenceAdjustmentPct) ? fixed.confidenceAdjustmentPct : 0;
            const risk = isFiniteNum(fixed.riskAdjustmentPct) ? fixed.riskAdjustmentPct : 0;
            fixed.finalEstimateMinutes = base * (1 + (historical + complexity + confidenceAdj + risk) / 100);
            console.warn(
                `[time_estimation_agent] finalEstimateMinutes missing for task ${fixed.taskId ?? '?'} — recomputed as ${fixed.finalEstimateMinutes}`
            );
        }

        // Ensure the three-point estimate exists at all; fall back to finalEstimateMinutes
        if (!isFiniteNum(fixed.expectedMinutes)) fixed.expectedMinutes = fixed.finalEstimateMinutes;
        if (!isFiniteNum(fixed.optimisticMinutes)) fixed.optimisticMinutes = fixed.expectedMinutes;
        if (!isFiniteNum(fixed.worstCaseMinutes)) fixed.worstCaseMinutes = fixed.expectedMinutes;

        // Clamp ordering violations: optimistic <= expected <= worstCase
        const violatesLow = fixed.optimisticMinutes > fixed.expectedMinutes;
        const violatesHigh = fixed.worstCaseMinutes < fixed.expectedMinutes;

        if (violatesLow || violatesHigh) {
            console.warn(
                `[time_estimation_agent] task ${fixed.taskId ?? '?'} violated optimistic<=expected<=worstCase ` +
                `(optimistic=${fixed.optimisticMinutes}, expected=${fixed.expectedMinutes}, worstCase=${fixed.worstCaseMinutes}) — clamping`
            );
            if (violatesLow) fixed.optimisticMinutes = fixed.expectedMinutes;
            if (violatesHigh) fixed.worstCaseMinutes = fixed.expectedMinutes;
        }

        return fixed;
    });
}

/**
 * Run the Time Estimation Agent.
 * Reads: context.planning.tasks, context.dependency, context.memory, context.benchmark
 * Writes: context.estimation
 */
export async function runTimeEstimationAgent(context, clients, eventBus = null, sseEmit = null) {
    const tasks = context.planning?.tasks ?? [];

    return runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'estimation',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 2,
        agentFn: async (ctx, llm) => {
            // No tasks to estimate — short-circuit without an LLM call.
            if (tasks.length === 0) {
                return {
                    estimations: [],
                    reasoning: {
                        confidence: 1,
                        assumptions: ['No tasks present in context.planning — nothing to estimate.'],
                        warnings: [],
                        alternatives: [],
                        promptVersion: PROMPT_VERSION,
                    },
                };
            }

            const prompt = buildTimeEstimationPrompt(
                tasks,
                ctx.memory,
                ctx.benchmark,
                ctx.dependency
            );

            const result = await llm.pro.generateText(prompt, { promptVersion: PROMPT_VERSION });
            const text = extractText(result);
            const parsed = await parseJSONWithRepair(text, llm.flash);

            // Deterministic post-processing pass — enforce the hard ordering
            // constraint and backfill any missing finalEstimateMinutes.
            parsed.estimations = applyEstimationConstraints(parsed.estimations);

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
