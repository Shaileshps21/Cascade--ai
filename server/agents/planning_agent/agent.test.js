/**
 * planning_agent/agent.test.js
 * Unit tests — no live LLM/network calls. Exercises only the pure,
 * deterministic pieces of the Planning Agent:
 *   - validatePlanningHierarchy() structural validation
 *   - attachResourcesToTasks() topic-matching
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validatePlanningHierarchy } from './validator.js';
import { attachResourcesToTasks } from './agent.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal-but-valid hierarchy: 4 milestones x 2 modules x 2 tasks,
 * each task with 3 execution steps — satisfies every documented bound
 * (4-8 milestones, 2-6 modules, 2-8 tasks, 3-8 steps).
 */
function buildValidHierarchy() {
    const milestones = [];
    const tasks = [];
    let moduleCounter = 0;
    let taskCounter = 0;

    for (let mi = 0; mi < 4; mi++) {
        const milestoneId = `M${mi + 1}`;
        const modules = [];

        for (let modi = 0; modi < 2; modi++) {
            moduleCounter += 1;
            const moduleId = `MOD${moduleCounter}`;
            const taskIdsForModule = [];

            for (let ti = 0; ti < 2; ti++) {
                taskCounter += 1;
                const taskId = `T${taskCounter}`;
                taskIdsForModule.push(taskId);
                tasks.push({
                    taskId,
                    milestoneId,
                    moduleId,
                    title: `Task ${taskCounter}`,
                    overview: 'Overview text',
                    objectives: ['Objective one'],
                    executionSteps: [
                        { stepId: 'S1', action: 'Do the first thing', order: 1 },
                        { stepId: 'S2', action: 'Do the second thing', order: 2 },
                        { stepId: 'S3', action: 'Verify the result', order: 3 },
                    ],
                    deliverables: ['A deliverable'],
                    successCriteria: ['✓ Done'],
                    commonMistakes: ['Skipping verification'],
                    aiGuidance: ['Take it step by step'],
                    reflectionQuestions: ['What did you learn?'],
                    resources: [],
                    notes: [],
                    progress: { status: 'not_started', completedAt: null, actualMinutes: null },
                    estimatedMinutes: 60,
                    difficulty: 'medium',
                    requiredSkills: [],
                    dependencies: [],
                    priority: 'medium',
                    reviewRequired: false,
                    isBuffer: false,
                    isReview: false,
                });
            }

            modules.push({
                id: moduleId,
                title: `Module ${moduleCounter}`,
                description: 'A module',
                acceptanceCriteria: ['Acceptance criterion'],
                dependencies: [],
                tasks: taskIdsForModule,
            });
        }

        milestones.push({
            id: milestoneId,
            title: `Milestone ${mi + 1}`,
            description: 'A milestone',
            estimatedOutcome: 'Outcome',
            completionCriteria: ['Criterion'],
            riskLevel: 'medium',
            dependencies: [],
            modules,
        });
    }

    return {
        schemaVersion: '1.0.0',
        milestones,
        tasks,
        dependencyGraph: {},
        criticalPath: [],
        riskSummary: [],
        planningNotes: 'Strategy note',
        realGoal: 'Ship the thing',
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// validatePlanningHierarchy
// ─────────────────────────────────────────────────────────────────────────────

describe('validatePlanningHierarchy', () => {
    test('a well-formed hierarchy passes validation', () => {
        const planning = buildValidHierarchy();
        const result = validatePlanningHierarchy(planning);
        assert.equal(result.valid, true, `expected valid, got errors: ${result.errors.join('; ')}`);
        assert.deepEqual(result.errors, []);
    });

    test('too few milestones fails validation', () => {
        const planning = buildValidHierarchy();
        // Drop to 2 milestones (below the 4-8 minimum) and drop their tasks too.
        planning.milestones = planning.milestones.slice(0, 2);
        const keptModuleIds = new Set(planning.milestones.flatMap((m) => m.modules.map((mod) => mod.id)));
        planning.tasks = planning.tasks.filter((t) => keptModuleIds.has(t.moduleId));

        const result = validatePlanningHierarchy(planning);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('milestone count must be')));
    });

    test('an orphan module (zero tasks) fails validation', () => {
        const planning = buildValidHierarchy();
        // Empty out one module's task list without removing its task objects,
        // producing an orphan module.
        planning.milestones[0].modules[0].tasks = [];

        const result = validatePlanningHierarchy(planning);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('is orphaned')));
    });

    test('a self-dependency at the task level fails validation', () => {
        const planning = buildValidHierarchy();
        const firstTask = planning.tasks[0];
        firstTask.dependencies = [firstTask.taskId];

        const result = validatePlanningHierarchy(planning);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('self-dependency')));
    });

    test('a dependency referencing an unknown task fails validation', () => {
        const planning = buildValidHierarchy();
        planning.tasks[0].dependencies = ['T999'];

        const result = validatePlanningHierarchy(planning);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes('depends on unknown task')));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// attachResourcesToTasks
// ─────────────────────────────────────────────────────────────────────────────

describe('attachResourcesToTasks', () => {
    const knowledgeResources = [
        {
            title: 'Graph Algorithms Crash Course',
            type: 'YouTube Courses',
            difficulty: 'intermediate',
            estimatedHours: 4,
            keyTopics: ['graph theory', 'bfs', 'dfs', 'shortest path'],
        },
        {
            title: 'Testing Frameworks Deep Dive',
            type: 'Official Documentation',
            difficulty: 'beginner',
            estimatedHours: 2,
            keyTopics: ['unit testing', 'jest', 'assertions'],
        },
    ];

    test('a task about implementing BFS receives the graph-algorithm resource', () => {
        const tasks = [
            {
                taskId: 'T1',
                title: 'Implement BFS traversal',
                objectives: ['Implement breadth-first search over an adjacency list'],
            },
        ];

        const result = attachResourcesToTasks(tasks, knowledgeResources);
        assert.equal(result[0].resources.length, 1);
        assert.equal(result[0].resources[0].title, 'Graph Algorithms Crash Course');
    });

    test('a task about writing tests does not receive the graph-algorithm resource', () => {
        const tasks = [
            {
                taskId: 'T2',
                title: 'Write unit tests',
                objectives: ['Write tests for the sorting module'],
            },
        ];

        const result = attachResourcesToTasks(tasks, knowledgeResources);
        const titles = result[0].resources.map((r) => r.title);
        assert.ok(!titles.includes('Graph Algorithms Crash Course'));
    });

    test('a testing-related task receives the testing resource', () => {
        const tasks = [
            {
                taskId: 'T3',
                title: 'Add Jest unit testing',
                objectives: ['Set up Jest and write assertions for the API'],
            },
        ];

        const result = attachResourcesToTasks(tasks, knowledgeResources);
        const titles = result[0].resources.map((r) => r.title);
        assert.ok(titles.includes('Testing Frameworks Deep Dive'));
    });

    test('returns tasks unchanged (empty resources) when no knowledge resources exist', () => {
        const tasks = [{ taskId: 'T4', title: 'Do something', objectives: [] }];
        const result = attachResourcesToTasks(tasks, []);
        assert.deepEqual(result[0].resources, []);
    });
});
