/**
 * memory_agent/agent.js
 * Hybrid agent: deterministic Firestore queries + LLM fallback.
 * Reads task_history and user_benchmarks to build a user memory profile.
 */

import './schema.js';
import { buildMemoryFallbackPrompt } from './prompt_v1.js';
import { db } from '../../config/firebase.js';
import { extractText, parseJSONWithRepair } from '../../config/Llm.js';
import { writeNamespace } from '../contextManager.js';
import { createAgentLog, completeAgentLog, attachToContext } from '../shared/logger.js';
import { toMillis } from '../shared/firestoreUtil.js';

const AGENT_NAME = 'memory_agent';
const MIN_HISTORY_FOR_DETERMINISTIC = 5;

export async function runMemoryAgent(context, clients, eventBus = null, sseEmit = null) {
    const log = createAgentLog(AGENT_NAME, 'v1.0.0');
    sseEmit?.('memory', 'thinking', 'Loading your project history...', null);
    eventBus?.agentStart(AGENT_NAME);

    try {
        const userId = context.userId;
        const category = context.intent?.category ?? 'other';

        // ── Query task history ────────────────────────────────────────────────
        // Deliberately filter on `userId` ONLY (no .orderBy() in the query
        // itself) and sort client-side. Firestore requires a composite index
        // for `.where(field A).orderBy(field B)` combos, and that index isn't
        // guaranteed to exist/be deployed in every environment — this agent
        // must degrade gracefully rather than throwing FAILED_PRECONDITION.
        const historySnap = await db
            .collection('task_history')
            .where('userId', '==', userId)
            .limit(200)
            .get();

        const history = historySnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => toMillis(b.completedAt) - toMillis(a.completedAt))
            .slice(0, 50);

        // ── Query user benchmarks ─────────────────────────────────────────────
        let benchmarkData = null;
        try {
            const benchSnap = await db
                .collection('user_benchmarks')
                .where('userId', '==', userId)
                .limit(50)
                .get();
            if (!benchSnap.empty) {
                const docs = benchSnap.docs
                    .map(d => d.data())
                    .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
                benchmarkData = docs[0] ?? null;
            }
        } catch {
            // Benchmarks not yet available — non-fatal
        }

        let memoryOutput;

        if (history.length >= MIN_HISTORY_FOR_DETERMINISTIC) {
            // ── Deterministic computation ─────────────────────────────────────
            memoryOutput = computeMemoryDeterministic(history, benchmarkData, category);
        } else {
            // ── LLM fallback ──────────────────────────────────────────────────
            const prompt = buildMemoryFallbackPrompt(
                category,
                context.intent?.complexity ?? 'medium',
                context.rawGoal
            );
            const result = await clients.flash.generateText(prompt, { promptVersion: 'v1.0.0' });
            memoryOutput = await parseJSONWithRepair(extractText(result), clients.flash);

            if (result?.usage) {
                log.tokens = { prompt: result.usage.promptTokens, completion: result.usage.completionTokens, total: result.usage.totalTokens };
                log.estimatedCost = result.estimatedCost;
            }
        }

        memoryOutput.schemaVersion = '1.0.0';
        writeNamespace(context, 'memory', memoryOutput);

        completeAgentLog(log, { confidence: memoryOutput.reasoning?.confidence ?? 0.7, status: 'success' });
        attachToContext(context, log);

        sseEmit?.('memory', 'done', `Memory loaded: ${history.length} past projects found`, null);
        eventBus?.agentComplete(AGENT_NAME, `memory loaded from ${history.length} tasks`);

        return memoryOutput;
    } catch (err) {
        completeAgentLog(log, { status: 'failed', errors: [err.message] });
        attachToContext(context, log);
        sseEmit?.('memory', 'error', `Memory agent failed: ${err.message}`, null);
        // Non-fatal — return empty memory
        const fallback = buildEmptyMemory();
        writeNamespace(context, 'memory', fallback);
        return fallback;
    }
}

function computeMemoryDeterministic(history, benchmarkData, category) {
    const categoryHistory = history.filter(h => h.category === category);
    const source = categoryHistory.length >= 3 ? categoryHistory : history;

    // Similar projects
    const similarProjects = source.slice(0, 5).map(h => ({
        title: h.title ?? '',
        category: h.category ?? '',
        estimatedHours: h.estimatedHours ?? null,
        actualHours: h.actualHours ?? null,
        status: h.status ?? 'unknown',
        delayReason: h.delayReason ?? null,
        moduleWorkflow: h.moduleWorkflow ?? [],
    }));

    // Success rate
    const completed = source.filter(h => h.status === 'completed').length;
    const averageSuccessRate = source.length > 0 ? completed / source.length : 0.75;

    // Average speeds from benchmark
    const averageSpeeds = benchmarkData?.averageSpeeds ?? {
        coding: 30, writing: 45, research: 60, reading: 40, design: 50, debugging: 35, revision: 25,
    };

    const reliabilityScore = Math.min(1, averageSuccessRate * (1 + (source.length / 50) * 0.2));

    return {
        schemaVersion: '1.0.0',
        similarProjects,
        averageSuccessRate: parseFloat(averageSuccessRate.toFixed(3)),
        commonFailures: ['Underestimating time', 'Scope creep', 'Insufficient testing'],
        bestWorkflowModules: ['Research', 'Design', 'Implementation', 'Testing'],
        averageSpeeds,
        optimalWorkHours: [9, 10, 14, 15],
        reliabilityScore: parseFloat(reliabilityScore.toFixed(3)),
        reasoning: {
            confidence: Math.min(0.95, 0.5 + (source.length / 50) * 0.5),
            assumptions: [`Based on ${source.length} past projects`],
            warnings: source.length < 5 ? ['Low history — estimates may be inaccurate'] : [],
            promptVersion: 'v1.0.0',
        },
    };
}

function buildEmptyMemory() {
    return {
        schemaVersion: '1.0.0',
        similarProjects: [],
        averageSuccessRate: 0.75,
        commonFailures: ['Underestimating complexity', 'Skipping testing'],
        bestWorkflowModules: ['Research', 'Design', 'Implementation', 'Testing'],
        averageSpeeds: { coding: 30, writing: 45, research: 60, reading: 40, design: 50, debugging: 35, revision: 25 },
        optimalWorkHours: [9, 10, 14, 15],
        reliabilityScore: 0.7,
        reasoning: { confidence: 0.5, assumptions: ['No history available'], warnings: ['No history'], promptVersion: 'v1.0.0' },
    };
}
