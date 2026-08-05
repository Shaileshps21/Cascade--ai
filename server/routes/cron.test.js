/**
 * cron.test.js — shared-secret gate on the externally-triggerable cron endpoints.
 *
 * These endpoints run expensive, all-user LLM work, so the gate matters more than
 * the handlers: the failure mode to protect against is an unset secret quietly
 * meaning "no auth required".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { requireCronSecret } from './cron.js';

/** Minimal express req/res doubles. */
function harness(headerValue) {
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    const req = { get: (name) => (name === 'X-Cron-Secret' ? headerValue : undefined) };
    let nextCalled = false;
    return { req, res, next: () => { nextCalled = true; }, wasAllowed: () => nextCalled };
}

const withSecret = (value, fn) => {
    const previous = process.env.CRON_SECRET;
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    try { fn(); } finally {
        if (previous === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previous;
    }
};

test('endpoints are disabled, not open, when CRON_SECRET is unset', () => {
    withSecret(undefined, () => {
        const h = harness('anything');
        requireCronSecret(h.req, h.res, h.next);
        assert.equal(h.wasAllowed(), false, 'an unset secret must never mean "no auth"');
        assert.equal(h.res.statusCode, 503);
    });
});

test('a blank CRON_SECRET also disables rather than opens', () => {
    withSecret('   ', () => {
        const h = harness('   ');
        requireCronSecret(h.req, h.res, h.next);
        assert.equal(h.wasAllowed(), false);
        assert.equal(h.res.statusCode, 503);
    });
});

test('the correct secret is allowed through', () => {
    withSecret('s3cret-value', () => {
        const h = harness('s3cret-value');
        requireCronSecret(h.req, h.res, h.next);
        assert.equal(h.wasAllowed(), true);
        assert.equal(h.res.statusCode, null);
    });
});

test('a wrong secret is rejected with 401', () => {
    withSecret('s3cret-value', () => {
        const h = harness('wrong-value');
        requireCronSecret(h.req, h.res, h.next);
        assert.equal(h.wasAllowed(), false);
        assert.equal(h.res.statusCode, 401);
    });
});

test('a missing header is rejected when a secret is configured', () => {
    withSecret('s3cret-value', () => {
        const h = harness(undefined);
        requireCronSecret(h.req, h.res, h.next);
        assert.equal(h.wasAllowed(), false);
        assert.equal(h.res.statusCode, 401);
    });
});

test('a secret of different length is rejected without throwing', () => {
    // timingSafeEqual throws on unequal buffer lengths; hashing both sides first
    // is what keeps this a clean 401 rather than a 500.
    withSecret('short', () => {
        const h = harness('a-considerably-longer-provided-value');
        assert.doesNotThrow(() => requireCronSecret(h.req, h.res, h.next));
        assert.equal(h.res.statusCode, 401);
    });
});

test('a prefix of the real secret is rejected', () => {
    withSecret('s3cret-value', () => {
        const h = harness('s3cret');
        requireCronSecret(h.req, h.res, h.next);
        assert.equal(h.wasAllowed(), false);
    });
});
