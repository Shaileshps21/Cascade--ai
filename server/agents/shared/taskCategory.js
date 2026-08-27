/**
 * taskCategory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic, keyword-based classification of a task's title into one of
 * the domain buckets `memory.averageSpeeds` is keyed by. No task in the
 * PlanningContext schema carries an explicit domain category of its own
 * (only project-level `intent.category`, which is a single value for the
 * whole project) — this fills that gap with a cheap, no-LLM heuristic.
 *
 * Shared because two call sites need the exact same bucket definitions to
 * stay consistent with each other:
 *   - memory_agent: classifies PAST completed tasks (from task_history's
 *     `taskPerformance[]`) to compute REAL per-category average speeds.
 *   - time_estimation_agent: classifies the CURRENT project's tasks to look
 *     up which of those speeds applies, for historical calibration
 *     (suggestions.md #24).
 *
 * Categories and their keywords are deliberately conservative: a task that
 * matches nothing returns `null` rather than guessing, so callers only
 * calibrate against data they're confident actually applies.
 */

/** Baseline assumption per category (minutes) when no real history exists yet — mirrors memory_agent's pre-existing fallback constants. */
export const DEFAULT_AVERAGE_SPEEDS = {
    coding: 30, writing: 45, research: 60, reading: 40, design: 50, debugging: 35, revision: 25,
};

// Checked in this order — first match wins. Ordered so the more specific /
// less ambiguous categories (debugging, revision) are tried before the
// broad catch-all (coding), since "fix the bug in the API" should classify
// as debugging, not coding.
const CATEGORY_KEYWORDS = {
    debugging: ['debug', 'bug', 'troubleshoot', 'diagnose', 'fix issue', 'fix bug', 'hotfix'],
    // Deliberately NOT bare "review" — "code review", "review the API design"
    // etc. are extremely common AI-generated task titles across every other
    // category, and would otherwise all get misclassified as revision.
    revision: ['revise', 'revision', 'refactor', 'polish', 'proofread'],
    research: ['research', 'investigate', 'explore', 'analyze', 'analyse', 'survey', 'benchmark'],
    design: ['design', 'wireframe', 'mockup', 'prototype', 'layout', 'ui/ux', 'user interface'],
    writing: ['write', 'draft', 'compose', 'document', 'report', 'essay', 'content'],
    reading: ['read ', 'reading', 'literature review'],
    coding: ['code', 'implement', 'build', 'develop', 'program', 'api', 'database', 'deploy', 'integrate'],
};

/**
 * Classify free text (typically a task title, optionally with requiredSkills
 * appended) into one of the `averageSpeeds` buckets.
 * @param {string} text
 * @returns {string|null} one of DEFAULT_AVERAGE_SPEEDS' keys, or null if nothing matched
 */
export function classifyTaskCategory(text) {
    const haystack = String(text ?? '').toLowerCase();
    if (!haystack.trim()) return null;
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some((kw) => haystack.includes(kw))) return category;
    }
    return null;
}
