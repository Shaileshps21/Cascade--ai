/**
 * briefing_agent/agent.test.js
 * Unit tests for the deterministic (Stage 1 + Stage 2) pure functions of the
 * Briefing Agent, plus the LLM-free narrative fallback (Stage 3 resilience
 * path). No live LLM/Firestore/network calls are made in this file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isProjectActive,
    isBriefableDoc,
    triageProjects,
    classifyUrgencyLevel,
    buildTodaysSchedule,
    pickTodaysFocusBlock,
    buildFallbackNarrative,
} from './agent.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-16T10:00:00.000Z'); // Thursday

function planningTask(overrides = {}) {
    return {
        taskId: 'T1',
        title: 'Write tests',
        estimatedMinutes: 60,
        difficulty: 'medium',
        progress: { status: 'not_started', completedAt: null, actualMinutes: null },
        ...overrides,
    };
}

function makeContext(overrides = {}) {
    return {
        taskId: 'proj-1',
        userId: 'user-1',
        rawGoal: 'Build a REST API',
        explicitDeadline: null,
        intent: { title: 'Build a REST API', deadline: null },
        priority: { riskScore: 0 },
        planning: { tasks: [planningTask()] },
        schedule: null,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// isProjectActive
// ─────────────────────────────────────────────────────────────────────────────

test('isProjectActive: true when at least one planning task is not completed', () => {
    const context = makeContext({
        planning: { tasks: [planningTask({ progress: { status: 'not_started' } })] },
    });
    assert.equal(isProjectActive(context), true);
});

test('isProjectActive: false when every planning task is completed', () => {
    const context = makeContext({
        planning: { tasks: [planningTask({ progress: { status: 'completed' } })] },
    });
    assert.equal(isProjectActive(context), false);
});

test('isProjectActive: false when planning.tasks is empty or missing', () => {
    assert.equal(isProjectActive(makeContext({ planning: { tasks: [] } })), false);
    assert.equal(isProjectActive(makeContext({ planning: null })), false);
    assert.equal(isProjectActive({}), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// isBriefableDoc — excludes archived (soft-deleted) and pipeline-failed docs
// from the briefing, matching the same filter GET /api/projects already uses.
// ─────────────────────────────────────────────────────────────────────────────

function fakeDoc(metadata) {
    return { data: () => ({ metadata }) };
}

test('isBriefableDoc: true for a normal, non-archived, non-failed doc', () => {
    assert.equal(isBriefableDoc(fakeDoc({})), true);
    assert.equal(isBriefableDoc(fakeDoc({ archived: false, pipelineFailed: false })), true);
});

test('isBriefableDoc: false for an archived (soft-deleted) project', () => {
    assert.equal(isBriefableDoc(fakeDoc({ archived: true })), false);
});

test('isBriefableDoc: false for a partial pipeline-failed checkpoint', () => {
    assert.equal(isBriefableDoc(fakeDoc({ pipelineFailed: true })), false);
});

test('isBriefableDoc: false when both flags are set', () => {
    assert.equal(isBriefableDoc(fakeDoc({ archived: true, pipelineFailed: true })), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// triageProjects
// ─────────────────────────────────────────────────────────────────────────────

test('triageProjects: buckets an overdue project correctly', () => {
    const context = makeContext({
        intent: { title: 'Overdue project', deadline: '2026-07-15T00:00:00.000Z' },
    });
    const { buckets } = triageProjects([context], NOW);
    assert.equal(buckets.overdue.length, 1);
    assert.equal(buckets.overdue[0].title, 'Overdue project');
    assert.equal(buckets.overdue[0].isPastDue, true);
});

test('triageProjects: buckets a fire-now project (<12h left)', () => {
    const context = makeContext({
        intent: { title: 'Fire now', deadline: '2026-07-16T18:00:00.000Z' }, // 8h from NOW
    });
    const { buckets } = triageProjects([context], NOW);
    assert.equal(buckets.fireNow.length, 1);
    assert.equal(buckets.fireNow[0].hoursLeft, 8);
});

test('triageProjects: buckets a due-today project (>12h but same day)', () => {
    const context = makeContext({
        intent: { title: 'Due today', deadline: '2026-07-16T23:00:00.000Z' }, // 13h from NOW
    });
    const { buckets } = triageProjects([context], NOW);
    assert.equal(buckets.dueToday.length, 1);
});

test('triageProjects: buckets a due-this-week project', () => {
    const context = makeContext({
        intent: { title: 'Due this week', deadline: '2026-07-20T10:00:00.000Z' }, // 4 days out
    });
    const { buckets } = triageProjects([context], NOW);
    assert.equal(buckets.dueWeek.length, 1);
});

test('triageProjects: a project with no deadline lands in onTrack', () => {
    const context = makeContext({ intent: { title: 'No deadline', deadline: null } });
    const { buckets } = triageProjects([context], NOW);
    assert.equal(buckets.onTrack.length, 1);
    assert.equal(buckets.onTrack[0].hoursLeft, null);
});

test('triageProjects: computes progress and workMinLeft from planning.tasks', () => {
    const context = makeContext({
        intent: { title: 'Partial progress', deadline: null },
        planning: {
            tasks: [
                planningTask({ taskId: 'T1', estimatedMinutes: 30, progress: { status: 'completed' } }),
                planningTask({ taskId: 'T2', estimatedMinutes: 90, progress: { status: 'not_started' } }),
            ],
        },
    });
    const { enriched } = triageProjects([context], NOW);
    assert.equal(enriched[0].progress, 50);
    assert.equal(enriched[0].workMinLeft, 90);
    assert.equal(enriched[0].nextTask.taskId, 'T2');
});

test('triageProjects: buckets are sorted by ascending hoursLeft', () => {
    const soon = makeContext({ intent: { title: 'Soon', deadline: '2026-07-16T15:00:00.000Z' } }); // 5h
    const later = makeContext({ intent: { title: 'Later', deadline: '2026-07-16T20:00:00.000Z' } }); // 10h
    const { buckets } = triageProjects([later, soon], NOW);
    assert.equal(buckets.fireNow.length, 2);
    assert.equal(buckets.fireNow[0].title, 'Soon');
    assert.equal(buckets.fireNow[1].title, 'Later');
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyUrgencyLevel
// ─────────────────────────────────────────────────────────────────────────────

test('classifyUrgencyLevel: critical when any project is overdue', () => {
    const buckets = { overdue: [{ title: 'x' }], fireNow: [], dueToday: [], dueWeek: [], onTrack: [] };
    assert.equal(classifyUrgencyLevel(buckets), 'critical');
});

test('classifyUrgencyLevel: critical when a fire-now project has <= 6h left', () => {
    const buckets = { overdue: [], fireNow: [{ hoursLeft: 5 }], dueToday: [], dueWeek: [], onTrack: [] };
    assert.equal(classifyUrgencyLevel(buckets), 'critical');
});

test('classifyUrgencyLevel: high when fireNow (>6h) or dueToday present without overdue/critical fireNow', () => {
    const buckets = { overdue: [], fireNow: [{ hoursLeft: 10 }], dueToday: [], dueWeek: [], onTrack: [] };
    assert.equal(classifyUrgencyLevel(buckets), 'high');

    const buckets2 = { overdue: [], fireNow: [], dueToday: [{ hoursLeft: 20 }], dueWeek: [], onTrack: [] };
    assert.equal(classifyUrgencyLevel(buckets2), 'high');
});

test('classifyUrgencyLevel: medium when only dueWeek projects exist', () => {
    const buckets = { overdue: [], fireNow: [], dueToday: [], dueWeek: [{ title: 'x' }], onTrack: [] };
    assert.equal(classifyUrgencyLevel(buckets), 'medium');
});

test('classifyUrgencyLevel: low when everything is onTrack or empty', () => {
    const buckets = { overdue: [], fireNow: [], dueToday: [], dueWeek: [], onTrack: [{ title: 'x' }] };
    assert.equal(classifyUrgencyLevel(buckets), 'low');
    assert.equal(classifyUrgencyLevel({ overdue: [], fireNow: [], dueToday: [], dueWeek: [], onTrack: [] }), 'low');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTodaysSchedule — prefers context.schedule.scheduledTasks, falls back
// to deterministic slotting when absent.
// ─────────────────────────────────────────────────────────────────────────────

test('buildTodaysSchedule: uses context.schedule.scheduledTasks when present, filtered to today', () => {
    const context = makeContext({
        intent: { title: 'Scheduled project', deadline: '2026-07-16T20:00:00.000Z' },
        planning: { tasks: [planningTask({ taskId: 'T1', title: 'Implement endpoint' })] },
        schedule: {
            scheduledTasks: [
                {
                    taskId: 'T1',
                    taskName: 'Implement endpoint',
                    startTime: '2026-07-16T11:00:00.000Z',
                    endTime: '2026-07-16T12:00:00.000Z',
                    energyLevel: 'high',
                    isBuffer: false,
                },
                {
                    // yesterday — must be filtered out
                    taskId: 'T2',
                    taskName: 'Old task',
                    startTime: '2026-07-15T11:00:00.000Z',
                    endTime: '2026-07-15T12:00:00.000Z',
                    isBuffer: false,
                },
                {
                    // buffer slot — must be excluded
                    taskId: 'BUF1',
                    taskName: 'Buffer',
                    startTime: '2026-07-16T13:00:00.000Z',
                    endTime: '2026-07-16T13:30:00.000Z',
                    isBuffer: true,
                },
            ],
        },
    });

    const { buckets } = triageProjects([context], NOW);
    const schedule = buildTodaysSchedule(buckets, NOW);

    assert.equal(schedule.length, 1);
    assert.equal(schedule[0].subtask, 'Implement endpoint');
    assert.equal(schedule[0].time, '11:00');
    assert.equal(schedule[0].endTime, '12:00');
    assert.equal(schedule[0].duration, 60);
    assert.equal(schedule[0].energyLevel, 'high');
});

test('buildTodaysSchedule: excludes scheduled tasks whose planning task is already completed', () => {
    const context = makeContext({
        intent: { title: 'Done task project', deadline: '2026-07-16T20:00:00.000Z' },
        planning: { tasks: [planningTask({ taskId: 'T1', progress: { status: 'completed' } })] },
        schedule: {
            scheduledTasks: [
                {
                    taskId: 'T1',
                    taskName: 'Already done',
                    startTime: '2026-07-16T11:00:00.000Z',
                    endTime: '2026-07-16T12:00:00.000Z',
                    isBuffer: false,
                },
            ],
        },
    });
    const { buckets } = triageProjects([context], NOW);
    const schedule = buildTodaysSchedule(buckets, NOW);
    assert.equal(schedule.length, 0);
});

test('buildTodaysSchedule: falls back to deterministic slotting when context.schedule is null', () => {
    const context = makeContext({
        intent: { title: 'Unscheduled project', deadline: '2026-07-16T20:00:00.000Z' },
        planning: {
            tasks: [
                planningTask({ taskId: 'T1', title: 'Task A', estimatedMinutes: 60 }),
                planningTask({ taskId: 'T2', title: 'Task B', estimatedMinutes: 45 }),
            ],
        },
        schedule: null,
    });
    const { buckets } = triageProjects([context], NOW);
    const schedule = buildTodaysSchedule(buckets, NOW);

    assert.ok(schedule.length >= 1);
    assert.equal(schedule[0].task, 'Unscheduled project');
    assert.ok(schedule.every((s) => s.duration > 0));
    // Fallback cursor starts at/after "now" (10:00 UTC), within working hours.
    assert.ok(schedule[0].time >= '10:00');
});

test('buildTodaysSchedule: returns entries sorted by start time across mixed sources', () => {
    const early = makeContext({
        intent: { title: 'Early project', deadline: '2026-07-16T13:00:00.000Z' },
        planning: { tasks: [planningTask({ taskId: 'E1', title: 'Early task' })] },
        schedule: {
            scheduledTasks: [{
                taskId: 'E1', taskName: 'Early task',
                startTime: '2026-07-16T11:00:00.000Z', endTime: '2026-07-16T11:30:00.000Z',
                isBuffer: false,
            }],
        },
    });
    const late = makeContext({
        intent: { title: 'Late project', deadline: '2026-07-16T20:00:00.000Z' },
        planning: { tasks: [planningTask({ taskId: 'L1', title: 'Late task' })] },
        schedule: {
            scheduledTasks: [{
                taskId: 'L1', taskName: 'Late task',
                startTime: '2026-07-16T16:00:00.000Z', endTime: '2026-07-16T16:30:00.000Z',
                isBuffer: false,
            }],
        },
    });
    const { buckets } = triageProjects([late, early], NOW);
    const schedule = buildTodaysSchedule(buckets, NOW);
    assert.equal(schedule.length, 2);
    assert.equal(schedule[0].subtask, 'Early task');
    assert.equal(schedule[1].subtask, 'Late task');
});

// ─────────────────────────────────────────────────────────────────────────────
// pickTodaysFocusBlock
// ─────────────────────────────────────────────────────────────────────────────

const SCHEDULE_FIXTURE = [
    { startISO: '2026-07-16T09:00:00.000Z', endISO: '2026-07-16T09:30:00.000Z', time: '09:00', subtask: 'Morning task', duration: 30 },
    { startISO: '2026-07-16T10:30:00.000Z', endISO: '2026-07-16T11:30:00.000Z', time: '10:30', subtask: 'Currently active task', duration: 60 },
    { startISO: '2026-07-16T14:00:00.000Z', endISO: '2026-07-16T15:00:00.000Z', time: '14:00', subtask: 'Afternoon task', duration: 60 },
];

test('pickTodaysFocusBlock: returns the currently active block when "now" falls inside it', () => {
    const now = new Date('2026-07-16T11:00:00.000Z'); // inside the 10:30-11:30 block
    const result = pickTodaysFocusBlock(SCHEDULE_FIXTURE, now);
    // startISO/endISO are additive — the client formats these in the
    // viewer's own local timezone instead of trusting the UTC-baked `time`
    // string, so the client and Schedule tab never disagree on a task's time.
    assert.deepEqual(result, {
        time: '10:30', task: 'Currently active task', duration: 60,
        startISO: '2026-07-16T10:30:00.000Z', endISO: '2026-07-16T11:30:00.000Z',
    });
});

test('pickTodaysFocusBlock: returns the next upcoming block when "now" is before all blocks', () => {
    const now = new Date('2026-07-16T08:00:00.000Z');
    const result = pickTodaysFocusBlock(SCHEDULE_FIXTURE, now);
    assert.deepEqual(result, {
        time: '09:00', task: 'Morning task', duration: 30,
        startISO: '2026-07-16T09:00:00.000Z', endISO: '2026-07-16T09:30:00.000Z',
    });
});

test('pickTodaysFocusBlock: skips past blocks and returns the next upcoming one', () => {
    const now = new Date('2026-07-16T12:00:00.000Z'); // after morning + active blocks, before afternoon
    const result = pickTodaysFocusBlock(SCHEDULE_FIXTURE, now);
    assert.deepEqual(result, {
        time: '14:00', task: 'Afternoon task', duration: 60,
        startISO: '2026-07-16T14:00:00.000Z', endISO: '2026-07-16T15:00:00.000Z',
    });
});

test('pickTodaysFocusBlock: returns null when all blocks are in the past', () => {
    const now = new Date('2026-07-16T23:00:00.000Z');
    const result = pickTodaysFocusBlock(SCHEDULE_FIXTURE, now);
    assert.equal(result, null);
});

test('pickTodaysFocusBlock: returns null for an empty or missing schedule', () => {
    assert.equal(pickTodaysFocusBlock([], NOW), null);
    assert.equal(pickTodaysFocusBlock(undefined, NOW), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// buildFallbackNarrative (LLM-free Stage 3 resilience path)
// ─────────────────────────────────────────────────────────────────────────────

test('buildFallbackNarrative: headline references the top-risk project when one exists', () => {
    const buckets = {
        overdue: [{ title: 'Overdue Report' }],
        fireNow: [],
        dueToday: [],
        dueWeek: [],
        onTrack: [],
    };
    const narrative = buildFallbackNarrative('Alex', buckets, 'critical');
    assert.match(narrative.headline, /Overdue Report/);
    assert.equal(narrative.urgencyLevel, 'critical');
    assert.ok(narrative.riskAlerts.some((r) => r.includes('Overdue Report')));
});

test('buildFallbackNarrative: uses a calm headline when nothing is at risk', () => {
    const buckets = { overdue: [], fireNow: [], dueToday: [], dueWeek: [], onTrack: [{ title: 'x' }] };
    const narrative = buildFallbackNarrative('Alex', buckets, 'low');
    assert.equal(narrative.riskAlerts.length, 0);
    assert.equal(narrative.urgencyLevel, 'low');
    assert.equal(typeof narrative.headline, 'string');
    assert.ok(narrative.headline.length > 0);
});

test('buildFallbackNarrative: greeting includes the provided user name', () => {
    const buckets = { overdue: [], fireNow: [], dueToday: [], dueWeek: [], onTrack: [] };
    const narrative = buildFallbackNarrative('Priya', buckets, 'low');
    assert.match(narrative.greeting, /Priya/);
});
