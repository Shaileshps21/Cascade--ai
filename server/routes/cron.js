/**
 * routes/cron.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Externally-triggerable equivalents of the two in-process node-cron jobs.
 *
 * Why: both schedules live inside the Express process, so they only fire while
 * that process is awake. On a host that sleeps when idle — Render's free tier
 * spins down after ~15 minutes — the 30-minute progress sweep and the morning
 * briefing simply never run, which silently disables autonomous replanning, the
 * product's most distinctive behaviour. Pointing any external scheduler (Cloud
 * Scheduler, GitHub Actions, cron-job.org) at these endpoints fixes that without
 * changing the logic: they call exactly the same functions the timers do.
 *
 * Auth is a shared secret rather than a user token — there is no signed-in user
 * behind a scheduler, and these act across all users.
 *
 * Security stance: if CRON_SECRET is unset the endpoints are DISABLED (503), not
 * open. An unset secret must never degrade to "no authentication required" —
 * that is how an ops convenience becomes an unauthenticated trigger for
 * expensive, all-user LLM work.
 */

import express from 'express';
import crypto from 'node:crypto';

import { runProgressSweepWithReplan } from '../agents/orchestrator.js';
import { runBriefingCron } from '../agents/briefing_agent/agent.js';

const router = express.Router();

/**
 * Constant-time comparison that does not leak length. timingSafeEqual throws on
 * unequal-length buffers, so both sides are hashed to a fixed width first.
 * @param {string} a
 * @param {string} b
 */
function secretsMatch(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

/** Reject anything without the configured shared secret. */
export function requireCronSecret(req, res, next) {
    const expected = process.env.CRON_SECRET;
    if (!expected || !expected.trim()) {
        return res.status(503).json({
            error: 'Cron endpoints are disabled. Set CRON_SECRET to enable them.',
        });
    }

    const provided = req.get('X-Cron-Secret') ?? '';
    if (!provided || !secretsMatch(provided, expected)) {
        return res.status(401).json({ error: 'Invalid cron secret.' });
    }
    next();
}

// ── POST /api/cron/progress ────────────────────────────────────────────────
// Detects at-risk/overrun tasks and replans each one, re-syncing Calendar.
router.post('/progress', requireCronSecret, async (req, res) => {
    try {
        const result = await runProgressSweepWithReplan();
        console.log(`[Cron HTTP] Progress sweep: ${result.processed} checked, ${result.escalated} escalated, ${result.replanned} replanned`);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Cron HTTP] Progress sweep failed:', err.message);
        res.status(500).json({ error: 'Progress sweep failed', detail: err.message });
    }
});

// ── POST /api/cron/briefing ────────────────────────────────────────────────
router.post('/briefing', requireCronSecret, async (req, res) => {
    try {
        const result = await runBriefingCron();
        res.json({ success: true, result: result ?? null });
    } catch (err) {
        console.error('[Cron HTTP] Briefing failed:', err.message);
        res.status(500).json({ error: 'Briefing run failed', detail: err.message });
    }
});

export default router;
