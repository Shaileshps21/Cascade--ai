/**
 * config/secrets.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Envelope encryption for secrets held at rest in Firestore — specifically the
 * provider API keys users bring themselves.
 *
 * Why this exists: `users/{uid}/settings/llm_key` previously stored raw provider
 * keys. Firestore security rules stop *other users* reading them, but they do
 * nothing about anyone holding a service-account credential or a Firebase console
 * seat, who could read every user's paid API key in the clear. Asking people to
 * hand over their own billable keys sets a higher bar than that.
 *
 * Key material, in order of preference:
 *   1. `SECRETS_KEY` — 32 bytes, hex or base64. The intended production setting;
 *      rotate it independently of everything else.
 *   2. Derived from `FIREBASE_PRIVATE_KEY` via HKDF-SHA256. The server cannot
 *      boot without that variable anyway, so this makes encryption work with no
 *      new configuration rather than leaving it switched off by default — the
 *      failure mode of an optional security feature is that nobody turns it on.
 *      Caveat: rotating the Firebase service-account key makes existing
 *      ciphertexts undecryptable, and affected users must re-enter their API key.
 *
 * Format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url. The version tag
 * makes a future algorithm change a migration rather than a break.
 *
 * Backward compatibility: `decryptSecret()` returns anything lacking the `v1.`
 * prefix unchanged, so keys stored before this change keep working. They are
 * re-encrypted the next time the user saves one.
 */

import crypto from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Fixed, non-secret HKDF context — separates this key from any other use. */
const HKDF_SALT = 'lifesaver.secrets.v1';
const HKDF_INFO = 'llm-api-key-encryption';

let cachedKey = null;

/**
 * Parse an explicit SECRETS_KEY, accepting hex or base64. Returns null when the
 * variable is unset or not exactly 32 bytes once decoded.
 * @param {string|undefined} raw
 * @returns {Buffer|null}
 */
export function parseExplicitKey(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();

    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');

    try {
        const buf = Buffer.from(trimmed, 'base64');
        if (buf.length === KEY_BYTES) return buf;
    } catch {
        /* fall through */
    }
    return null;
}

/**
 * Resolve the 32-byte master key, caching the result.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Buffer}
 * @throws if no key material is available at all
 */
export function getMasterKey(env = process.env) {
    if (cachedKey) return cachedKey;

    const explicit = parseExplicitKey(env.SECRETS_KEY);
    if (explicit) {
        cachedKey = explicit;
        return cachedKey;
    }
    if (env.SECRETS_KEY) {
        // Set but unusable — say so rather than silently falling back, otherwise
        // a typo downgrades security without anyone noticing.
        console.warn('[Secrets] SECRETS_KEY is set but is not 32 bytes of hex or base64 — ignoring it.');
    }

    const firebaseKey = env.FIREBASE_PRIVATE_KEY;
    if (firebaseKey && firebaseKey.trim()) {
        cachedKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(firebaseKey, 'utf8'), HKDF_SALT, HKDF_INFO, KEY_BYTES));
        return cachedKey;
    }

    throw new Error('No key material: set SECRETS_KEY (32 bytes hex/base64) or FIREBASE_PRIVATE_KEY.');
}

/** Test seam — drops the cached key so a changed env is picked up. */
export function resetMasterKeyCache() {
    cachedKey = null;
}

/** True if `value` looks like output of encryptSecret(). */
export function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
}

/**
 * Encrypt a secret for storage.
 * @param {string} plaintext
 * @param {Buffer} [key]
 * @returns {string} `v1.<iv>.<authTag>.<ciphertext>`
 */
export function encryptSecret(plaintext, key = getMasterKey()) {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('encryptSecret requires a non-empty string.');
    }
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        VERSION,
        iv.toString('base64url'),
        authTag.toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

/**
 * Decrypt a stored secret. Values not in the envelope format are returned
 * unchanged, so keys written before encryption existed keep working.
 * @param {string} stored
 * @param {Buffer} [key]
 * @returns {string} plaintext
 * @throws if the envelope is well-formed but fails to decrypt (wrong key or tampering)
 */
export function decryptSecret(stored, key = getMasterKey()) {
    if (!isEncrypted(stored)) return stored;

    const [, ivPart, tagPart, dataPart] = stored.split('.');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
        decipher.update(Buffer.from(dataPart, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}
