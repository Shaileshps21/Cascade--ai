/**
 * Calendar Routes
 * ────────────────────────────────────────────────────────────────────────────
 * Handles Google Calendar OAuth2 flow and exposes calendar data endpoints.
 *
 * OAuth Flow:
 *   1. GET /api/calendar/auth?userId=xxx  → generates Google OAuth URL
 *   2. User visits URL, grants permission
 *   3. Google redirects to /api/calendar/callback?code=xxx&state=userId
 *   4. Server exchanges code for tokens, stores in Firestore
 *   5. Server redirects to CLIENT_URL/?calendarConnected=true
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
// Generate OAuth URL. userId passed as query param (can't use auth header for redirects).
router.get('/auth', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const oauth2Client = createOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',    // Get refresh token
    prompt: 'consent',         // Force refresh token on every auth
    scope: CALENDAR_SCOPES,
    state: userId,             // Pass userId through OAuth state
  });

  res.redirect(url);
});

// ── GET /api/calendar/callback ──────────────────────────────────────────────
// OAuth2 callback — exchanges code for tokens and stores them.
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error) {
    console.error('[Calendar OAuth] Error:', error);
    return res.redirect(`${process.env.CLIENT_URL}/?calendarError=true`);
  }

  if (!code || !userId) {
    return res.redirect(`${process.env.CLIENT_URL}/?calendarError=missing_params`);
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    // Store tokens in Firestore
    await db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc('calendar_tokens')
      .set({
        ...tokens,
        connectedAt: new Date().toISOString(),
      });

    // Mark user as calendar-connected
    await db.collection('users').doc(userId).set(
      { calendarConnected: true, updatedAt: new Date() },
      { merge: true }
    );

    console.log(`[Calendar] Tokens stored for user ${userId}`);
    res.redirect(`${process.env.CLIENT_URL}/?calendarConnected=true`);
  } catch (err) {
    console.error('[Calendar Callback]', err);
    res.redirect(`${process.env.CLIENT_URL}/?calendarError=token_exchange_failed`);
  }
});

// ── GET /api/calendar/status ────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const tokenDoc = await db
      .collection('users')
      .doc(req.user.uid)
      .collection('settings')
      .doc('calendar_tokens')
      .get();

    res.json({ connected: tokenDoc.exists });
  } catch {
    res.json({ connected: false });
  }
});

// ── GET /api/calendar/events ────────────────────────────────────────────────
// Returns events for the next 7 days from primary calendar.
router.get('/events', requireAuth, async (req, res) => {
  try {
    const tokenDoc = await db
      .collection('users')
      .doc(req.user.uid)
      .collection('settings')
      .doc('calendar_tokens')
      .get();

    if (!tokenDoc.exists) {
      return res.status(403).json({ error: 'Calendar not connected' });
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(tokenDoc.data());

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

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
      isLifeSaver: e.summary?.startsWith('⚡ [LifeSaver]'),
    }));

    res.json({ events });
  } catch (err) {
    console.error('[Calendar Events]', err);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// ── DELETE /api/calendar/disconnect ────────────────────────────────────────
router.delete('/disconnect', requireAuth, async (req, res) => {
  try {
    await db
      .collection('users')
      .doc(req.user.uid)
      .collection('settings')
      .doc('calendar_tokens')
      .delete();

    await db.collection('users').doc(req.user.uid).set(
      { calendarConnected: false },
      { merge: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect calendar' });
  }
});

export default router;
