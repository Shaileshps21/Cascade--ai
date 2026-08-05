/**
 * knowledge_acquisition_agent/agent.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the pure, non-network pieces of the Knowledge Acquisition
 * Agent: the cosine similarity helper and the schema.js validator.
 *
 * Deliberately does NOT exercise anything requiring live Firestore or LLM
 * network calls (runKnowledgeAcquisitionAgent itself is untested here).
 *
 * Run with: node --test server/agents/knowledge_acquisition_agent/agent.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cosineSimilarity } from './agent.js';
import { validateKnowledgeOutput, RESOURCE_TYPES, DIFFICULTIES } from './schema.js';
import {
    validateKnowledgePackage,
    isUrlReachable,
    verifyResourceUrls,
    isRedirectCollapse,
    looksLikeNotFoundTitle,
} from './validator.js';

// ─────────────────────────────────────────────────────────────────────────────
// cosineSimilarity
// ─────────────────────────────────────────────────────────────────────────────

test('cosineSimilarity: identical vectors → similarity 1', () => {
    const v = [1, 2, 3, 4];
    const sim = cosineSimilarity(v, v);
    assert.ok(Math.abs(sim - 1) < 1e-9, `expected ~1, got ${sim}`);
});

test('cosineSimilarity: orthogonal vectors → similarity 0', () => {
    const sim = cosineSimilarity([1, 0], [0, 1]);
    assert.equal(sim, 0);
});

test('cosineSimilarity: opposite vectors → similarity -1', () => {
    const sim = cosineSimilarity([1, 2, 3], [-1, -2, -3]);
    assert.ok(Math.abs(sim - -1) < 1e-9, `expected ~-1, got ${sim}`);
});

test('cosineSimilarity: near-duplicate vectors → similarity above 0.88 threshold', () => {
    const a = [0.9, 0.4, 0.1, 0.2];
    const b = [0.91, 0.42, 0.09, 0.21];
    const sim = cosineSimilarity(a, b);
    assert.ok(sim > 0.88, `expected > 0.88, got ${sim}`);
});

test('cosineSimilarity: mismatched lengths → returns 0 instead of throwing', () => {
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0);
});

test('cosineSimilarity: empty arrays → returns 0 instead of throwing', () => {
    assert.equal(cosineSimilarity([], []), 0);
});

test('cosineSimilarity: non-array input → returns 0 instead of throwing', () => {
    assert.equal(cosineSimilarity(null, [1, 2, 3]), 0);
    assert.equal(cosineSimilarity(undefined, undefined), 0);
    assert.equal(cosineSimilarity('nope', [1, 2, 3]), 0);
});

test('cosineSimilarity: zero-magnitude vector → returns 0 instead of NaN', () => {
    const sim = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    assert.equal(sim, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// schema.js — validateKnowledgeOutput
// ─────────────────────────────────────────────────────────────────────────────

function buildValidPackage() {
    return {
        schemaVersion: '1.0.0',
        requiresLearning: true,
        reason: 'The user needs to learn graph algorithms before implementing BFS/DFS.',
        learningObjectives: ['Understand graph representations', 'Implement BFS and DFS'],
        knowledgeGraph: {
            concepts: [
                {
                    id: 'c1',
                    name: 'Graph Representations',
                    summary: 'Adjacency list vs matrix representations of graphs.',
                    difficulty: 'beginner',
                    prerequisites: [],
                },
                {
                    id: 'c2',
                    name: 'Breadth-First Search',
                    summary: 'Level-order traversal algorithm for graphs.',
                    difficulty: 'intermediate',
                    prerequisites: ['c1'],
                },
            ],
            paths: [{ from: 'c1', to: 'c2' }],
        },
        resources: [
            {
                title: 'Introduction to Graph Theory',
                type: 'Official Documentation',
                difficulty: 'beginner',
                estimatedHours: 3,
                reason: 'Authoritative reference for graph fundamentals.',
                summary: 'Covers graph representations, traversal, and common algorithms in depth with examples.',
                keyTopics: ['adjacency list', 'adjacency matrix', 'BFS', 'DFS'],
                bestFor: 'beginners with no prior graph theory background',
                prerequisites: [],
                url: 'https://example.com/graph-theory',
                priority: 1,
            },
        ],
        recommendedLearningTime: 3,
        confidence: 0.85,
    };
}

test('validateKnowledgeOutput: valid package passes with no errors', () => {
    const result = validateKnowledgeOutput(buildValidPackage());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
});

test('validateKnowledgeOutput: missing requiresLearning fails', () => {
    const pkg = buildValidPackage();
    delete pkg.requiresLearning;
    const result = validateKnowledgeOutput(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('requiresLearning')));
});

test('validateKnowledgeOutput: missing knowledgeGraph fails', () => {
    const pkg = buildValidPackage();
    delete pkg.knowledgeGraph;
    const result = validateKnowledgeOutput(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('knowledgeGraph')));
});

test('validateKnowledgeOutput: concept with empty summary fails', () => {
    const pkg = buildValidPackage();
    pkg.knowledgeGraph.concepts[0].summary = '';
    const result = validateKnowledgeOutput(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('summary')));
});

test('validateKnowledgeOutput: invalid concept difficulty fails', () => {
    const pkg = buildValidPackage();
    pkg.knowledgeGraph.concepts[0].difficulty = 'expert';
    const result = validateKnowledgeOutput(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('difficulty')));
});

test('validateKnowledgeOutput: invalid resource type fails', () => {
    const pkg = buildValidPackage();
    pkg.resources[0].type = 'Blog Post';
    const result = validateKnowledgeOutput(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('type')));
});

test('validateKnowledgeOutput: resource estimatedHours <= 0 fails', () => {
    const pkg = buildValidPackage();
    pkg.resources[0].estimatedHours = 0;
    const result = validateKnowledgeOutput(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('estimatedHours')));
});

test('validateKnowledgeOutput: all RESOURCE_TYPES/DIFFICULTIES values are individually valid', () => {
    for (const type of RESOURCE_TYPES) {
        for (const difficulty of DIFFICULTIES) {
            const pkg = buildValidPackage();
            pkg.resources[0].type = type;
            pkg.resources[0].difficulty = difficulty;
            const result = validateKnowledgeOutput(pkg);
            assert.equal(result.valid, true, `expected valid for type="${type}" difficulty="${difficulty}": ${result.errors.join('; ')}`);
        }
    }
});

test('validateKnowledgeOutput: "No Learning Required" package with empty arrays is valid', () => {
    const pkg = {
        schemaVersion: '1.0.0',
        requiresLearning: false,
        reason: 'The user already has all the required skills.',
        learningObjectives: [],
        knowledgeGraph: { concepts: [], paths: [] },
        resources: [],
        recommendedLearningTime: 0,
        confidence: 0.9,
    };
    const result = validateKnowledgeOutput(pkg);
    assert.equal(result.valid, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// validator.js — validateKnowledgePackage (deep structural checks)
// ─────────────────────────────────────────────────────────────────────────────

test('validateKnowledgePackage: valid package passes deep checks', () => {
    const result = validateKnowledgePackage(buildValidPackage());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
});

test('validateKnowledgePackage: path edge referencing unknown concept id fails', () => {
    const pkg = buildValidPackage();
    pkg.knowledgeGraph.paths.push({ from: 'c1', to: 'c999' });
    const result = validateKnowledgePackage(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('c999')));
});

test('validateKnowledgePackage: duplicate resource titles fail', () => {
    const pkg = buildValidPackage();
    pkg.resources.push({ ...pkg.resources[0] });
    const result = validateKnowledgePackage(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes('duplicate')));
});

test('validateKnowledgePackage: duplicate titles are case/whitespace insensitive', () => {
    const pkg = buildValidPackage();
    pkg.resources.push({ ...pkg.resources[0], title: `  ${pkg.resources[0].title.toUpperCase()}  ` });
    const result = validateKnowledgePackage(pkg);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes('duplicate')));
});

test('validateKnowledgePackage: unknown prerequisite id is only a warning, not an error', () => {
    const pkg = buildValidPackage();
    pkg.knowledgeGraph.concepts[1].prerequisites.push('c_unknown');
    const result = validateKnowledgePackage(pkg);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('c_unknown')));
});

// ── isUrlReachable / verifyResourceUrls — live-link verification ───────────

test('isUrlReachable: 200 response → true', async () => {
    const fakeFetch = async () => ({ status: 200 });
    assert.equal(await isUrlReachable('https://example-real-site.com/docs', { fetchImpl: fakeFetch }), true);
});

test('isUrlReachable: 404 response → false', async () => {
    const fakeFetch = async () => ({ status: 404 });
    assert.equal(await isUrlReachable('https://example-real-site.com/missing', { fetchImpl: fakeFetch }), false);
});

test('isUrlReachable: HEAD rejected (405) but GET succeeds → true', async () => {
    const fakeFetch = async (url, { method }) => (method === 'HEAD' ? { status: 405 } : { status: 200 });
    assert.equal(await isUrlReachable('https://example-real-site.com/no-head', { fetchImpl: fakeFetch }), true);
});

test('isUrlReachable: network error on both attempts → false, never throws', async () => {
    const fakeFetch = async () => { throw new Error('ENOTFOUND'); };
    assert.equal(await isUrlReachable('https://nonexistent-domain-xyz.test/', { fetchImpl: fakeFetch }), false);
});

test('isUrlReachable: non-http(s) or malformed input → false', async () => {
    assert.equal(await isUrlReachable('', {}), false);
    assert.equal(await isUrlReachable('not-a-url', {}), false);
    assert.equal(await isUrlReachable(null, {}), false);
});

test('verifyResourceUrls: blanks unreachable URLs and keeps reachable ones', async () => {
    const data = {
        resources: [
            { title: 'Good', url: 'https://good.example/a' },
            { title: 'Dead', url: 'https://dead.example/b' },
            { title: 'NoUrl', url: '' },
        ],
    };
    const fakeFetch = async (url) => ({ status: url.includes('good') ? 200 : 404 });
    const blanked = await verifyResourceUrls(data, { fetchImpl: fakeFetch });
    assert.equal(blanked, 1);
    assert.equal(data.resources[0].url, 'https://good.example/a');
    assert.equal(data.resources[1].url, '');
    assert.equal(data.resources[2].url, '');
});

test('verifyResourceUrls: no resources → 0, no throw', async () => {
    assert.equal(await verifyResourceUrls({}), 0);
    assert.equal(await verifyResourceUrls({ resources: [] }), 0);
});

// ── Wrong-but-alive links ──────────────────────────────────────────────────
// A status check only proves *something* answered. These cover the two ways a
// link can return 200 and still be the wrong page.

test('isRedirectCollapse: deep link bounced to the site root → true', () => {
    assert.equal(
        isRedirectCollapse('https://docs.docker.com/network/deep-dive/', 'https://docs.docker.com/'),
        true,
    );
});

test('isRedirectCollapse: legitimate redirects that keep a real path → false', () => {
    // trailing slash added
    assert.equal(isRedirectCollapse('https://x.example/get-started', 'https://x.example/get-started/'), false);
    // http → https
    assert.equal(isRedirectCollapse('http://x.example/a/b', 'https://x.example/a/b'), false);
    // site reorganisation across domains, path still meaningful
    assert.equal(isRedirectCollapse('https://reactjs.org/docs/hooks', 'https://react.dev/reference/react/hooks'), false);
    // redirected deeper
    assert.equal(isRedirectCollapse('https://x.example/a', 'https://x.example/a/b/'), false);
});

test('isRedirectCollapse: a root URL that stays at a root is not a collapse', () => {
    assert.equal(isRedirectCollapse('https://x.example/', 'https://x.example/'), false);
    assert.equal(isRedirectCollapse('https://x.example', 'https://www.x.example/'), false);
});

test('isRedirectCollapse: no redirect information claims nothing', () => {
    assert.equal(isRedirectCollapse('https://x.example/a/b', undefined), false);
    assert.equal(isRedirectCollapse('https://x.example/a/b', ''), false);
    assert.equal(isRedirectCollapse('https://x.example/a/b', 'not-a-url'), false);
});

test('looksLikeNotFoundTitle: detects not-found titles', () => {
    assert.equal(looksLikeNotFoundTitle('<html><head><title>404 Not Found</title></head>'), true);
    assert.equal(looksLikeNotFoundTitle('<TITLE>Page not found · GitHub</TITLE>'), true);
    assert.equal(looksLikeNotFoundTitle('<title>This page doesn\'t exist</title>'), true);
});

test('looksLikeNotFoundTitle: a real page about 404s is not flagged', () => {
    // The word appears in the body, not the title — scanning the whole document
    // would misread this as missing.
    assert.equal(
        looksLikeNotFoundTitle('<title>Handling HTTP Errors in Express</title><p>...a 404 not found...</p>'),
        false,
    );
    assert.equal(looksLikeNotFoundTitle('<title>Docker Networking</title>'), false);
    assert.equal(looksLikeNotFoundTitle('no title element at all'), false);
    assert.equal(looksLikeNotFoundTitle(null), false);
});

test('isUrlReachable: 200 that collapsed to the homepage → false', async () => {
    const fakeFetch = async () => ({ status: 200, url: 'https://docs.example.com/' });
    assert.equal(
        await isUrlReachable('https://docs.example.com/guides/networking/advanced', { fetchImpl: fakeFetch }),
        false,
    );
});

test('isUrlReachable: deep link serving a soft-404 body → false', async () => {
    const fakeFetch = async (url, { method }) => ({
        status: 200,
        url,
        text: async () => (method === 'GET' ? '<html><head><title>Page not found</title></head>' : ''),
    });
    assert.equal(
        await isUrlReachable('https://docs.example.com/guides/missing-page', { fetchImpl: fakeFetch }),
        false,
    );
});

test('isUrlReachable: deep link with a genuine page → true', async () => {
    const fakeFetch = async (url) => ({
        status: 200,
        url,
        text: async () => '<html><head><title>Advanced Networking Guide</title></head>',
    });
    assert.equal(
        await isUrlReachable('https://docs.example.com/guides/networking', { fetchImpl: fakeFetch }),
        true,
    );
});

test('isUrlReachable: shallow canonical URL skips the body check entirely', async () => {
    // Only HEAD should be issued — no GET, no body read — for a depth-1 URL.
    const methods = [];
    const fakeFetch = async (url, { method }) => {
        methods.push(method);
        return { status: 200, url };
    };
    assert.equal(await isUrlReachable('https://docs.example.com/get-started', { fetchImpl: fakeFetch }), true);
    assert.deepEqual(methods, ['HEAD']);
});

test('isUrlReachable: unreadable body leaves the reachable verdict standing', async () => {
    const fakeFetch = async (url, { method }) => ({
        status: 200,
        url,
        text: async () => { throw new Error('stream closed'); },
    });
    assert.equal(
        await isUrlReachable('https://docs.example.com/a/b/c', { fetchImpl: fakeFetch }),
        true,
    );
});
