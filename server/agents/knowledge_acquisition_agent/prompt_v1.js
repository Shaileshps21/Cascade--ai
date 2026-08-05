/**
 * knowledge_acquisition_agent/prompt_v1.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the single-call 7-step Knowledge Acquisition prompt:
 *   1. Knowledge Requirement Detection
 *   2. Learning Objectives
 *   3. Knowledge Graph
 *   4. Resource Discovery
 *   5. Resource Summarization
 *   6. Learning Path
 *   7. Knowledge Package (assembled JSON output)
 *
 * The whole 7-step process is sent as ONE prompt to clients.pro — the "steps"
 * describe the content the model must reason through, not separate LLM calls.
 */

export const RESOURCE_TYPES = [
    'Official Documentation',
    'Books',
    'Research Papers',
    'YouTube Courses',
    'Interactive Platforms',
    'Community Articles',
    'GitHub Repositories',
    'Practice Websites',
];

export const KNOWLEDGE_REQUIREMENT_LEVELS = [
    'No Learning Required',
    'Learning Recommended',
    'Learning Required',
    'Research Required',
];

/**
 * Build the knowledge acquisition prompt.
 * @param {string} rawGoal    - the user's raw goal text (context.rawGoal)
 * @param {string} [category]   - context.intent.category
 * @param {string} [complexity] - context.intent.complexity
 * @returns {string} prompt
 */
export function buildKnowledgeAcquisitionPrompt(rawGoal, category = 'other', complexity = 'medium') {
    return `You are an expert Knowledge Acquisition Agent for a project planning system.

Your job is to determine what a user needs to LEARN before and while executing their goal,
and to build a complete, high-quality knowledge package for them.

User's goal:
"${rawGoal}"

Category: ${category}
Complexity: ${complexity}

Work through the following 7 steps internally, then return ONLY the final assembled JSON
described at the end (do not emit the intermediate steps as separate top-level keys —
fold everything into the final structure).

STEP 1 — Knowledge Requirement Detection:
Decide whether learning is required to accomplish this goal. Classify it as one of:
${KNOWLEDGE_REQUIREMENT_LEVELS.map(l => `"${l}"`).join(' | ')}
Set requiresLearning = true unless the classification is "No Learning Required".
Explain your decision in "reason".

STEP 2 — Learning Objectives:
If learning is needed, list ordered, logical learning objectives — what the user must
understand or be able to do, in the order they should learn it. Each area of knowledge
should have at least one clear objective.

STEP 3 — Knowledge Graph:
Build a concept graph. Each concept node has:
  { id, name, summary (1-2 sentences), difficulty (beginner|intermediate|advanced), prerequisites: [conceptId, ...] }
Add directed edges in "paths" as { from: conceptId, to: conceptId } meaning
"must learn 'from' before 'to'". Every id referenced in paths and in any concept's
prerequisites[] MUST correspond to a concept that also appears in the concepts array.
Never reference a concept id that doesn't exist.

STEP 4 — Resource Discovery:
Find HIGH-QUALITY, non-outdated resources — but cover BREADTH, not just the single best
overall link. Downstream, each resource gets attached to the *specific concept or task* it's
most relevant to (not shown as one shared pile), so a handful of generic resources covering
only the goal as a whole is not enough — most tasks would end up with nothing relevant, or
everyone reusing the same 2-3 links. Instead:
  - Aim for roughly ONE resource per concept in your Step 3 knowledge graph (a goal with
    6 concepts should have somewhere around 6+ resources, not 2-3), plus 1-2 general/overview
    resources for the goal as a whole.
  - Within a single concept, avoid two resources that cover the exact same material —
    prefer the single best one for THAT concept. Different concepts should generally get
    different resources, not the same link repeated with a different "reason".
  - For a trivial goal with 1-2 concepts, a small resource list is correct — don't pad it.
  - Each resource's "type" must be exactly one of:
${RESOURCE_TYPES.map(t => `      - ${t}`).join('\n')}
  - Avoid resources you know to be outdated or deprecated.

STEP 5 — Resource Summarization:
For every resource, produce these exact fields:
  title, type, difficulty (beginner|intermediate|advanced), estimatedHours (number > 0),
  reason (why this resource was chosen), summary (3-5 sentences describing what it covers),
  keyTopics (array of strings — used to match this resource to the specific task/concept it's
  for, so make these SPECIFIC to this one resource, not generic goal-level keywords),
  bestFor (who/what stage this is best suited for),
  prerequisites (array of concept ids or skill names needed before using this resource),
  url, priority (integer, 1 = highest)

URL RULE — be conservative, a wrong link is worse than no link:
  - Only set a URL when you are highly confident of the EXACT address — official
    documentation homepages, a project's main site, a well-known platform's course/landing
    page, etc.
  - Strongly prefer a stable top-level/canonical URL (e.g. "https://docs.docker.com/get-started/")
    over a specific deep link to one article, video, or blog post whose exact address you
    aren't certain of — those are the links most likely to be wrong or dead.
  - If you are not highly confident of the exact URL, set url to an empty string. Do not
    invent a plausible-looking URL just to fill the field.

STEP 6 — Learning Path:
Order resources/concepts Beginner → Intermediate → Advanced. When multiple resources
overlap in content, mark only ONE as the primary (lowest priority number) for that topic
and give the rest a higher (less urgent) priority number.

STEP 7 — Knowledge Package:
Assemble everything into the final JSON below. recommendedLearningTime is the total
realistic estimated hours needed (account for overlap between resources — do not just
sum every resource's estimatedHours blindly). confidence is 0-1, reflecting how confident
you are that this package is accurate and sufficient for the user's goal.

Return ONLY valid JSON in exactly this shape. No markdown, no explanation, no extra keys
outside of "reasoning":

{
  "schemaVersion": "1.0.0",
  "requiresLearning": true,
  "reason": "string explaining the Step 1 classification",
  "learningObjectives": ["string", "..."],
  "knowledgeGraph": {
    "concepts": [
      { "id": "c1", "name": "string", "summary": "string", "difficulty": "beginner", "prerequisites": [] }
    ],
    "paths": [
      { "from": "c1", "to": "c2" }
    ]
  },
  "resources": [
    {
      "title": "string",
      "type": "Official Documentation",
      "difficulty": "beginner",
      "estimatedHours": 4,
      "reason": "string",
      "summary": "string (3-5 sentences)",
      "keyTopics": ["string"],
      "bestFor": "string",
      "prerequisites": [],
      "url": "string",
      "priority": 1
    }
  ],
  "recommendedLearningTime": 12,
  "confidence": 0.85,
  "reasoning": {
    "confidence": 0.85,
    "assumptions": ["string"],
    "warnings": ["string"],
    "promptVersion": "v1.0.0"
  }
}

If requiresLearning is false (Step 1 classification is "No Learning Required"), still
return valid JSON with empty arrays for learningObjectives, knowledgeGraph.concepts,
knowledgeGraph.paths, and resources, recommendedLearningTime = 0, and explain why in "reason".`;
}
