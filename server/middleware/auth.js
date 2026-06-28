import { auth } from '../config/firebase.js';

/**
 * Middleware: Verify Firebase ID token from Authorization header.
 * Attaches req.user = { uid, email, name } on success.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decoded = await auth.verifyIdToken(idToken);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
    };
    next();
  } catch (err) {
    console.error('[Auth Middleware]', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
