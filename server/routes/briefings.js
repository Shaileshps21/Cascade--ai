
import express from 'express';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { generateBriefingNow } from '../agents/briefing_agent/agent.js';

const router = express.Router();

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

// ── GET /api/briefings/today ──────────────────────────────────────────────────
router.get('/today', requireAuth, async (req, res) => {
    try {
        const doc = await db
            .collection('users').doc(req.user.uid)
            .collection('briefings').doc(todayKey())
            .get();

        if (!doc.exists) {
            return res.json({ briefing: null });
        }

        res.json({ briefing: { id: doc.id, ...doc.data() } });
    } catch (err) {
        console.error('[Briefings GET]', err.message);
        res.status(500).json({ error: 'Failed to fetch briefing' });
    }
});

// ── POST /api/briefings/generate ─────────────────────────────────────────────
// On-demand generation (e.g. user clicks "Refresh" or first login of day)
router.post('/generate', requireAuth, async (req, res) => {
    try {
        const briefing = await generateBriefingNow(req.user.uid);
        res.json({ briefing });
    } catch (err) {
        console.error('[Briefings Generate]', err.message);
        res.status(500).json({ error: err.message || 'Failed to generate briefing' });
    }
});

// ── PATCH /api/briefings/seen ─────────────────────────────────────────────────
router.patch('/seen', requireAuth, async (req, res) => {
    try {
        await db
            .collection('users').doc(req.user.uid)
            .collection('briefings').doc(todayKey())
            .update({ seen: true, seenAt: new Date() });
        res.json({ success: true });
    } catch {
        res.json({ success: false });
    }
});

// ── PATCH /api/briefings/dismiss ──────────────────────────────────────────────
router.patch('/dismiss', requireAuth, async (req, res) => {
    try {
        await db
            .collection('users').doc(req.user.uid)
            .collection('briefings').doc(todayKey())
            .update({ dismissed: true, dismissedAt: new Date() });
        res.json({ success: true });
    } catch {
        res.json({ success: false });
    }
});

export default router;