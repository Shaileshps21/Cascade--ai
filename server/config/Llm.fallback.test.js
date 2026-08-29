/**
 * Llm.fallback.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression test for a bug reported live in production: Groq calls that fail
 * and fall back to Gemini crashed with "fallbackFn is not a function" instead
 * of actually falling back — createClients() passes wrapGeminiText()'s return
 * value (an { generateText } wrapper object, not a bare function) as
 * wrapGroqText()'s fallbackFn, but the catch block called it directly as
 * `fallbackFn(prompt, opts)` instead of `fallbackFn.generateText(prompt, opts)`.
 *
 * Uses fake Groq/Gemini clients — no real API keys or network calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wrapGroqText, wrapGeminiText } from './Llm.js';

// A 404 model-not-found error is deliberately used here (not a generic Error)
// because withRetry() treats it as non-retryable, so the test fails over to
// Gemini on the very first attempt instead of waiting through real
// exponential-backoff delays for a generic retryable error.
function makeFailingGroqClient() {
    return {
        chat: {
            completions: {
                create: async () => {
                    const err = new Error('The model `bogus-model` does not exist');
                    err.status = 404;
                    throw err;
                },
            },
        },
    };
}

function makeFakeGeminiModel(responseText) {
    return {
        generateContent: async () => ({
            response: {
                text: () => responseText,
                candidates: [{ finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
            },
        }),
    };
}

test('Groq wrapper falls back to the Gemini wrapper object (not a bare function) on failure', async () => {
    const geminiFallback = wrapGeminiText(makeFakeGeminiModel('fallback response'), 'gemini-fake-model');
    const groq = wrapGroqText(makeFailingGroqClient(), 'bogus-model', 0.3, 100, geminiFallback);

    const result = await groq.generateText('a prompt');

    assert.equal(result.text, 'fallback response');
    assert.equal(result.provider, 'gemini');
});

test('Groq wrapper with no fallback configured still throws the original error', async () => {
    const groq = wrapGroqText(makeFailingGroqClient(), 'bogus-model', 0.3, 100, null);
    await assert.rejects(() => groq.generateText('a prompt'), /does not exist/);
});
