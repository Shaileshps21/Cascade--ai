import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';

import tasksRouter from './routes/tasks.js';
import projectsRouter from './routes/projects.js';
import calendarRouter from './routes/calendar.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import briefingsRouter from './routes/briefings.js';
import cronRouter from './routes/cron.js';

import { runBriefingCron } from './agents/briefing_agent/agent.js';
import { runProgressSweepWithReplan } from './agents/orchestrator.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/tasks', tasksRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/briefings', briefingsRouter);
app.use('/api/cron', cronRouter);

app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
}));

// ── Cron: Progress Tracking Agent — every 30 minutes ─────────────────────────
// The sweep only DETECTS escalation (risk score crossing the threshold,
// which already factors in missed/overdue scheduled slots — see
// computeLiveRiskScore's overdueCount term). Actually reassigning the missed
// task and modifying the schedule is a separate step: replanTask() re-runs
// the scheduler for the affected tasks and re-syncs Google Calendar.
//
// This timer only fires while the process is awake. On a host that sleeps when
// idle, drive POST /api/cron/progress from an external scheduler instead — it
// runs the identical function (see routes/cron.js).
cron.schedule('*/30 * * * *', async () => {
  console.log('[CRON] Progress tracking sweep...');
  try {
    const { processed, escalated, replanned } = await runProgressSweepWithReplan();
    console.log(`[CRON] Progress sweep: ${processed} checked, ${escalated} escalated, ${replanned} replanned`);
  } catch (err) {
    console.error('[CRON] Progress tracking error:', err.message);
  }
});

// ── Cron: Briefing Agent — 3:30 AM UTC daily (≈ 9 AM IST) ───────────────────
// Adjust the UTC hour to match your target timezone:
//   IST (UTC+5:30)  → 3:30 AM UTC  → "30 3 * * *"
//   PST (UTC-8)     → 4:00 PM UTC  → "0 16 * * *"
//   EST (UTC-5)     → 1:00 PM UTC  → "0 13 * * *"
cron.schedule('30 3 * * *', async () => {
  console.log('[CRON] 🌅 Morning briefing agent starting...');
  try { await runBriefingCron(); }
  catch (err) { console.error('[CRON] Briefing error:', err.message); }
});

// Also run at 4:30 AM UTC (≈ 10 AM IST) as a catch-up sweep
cron.schedule('30 4 * * *', async () => {
  console.log('[CRON] 🌅 Briefing catch-up sweep...');
  try { await runBriefingCron(); }
  catch (err) { console.error('[CRON] Briefing catch-up error:', err.message); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const groqReady = !!process.env.GROQ_API_KEY;
  const geminiReady = !!process.env.GEMINI_API_KEY;

  console.log(`
🚀 LifeSaver Server — port ${PORT}
📡 Client: ${process.env.CLIENT_URL}
⚡ Groq:   ${groqReady ? '✅ configured (default)' : '❌ not set'}
✦  Gemini: ${geminiReady ? '✅ configured (fallback)' : '⚠️  not set'}
🤖 Agents: 15-agent pipeline · Progress Tracking (30m) · Briefing (3:30 AM UTC)
  `);
});

export default app;