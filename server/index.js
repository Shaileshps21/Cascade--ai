import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
import cron from 'node-cron';
import tasksRouter from './routes/tasks.js';
import calendarRouter from './routes/calendar.js';
import authRouter from './routes/auth.js';
import { runMonitorAgent } from './agents/monitorAgent.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lifesaver-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/tasks', tasksRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/auth', authRouter);

app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
}));

// ── Monitor Agent Cron Job ────────────────────────────────────────────────────
// Runs every 30 minutes to check task progress and re-plan if needed
cron.schedule('*/30 * * * *', async () => {
  console.log('[CRON] Running monitor agent sweep...');
  try {
    await runMonitorAgent();
  } catch (err) {
    console.error('[CRON] Monitor agent error:', err.message);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 LifeSaver Server running on port ${PORT}`);
  console.log(`📡 Client expected at: ${process.env.CLIENT_URL}`);
  console.log(`🤖 Gemini API: ${process.env.GEMINI_API_KEY ? '✅ configured' : '❌ missing'}\n`);
});

export default app;
