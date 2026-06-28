import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

let db;
let auth;

function initFirebase() {
  if (admin.apps.length > 0) return; // Already initialised

  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });

  console.log('[Firebase] Admin SDK initialised ✅');
}

initFirebase();

db = admin.firestore();
auth = admin.auth();

export { db, auth };
export default admin;
