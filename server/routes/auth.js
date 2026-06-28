import express from 'express';
import { auth, db } from '../config/firebase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// ── POST /api/auth/verify ───────────────────────────────────────────────────
// Called on login — verifies token and creates/updates user profile in Firestore.
router.post('/verify', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });

  try {
    const decoded = await auth.verifyIdToken(idToken);

    // Upsert user profile in Firestore
    const userRef = db.collection('users').doc(decoded.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({
        uid: decoded.uid,
        email: decoded.email || null,
        name: decoded.name || null,
        photoURL: decoded.picture || null,
        calendarConnected: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      await userRef.update({ updatedAt: new Date() });
    }

    const profile = (await userRef.get()).data();

    res.json({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      calendarConnected: profile.calendarConnected || false,
    });
  } catch (err) {
    console.error('[Auth Verify]', err);
    res.status(401).json({ error: 'Token verification failed' });
  }
});

// ── GET /api/auth/profile ───────────────────────────────────────────────────
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });
    res.json({ profile: doc.data() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
