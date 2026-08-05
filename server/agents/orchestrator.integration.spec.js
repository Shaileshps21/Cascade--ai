/**
 * orchestrator.integration.spec.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration coverage for the pipeline wiring itself — the layer the unit tests
 * cannot reach and, historically, the one that actually broke. Every bug in the
 * project's development history (a Firestore nested-array rejection, a crash on a
 * malformed document, a scheduler returning an empty list) lived here, in how the
 * agents are composed, not inside any single agent.
 *
 * Firebase, the LLM clients, SSE and all fifteen agents are replaced with doubles,
 * so these run with no network, no credentials and no API spend.
 *
 * Requires ESM module mocking, which is still flagged in Node 22:
 *     npm run test:integration
 * The main `npm test` suite stays flag-free on purpose — an experimental flag
 * across the whole suite would print warnings on every run and risks breaking on
 * a Node upgrade.
 */

import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Shared mutable state the doubles read and record into ───────────────────
const calls = [];
const state = {
    writes: [],
    storedDoc: null,
    failAt: null,          // agent name that should throw
    quotaFailAt: null,     // agent name that should throw a quota error
    reviewScores: [95],    // successive Review Agent quality scores
    userKeyDoc: null,      // users/{id}/settings/llm_key
    preferencesDoc: null,
};

const record = (name) => { calls.push(name); };

/** Fake Firestore: only the handful of shapes the orchestrator actually uses. */
function makeDb() {
    const docApi = (path) => ({
        async get() {
            if (path.includes('llm_key')) {
                return { exists: !!state.userKeyDoc, data: () => state.userKeyDoc };
            }
            if (path.includes('preferences')) {
                return { exists: !!state.preferencesDoc, data: () => state.preferencesDoc };
            }
            return { exists: !!state.storedDoc, data: () => state.storedDoc };
        },
        async set(data, opts) {
            // Snapshot on write, as Firestore does. Storing by reference would be
            // actively misleading here: toFirestoreDocument() shallow-copies, so
            // every recorded write would share one mutable `metadata` object and
            // appear to hold whatever the pipeline set last.
            const snapshot = JSON.parse(JSON.stringify(data));
            state.writes.push({ path, data: snapshot, merge: !!opts?.merge });
            state.storedDoc = opts?.merge ? { ...(state.storedDoc ?? {}), ...snapshot } : snapshot;
            return true;
        },
        collection: (name) => collectionApi(`${path}/${name}`),
        ref: null,
    });
    const collectionApi = (path) => ({
        doc: (id) => docApi(`${path}/${id}`),
        where() { return this; },
        orderBy() { return this; },
        limit() { return this; },
        async get() { return { docs: [], empty: true }; },
    });
    return { collection: (name) => collectionApi(name) };
}

mock.module('../config/firebase.js', { namedExports: { db: makeDb() } });

mock.module('../rag/sseManager.js', {
    namedExports: {
        emit: () => {},
        close: (_pid, payload) => { state.closed = payload; },
        closeWithError: (_pid, msg) => { state.closedWithError = msg; },
    },
});

class QuotaError extends Error {}
mock.module('../config/Llm.js', {
    namedExports: {
        createClients: () => ({ keyType: 'groq', modelId: 'm', modelLabel: 'M', embedding: null }),
        defaultClients: { keyType: 'groq', modelId: 'm', modelLabel: 'M', embedding: null },
        isQuotaError: (err) => err instanceof QuotaError,
        getModelLabel: () => 'M',
    },
});

mock.module('../config/secrets.js', { namedExports: { decryptSecret: (v) => v } });
mock.module('../rag/vectorStore.js', { namedExports: { addEntry: async () => {} } });

/** Build an agent double that records its call and writes its namespace. */
function agentDouble(name, apply) {
    return async (context) => {
        record(name);
        if (state.quotaFailAt === name) throw new QuotaError(`${name} quota`);
        if (state.failAt === name) throw new Error(`${name} exploded`);
        apply?.(context);
    };
}

mock.module('./memory_agent/agent.js', {
    namedExports: {
        runMemoryAgent: agentDouble('memory', (c) => {
            // Records what intent looked like when memory ran — this is the
            // assertion target for the ordering bug fix.
            state.intentAtMemoryTime = c.intent ? { ...c.intent } : null;
            c.memory = { pastProjects: [] };
        }),
    },
});
mock.module('./evaluation_benchmark_agent/agent.js', {
    namedExports: {
        loadUserBenchmarkContext: async () => {
            record('benchmark');
            if (state.failAt === 'benchmark') throw new Error('benchmark exploded');
            return { history: [] };
        },
        recordBenchmarkSnapshot: async () => { record('benchmarkSnapshot'); },
    },
});
mock.module('./intent_context_agent/agent.js', {
    namedExports: {
        runIntentContextAgent: agentDouble('intent', (c) => {
            c.intent = { category: 'learning', complexity: 'high', deadline: '2026-08-30T00:00:00.000Z' };
        }),
    },
});
mock.module('./knowledge_acquisition_agent/agent.js', {
    namedExports: {
        runKnowledgeAcquisitionAgent: agentDouble('knowledge', (c) => { c.knowledge = { resources: [] }; }),
    },
});
mock.module('./prioritization_agent/agent.js', {
    namedExports: { runPrioritizationAgent: agentDouble('priority', (c) => { c.priority = { score: 80 }; }) },
});
mock.module('./planning_agent/agent.js', {
    namedExports: {
        runPlanningAgent: agentDouble('planning', (c) => {
            c.planning = { tasks: [{ taskId: 'a', title: 'Task A', executionSteps: [], progress: {} }], milestones: [] };
        }),
    },
});
mock.module('./review_agent/agent.js', {
    namedExports: {
        runReviewAgent: async () => {
            record('review');
            const score = state.reviewScores.length > 1 ? state.reviewScores.shift() : state.reviewScores[0];
            return { qualityScore: score };
        },
    },
});
mock.module('./dependency_analysis_agent/agent.js', {
    namedExports: { runDependencyAnalysisAgent: agentDouble('dependency', (c) => { c.dependency = { criticalPath: [] }; }) },
});
mock.module('./time_estimation_agent/agent.js', {
    namedExports: { runTimeEstimationAgent: agentDouble('estimation', (c) => { c.estimation = { estimations: [] }; }) },
});
mock.module('./deadline_feasibility_agent/agent.js', {
    namedExports: {
        runDeadlineFeasibilityAgent: async (c) => {
            record('feasibility');
            c.feasibility = { isFeasible: true };
            return c.feasibility;
        },
    },
});
mock.module('./scheduler_agent/agent.js', {
    namedExports: {
        runSchedulerAgent: agentDouble('scheduler', (c) => {
            c.schedule = { scheduledTasks: [], schedulingScore: 90 };
        }),
    },
});
mock.module('./google_calendar_agent/agent.js', {
    namedExports: {
        getFreeBusy: async () => [],
        syncScheduleToCalendar: async (c) => {
            record('calendarSync');
            return { scheduledTasks: c.schedule?.scheduledTasks ?? [], calendarConnected: false };
        },
    },
});
mock.module('./progress_tracking_agent/agent.js', {
    namedExports: {
        reassessTask: () => { record('progress'); },
        runProgressCron: async () => ({ processed: 0, escalated: 0, escalatedTasks: [] }),
    },
});
mock.module('./replanning_agent/agent.js', {
    namedExports: { runReplanningAgent: async (c) => ({ context: c, disruptionScore: 0, warnings: [] }) },
});

const { orchestrateTask, resumeTask } = await import('./orchestrator.js');

beforeEach(() => {
    calls.length = 0;
    Object.assign(state, {
        writes: [], storedDoc: null, failAt: null, quotaFailAt: null,
        reviewScores: [95], userKeyDoc: null, preferencesDoc: null,
        closed: null, closedWithError: null, intentAtMemoryTime: null,
    });
});

// ── Ordering ────────────────────────────────────────────────────────────────

test('intent runs before memory, so memory sees a real category', async () => {
    // Regression guard: memory used to run first and read a null context.intent,
    // silently profiling every project as category 'other' / complexity 'medium'.
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    assert.ok(state.intentAtMemoryTime, 'memory must not run before intent');
    assert.equal(state.intentAtMemoryTime.category, 'learning');
    assert.equal(state.intentAtMemoryTime.complexity, 'high');
});

test('a full run reaches completion and stores the context', async () => {
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    assert.equal(state.closedWithError, null, 'a clean run must not close with an error');
    assert.ok(state.closed, 'the SSE channel should close with a result payload');
    assert.equal(state.storedDoc.metadata.pipelineStage, 'complete');
    assert.equal(state.storedDoc.metadata.pipelineFailed, false);
});

// ── allSettled semantics ────────────────────────────────────────────────────

test('a benchmark failure is non-fatal', async () => {
    state.failAt = 'benchmark';
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    assert.equal(state.closedWithError, null, 'benchmark is explicitly best-effort');
    assert.ok(calls.includes('planning'), 'the pipeline should carry on past it');
});

test('a memory failure is fatal, and Promise.all would have masked it', async () => {
    state.failAt = 'memory';
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    assert.ok(state.closedWithError, 'a memory failure must still abort the run');
    assert.ok(!calls.includes('planning'), 'the pipeline must not continue past a fatal stage');
});

// ── Review loop ─────────────────────────────────────────────────────────────

test('a low review score triggers a planning revision', async () => {
    state.reviewScores = [40, 95]; // fail once, then pass
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    const planningRuns = calls.filter((c) => c === 'planning').length;
    assert.equal(planningRuns, 2, 'one initial plan plus one revision');
});

test('revisions are capped so a stubborn reviewer cannot loop forever', async () => {
    state.reviewScores = [10]; // always fails
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    const planningRuns = calls.filter((c) => c === 'planning').length;
    assert.equal(planningRuns, 3, 'initial plan plus MAX_PLANNING_REVISIONS (2)');
});

// ── Checkpointing and failure preservation ──────────────────────────────────

test('checkpoints are written after the expensive stages', async () => {
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    const stages = state.writes.filter((w) => w.merge).map((w) => w.data.metadata?.pipelineStage);
    assert.ok(stages.includes('planning'), 'planning is the most expensive stage — it must checkpoint');
    assert.ok(stages.includes('schedule'));
});

test('a failure part-way preserves the work already done', async () => {
    state.failAt = 'scheduler';
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    assert.ok(state.closedWithError);
    assert.equal(state.storedDoc.metadata.pipelineFailed, true, 'so the list can exclude it');
    assert.ok(state.storedDoc.planning, 'planning work must survive a later failure');
    assert.ok(state.storedDoc.estimation, 'estimation work must survive too');
});

// ── Resume ──────────────────────────────────────────────────────────────────

test('resuming skips stages that already completed', async () => {
    state.failAt = 'scheduler';
    await orchestrateTask('p1', 'Learn Rust', 'user-1');
    const taskId = state.storedDoc.taskId;

    calls.length = 0;
    state.failAt = null;
    await resumeTask(taskId, 'user-1', 'p2');

    assert.ok(!calls.includes('planning'), 'planning was already done and paid for');
    assert.ok(!calls.includes('intent'), 'intent was already done');
    assert.ok(calls.includes('scheduler'), 'the stage that failed must actually re-run');
    assert.equal(state.storedDoc.metadata.pipelineStage, 'complete');
});

test('resuming a completed project is refused', async () => {
    await orchestrateTask('p1', 'Learn Rust', 'user-1');
    await resumeTask(state.storedDoc.taskId, 'user-1', 'p2');

    assert.match(state.closedWithError ?? '', /already finished/i);
});

test('resuming another user\'s task is refused', async () => {
    state.failAt = 'scheduler';
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    await resumeTask(state.storedDoc.taskId, 'someone-else', 'p2');
    assert.match(state.closedWithError ?? '', /not found/i);
});

// ── Quota handling ──────────────────────────────────────────────────────────

test('shared-quota exhaustion is reported as QUOTA_EXCEEDED', async () => {
    state.quotaFailAt = 'planning';
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    assert.equal(state.closedWithError, 'QUOTA_EXCEEDED', 'the client keys off this to prompt for a personal key');
});

test('a personal key exhausting quota gets a distinct message', async () => {
    state.userKeyDoc = { key: 'personal-key', keyType: 'groq', model: null };
    state.quotaFailAt = 'planning';
    await orchestrateTask('p1', 'Learn Rust', 'user-1');

    assert.notEqual(state.closedWithError, 'QUOTA_EXCEEDED');
    assert.match(state.closedWithError ?? '', /personal API key/i);
});
