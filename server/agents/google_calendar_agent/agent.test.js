/**
 * google_calendar_agent/agent.test.js
 * Unit tests for the pure helpers only — buildCalendarEventPayload and
 * identifyFirstAndLastTasks. No real Google OAuth/network access.
 * (getCalendarClient / getFreeBusy / syncScheduleToCalendar / deleteCalendarEvents
 * all require live Firestore + Google Calendar credentials and are intentionally
 * NOT exercised here.)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCalendarEventPayload,
    identifyFirstAndLastTasks,
    FIRST_TASK_COLOR_ID,
    LAST_TASK_COLOR_ID,
    CALENDAR_EVENT_PREFIX,
} from './agent.js';

const sampleTask = {
    taskId: 'T1',
    taskName: 'Design the schema',
    startTime: '2026-07-16T09:30:00.000Z',
    endTime: '2026-07-16T10:30:00.000Z',
    adjustedDuration: 60,
    estimatedDuration: 60,
};

describe('buildCalendarEventPayload', () => {
    test('first-task event uses the 🚀 emoji, colorId 9, and the 30+5 min reminder pair', () => {
        const payload = buildCalendarEventPayload(sampleTask, 'first', 'Build a REST API');

        assert.equal(payload.summary, `${CALENDAR_EVENT_PREFIX} 🚀 ${sampleTask.taskName}`);
        assert.equal(payload.colorId, FIRST_TASK_COLOR_ID);
        assert.equal(payload.colorId, '9');
        assert.ok(payload.description.includes('🚀 START BLOCK'));
        assert.ok(payload.description.includes('Build a REST API'));
        assert.deepEqual(payload.reminders, {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: 30 }, { method: 'popup', minutes: 5 }],
        });
        assert.deepEqual(payload.start, { dateTime: sampleTask.startTime });
        assert.deepEqual(payload.end, { dateTime: sampleTask.endTime });
    });

    test('last-task event uses the 🏁 emoji, colorId 11, and the 120+30+10 min reminder trio', () => {
        const payload = buildCalendarEventPayload(sampleTask, 'last', 'Build a REST API');

        assert.equal(payload.summary, `${CALENDAR_EVENT_PREFIX} 🏁 ${sampleTask.taskName}`);
        assert.equal(payload.colorId, LAST_TASK_COLOR_ID);
        assert.equal(payload.colorId, '11');
        assert.ok(payload.description.includes('🏁 FINAL BLOCK'));
        assert.deepEqual(payload.reminders, {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: 120 }, { method: 'popup', minutes: 30 }, { method: 'popup', minutes: 10 }],
        });
    });

    test('regular (non-anchor) task gets no colorId and a single 15-minute reminder', () => {
        const payload = buildCalendarEventPayload(sampleTask, null, 'Build a REST API');

        assert.equal(payload.summary, `${CALENDAR_EVENT_PREFIX} ${sampleTask.taskName}`);
        assert.equal('colorId' in payload, false);
        assert.deepEqual(payload.reminders, {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: 15 }],
        });
    });

    test('always prefixes the summary with the ⚡ [LifeSaver] tag', () => {
        for (const label of ['first', 'last', null]) {
            const payload = buildCalendarEventPayload(sampleTask, label, 'Any Title');
            assert.ok(payload.summary.startsWith('⚡ [LifeSaver]'));
        }
    });

    test('includes task overview and AI guidance tips in the description when provided', () => {
        const payload = buildCalendarEventPayload(sampleTask, 'first', 'Build a REST API', {
            overview: 'This task sets up the core data model.',
            aiGuidance: ['Start with the User entity', 'Keep fields minimal'],
        });
        assert.ok(payload.description.includes('This task sets up the core data model.'));
        assert.ok(payload.description.includes('• Start with the User entity'));
        assert.ok(payload.description.includes('• Keep fields minimal'));
    });

    test('falls back to a generic tip when no aiGuidance is provided', () => {
        const payload = buildCalendarEventPayload(sampleTask, null, 'Any Title');
        assert.ok(payload.description.includes('Stay focused and make meaningful progress.'));
    });

    test('reports the adjusted (not estimated) duration when both are present and differ', () => {
        const task = { ...sampleTask, estimatedDuration: 60, adjustedDuration: 90 };
        const payload = buildCalendarEventPayload(task, null, 'Any Title');
        assert.ok(payload.description.includes('⏱ Estimated: 90 minutes'));
    });
});

describe('identifyFirstAndLastTasks', () => {
    test('picks the earliest-starting and latest-ending tasks', () => {
        const scheduledTasks = [
            { taskId: 'T2', startTime: '2026-07-16T11:00:00.000Z', endTime: '2026-07-16T12:00:00.000Z' },
            { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z' },
            { taskId: 'T3', startTime: '2026-07-16T13:00:00.000Z', endTime: '2026-07-16T14:00:00.000Z' },
        ];
        const { firstId, lastId } = identifyFirstAndLastTasks(scheduledTasks);
        assert.equal(firstId, 'T1');
        assert.equal(lastId, 'T3');
    });

    test('returns lastId: null for a single-task schedule (no distinct "last" anchor)', () => {
        const scheduledTasks = [
            { taskId: 'T1', startTime: '2026-07-16T09:00:00.000Z', endTime: '2026-07-16T10:00:00.000Z' },
        ];
        const { firstId, lastId } = identifyFirstAndLastTasks(scheduledTasks);
        assert.equal(firstId, 'T1');
        assert.equal(lastId, null);
    });

    test('returns nulls for an empty schedule', () => {
        assert.deepEqual(identifyFirstAndLastTasks([]), { firstId: null, lastId: null });
    });
});
