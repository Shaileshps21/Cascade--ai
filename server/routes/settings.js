// import express from 'express';
// import { db } from '../config/firebase.js';
// import { requireAuth } from '../middleware/auth.js';
// import { createGeminiClients } from '../config/gemini.js';

// const router = express.Router();

// // ── GET /api/settings/apikey ───────────────────────────────────────────────
// // Returns whether key is set — never returns the actual key
// router.get('/apikey', requireAuth, async (req, res) => {
//     try {
//         const doc = await db
//             .collection('users').doc(req.user.uid)
//             .collection('settings').doc('gemini_key')
//             .get();

//         res.json({ hasKey: doc.exists && !!doc.data()?.key });
//     } catch {
//         res.json({ hasKey: false });
//     }
// });

// // ── POST /api/settings/apikey ──────────────────────────────────────────────
// // Validates the key with a test call then saves it
// router.post('/apikey', requireAuth, async (req, res) => {
//     const { apiKey } = req.body;
//     if (!apiKey?.trim()) {
//         return res.status(400).json({ error: 'API key is required' });
//     }

//     // Validate key with a lightweight test call
//     try {
//         const clients = createGeminiClients(apiKey.trim());
//         const test = await clients.flash.generateContent('Reply with the single word: valid');
//         const text = test.response.text();
//         if (!text) throw new Error('Empty response');
//     } catch (err) {
//         return res.status(400).json({
//             error: 'Invalid API key — could not connect to Gemini. Check your key and try again.',
//         });
//     }

//     // Save to Firestore
//     await db
//         .collection('users').doc(req.user.uid)
//         .collection('settings').doc('gemini_key')
//         .set({ key: apiKey.trim(), savedAt: new Date() });

//     res.json({ success: true });
// });

// // ── DELETE /api/settings/apikey ────────────────────────────────────────────
// router.delete('/apikey', requireAuth, async (req, res) => {
//     try {
//         await db
//             .collection('users').doc(req.user.uid)
//             .collection('settings').doc('gemini_key')
//             .delete();
//         res.json({ success: true });
//     } catch {
//         res.status(500).json({ error: 'Failed to remove key' });
//     }
// });

// // ── Onboarding state ─────────────────────────────────────────────────────────
// Tracks whether the user has seen and dismissed the first-run onboarding flow.
// Stored at users/{uid}/settings/onboarding → { completed: boolean, completedAt? }

// GET /api/settings/onboarding
// router.get('/onboarding', requireAuth, async (req, res) => {
//     try {
//         const doc = await db
//             .collection('users').doc(req.user.uid)
//             .collection('settings').doc('onboarding')
//             .get();
//         res.json({ completed: doc.exists ? (doc.data()?.completed === true) : false });
//     } catch {
//         res.json({ completed: false });
//     }
// });

// // POST /api/settings/onboarding/complete
// // Called when the user finishes or skips the onboarding flow.
// router.post('/onboarding/complete', requireAuth, async (req, res) => {
//     try {
//         await db
//             .collection('users').doc(req.user.uid)
//             .collection('settings').doc('onboarding')
//             .set({ completed: true, completedAt: new Date().toISOString() }, { merge: true });
//         res.json({ success: true });
//     } catch {
//         res.status(500).json({ error: 'Failed to save onboarding state.' });
//     }
// });

// export default router;

//-------------------------------------------------------- new file----------------------

/**
 * Settings Routes — API Key Management
 * Supports both Gemini and Groq API keys.
 * Keys are validated live before saving.
 */

import express from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { validateApiKey, getProviderSummary, getAvailableModels, defaultClients } from '../config/Llm.js';
import { encryptSecret } from '../config/secrets.js';

const router = express.Router();

// ── GET /api/settings/apikey ───────────────────────────────────────────────
// Returns whether a key is saved and which type — never returns the actual key.
// `models` always reflects whatever Llm.js is actually configured with (both
// providers), so the client never has to hardcode a model name anywhere.
// `availableModels` is the full pickable list per provider, for the "choose a
// model" dropdown.
router.get('/apikey', requireAuth, async (req, res) => {
    const models = { groq: getProviderSummary('groq'), gemini: getProviderSummary('gemini') };
    const availableModels = { groq: getAvailableModels('groq'), gemini: getAvailableModels('gemini') };

    try {
        const doc = await db
            .collection('users').doc(req.user.uid)
            .collection('settings').doc('llm_key')
            .get();

        if (!doc.exists || !doc.data()?.key) {
            return res.json({
                hasKey: false,
                keyType: null,
                default: defaultClients ? getProviderSummary(defaultClients.keyType) : null,
                models,
                availableModels,
            });
        }

        const { keyType: savedKeyType, model } = doc.data();
        const keyType = savedKeyType || 'gemini';
        res.json({
            hasKey: true,
            keyType,
            model: model || null,
            provider: getProviderSummary(keyType, model || null),
            models,
            availableModels,
        });
    } catch {
        res.json({ hasKey: false, keyType: null, default: null, models, availableModels });
    }
});

// ── POST /api/settings/apikey ──────────────────────────────────────────────
// Validates then saves the key (+ optional chosen model)
router.post('/apikey', requireAuth, async (req, res) => {
    const { apiKey, keyType, model } = req.body;

    if (!apiKey?.trim()) {
        return res.status(400).json({ error: 'API key is required.' });
    }
    if (!['gemini', 'groq'].includes(keyType)) {
        return res.status(400).json({ error: 'keyType must be "gemini" or "groq".' });
    }
    let chosenModel = null;
    if (model) {
        const allowed = getAvailableModels(keyType).map((m) => m.id);
        if (!allowed.includes(model)) {
            return res.status(400).json({ error: `"${model}" isn't a selectable ${keyType} model.` });
        }
        chosenModel = model;
    }

    // ── Live validation ────────────────────────────────────────────────────
    const { valid, error } = await validateApiKey(keyType, apiKey.trim(), chosenModel);
    if (!valid) {
        return res.status(400).json({ error });
    }

    // ── Persist ────────────────────────────────────────────────────────────
    // Encrypted at rest — Firestore rules keep other users out, but they don't
    // stop anyone with a service-account credential or console seat from reading
    // every user's paid API key. See config/secrets.js.
    let storedKey;
    try {
        storedKey = encryptSecret(apiKey.trim());
    } catch (err) {
        console.error('[Settings] Refusing to store an API key unencrypted:', err.message);
        return res.status(500).json({ error: 'Server is not configured to store API keys securely.' });
    }

    await db
        .collection('users').doc(req.user.uid)
        .collection('settings').doc('llm_key')
        .set({ key: storedKey, keyType, model: chosenModel, savedAt: new Date() });

    res.json({ success: true, keyType, model: chosenModel });
});

// ── DELETE /api/settings/apikey ────────────────────────────────────────────
router.delete('/apikey', requireAuth, async (req, res) => {
    try {
        await db
            .collection('users').doc(req.user.uid)
            .collection('settings').doc('llm_key')
            .delete();
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Failed to remove key.' });
    }
});

// ── Scheduling preferences — day person / night person / flexible ──────────
// Read by scheduler_agent (see resolveWorkingHours in
// agents/scheduler_agent/agent.js) to pick the working-hours window tasks
// get scheduled into, the weekend mode, and the daily capacity.
const WORK_STYLES = ['day', 'night', 'flexible'];
const RESOURCE_MODES = ['urls', 'info_only'];
const WEEKEND_MODES = ['skip', 'light', 'normal', 'heavy'];

// ── GET /api/settings/preferences ───────────────────────────────────────────
router.get('/preferences', requireAuth, async (req, res) => {
    try {
        const doc = await db
            .collection('users').doc(req.user.uid)
            .collection('settings').doc('preferences')
            .get();
        const data = doc.exists ? doc.data() : {};
        res.json({
            workStyle: data.workStyle || 'flexible',
            resourceMode: data.resourceMode || 'urls',
            weekendMode: data.weekendMode || 'skip',
            availableHoursPerDay: typeof data.availableHoursPerDay === 'number' ? data.availableHoursPerDay : 2,
        });
    } catch {
        res.json({ workStyle: 'flexible', resourceMode: 'urls', weekendMode: 'skip', availableHoursPerDay: 2 });
    }
});

// ── PUT /api/settings/preferences ───────────────────────────────────────────
router.put('/preferences', requireAuth, async (req, res) => {
    const { workStyle, resourceMode, weekendMode, availableHoursPerDay } = req.body ?? {};

    if (workStyle !== undefined && !WORK_STYLES.includes(workStyle)) {
        return res.status(400).json({ error: `workStyle must be one of: ${WORK_STYLES.join(', ')}.` });
    }
    if (resourceMode !== undefined && !RESOURCE_MODES.includes(resourceMode)) {
        return res.status(400).json({ error: `resourceMode must be one of: ${RESOURCE_MODES.join(', ')}.` });
    }
    if (weekendMode !== undefined && !WEEKEND_MODES.includes(weekendMode)) {
        return res.status(400).json({ error: `weekendMode must be one of: ${WEEKEND_MODES.join(', ')}.` });
    }
    if (availableHoursPerDay !== undefined) {
        if (typeof availableHoursPerDay !== 'number' || availableHoursPerDay < 0.5 || availableHoursPerDay > 12) {
            return res.status(400).json({ error: 'availableHoursPerDay must be a number between 0.5 and 12.' });
        }
    }
    if (workStyle === undefined && resourceMode === undefined && weekendMode === undefined && availableHoursPerDay === undefined) {
        return res.status(400).json({ error: 'At least one preference field is required.' });
    }

    const patch = {};
    if (workStyle !== undefined) patch.workStyle = workStyle;
    if (resourceMode !== undefined) patch.resourceMode = resourceMode;
    if (weekendMode !== undefined) patch.weekendMode = weekendMode;
    if (availableHoursPerDay !== undefined) patch.availableHoursPerDay = availableHoursPerDay;
    patch.updatedAt = new Date();

    try {
        await db
            .collection('users').doc(req.user.uid)
            .collection('settings').doc('preferences')
            .set(patch, { merge: true });
        res.json({ success: true, ...patch });
    } catch {
        res.status(500).json({ error: 'Failed to save preferences.' });
    }
});

// ── Onboarding state ─────────────────────────────────────────────────────────
// Tracks whether the user has seen and dismissed the first-run onboarding flow.
// Stored at users/{uid}/settings/onboarding → { completed: boolean, completedAt? }

// GET /api/settings/onboarding
router.get('/onboarding', requireAuth, async (req, res) => {
    try {
        const doc = await db
            .collection('users').doc(req.user.uid)
            .collection('settings').doc('onboarding')
            .get();
        res.json({ completed: doc.exists ? (doc.data()?.completed === true) : false });
    } catch {
        res.json({ completed: false });
    }
});

// POST /api/settings/onboarding/complete
// Called when the user finishes or skips the onboarding flow.
router.post('/onboarding/complete', requireAuth, async (req, res) => {
    try {
        await db
            .collection('users').doc(req.user.uid)
            .collection('settings').doc('onboarding')
            .set({ completed: true, completedAt: new Date().toISOString() }, { merge: true });
        res.json({ success: true });
    } catch {
        res.status(500).json({ error: 'Failed to save onboarding state.' });
    }
});

export default router;
