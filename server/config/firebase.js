import admin from 'firebase-admin';
import { initializeFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
dotenv.config();

let db;
let auth;

function initFirebase() {
  if (admin.apps.length > 0) return; // Already initialised

  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });

  // Firestore speaks gRPC by default, which some corporate/campus proxies
  // refuse to tunnel (the CONNECT to firestore.googleapis.com:443 comes back
  // 504) — the SDK then retries silently and every read times out. Setting
  // FIRESTORE_PREFER_REST=true switches to the REST transport, which is plain
  // HTTPS and proxies cleanly.
  //
  // Opt-in, defaulting to gRPC: for a long-lived server gRPC keeps a warm
  // multiplexed connection and is the better default, so this only changes
  // behaviour where the network forces it. (It is also the transport Google
  // recommends for short-lived serverless instances, where gRPC's setup cost
  // outweighs its benefits.)
  if (process.env.FIRESTORE_PREFER_REST === 'true') {
    initializeFirestore(app, { preferRest: true });
    console.log('[Firebase] Firestore transport: REST (FIRESTORE_PREFER_REST=true)');
  }

  console.log('[Firebase] Admin SDK initialised ✅');
}

initFirebase();

db = admin.firestore();
auth = admin.auth();

export { db, auth };
export default admin;
