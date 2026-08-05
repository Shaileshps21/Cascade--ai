/**
 * contextManager.size.test.js — Firestore per-document size guard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    estimateDocumentBytes,
    shrinkContextForWrite,
    SHEDDABLE_FIELDS,
    SAFE_DOC_BYTES,
    FIRESTORE_MAX_DOC_BYTES,
} from './contextManager.js';

/** A context whose optional fields are padded to a chosen size. */
function contextWithBulk(bytesPerField) {
    const pad = (n) => 'x'.repeat(n);
    return {
        taskId: 't1',
        userId: 'u1',
        rawGoal: 'Learn Rust',
        planning: { tasks: [{ taskId: 'a', title: 'Read the book' }] },
        schedule: { scheduledTasks: [{ taskId: 'a', startTime: '2026-07-22T09:00:00.000Z' }] },
        intent: { category: 'learning' },
        review: { notes: pad(bytesPerField) },
        benchmark: { history: pad(bytesPerField) },
        memory: { pastProjects: pad(bytesPerField) },
        knowledge: { resources: pad(bytesPerField) },
        metadata: { createdAt: '2026-07-22T00:00:00.000Z' },
    };
}

test('the safe threshold leaves headroom under Firestore hard limit', () => {
    assert.ok(SAFE_DOC_BYTES < FIRESTORE_MAX_DOC_BYTES);
});

test('estimateDocumentBytes measures serialized size', () => {
    assert.ok(estimateDocumentBytes({ a: 'x'.repeat(1000) }) > 1000);
    assert.equal(estimateDocumentBytes({}), 2); // "{}"
});

test('estimateDocumentBytes treats unserializable input as oversized', () => {
    const circular = {};
    circular.self = circular;
    assert.equal(estimateDocumentBytes(circular), Infinity);
});

test('a normal context passes through untouched', () => {
    const context = contextWithBulk(10);
    const result = shrinkContextForWrite(context);
    assert.deepEqual(result.droppedFields, []);
    assert.equal(result.stillTooLarge, false);
    assert.equal(result.context, context, 'small contexts should not be copied at all');
});

test('an oversized context sheds optional fields in priority order', () => {
    // Sized so that even one surviving field would breach the threshold on its
    // own — that forces the full shed order to be exercised end to end.
    const result = shrinkContextForWrite(contextWithBulk(SAFE_DOC_BYTES + 1_000));
    assert.deepEqual(result.droppedFields, SHEDDABLE_FIELDS);
    assert.equal(result.stillTooLarge, false);
});

test('shedding stops as soon as the context fits', () => {
    // Total ~1.2MB across four fields; dropping the first two gets under 900KB.
    const result = shrinkContextForWrite(contextWithBulk(300_000));
    assert.ok(result.droppedFields.length > 0);
    assert.ok(result.droppedFields.length < SHEDDABLE_FIELDS.length, 'should not shed more than necessary');
    assert.equal(result.droppedFields[0], 'review', 'least valuable field goes first');
    assert.equal(result.stillTooLarge, false);
});

test('required planning and schedule data is never shed', () => {
    const result = shrinkContextForWrite(contextWithBulk(400_000));
    assert.ok(result.context.planning, 'planning must survive — the UI cannot render without it');
    assert.ok(result.context.schedule, 'schedule must survive');
    assert.equal(result.context.taskId, 't1');
});

test('shrinking does not mutate the caller’s context', () => {
    const context = contextWithBulk(400_000);
    shrinkContextForWrite(context);
    assert.ok(context.review, 'the original object must be left intact');
    assert.ok(context.knowledge);
});

test('stillTooLarge is reported when required data alone exceeds the limit', () => {
    const result = shrinkContextForWrite({
        taskId: 't1',
        planning: { tasks: [{ notes: 'x'.repeat(1_000_000) }] },
    });
    assert.equal(result.stillTooLarge, true);
    assert.deepEqual(result.droppedFields, [], 'nothing optional was present to drop');
});

test('null optional fields are skipped rather than counted as dropped', () => {
    const result = shrinkContextForWrite({
        taskId: 't1',
        review: null,
        benchmark: null,
        memory: null,
        knowledge: { resources: 'x'.repeat(1_000_000) },
        planning: { tasks: [] },
    });
    assert.deepEqual(result.droppedFields, ['knowledge']);
});
