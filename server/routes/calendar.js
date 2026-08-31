// ----------------------------------- new file-------------------------------------------------------
/**
 * Calendar Routes — OAuth2 flow + event endpoints
 */

import express from 'express';
import { google } from 'googleapis';
import { db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// ── GET /api/calendar/auth ──────────────────────────────────────────────────
router.get('/auth', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const oauth2Client = createOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',   // ensures refresh_token is returned
    prompt: 'consent',   // forces consent screen so refresh_token always comes back
    scope: CALENDAR_SCOPES,
    state: userId,
  });

  console.log(`[Calendar] OAuth URL generated for user ${userId}`);
  res.redirect(url);
});

// ── GET /api/calendar/callback ──────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error) {
    console.error('[Calendar OAuth] User denied or error:', error);
    return res.redirect(`${process.env.CLIENT_URL}/?calendarError=true`);
  }
  if (!code || !userId) {
    return res.redirect(`${process.env.CLIENT_URL}/?calendarError=missing_params`);
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    console.log('[Calendar] Tokens received:', {
      has_access_token: !!tokens.access_token,
      has_refresh_token: !!tokens.refresh_token,
      scope: tokens.scope,
      expiry_date: tokens.expiry_date,
    });

    if (!tokens.access_token) {
      throw new Error('No access_token in response');
    }

    // Persist tokens
    await db.collection('users').doc(userId)
      .collection('settings').doc('calendar_tokens')
      .set({ ...tokens, connectedAt: new Date().toISOString() });

    // Mark user as calendar-connected
    await db.collection('users').doc(userId)
      .set({ calendarConnected: true, updatedAt: new Date() }, { merge: true });

    console.log(`[Calendar] Tokens stored for user ${userId}`);
    res.redirect(`${process.env.CLIENT_URL}/?calendarConnected=true`);
  } catch (err) {
    console.error('[Calendar Callback] Token exchange failed:', err.message);
    res.redirect(`${process.env.CLIENT_URL}/?calendarError=token_exchange_failed`);
  }
});

// ── GET /api/calendar/status ────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid)
      .collection('settings').doc('calendar_tokens').get();

    const connected = doc.exists && !!doc.data()?.access_token;
    res.json({ connected });
  } catch {
    res.json({ connected: false });
  }
});

// ── GET /api/calendar/events ────────────────────────────────────────────────
router.get('/events', requireAuth, async (req, res) => {
  try {
    const tokenDoc = await db.collection('users').doc(req.user.uid)
      .collection('settings').doc('calendar_tokens').get();

    if (!tokenDoc.exists || !tokenDoc.data()?.access_token) {
      return res.status(403).json({ error: 'Calendar not connected' });
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(tokenDoc.data());
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 3_600_000);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: weekLater.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const events = (response.data.items || []).map((e) => ({
      id: e.id,
      title: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      isCascade: e.summary?.startsWith('⚡ [Cascade]'),
    }));

    res.json({ events });
  } catch (err) {
    console.error('[Calendar Events]', err.message);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// ── DELETE /api/calendar/disconnect ────────────────────────────────────────
router.delete('/disconnect', requireAuth, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid)
      .collection('settings').doc('calendar_tokens').delete();
    await db.collection('users').doc(req.user.uid)
      .set({ calendarConnected: false }, { merge: true });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

export default router;