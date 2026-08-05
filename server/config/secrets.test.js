/**
 * secrets.test.js — envelope encryption for API keys held at rest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    encryptSecret,
    decryptSecret,
    isEncrypted,
    parseExplicitKey,
    getMasterKey,
    resetMasterKeyCache,
} from './secrets.js';

const KEY = crypto.randomBytes(32);
const SAMPLE = 'gsk_ThisLooksLikeARealProviderKey0123456789';

// ── Round trip ──────────────────────────────────────────────────────────────

test('encryptSecret → decryptSecret round-trips exactly', () => {
    assert.equal(decryptSecret(encryptSecret(SAMPLE, KEY), KEY), SAMPLE);
});

test('ciphertext never contains the plaintext', () => {
    assert.ok(!encryptSecret(SAMPLE, KEY).includes(SAMPLE));
});

test('the same input encrypts differently each time (random IV)', () => {
    const a = encryptSecret(SAMPLE, KEY);
    const b = encryptSecret(SAMPLE, KEY);
    assert.notEqual(a, b, 'a fixed IV would leak that two users share a key');
    assert.equal(decryptSecret(a, KEY), decryptSecret(b, KEY));
});

test('round-trips unicode and long values', () => {
    for (const value of ['ключ-🔐-キー', 'x'.repeat(5000)]) {
        assert.equal(decryptSecret(encryptSecret(value, KEY), KEY), value);
    }
});

test('encryptSecret rejects empty input', () => {
    assert.throws(() => encryptSecret('', KEY), /non-empty/);
    assert.throws(() => encryptSecret(undefined, KEY), /non-empty/);
});

// ── Backward compatibility ──────────────────────────────────────────────────

test('decryptSecret passes through keys stored before encryption existed', () => {
    // Pre-existing plaintext records must keep working, or every user is
    // silently logged out of their own provider key on deploy.
    assert.equal(decryptSecret(SAMPLE, KEY), SAMPLE);
    assert.equal(decryptSecret('AIzaSyPlaintextLegacyValue', KEY), 'AIzaSyPlaintextLegacyValue');
});

test('isEncrypted distinguishes envelopes from raw values', () => {
    assert.equal(isEncrypted(encryptSecret(SAMPLE, KEY)), true);
    assert.equal(isEncrypted(SAMPLE), false);
    assert.equal(isEncrypted('v1.only.three'), false);
    assert.equal(isEncrypted(null), false);
});

// ── Integrity ───────────────────────────────────────────────────────────────

test('a tampered ciphertext fails to decrypt rather than returning garbage', () => {
    const envelope = encryptSecret(SAMPLE, KEY);
    const [v, iv, tag, data] = envelope.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    assert.throws(() => decryptSecret([v, iv, tag, flipped.toString('base64url')].join('.'), KEY));
});

test('decrypting with the wrong key throws', () => {
    assert.throws(() => decryptSecret(encryptSecret(SAMPLE, KEY), crypto.randomBytes(32)));
});

// ── Key resolution ──────────────────────────────────────────────────────────

test('parseExplicitKey accepts 32-byte hex and base64, rejects the rest', () => {
    const hex = crypto.randomBytes(32).toString('hex');
    const b64 = crypto.randomBytes(32).toString('base64');
    assert.equal(parseExplicitKey(hex)?.length, 32);
    assert.equal(parseExplicitKey(b64)?.length, 32);
    assert.equal(parseExplicitKey('too-short'), null);
    assert.equal(parseExplicitKey(crypto.randomBytes(16).toString('hex')), null, '16 bytes must be rejected');
    assert.equal(parseExplicitKey(undefined), null);
});

test('getMasterKey prefers SECRETS_KEY over the derived fallback', () => {
    resetMasterKeyCache();
    const explicit = crypto.randomBytes(32);
    const key = getMasterKey({
        SECRETS_KEY: explicit.toString('hex'),
        FIREBASE_PRIVATE_KEY: 'some-service-account-key',
    });
    assert.deepEqual(key, explicit);
    resetMasterKeyCache();
});

test('getMasterKey derives a stable key from FIREBASE_PRIVATE_KEY when SECRETS_KEY is absent', () => {
    resetMasterKeyCache();
    const first = getMasterKey({ FIREBASE_PRIVATE_KEY: 'service-account-private-key' });
    resetMasterKeyCache();
    const second = getMasterKey({ FIREBASE_PRIVATE_KEY: 'service-account-private-key' });
    assert.equal(first.length, 32);
    assert.deepEqual(first, second, 'derivation must be deterministic or stored keys become unreadable');

    resetMasterKeyCache();
    const different = getMasterKey({ FIREBASE_PRIVATE_KEY: 'a-different-service-account' });
    assert.notDeepEqual(first, different);
    resetMasterKeyCache();
});

test('getMasterKey throws when no key material exists at all', () => {
    resetMasterKeyCache();
    assert.throws(() => getMasterKey({}), /No key material/);
    resetMasterKeyCache();
});

test('an unusable SECRETS_KEY falls back to derivation instead of failing', () => {
    resetMasterKeyCache();
    const key = getMasterKey({ SECRETS_KEY: 'not-a-valid-key', FIREBASE_PRIVATE_KEY: 'fallback-source' });
    assert.equal(key.length, 32);
    resetMasterKeyCache();
});
