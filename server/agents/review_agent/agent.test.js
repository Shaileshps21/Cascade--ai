/**
 * review_agent/agent.test.js
 * Unit tests for runDeterministicChecks() — pure function, no LLM/network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDeterministicChecks } from './agent.js';

function completeTaskWorkspace(overrides = {}) {
    return {
        taskId: 'T1',
        milestoneId: 'M1',
        moduleId: 'MOD1',
        title: 'Task One',
        overview: 'Why this task exists.',
        objectives: ['Objective 1'],
        executionSteps: [{ stepId: 'S1', action: 'Do the thing', order: 1 }],
        deliverables: ['Deliverable 1'],
        successCriteria: ['Criteria 1'],
        commonMistakes: ['Mistake 1'],
        aiGuidance: ['Guidance 1'],
        reflectionQuestions: ['Question 1'],
        dependencies: [],
        ...overrides,
    };
}

test('runDeterministicChecks (planning): detects orphan module with no tasks', () => {
    const context = {
        planning: {
            milestones: [
                {
                    id: 'M1',
                    title: 'Milestone 1',
                    modules: [
                        { id: 'MOD1', title: 'Module One', tasks: ['T1'] },
                        { id: 'MOD2', title: 'Orphan Module', tasks: [] },
                    ],
                },
            ],
            tasks: [completeTaskWorkspace()],
        },
    };

    const { issues } = runDeterministicChecks(context, 'planning');
    const orphanIssue = issues.find(i => i.type === 'orphan_module');

    assert.ok(orphanIssue, 'expected an orphan_module issue to be reported');
    assert.equal(orphanIssue.entityId, 'MOD2');
    assert.equal(orphanIssue.severity, 'high');
});

test('runDeterministicChecks (planning): detects task missing workspace fields', () => {
    const context = {
        planning: {
            milestones: [
                { id: 'M1', title: 'Milestone 1', modules: [{ id: 'MOD1', title: 'Module One', tasks: ['T1'] }] },
            ],
            tasks: [
                completeTaskWorkspace({ overview: '', aiGuidance: [] }),
            ],
        },
    };

    const { issues } = runDeterministicChecks(context, 'planning');
    const missingFieldsIssue = issues.find(i => i.type === 'missing_workspace_fields' && i.entityId === 'T1');

    assert.ok(missingFieldsIssue, 'expected a missing_workspace_fields issue for T1');
    assert.match(missingFieldsIssue.message, /overview/);
    assert.match(missingFieldsIssue.message, /aiGuidance/);
});

test('runDeterministicChecks (planning): does NOT flag missing-field issues when target is schedule', () => {
    const context = {
        planning: {
            milestones: [
                { id: 'M1', title: 'Milestone 1', modules: [{ id: 'MOD1', title: 'Module One', tasks: ['T1'] }] },
            ],
            tasks: [completeTaskWorkspace({ overview: '' })],
        },
    };

    const { issues } = runDeterministicChecks(context, 'schedule');
    const missingFieldsIssue = issues.find(i => i.type === 'missing_workspace_fields');

    assert.equal(missingFieldsIssue, undefined, 'missing_workspace_fields should only be checked for target=planning');
});

test('runDeterministicChecks: detects duplicate task titles case-insensitively', () => {
    const context = {
        planning: {
            milestones: [],
            tasks: [
                completeTaskWorkspace({ taskId: 'T1', title: 'Write Report' }),
                completeTaskWorkspace({ taskId: 'T2', title: 'write report' }),
            ],
        },
    };

    const { issues } = runDeterministicChecks(context, 'planning');
    const dupIssue = issues.find(i => i.type === 'duplicate_task_title');

    assert.ok(dupIssue, 'expected a duplicate_task_title issue');
    assert.equal(dupIssue.severity, 'medium');
});

test('runDeterministicChecks: detects a task referencing a non-existent moduleId/milestoneId', () => {
    const context = {
        planning: {
            milestones: [{ id: 'M1', title: 'Milestone 1', modules: [{ id: 'MOD1', title: 'Module One', tasks: [] }] }],
            tasks: [completeTaskWorkspace({ moduleId: 'MOD_MISSING', milestoneId: 'M_MISSING' })],
        },
    };

    const { issues } = runDeterministicChecks(context, 'planning');
    const dangling = issues.filter(i => i.type === 'orphan_task_reference');

    assert.equal(dangling.length, 2, 'expected both a dangling moduleId and dangling milestoneId issue');
    assert.ok(dangling.every(i => i.severity === 'high'));
});

test('runDeterministicChecks (schedule): flags a day with more than 8 hours scheduled', () => {
    const context = {
        schedule: {
            scheduledTasks: [
                {
                    taskId: 'T1',
                    taskName: 'Task 1',
                    startTime: '2026-07-20T09:00:00.000Z',
                    endTime: '2026-07-20T14:00:00.000Z',
                    adjustedDuration: 300,
                    dependencies: [],
                },
                {
                    taskId: 'T2',
                    taskName: 'Task 2',
                    startTime: '2026-07-20T15:00:00.000Z',
                    endTime: '2026-07-20T20:00:00.000Z',
                    adjustedDuration: 300,
                    dependencies: [],
                },
            ],
        },
    };

    const { issues } = runDeterministicChecks(context, 'schedule');
    const overloaded = issues.find(i => i.type === 'overloaded_day');

    assert.ok(overloaded, 'expected an overloaded_day issue (10h total scheduled)');
    assert.equal(overloaded.entityId, '2026-07-20');
    assert.equal(overloaded.severity, 'high');
});

test('runDeterministicChecks (schedule): does not flag a day at or under 8 hours', () => {
    const context = {
        schedule: {
            scheduledTasks: [
                {
                    taskId: 'T1',
                    taskName: 'Task 1',
                    startTime: '2026-07-20T09:00:00.000Z',
                    endTime: '2026-07-20T13:00:00.000Z',
                    adjustedDuration: 240,
                    dependencies: [],
                },
                {
                    taskId: 'T2',
                    taskName: 'Task 2',
                    startTime: '2026-07-20T14:00:00.000Z',
                    endTime: '2026-07-20T18:00:00.000Z',
                    adjustedDuration: 240,
                    dependencies: [],
                },
            ],
        },
    };

    const { issues } = runDeterministicChecks(context, 'schedule');
    const overloaded = issues.find(i => i.type === 'overloaded_day');

    assert.equal(overloaded, undefined, 'a day with exactly 8h scheduled should not be flagged');
});

test('runDeterministicChecks (schedule): detects a dependency scheduled to start after the dependent task', () => {
    const context = {
        schedule: {
            scheduledTasks: [
                {
                    taskId: 'T1',
                    taskName: 'Implement Feature',
                    startTime: '2026-07-20T09:00:00.000Z',
                    endTime: '2026-07-20T10:00:00.000Z',
                    dependencies: ['T2'],
                },
                {
                    taskId: 'T2',
                    taskName: 'Design Feature (dependency)',
                    startTime: '2026-07-20T11:00:00.000Z',
                    endTime: '2026-07-20T12:00:00.000Z',
                    dependencies: [],
                },
            ],
        },
    };

    const { issues } = runDeterministicChecks(context, 'schedule');
    const depViolation = issues.find(i => i.type === 'dependency_violation');

    assert.ok(depViolation, 'expected a dependency_violation issue');
    assert.equal(depViolation.entityId, 'T1');
});

test('runDeterministicChecks (schedule): no violation when dependency starts before dependent task', () => {
    const context = {
        schedule: {
            scheduledTasks: [
                {
                    taskId: 'T1',
                    taskName: 'Design Feature',
                    startTime: '2026-07-20T09:00:00.000Z',
                    endTime: '2026-07-20T10:00:00.000Z',
                    dependencies: [],
                },
                {
                    taskId: 'T2',
                    taskName: 'Implement Feature',
                    startTime: '2026-07-20T11:00:00.000Z',
                    endTime: '2026-07-20T12:00:00.000Z',
                    dependencies: ['T1'],
                },
            ],
        },
    };

    const { issues } = runDeterministicChecks(context, 'schedule');
    const depViolation = issues.find(i => i.type === 'dependency_violation');

    assert.equal(depViolation, undefined, 'no dependency_violation expected when ordering is correct');
});

test('runDeterministicChecks: returns empty issues array for a clean, well-formed plan', () => {
    const context = {
        planning: {
            milestones: [
                { id: 'M1', title: 'Milestone 1', modules: [{ id: 'MOD1', title: 'Module One', tasks: ['T1', 'T2'] }] },
            ],
            tasks: [
                completeTaskWorkspace({ taskId: 'T1', title: 'Task One' }),
                completeTaskWorkspace({ taskId: 'T2', title: 'Task Two' }),
            ],
        },
    };

    const { issues } = runDeterministicChecks(context, 'planning');
    assert.deepEqual(issues, []);
});
