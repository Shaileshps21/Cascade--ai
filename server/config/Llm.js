// --------------------newer version with more models---------------------------------------
/**
 * Unified LLM Client — Groq (default) + Gemini (fallback)
 * ─────────────────────────────────────────────────────────────────────────────
 * v3 — Enhanced with:
 *   • Cross-provider fallback (Groq → Gemini on failure)
 *   • Exponential backoff retry w/ jitter, honoring provider Retry-After hints
 *   • Per-call token budget control, clamped to each model's real ceiling —
 *     long planning/hierarchy generations no longer silently truncate
 *   • Automatic one-shot continuation at the model's max ceiling when a
 *     response comes back truncated (finish_reason === length / MAX_TOKENS),
 *     instead of handing clipped JSON to the syntax-only repair pass
 *   • Optional native JSON mode (Groq response_format / Gemini responseMimeType)
 *   • Empty/blocked-response detection treated as a retryable failure
 *   • Token/cost capture on every generateText() call
 *   • Prompt version tracking
 *
 * Both providers expose the same unified interface:
 *   clients.pro.generateText(prompt, opts?)   → EnrichedResult
 *   clients.flash.generateText(prompt, opts?) → EnrichedResult
 *   clients.embedding.embed(text)             → number[] | null
 *
 * generateText(prompt, opts):
 *   opts.promptVersion    - string, default 'v1.0.0'
 *   opts.maxOutputTokens  - number, overrides the tier default (clamped to
 *                           the model's documented ceiling — see MODEL_LIMITS)
 *   opts.jsonMode         - boolean, requests the provider's native
 *                           structured-JSON output mode when supported
 *
 * EnrichedResult:
 *   { text, usage: { promptTokens, completionTokens, totalTokens },
 *     provider, model, estimatedCost, promptVersion, truncated }
 *
 * Supported keyTypes: 'gemini' | 'groq'
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

// ── Model mapping ─────────────────────────────────────────────────────────────
// IMPORTANT — two separate ways a model choice can break this app on Groq:
//   1. Availability: the model catalog varies per account/region — an id
//      not in your account's list 404s as "model_not_found" on every call.
//      Verify with: curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
//   2. Free-plan TPM (tokens/minute) is often far smaller than the model's
//      documented context window, and a request over that limit 413s as
//      "Request too large" — this app's planning/knowledge prompts commonly
//      run 3-6K tokens, so headroom matters more than raw capability.
//      Free-plan TPM as of writing: llama-3.3-70b-versatile 12K,
//      llama-3.1-8b-instant 6K, openai/gpt-oss-120b/20b 8K, groq/compound 70K.
//      (openai/gpt-oss-120b was tried as `pro` here — technically more
//      capable, but its 8K TPM cap made the knowledge/planning prompts 413
//      constantly. llama-3.3-70b-versatile's larger TPM budget makes it the
//      more reliable default despite being an older model.)
const GROQ_MODELS = {
    pro: 'llama-3.3-70b-versatile', // best quality — planning, prioritization
    flash: 'llama-3.1-8b-instant',    // fastest — parsing, quick tasks
};

const GEMINI_MODELS = {
    pro: 'gemini-2.5-pro',
    flash: 'gemini-2.5-flash',
    flashLite: 'gemini-2.5-flash-lite',
    embedding: 'embedding-001',
};

// ── Per-model output/context ceilings (provider-documented) ─────────────────
// Used to clamp caller-supplied `maxOutputTokens` and to pick the retry
// budget when a response comes back truncated. If a provider changes these
// limits, update here — every call site benefits automatically.
const MODEL_LIMITS = {
    'openai/gpt-oss-120b': { maxOutputTokens: 65536, contextWindow: 131072 },
    'openai/gpt-oss-20b': { maxOutputTokens: 65536, contextWindow: 131072 },
    'llama-3.3-70b-versatile': { maxOutputTokens: 32768, contextWindow: 131072 },
    'llama-3.1-8b-instant': { maxOutputTokens: 131072, contextWindow: 131072 },
    'gemini-2.5-pro': { maxOutputTokens: 65536, contextWindow: 1048576 },
    'gemini-2.5-flash': { maxOutputTokens: 65536, contextWindow: 1048576 },
    'gemini-2.5-flash-lite': { maxOutputTokens: 65536, contextWindow: 1048576 },
};

function modelCeiling(modelName) {
    return MODEL_LIMITS[modelName]?.maxOutputTokens ?? 8192;
}

// ── Human-readable model labels ──────────────────────────────────────────────
// Single source of truth for "what model are we actually using" — the client
// (ApiKeySetup banner) and orchestrator.js SSE messages both read this via
// getModelLabel()/getProviderSummary() instead of hardcoding a model name, so
// changing GROQ_MODELS/GEMINI_MODELS above is enough to update the whole app.
const MODEL_DISPLAY_NAMES = {
    'openai/gpt-oss-120b': 'GPT-OSS 120B',
    'openai/gpt-oss-20b': 'GPT-OSS 20B',
    'llama-3.3-70b-versatile': 'Llama 3.3 70B',
    'llama-3.1-8b-instant': 'Llama 3.1 8B',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
};

// Fallback for any model id not yet added to MODEL_DISPLAY_NAMES above —
// strips a provider path prefix and title-cases the rest, so a new model
// still gets a readable (if unpolished) label instead of a raw slug.
function humanizeModelId(modelId) {
    const base = modelId.split('/').pop() ?? modelId;
    return base.replace(/[-_]/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * @param {string} modelId
 * @returns {string} human-readable model name, independent of keyType/tier
 */
export function getModelLabelById(modelId) {
    if (!modelId) return '';
    return MODEL_DISPLAY_NAMES[modelId] ?? humanizeModelId(modelId);
}

/**
 * @param {'groq'|'gemini'} keyType
 * @param {'pro'|'flash'} [tier]
 * @returns {string} human-readable model name, e.g. "Llama 3.3 70B"
 */
export function getModelLabel(keyType, tier = 'pro') {
    const modelId = keyType === 'groq' ? GROQ_MODELS[tier] : GEMINI_MODELS[tier];
    if (!modelId) return keyType === 'groq' ? 'Groq' : 'Gemini';
    return getModelLabelById(modelId);
}

/**
 * @param {'groq'|'gemini'} keyType
 * @param {string|null} [modelOverride] - if the user picked a specific model for their key
 * @returns {{ keyType, modelId, modelLabel, flashModelId, flashModelLabel }}
 */
export function getProviderSummary(keyType, modelOverride = null) {
    const models = keyType === 'groq' ? GROQ_MODELS : GEMINI_MODELS;
    const modelId = modelOverride || models.pro;
    return {
        keyType,
        modelId,
        modelLabel: getModelLabelById(modelId),
        flashModelId: models.flash,
        flashModelLabel: getModelLabel(keyType, 'flash'),
    };
}

// ── User-selectable models — what the "Choose a model" dropdown offers ──────
// Deliberately a curated subset of everything Groq/Gemini expose (not every
// model is chat-capable or a sane choice for this app's planning/reasoning
// workload — e.g. embedding-001, whisper, prompt-guard are excluded).
const GROQ_SELECTABLE_MODELS = [
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant',
];
const GEMINI_SELECTABLE_MODELS = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
];

/**
 * @param {'groq'|'gemini'} keyType
 * @returns {Array<{id: string, label: string}>} models the user can pick between
 */
export function getAvailableModels(keyType) {
    const ids = keyType === 'groq' ? GROQ_SELECTABLE_MODELS : GEMINI_SELECTABLE_MODELS;
    return ids.map((id) => ({ id, label: getModelLabelById(id) }));
}

// Per-tier defaults, used when the caller doesn't pass `maxOutputTokens`.
// Bumped up slightly from v3 so planning/hierarchy generations get more
// headroom before ever hitting the truncation/continuation path.
// Deliberately smaller than the model ceiling for the 'flash' tier (quick,
// cheap calls) — the ceiling is still available via the truncation
// auto-continuation path or an explicit override.
const DEFAULT_MAX_TOKENS = { pro: 10240, flash: 5120 };

// ── Cost constants (USD per 1k tokens) ───────────────────────────────────────
// Approximate public pricing as of 2025 — adjust as needed
const COST_PER_1K = {
    'openai/gpt-oss-120b': { input: 0.00015, output: 0.00060 },
    'openai/gpt-oss-20b': { input: 0.000075, output: 0.00030 },
    'llama-3.3-70b-versatile': { input: 0.00059, output: 0.00079 },
    'llama-3.1-8b-instant': { input: 0.000050, output: 0.000080 },
    'gemini-2.5-pro': { input: 0.00125, output: 0.00500 },
    'gemini-2.5-flash': { input: 0.000075, output: 0.00030 },
    'gemini-2.5-flash-lite': { input: 0.0000375, output: 0.00015 },
};

function estimateCost(model, promptTokens, completionTokens) {
    const rates = COST_PER_1K[model];
    if (!rates) {
        console.warn(`[LLM] No cost entry for model "${model}" — estimatedCost will read 0. Add it to COST_PER_1K if this model is in regular use.`);
        return 0;
    }
    return (promptTokens / 1000) * rates.input + (completionTokens / 1000) * rates.output;
}

// ── Quota / rate-limit error detection ───────────────────────────────────────
export function isQuotaError(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.status || err?.code || 0;
    return (
        code === 429 ||
        msg.includes('429') ||
        msg.includes('quota') ||
        msg.includes('rate limit') ||
        msg.includes('resource_exhausted') ||
        msg.includes('too many requests') ||
        msg.includes('rate_limit_exceeded')
    );
}

function isAuthError(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.status || err?.code || 0;
    return (
        code === 401 || code === 403 ||
        msg.includes('api key') ||
        msg.includes('invalid_api_key') ||
        msg.includes('authentication') ||
        msg.includes('permission denied') ||
        msg.includes('incorrect api key')
    );
}

/**
 * A misconfigured/unavailable model id (typo, deprecated, or not enabled
 * for this account) fails identically on every attempt — retrying just
 * burns the retry budget and delays surfacing the real problem.
 */
function isInvalidModelError(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.status || err?.code || 0;
    return (
        code === 404 ||
        msg.includes('model_not_found') ||
        (msg.includes('model') && (msg.includes('does not exist') || msg.includes('not found')))
    );
}

/**
 * The request payload itself exceeds the model's per-request/TPM ceiling
 * (Groq 413 "Request too large", or an equivalent size-based 400 from
 * another provider). Retrying the identical payload always fails the same
 * way — unlike a plain rate limit, waiting doesn't help.
 */
function isPayloadTooLargeError(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.status || err?.code || 0;
    return code === 413 || msg.includes('413') || msg.includes('too large') || msg.includes('request too large');
}

/** A response that came back syntactically fine but empty/blocked — worth a retry. */
class EmptyResponseError extends Error {
    constructor(label) {
        super(`${label} returned an empty response (possibly content-filtered)`);
        this.name = 'EmptyResponseError';
    }
}

// ── Retry-After extraction ────────────────────────────────────────────────────
/**
 * Best-effort extraction of a provider-supplied "retry after N ms" hint.
 * Groq/OpenAI-style SDKs surface a `headers` map on the error; Gemini's API
 * sometimes includes a `RetryInfo` with a `retryDelay` like "13s" in
 * `errorDetails`. Falls back to null (caller uses exponential backoff).
 * @param {*} err
 * @returns {number|null} milliseconds to wait, or null if unknown
 */
function getRetryAfterMs(err) {
    try {
        const headerVal = err?.headers?.get?.('retry-after') ?? err?.response?.headers?.get?.('retry-after');
        if (headerVal) {
            const secs = Number(headerVal);
            if (Number.isFinite(secs)) return secs * 1000;
        }
        const retryInfo = err?.errorDetails?.find?.((d) => typeof d?.retryDelay === 'string');
        if (retryInfo?.retryDelay) {
            const secs = parseFloat(retryInfo.retryDelay);
            if (Number.isFinite(secs)) return secs * 1000;
        }
    } catch {
        // best-effort only
    }
    return null;
}

// ── Retry with exponential backoff + jitter ──────────────────────────────────
async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'LLM' } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastErr = err;
            if (isAuthError(err) || isInvalidModelError(err) || isPayloadTooLargeError(err)) throw err; // not retryable — will fail identically every time
            if (attempt < maxAttempts) {
                const retryAfter = getRetryAfterMs(err);
                // Exponential backoff (1s, 2s, 4s...) with +/-25% jitter to avoid
                // synchronized retry storms across concurrent pipeline runs.
                const backoff = baseDelayMs * Math.pow(2, attempt - 1);
                const jittered = backoff * (0.75 + Math.random() * 0.5);
                const delay = retryAfter ?? jittered;
                console.warn(`[${label}] Attempt ${attempt} failed (${err.message?.slice(0, 60)}). Retrying in ${Math.round(delay)}ms...`);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}

// ── Groq text wrapper ─────────────────────────────────────────────────────────
function wrapGroqText(groqClient, modelName, temperature = 0.3, defaultMaxTokens = 8192, fallbackFn = null) {
    const ceiling = modelCeiling(modelName);

    return {
        async generateText(prompt, { promptVersion = 'v1.0.0', maxOutputTokens, jsonMode = false } = {}) {
            const budget = Math.min(maxOutputTokens ?? defaultMaxTokens, ceiling);

            const call = async (tokenBudget) => withRetry(async () => {
                const res = await groqClient.chat.completions.create({
                    model: modelName,
                    messages: [{ role: 'user', content: prompt }],
                    temperature,
                    max_tokens: tokenBudget,
                    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
                });
                const text = res.choices[0]?.message?.content || '';
                if (!text.trim()) throw new EmptyResponseError(`Groq:${modelName}`);
                return { res, text };
            }, { label: `Groq:${modelName}` });

            try {
                let { res, text } = await call(budget);
                let truncated = res.choices[0]?.finish_reason === 'length';

                // One-shot continuation at the model's real ceiling — a
                // truncated response is not "malformed JSON", it's missing
                // data, and no amount of syntax repair recovers that.
                if (truncated && budget < ceiling) {
                    console.warn(`[Groq:${modelName}] Response truncated at ${budget} tokens — retrying once at the ${ceiling}-token ceiling.`);
                    ({ res, text } = await call(ceiling));
                    truncated = res.choices[0]?.finish_reason === 'length';
                }

                const promptTokens = res.usage?.prompt_tokens ?? 0;
                const completionTokens = res.usage?.completion_tokens ?? 0;
                return {
                    text,
                    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
                    provider: 'groq',
                    model: modelName,
                    estimatedCost: estimateCost(modelName, promptTokens, completionTokens),
                    promptVersion,
                    truncated,
                };
            } catch (err) {
                if (fallbackFn && !isAuthError(err)) {
                    console.warn(`[Groq] Falling back to Gemini: ${err.message?.slice(0, 80)}`);
                    return fallbackFn(prompt, { promptVersion, maxOutputTokens, jsonMode });
                }
                throw err;
            }
        },
    };
}

// ── Gemini text wrapper ───────────────────────────────────────────────────────
function wrapGeminiText(model, modelName, baseGenerationConfig = {}) {
    const ceiling = modelCeiling(modelName);

    return {
        async generateText(prompt, { promptVersion = 'v1.0.0', maxOutputTokens, jsonMode = false } = {}) {
            const budget = Math.min(maxOutputTokens ?? baseGenerationConfig.maxOutputTokens ?? 8192, ceiling);

            const call = async (tokenBudget) => withRetry(async () => {
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        ...baseGenerationConfig,
                        maxOutputTokens: tokenBudget,
                        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
                    },
                });
                const text = result.response.text();
                if (!text.trim()) throw new EmptyResponseError(`Gemini:${modelName}`);
                return { result, text };
            }, { label: `Gemini:${modelName}` });

            let { result, text } = await call(budget);
            let truncated = result.response.candidates?.[0]?.finishReason === 'MAX_TOKENS';

            if (truncated && budget < ceiling) {
                console.warn(`[Gemini:${modelName}] Response truncated at ${budget} tokens — retrying once at the ${ceiling}-token ceiling.`);
                ({ result, text } = await call(ceiling));
                truncated = result.response.candidates?.[0]?.finishReason === 'MAX_TOKENS';
            }

            const meta = result.response.usageMetadata ?? {};
            const promptTokens = meta.promptTokenCount ?? 0;
            const completionTokens = meta.candidatesTokenCount ?? 0;
            return {
                text,
                usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
                provider: 'gemini',
                model: modelName,
                estimatedCost: estimateCost(modelName, promptTokens, completionTokens),
                promptVersion,
                truncated,
            };
        },
    };
}

// ── Gemini embedding wrapper ──────────────────────────────────────────────────
function wrapGeminiEmbedding(model) {
    return {
        async embed(text) {
            const result = await model.embedContent(text);
            return result.embedding.values;
        },
    };
}

// Groq has no embedding API — returns null so RAG gracefully skips
const noEmbedding = {
    async embed() { return null; },
};

// ── Client factory ─────────────────────────────────────────────────────────────
/**
 * Creates unified LLM clients for a given provider + key.
 * @param {'groq'|'gemini'} keyType
 * @param {string} apiKey
 * @param {object} [fallbackKeys] - optional { gemini: key } for cross-provider fallback
 * @param {string|null} [proModelOverride] - user-chosen model for the 'pro' tier
 *   (from getAvailableModels(keyType)); ignored (with a warning) if it isn't
 *   one of the curated selectable ids, so an old/invalid saved choice can
 *   never silently break every call.
 */
export function createClients(keyType, apiKey, fallbackKeys = {}, proModelOverride = null) {
    const selectable = getAvailableModels(keyType).map((m) => m.id);
    if (proModelOverride && !selectable.includes(proModelOverride)) {
        console.warn(`[LLM] Ignoring unknown model override "${proModelOverride}" for ${keyType} — falling back to the default.`);
        proModelOverride = null;
    }
    const proModel = proModelOverride || (keyType === 'groq' ? GROQ_MODELS.pro : GEMINI_MODELS.pro);

    if (keyType === 'groq') {
        const groq = new Groq({ apiKey });

        // Build Gemini fallback clients if a Gemini key is available
        let geminiFallbackPro = null;
        let geminiFallbackFlash = null;
        if (fallbackKeys.gemini) {
            const fallbackGenAI = new GoogleGenerativeAI(fallbackKeys.gemini);
            geminiFallbackPro = wrapGeminiText(
                fallbackGenAI.getGenerativeModel({ model: GEMINI_MODELS.pro }),
                GEMINI_MODELS.pro,
                { temperature: 0.3, topP: 0.8, maxOutputTokens: DEFAULT_MAX_TOKENS.pro },
            );
            geminiFallbackFlash = wrapGeminiText(
                fallbackGenAI.getGenerativeModel({ model: GEMINI_MODELS.flash }),
                GEMINI_MODELS.flash,
                { temperature: 0.1, topP: 0.8, maxOutputTokens: DEFAULT_MAX_TOKENS.flash },
            );
        }

        return {
            keyType: 'groq',
            modelId: proModel,
            modelLabel: getModelLabelById(proModel),
            pro: wrapGroqText(groq, proModel, 0.3, DEFAULT_MAX_TOKENS.pro, geminiFallbackPro),
            flash: wrapGroqText(groq, GROQ_MODELS.flash, 0.1, DEFAULT_MAX_TOKENS.flash, geminiFallbackFlash),
            embedding: noEmbedding,
        };
    }

    // Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    return {
        keyType: 'gemini',
        modelId: proModel,
        modelLabel: getModelLabelById(proModel),
        pro: wrapGeminiText(
            genAI.getGenerativeModel({ model: proModel }),
            proModel,
            { temperature: 0.3, topP: 0.8, maxOutputTokens: DEFAULT_MAX_TOKENS.pro },
        ),
        flash: wrapGeminiText(
            genAI.getGenerativeModel({ model: GEMINI_MODELS.flash }),
            GEMINI_MODELS.flash,
            { temperature: 0.1, topP: 0.8, maxOutputTokens: DEFAULT_MAX_TOKENS.flash },
        ),
        embedding: wrapGeminiEmbedding(
            genAI.getGenerativeModel({ model: GEMINI_MODELS.embedding })
        ),
    };
}

// ── Server default clients (from .env) ───────────────────────────────────────
// Groq is checked FIRST — it is the preferred default.
function buildDefaultClients() {
    const fallbackKeys = process.env.GEMINI_API_KEY ? { gemini: process.env.GEMINI_API_KEY } : {};
    if (process.env.GROQ_API_KEY) {
        console.log(`[LLM] Default provider: Groq (${GROQ_MODELS.pro})`);
        return createClients('groq', process.env.GROQ_API_KEY, fallbackKeys);
    }
    if (process.env.GEMINI_API_KEY) {
        console.log(`[LLM] Default provider: Gemini (${GEMINI_MODELS.pro})`);
        return createClients('gemini', process.env.GEMINI_API_KEY);
    }
    console.warn('[LLM] ⚠️  No default API key found. Users must supply their own.');
    return null;
}

export const defaultClients = buildDefaultClients();

// ── Live key validation ───────────────────────────────────────────────────────
/**
 * @param {'groq'|'gemini'} keyType
 * @param {string} apiKey
 * @param {string|null} [model] - if the user picked a specific model, also
 *   verify THAT model responds (catches an unavailable/mistyped model id
 *   immediately at save time instead of failing later mid-pipeline).
 */
export async function validateApiKey(keyType, apiKey, model = null) {
    try {
        const clients = createClients(keyType, apiKey, {}, model);
        // Flash call proves the key itself authenticates, regardless of model choice.
        const flashResult = await clients.flash.generateText('Reply with the single word: valid');
        const flashText = typeof flashResult === 'string' ? flashResult : flashResult.text;
        if (!flashText) throw new Error('Empty response');

        if (model) {
            const proResult = await clients.pro.generateText('Reply with the single word: valid');
            const proText = typeof proResult === 'string' ? proResult : proResult.text;
            if (!proText) throw new Error(`Empty response from ${model}`);
        }

        return { valid: true };
    } catch (err) {
        const msg = err.message || '';
        if (isInvalidModelError(err)) {
            return { valid: false, error: `"${getModelLabelById(model) || model}" isn't available on this account/key. Pick a different model.` };
        }
        if (isQuotaError(err)) return { valid: true }; // quota = key is real, just busy
        if (isAuthError(err)) {
            return { valid: false, error: 'Invalid API key — please check and try again.' };
        }
        return { valid: false, error: `Connection failed: ${msg.slice(0, 100)}` };
    }
}

// ── JSON parse helper ─────────────────────────────────────────────────────────
/**
 * Strips markdown code fences and parses JSON.
 * @param {string} text
 * @returns {object}
 */
export function parseJSON(text) {
    const cleaned = text
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();
    return JSON.parse(cleaned);
}

/**
 * Parse JSON with an automatic LLM repair fallback.
 * If the first parse fails, sends a repair prompt to the flash model.
 *
 * `wasTruncated` should be set to the `truncated` flag from the
 * EnrichedResult this text came from, when available. Truncated output is
 * missing data, not merely malformed — the repair prompt asks the model to
 * complete the structure instead of just re-punctuating it, which produces
 * far more accurate recoveries than blind syntax repair.
 *
 * @param {string} text            - raw LLM output
 * @param {object} flashClient     - clients.flash (for repair)
 * @param {boolean} [wasTruncated] - true if the source response hit its token ceiling
 * @returns {object}               - parsed JSON
 */
export async function parseJSONWithRepair(text, flashClient, wasTruncated = false) {
    try {
        return parseJSON(text);
    } catch (firstErr) {
        console.warn(`[LLM] JSON parse failed${wasTruncated ? ' (source response was truncated)' : ''}, attempting repair...`);
        try {
            const instruction = wasTruncated
                ? 'This JSON was cut off before it finished generating. Complete it into valid, well-formed JSON that preserves all the data already present — close every open object/array sensibly. Return ONLY the JSON, no markdown, no explanation:'
                : 'Fix this invalid JSON and return ONLY valid JSON with no markdown, no explanation:';
            const repairPrompt = `${instruction}\n\n${text.slice(0, 3000)}`;
            // For a truncated source, ask for as much room as the repair
            // model actually has (generateText clamps this to its real
            // ceiling) — a small default budget here would just truncate
            // the "repair" too, before it even reaches the original cutoff.
            const repairBudget = wasTruncated ? 65536 : 4096;

            let repairResult;
            try {
                // Prefer the provider's native JSON mode when available — it
                // meaningfully cuts down on repair-of-a-repair loops.
                repairResult = await flashClient.generateText(repairPrompt, { maxOutputTokens: repairBudget, jsonMode: true });
            } catch (jsonModeErr) {
                // Not every model/provider combination supports structured
                // output (e.g. some Groq models reject `response_format`) —
                // fall back to plain prompting rather than losing the repair
                // pass entirely.
                console.warn(`[LLM] JSON-mode repair unavailable (${jsonModeErr.message?.slice(0, 80)}), retrying without it...`);
                repairResult = await flashClient.generateText(repairPrompt, { maxOutputTokens: repairBudget });
            }
            const repairText = typeof repairResult === 'string' ? repairResult : repairResult.text;
            return parseJSON(repairText);
        } catch (repairErr) {
            throw new Error(`JSON repair failed: ${firstErr.message} | repair: ${repairErr.message}`);
        }
    }
}

// ── Text extraction helper ────────────────────────────────────────────────────
/**
 * Extract plain text from either a legacy string response or enriched result.
 * Keeps backward compatibility with agents that call clients.flash.generateText
 * and expect a plain string.
 * @param {string|object} result
 * @returns {string}
 */
export function extractText(result) {
    if (typeof result === 'string') return result;
    return result?.text ?? '';
}
