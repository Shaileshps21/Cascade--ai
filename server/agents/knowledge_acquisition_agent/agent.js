/**
 * knowledge_acquisition_agent/agent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Determines what the user needs to learn to accomplish their goal and builds
 * a knowledge package (learning objectives, concept graph, curated resources,
 * learning path). Reads context.rawGoal + context.intent, writes context.knowledge.
 *
 * Flow:
 *   1. Embed the raw goal (skip cache entirely if the embedding client returns
 *      null — e.g. Groq users have no embedding model).
 *   2. Look up `knowledge_cache` for a semantically similar cached package
 *      (cosine similarity > 0.88, scoped to the same intent.category). On a
 *      hit, write the cached package straight to context and return — no LLM
 *      call needed.
 *   3. On a cache miss, run the 7-step prompt via clients.pro through the
 *      standard runAgent pipeline (parse → validate → evaluate → write).
 *   4. Best-effort persist the new package + embedding back to `knowledge_cache`
 *      (non-fatal on failure).
 *
 * NOTE: per the plan, resources are attached to context.knowledge only — the
 * Planning Agent later attaches relevant resources to individual task
 * workspaces by topic alignment. This agent has no knowledge of context.planning.
 */

import './schema.js';
import { buildKnowledgeAcquisitionPrompt } from './prompt_v1.js';
import { validateKnowledgePackage, stripPlaceholderResourceUrls, verifyResourceUrls } from './validator.js';
import { runAgent } from '../shared/agentRunner.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';
import { writeNamespace } from '../contextManager.js';
import { db } from '../../config/firebase.js';
import { createAgentLog, completeAgentLog, attachToContext } from '../shared/logger.js';
import { toMillis } from '../shared/firestoreUtil.js';

const AGENT_NAME = 'knowledge_acquisition_agent';
const SSE_NAME = 'knowledge';
const SCHEMA_VERSION = '1.0.0';
const PROMPT_VERSION = 'v1.0.0';
const SIMILARITY_THRESHOLD = 0.88;
const CACHE_QUERY_LIMIT = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Cosine similarity — pure helper, exported for testability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the cosine similarity between two equal-length numeric vectors.
 * Returns 0 for invalid/mismatched/zero-magnitude input rather than throwing,
 * so callers can treat it as "no similarity" instead of special-casing errors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} similarity in [-1, 1] (0 on invalid input)
 */
export function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the Knowledge Acquisition Agent.
 * Reads: context.rawGoal, context.intent.category, context.intent.complexity
 * Writes: context.knowledge
 *
 * @param {object} context - PlanningContext
 * @param {object} clients - LLM clients { pro, flash, embedding }
 * @param {object|null} [eventBus]
 * @param {function|null} [sseEmit]
 * @returns {Promise<object>} the knowledge package written to context.knowledge
 */
export async function runKnowledgeAcquisitionAgent(context, clients, eventBus = null, sseEmit = null) {
    const category = context.intent?.category ?? 'other';
    const complexity = context.intent?.complexity ?? 'medium';
    const rawGoal = context.rawGoal;

    sseEmit?.(SSE_NAME, 'thinking', 'Checking for relevant learning resources...', null);
    eventBus?.agentStart(AGENT_NAME, `${AGENT_NAME} started`);

    // ── Step: embed the goal for cache lookup ─────────────────────────────────
    let queryEmbedding = null;
    try {
        queryEmbedding = await clients.embedding.embed(rawGoal);
    } catch (err) {
        console.warn(`[${AGENT_NAME}] embedding failed, skipping cache lookup: ${err.message?.slice(0, 120)}`);
        queryEmbedding = null;
    }

    // ── Step: cache lookup (only possible if we have an embedding) ────────────
    if (queryEmbedding) {
        const cached = await findCachedPackage(category, queryEmbedding);
        if (cached) {
            const log = createAgentLog(AGENT_NAME, PROMPT_VERSION);
            writeNamespace(context, 'knowledge', cached);
            completeAgentLog(log, {
                confidence: cached.confidence ?? cached.reasoning?.confidence ?? 0.8,
                status: 'success',
            });
            attachToContext(context, log);

            sseEmit?.(SSE_NAME, 'done', 'Reused a cached knowledge package for a similar goal', { cacheHit: true });
            eventBus?.agentComplete(AGENT_NAME, `${AGENT_NAME} cache hit`, { cacheHit: true });
            return cached;
        }
    }

    // ── Cache miss: generate via the 7-step prompt ────────────────────────────
    const parsed = await runAgent({
        agentName: AGENT_NAME,
        sseAgentName: SSE_NAME,
        context,
        clients,
        namespace: 'knowledge',
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        eventBus,
        sseEmit,
        maxRetries: 2,
        agentFn: async (ctx, llm) => {
            const prompt = buildKnowledgeAcquisitionPrompt(ctx.rawGoal, category, complexity);
            const result = await llm.pro.generateText(prompt, { promptVersion: PROMPT_VERSION });
            const text = extractText(result);
            const parsedOutput = await parseJSONWithRepair(text, llm.flash);

            const strippedCount = stripPlaceholderResourceUrls(parsedOutput);
            if (strippedCount > 0) {
                console.warn(`[${AGENT_NAME}] blanked ${strippedCount} hallucinated placeholder resource URL(s)`);
            }

            // Check user's resource mode preference — 'info_only' skips the
            // network round-trips entirely (fast but no verified links).
            // 'urls' (default) runs the full HEAD/GET verification pass.
            const resourceMode = ctx.preferences?.resourceMode ?? 'urls';

            if (resourceMode === 'info_only') {
                // Strip remaining URLs so nothing looks like a broken link in
                // the UI — resources render as descriptive text only.
                if (Array.isArray(parsedOutput.resources)) {
                    for (const r of parsedOutput.resources) {
                        r.url = null;
                    }
                }
                console.log(`[${AGENT_NAME}] info_only mode — URL verification skipped, resource links cleared`);
                sseEmit?.(SSE_NAME, 'thinking', '📄 Info-only mode: skipping URL verification for faster results', null);
            } else {
                // Pattern-matching only catches obviously-fake placeholders. The
                // LLM also confidently invents plausible-but-wrong deep links on
                // real domains (e.g. a docs path that was moved/renamed) — the
                // only way to catch those is to actually try to reach them.
                // Non-fatal: a network hiccup here must never fail the pipeline,
                // it just means fewer URLs survive (resources are still useful
                // without a link).
                try {
                    const unreachableCount = await verifyResourceUrls(parsedOutput);
                    if (unreachableCount > 0) {
                        console.warn(`[${AGENT_NAME}] blanked ${unreachableCount} unreachable/dead resource URL(s)`);
                    }
                } catch (err) {
                    console.warn(`[${AGENT_NAME}] URL verification skipped (non-fatal): ${err.message?.slice(0, 120)}`);
                }
            }

            // Deep structural validation (graph edges, duplicate resources) —
            // soft-fail: log a warning on the context rather than blocking the
            // write, since these issues are recoverable downstream.
            const deepCheck = validateKnowledgePackage(parsedOutput);
            if (!deepCheck.valid) {
                console.warn(`[${AGENT_NAME}] deep validation issues: ${deepCheck.errors.join('; ')}`);
                if (Array.isArray(ctx.metadata?.warnings)) {
                    ctx.metadata.warnings.push(`${AGENT_NAME}: ${deepCheck.errors.join('; ')}`);
                }
            }

            if (result?.usage) {
                parsedOutput.__usage = result.usage;
                parsedOutput.__cost = result.estimatedCost;
                parsedOutput.__provider = result.provider;
                parsedOutput.__model = result.model;
            }

            return parsedOutput;
        },
    });

    // ── Best-effort write-through cache ────────────────────────────────────────
    if (queryEmbedding) {
        try {
            await db.collection('knowledge_cache').add({
                category,
                embedding: queryEmbedding,
                package: parsed,
                createdAt: new Date(),
            });
        } catch (err) {
            console.warn(`[${AGENT_NAME}] failed to write knowledge_cache (non-fatal): ${err.message?.slice(0, 120)}`);
        }
    }

    return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query `knowledge_cache` for docs matching `category`, and return the cached
 * `package` field of the closest match if its cosine similarity to
 * `queryEmbedding` exceeds SIMILARITY_THRESHOLD. Returns null on cache miss
 * or on any Firestore error (non-fatal — caller falls through to LLM generation).
 * @param {string} category
 * @param {number[]} queryEmbedding
 * @returns {Promise<object|null>}
 */
async function findCachedPackage(category, queryEmbedding) {
    try {
        // Filter on `category` only (no `.orderBy()`) so this cache lookup
        // never depends on a composite index being deployed — the top-N most
        // recent candidates are picked in memory instead.
        const snap = await db
            .collection('knowledge_cache')
            .where('category', '==', category)
            .limit(CACHE_QUERY_LIMIT * 2)
            .get();

        const docsByRecency = snap.docs
            .slice()
            .sort((a, b) => toMillis(b.data()?.createdAt) - toMillis(a.data()?.createdAt))
            .slice(0, CACHE_QUERY_LIMIT);

        let best = null;
        let bestScore = 0;

        for (const doc of docsByRecency) {
            const data = doc.data();
            if (!Array.isArray(data?.embedding) || !data?.package) continue;
            const score = cosineSimilarity(queryEmbedding, data.embedding);
            if (score > bestScore) {
                bestScore = score;
                best = data.package;
            }
        }

        if (best && bestScore > SIMILARITY_THRESHOLD) {
            // Defensive: don't serve a malformed cached package back to the pipeline.
            const check = validateKnowledgePackage(best);
            if (check.valid) return best;
            console.warn(`[${AGENT_NAME}] discarding invalid cached package: ${check.errors.join('; ')}`);
        }

        return null;
    } catch (err) {
        console.warn(`[${AGENT_NAME}] cache lookup failed (non-fatal): ${err.message?.slice(0, 120)}`);
        return null;
    }
}
