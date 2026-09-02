import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { nextModuleId, buildManualModule, resolveModuleSource } from './quickAddModule.js';

describe('nextModuleId', () => {
    test('returns MOD1 for no milestones/modules', () => {
        assert.equal(nextModuleId([]), 'MOD1');
        assert.equal(nextModuleId(undefined), 'MOD1');
        assert.equal(nextModuleId([{ modules: [] }]), 'MOD1');
    });

    test('returns one past the highest numeric suffix across ALL milestones', () => {
        const milestones = [
            { modules: [{ id: 'MOD1' }, { id: 'MOD2' }] },
            { modules: [{ id: 'MOD3' }] },
        ];
        assert.equal(nextModuleId(milestones), 'MOD4');
    });

    test('is robust to out-of-order or gapped moduleIds', () => {
        const milestones = [{ modules: [{ id: 'MOD5' }, { id: 'MOD1' }] }];
        assert.equal(nextModuleId(milestones), 'MOD6');
    });

    test('ignores malformed/non-standard moduleIds instead of throwing', () => {
        const milestones = [{ modules: [{ id: 'MOD2' }, { id: 'buffer-0' }, { id: undefined }, {}] }];
        assert.equal(nextModuleId(milestones), 'MOD3');
    });
});

describe('buildManualModule', () => {
    test('produces an empty module tagged source: manual', () => {
        const mod = buildManualModule({ id: 'MOD4', title: 'New module' });
        assert.equal(mod.id, 'MOD4');
        assert.equal(mod.title, 'New module');
        assert.deepEqual(mod.tasks, []);
        assert.equal(mod.source, 'manual');
    });
});

describe('resolveModuleSource', () => {
    test('an explicit source always wins', () => {
        assert.equal(resolveModuleSource({ source: 'manual' }, { manualMode: false }), 'manual');
        assert.equal(resolveModuleSource({ source: 'ai' }, { manualMode: true }), 'ai');
    });

    test('untagged module in an AI-generated project falls back to ai', () => {
        assert.equal(resolveModuleSource({}, {}), 'ai');
        assert.equal(resolveModuleSource({}, { manualMode: false }), 'ai');
    });

    test('untagged module in a not-yet-enhanced manual project falls back to manual', () => {
        assert.equal(resolveModuleSource({}, { manualMode: true, aiEnhanced: false }), 'manual');
        assert.equal(resolveModuleSource({}, { manualMode: true }), 'manual');
    });

    test('untagged module in an AI-enhanced former-manual project falls back to ai', () => {
        assert.equal(resolveModuleSource({}, { manualMode: true, aiEnhanced: true }), 'ai');
    });
});
