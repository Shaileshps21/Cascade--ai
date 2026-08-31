/**
 * knowledge_acquisition_agent/validator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deeper structural validation for the Knowledge Acquisition Agent output,
 * on top of the shallow field/type/enum checks registered in schema.js.
 *
 * Extra checks performed:
 *   - knowledgeGraph.paths edges reference concept ids that actually exist
 *   - concept.prerequisites reference concept ids that actually exist
 *   - no duplicate resource titles (case-insensitive, whitespace-trimmed)
 */

import './schema.js';
import { validateAgentOutput } from '../shared/validator.js';

const AGENT_NAME = 'knowledge_acquisition_agent';
const SCHEMA_VERSION = '1.0.0';

// LLMs asked for a URL "if confidently known" reliably hallucinate a
// plausible-looking placeholder instead of leaving it blank (example.com,
// a fake YouTube "?list=example" playlist, etc.). None of these are real,
// clickable resources, so they're worse than no link at all — better to
// fall back to the prompt's own documented empty-string case.
const PLACEHOLDER_URL_PATTERN = /(^|\.)example\.(com|org|net)\b|[?&]list=example\b|yourdomain\.|placeholder\.(com|org|net)\b/i;

/**
 * Blank out any resource URL that matches a known LLM-hallucinated
 * placeholder pattern, mutating `data.resources` in place.
 * @param {object} data - parsed knowledge_acquisition_agent output
 * @returns {number} count of URLs blanked out
 */
export function stripPlaceholderResourceUrls(data) {
    const resources = Array.isArray(data?.resources) ? data.resources : [];
    let stripped = 0;
    for (const resource of resources) {
        if (typeof resource?.url === 'string' && PLACEHOLDER_URL_PATTERN.test(resource.url)) {
            resource.url = '';
            stripped++;
        }
    }
    return stripped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live URL verification — catches the links that LOOK legitimate (real
// domain, well-formed path) but are still wrong: the LLM guessed a plausible
// deep link that doesn't actually resolve, was moved, or 404s. Pattern
// matching (stripPlaceholderResourceUrls above) can't catch these — only an
// actual network check can. Non-fatal and bounded: a broken check (offline
// sandbox, DNS hiccup) blanks the URL rather than failing the pipeline, since
// a link the agent can't personally verify is worse to show than no link.
// ─────────────────────────────────────────────────────────────────────────────

const URL_CHECK_TIMEOUT_MS = 4000;
const URL_CHECK_CONCURRENCY = 6;
/** Path segments at or above which a URL counts as a "deep link" worth body-checking. */
const DEEP_LINK_MIN_DEPTH = 2;
/** Only this much of a response body is scanned for a not-found <title>. */
const SOFT_404_SCAN_BYTES = 8192;

const USER_AGENT = 'Mozilla/5.0 (compatible; CascadeBot/1.0; +link-check)';

const NOT_FOUND_TITLE_PATTERN =
    /(^|\W)(404|not found|page not found|page does(?:n'?t| not) exist|no longer available|nothing here)(\W|$)/i;

/** Number of non-empty path segments, e.g. "/a/b/" → 2, "/" → 0. */
function pathDepth(pathname) {
    return pathname.split('/').filter(Boolean).length;
}

/**
 * True when a URL with a real path redirected to the bare root of a site — the
 * classic signature of a dead deep link.
 *
 * This is the failure `res.status < 400` cannot see. When an LLM invents a
 * plausible-looking deep link, the host very often 301s it to its homepage
 * rather than 404ing, so `redirect: 'follow'` lands on a healthy 200 and the
 * wrong link ships: the card says "Docker Networking Deep Dive" and the user
 * arrives at docker.com's front page.
 *
 * Deliberately narrow — it fires only on a full collapse to root, not on any
 * shortening. Legitimate redirects (adding a trailing slash, http→https, a
 * docs-site reorganisation like reactjs.org/docs/hooks → react.dev/reference/
 * react/hooks) all keep a non-empty path and are left alone.
 *
 * @param {string} requestedUrl
 * @param {string} [finalUrl] - `response.url` after redirects; absent means the
 *   caller has no redirect information, in which case nothing is claimed.
 * @returns {boolean}
 */
export function isRedirectCollapse(requestedUrl, finalUrl) {
    if (typeof finalUrl !== 'string' || finalUrl.trim() === '') return false;
    let requested, final;
    try {
        requested = new URL(requestedUrl);
        final = new URL(finalUrl);
    } catch {
        return false;
    }
    // A canonical root URL that stays at a root is exactly what we ask for.
    if (pathDepth(requested.pathname) === 0) return false;
    return pathDepth(final.pathname) === 0;
}

/**
 * True when an HTML document's <title> announces a missing page. Catches the
 * "soft 404" — a not-found page served with HTTP 200, common on SPAs and doc
 * sites with catch-all routes, where a status check alone sees success.
 *
 * Scoped to the <title> on purpose: scanning the whole body would flag any page
 * that merely discusses 404s (an HTTP-status tutorial, an error-handling guide).
 *
 * @param {string} html - the leading bytes of a response body
 * @returns {boolean}
 */
export function looksLikeNotFoundTitle(html) {
    if (typeof html !== 'string') return false;
    const match = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
    if (!match) return false;
    return NOT_FOUND_TITLE_PATTERN.test(match[1].trim());
}

/**
 * Check whether a single URL resolves to a real, non-error page.
 *
 * Three ways a URL can fail, in increasing order of subtlety:
 *   1. an error status or a network failure         — status check
 *   2. a dead deep link redirected to the site root — isRedirectCollapse()
 *   3. a not-found page served as HTTP 200          — looksLikeNotFoundTitle()
 *
 * HEAD is tried first because it is cheap and enough for (1) and (2); GET is
 * the fallback for servers that reject HEAD (a 405/403 there must not be read
 * as "dead"). Check (3) needs a body, so it runs only for deep links — the
 * paths an LLM is actually liable to invent — leaving canonical roots on the
 * cheap path.
 *
 * @param {string} url
 * @param {{timeoutMs?: number, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<boolean>}
 */
export async function isUrlReachable(url, { timeoutMs = URL_CHECK_TIMEOUT_MS, fetchImpl = fetch } = {}) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;

    const request = async (method, extraHeaders = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetchImpl(url, {
                method,
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'User-Agent': USER_AGENT, ...extraHeaders },
            });
        } finally {
            clearTimeout(timer);
        }
    };

    /** @returns {'ok'|'dead'} — 'dead' also covers a healthy status at the wrong page. */
    const verdictFrom = (res) => {
        if (!(res?.status > 0 && res.status < 400)) return 'dead';
        if (isRedirectCollapse(url, res.url)) return 'dead';
        return 'ok';
    };

    // Only a positive HEAD is trusted. Any negative — 405/403 from a server that
    // refuses HEAD, a redirect collapse, a dropped connection — retries as GET,
    // because a HEAD-hostile server must not be misread as a dead link.
    let verdict = 'dead';
    try {
        verdict = verdictFrom(await request('HEAD'));
    } catch {
        verdict = 'dead';
    }

    if (verdict !== 'ok') {
        try {
            verdict = verdictFrom(await request('GET'));
        } catch {
            return false;
        }
    }

    if (verdict === 'dead') return false;

    // Soft-404 pass: only for deep links, and never fatal on its own failure —
    // an unreadable body leaves the earlier "reachable" verdict standing.
    let isDeep = false;
    try {
        isDeep = pathDepth(new URL(url).pathname) >= DEEP_LINK_MIN_DEPTH;
    } catch {
        isDeep = false;
    }
    if (!isDeep) return true;

    try {
        const res = await request('GET', { Range: `bytes=0-${SOFT_404_SCAN_BYTES - 1}` });
        if (verdictFrom(res) === 'dead') return false;
        if (typeof res?.text !== 'function') return true;
        const body = await res.text();
        return !looksLikeNotFoundTitle(String(body).slice(0, SOFT_404_SCAN_BYTES));
    } catch {
        return true;
    }
}

/**
 * Verify every resource URL in `data.resources` against the live network and
 * blank out any that don't resolve, mutating in place. Runs with bounded
 * concurrency so a long resource list doesn't serialize into a huge delay.
 * @param {object} data - parsed knowledge_acquisition_agent output
 * @param {{timeoutMs?: number, fetchImpl?: typeof fetch, concurrency?: number}} [opts]
 * @returns {Promise<number>} count of URLs blanked out for being unreachable
 */
export async function verifyResourceUrls(data, { timeoutMs = URL_CHECK_TIMEOUT_MS, fetchImpl = fetch, concurrency = URL_CHECK_CONCURRENCY } = {}) {
    const resources = Array.isArray(data?.resources) ? data.resources : [];
    const candidates = resources.filter(r => typeof r?.url === 'string' && r.url.trim() !== '');
    if (candidates.length === 0) return 0;

    let blanked = 0;
    let cursor = 0;

    async function worker() {
        while (cursor < candidates.length) {
            const resource = candidates[cursor++];
            let reachable = false;
            try {
                reachable = await isUrlReachable(resource.url, { timeoutMs, fetchImpl });
            } catch {
                reachable = false;
            }
            if (!reachable) {
                resource.url = '';
                blanked++;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
    return blanked;
}

/**
 * Validate a full knowledge package: runs the registered schema.js checks
 * plus deeper structural integrity checks.
 * @param {object} data - parsed knowledge_acquisition_agent output
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateKnowledgePackage(data) {
    const base = validateAgentOutput(AGENT_NAME, SCHEMA_VERSION, data);
    const errors = [...base.errors];
    const warnings = [...base.warnings];

    const concepts = Array.isArray(data?.knowledgeGraph?.concepts) ? data.knowledgeGraph.concepts : [];
    const paths = Array.isArray(data?.knowledgeGraph?.paths) ? data.knowledgeGraph.paths : [];
    const conceptIds = new Set(concepts.map(c => c?.id).filter(Boolean));

    // ── Knowledge graph edges must reference real concept ids ────────────────
    paths.forEach((edge, idx) => {
        if (!edge?.from || !conceptIds.has(edge.from)) {
            errors.push(`knowledgeGraph.paths[${idx}] references unknown concept id "from": ${edge?.from}`);
        }
        if (!edge?.to || !conceptIds.has(edge.to)) {
            errors.push(`knowledgeGraph.paths[${idx}] references unknown concept id "to": ${edge?.to}`);
        }
    });

    // ── Prerequisite references should also point at real concept ids ────────
    concepts.forEach((concept) => {
        const prereqs = Array.isArray(concept?.prerequisites) ? concept.prerequisites : [];
        prereqs.forEach((p) => {
            if (!conceptIds.has(p)) {
                warnings.push(`concept "${concept?.id}" lists unknown prerequisite: ${p}`);
            }
        });
    });

    // ── No duplicate resource titles ──────────────────────────────────────────
    const resources = Array.isArray(data?.resources) ? data.resources : [];
    const seenTitles = new Set();
    resources.forEach((resource) => {
        const key = (resource?.title ?? '').trim().toLowerCase();
        if (!key) return;
        if (seenTitles.has(key)) {
            errors.push(`duplicate resource title detected: "${resource.title}"`);
        }
        seenTitles.add(key);
    });

    return { valid: errors.length === 0, errors, warnings };
}
