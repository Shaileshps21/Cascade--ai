import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { nextTaskId, buildQuickAddTask } from './quickAddTask.js';

describe('nextTaskId', () => {
    test('returns T1 for an empty task list', () => {
        assert.equal(nextTaskId([]), 'T1');
        assert.equal(nextTaskId(undefined), 'T1');
    });

    test('returns one past the highest existing numeric suffix', () => {
        const tasks = [{ taskId: 'T1' }, { taskId: 'T2' }, { taskId: 'T3' }];
        assert.equal(nextTaskId(tasks), 'T4');
    });

    test('is robust to out-of-order or gapped taskIds', () => {
        const tasks = [{ taskId: 'T5' }, { taskId: 'T1' }, { taskId: 'T3' }];
        assert.equal(nextTaskId(tasks), 'T6');
    });

    test('ignores malformed/non-standard taskIds instead of throwing', () => {
        const tasks = [{ taskId: 'T2' }, { taskId: 'buffer-0' }, { taskId: undefined }, {}];
        assert.equal(nextTaskId(tasks), 'T3');
    });
});

describe('buildQuickAddTask', () => {
    test('produces a task with exactly one execution step matching the title', () => {
        const task = buildQuickAddTask({
            taskId: 'T7', milestoneId: 'M1', moduleId: 'MOD1', title: 'Fix the flaky test',
        });
        assert.equal(task.taskId, 'T7');
        assert.equal(task.milestoneId, 'M1');
        assert.equal(task.moduleId, 'MOD1');
        assert.equal(task.title, 'Fix the flaky test');
        assert.equal(task.executionSteps.length, 1);
        assert.equal(task.executionSteps[0].title, 'Fix the flaky test');
        assert.equal(task.executionSteps[0].status, 'pending');
        assert.equal(task.progress.status, 'not_started');
    });

    test('defaults estimatedMinutes to 30 when absent or invalid', () => {
        assert.equal(buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x' }).estimatedMinutes, 30);
        assert.equal(buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x', estimatedMinutes: -5 }).estimatedMinutes, 30);
        assert.equal(buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x', estimatedMinutes: 'abc' }).estimatedMinutes, 30);
    });

    test('clamps a tiny positive estimate to a 5-minute floor', () => {
        assert.equal(buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x', estimatedMinutes: 1 }).estimatedMinutes, 5);
    });

    test('defaults priority to medium when absent or invalid', () => {
        assert.equal(buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x' }).priority, 'medium');
        assert.equal(buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x', priority: 'urgent' }).priority, 'medium');
        assert.equal(buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x', priority: 'critical' }).priority, 'critical');
    });

    test('is not marked as a buffer/review slot', () => {
        const task = buildQuickAddTask({ taskId: 'T1', milestoneId: 'M1', moduleId: 'MOD1', title: 'x' });
        assert.equal(task.isBuffer, false);
        assert.equal(task.isReview, false);
    });
});
