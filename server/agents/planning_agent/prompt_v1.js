/**
 * planning_agent/prompt_v1.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prompt templates for the three-stage Planning Agent.
 *
 * Stage 1 — Domain Analysis
 *   Preserved verbatim in spirit from the old planningAgent.js's
 *   buildAnalysisPrompt() / CATEGORY_CONTEXT (7 category expert personas).
 *   Only the surrounding plumbing (inputs/outputs) is adapted to the new
 *   pipeline — the persona text and analysis questions are unchanged.
 *
 * Stage 2 — Hierarchy Generation (new)
 *   Project → Milestones (4-8) → Modules (2-6 each) → Tasks (2-8 each).
 *   Dependencies are expressed as ZERO-BASED INDICES into the flattened
 *   milestones/modules/tasks lists of THIS SAME response (not string ids) —
 *   this lets agent.js normalize/re-index deterministically afterwards
 *   without relying on the LLM inventing consistent id strings.
 *
 * Stage 3 — Task Workspace Generation (new, batched)
 *   For a batch of already-decided tasks (title/difficulty/etc. fixed in
 *   Stage 2), produce the full workspace blueprint for each.
 */

// ── Category-specific expert personas — PRESERVED from planningAgent.js ──────
const CATEGORY_CONTEXT = {
    academic: `You are an experienced academic who has guided hundreds of students.
You know exactly what each step of a research/assignment workflow looks like in practice.
You understand the difference between "reading about X" (vague) and "read chapters 3-4
of [source], extract the 3 key algorithms, write 200-word summary" (concrete).`,

    work: `You are a senior professional who has managed complex work projects.
You break work into deliverables with clear owners, inputs, and outputs.
You know that "prepare presentation" is useless — "build 8-slide deck covering
Q3 metrics, competitor analysis, and 3 recommendations" is actionable.`,

    personal: `You are a life coach who specializes in personal goal execution.
You understand human motivation and break personal goals into low-friction,
immediately startable steps with built-in accountability checkpoints.`,

    health: `You are a health professional who understands how to make health goals stick.
You create specific, measurable action steps tied to habits and schedules,
not vague intentions like "exercise more" or "eat better".`,

    finance: `You are a financial advisor who translates financial goals into concrete actions.
Each step has a specific number, account, deadline, or decision point attached to it.`,

    creative: `You are a creative director who has shipped hundreds of creative projects.
You know the creative process has distinct phases: ideation, drafting, refinement,
and production — and each requires different mental states and time blocks.`,

    other: `You are an expert project manager who handles diverse tasks.
You translate ambiguous goals into concrete, measurable steps with clear outputs.`,
};

// ── Time-context guidance — PRESERVED from planningAgent.js's timeContext() ──
function timeContext(totalDays, hoursAvail) {
    if (totalDays >= 7) {
        return `TIME CONTEXT: ${Math.round(totalDays)} days available.
Each unit of work = one focused work session scheduled on a DIFFERENT DAY.
Don't over-schedule — leave room for life.`;
    }
    if (totalDays >= 3) {
        return `TIME CONTEXT: ${totalDays.toFixed(1)} days available.
Work will be spread across days, 1-2 sessions per day.`;
    }
    if (totalDays >= 1) {
        return `TIME CONTEXT: ${totalDays.toFixed(1)} days (${Math.round(hoursAvail)} hrs) available.
Work spread across today and tomorrow.`;
    }
    return `TIME CONTEXT: URGENT — only ${Math.round(hoursAvail)} hours left.
Keep the plan short, decisive, high-impact. Minimize hierarchy depth.`;
}

function computeTimeWindow(deadlineISO, nowISO) {
    const now = new Date(nowISO);
    const deadline = new Date(deadlineISO);
    const hoursAvail = Math.max(1, (deadline - now) / 3_600_000);
    const totalDays = hoursAvail / 24;
    return { hoursAvail, totalDays };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Domain Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Stage 1 domain-analysis prompt.
 * Preserved from the old buildAnalysisPrompt() — same persona text, same
 * analysis questions, same output JSON shape.
 *
 * @param {string} rawGoal      - the raw user goal string
 * @param {string} category     - one of intent.category enum
 * @param {string} complexity   - one of intent.complexity enum
 * @param {string} deadlineISO  - resolved/inferred deadline (ISO 8601)
 * @param {string} nowISO       - current time (ISO 8601)
 * @returns {string} prompt
 */
export function buildDomainAnalysisPrompt(rawGoal, category, complexity, deadlineISO, nowISO) {
    const persona = CATEGORY_CONTEXT[category] || CATEGORY_CONTEXT.other;
    const { hoursAvail, totalDays } = computeTimeWindow(deadlineISO, nowISO);

    return `${persona}

A user needs help breaking down this task. Before creating a plan, you MUST
deeply analyze what this task actually requires.

TASK: "${rawGoal}"
CATEGORY: ${category}
COMPLEXITY: ${complexity}
${timeContext(totalDays, hoursAvail)}

Think through these questions:
1. What is the REAL goal the user is trying to achieve? (not the surface request)
2. What domain expertise is required? What does someone competent in this area
   actually DO when executing this kind of task?
3. What are the natural phases or stages of this type of work?
4. What dependencies exist — what MUST happen before what else?
5. What are the most common failure points for this type of task?
6. What does "done" look like — what is the tangible final output?

Respond ONLY with valid JSON:
{
  "realGoal": "the actual outcome the user needs (1 sentence)",
  "domainWorkflow": "how an expert actually approaches this type of task (2-3 sentences)",
  "naturalPhases": ["phase 1", "phase 2", "phase 3"],
  "criticalDependency": "the single most important prerequisite",
  "doneDefinition": "what the completed task looks like concretely",
  "timeRealism": "honest assessment of whether the deadline is realistic (1 sentence)"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Hierarchy Generation
// ─────────────────────────────────────────────────────────────────────────────

function formatReviewFeedback(reviewFeedback) {
    if (!reviewFeedback) return '';

    const allIssues = Array.isArray(reviewFeedback)
        ? reviewFeedback
        : Array.isArray(reviewFeedback.issues)
            ? reviewFeedback.issues
            : [];

    if (allIssues.length === 0) return '';
    // Capped — a large plan with many flagged issues shouldn't balloon the
    // revision prompt; the highest-severity issues matter most to fix first.
    const issues = allIssues.slice(0, 15);

    const lines = issues.map((issue) => {
        if (typeof issue === 'string') return `- ${issue}`;
        const parts = [issue.severity ? `[${issue.severity}]` : null, issue.message ?? issue.type ?? JSON.stringify(issue)]
            .filter(Boolean)
            .join(' ');
        return `- ${parts}`;
    });

    return `

⚠️ REVISION REQUIRED — a Review Agent flagged the following issues with your
PREVIOUS hierarchy. You MUST fix every one of them in this new attempt:
${lines.join('\n')}`;
}

function formatKnowledgeSection(knowledge) {
    const resources = knowledge?.resources ?? [];
    if (!resources.length) return 'KNOWLEDGE CONTEXT: No learning resources were identified for this goal.';
    const summary = resources
        .slice(0, 10)
        .map((r) => `- "${r.title}" (${r.type ?? 'resource'}, ${r.difficulty ?? 'unknown'}) — topics: ${(r.keyTopics ?? []).join(', ')}`)
        .join('\n');
    return `KNOWLEDGE CONTEXT: The Knowledge Agent identified these learning resources.
Keep them in mind when phrasing learning-related modules/tasks so their topics align
(resources are attached to tasks automatically afterwards by keyword match — you do not
need to reference them by name):
${summary}`;
}

function formatMemorySection(memory) {
    const workflows = (memory?.bestWorkflowModules ?? []).slice(0, 10);
    if (!workflows.length) return 'MEMORY CONTEXT: No prior successful workflow history available for this user.';
    return `MEMORY CONTEXT: This user has previously succeeded with these workflow modules —
reuse similar phrasing/ordering where it fits this task:
${workflows.map((w) => `- ${w}`).join('\n')}`;
}

/**
 * Build the Stage 2 hierarchy-generation prompt.
 *
 * @param {object} domainAnalysis - Stage 1 output { realGoal, domainWorkflow, naturalPhases, criticalDependency, doneDefinition, timeRealism }
 * @param {object} intent         - context.intent { title, category, complexity, deadline, urgency, scope, userConstraints, ... }
 * @param {object} priority       - context.priority { priorityScore, riskScore, importanceScore, ... }
 * @param {object} knowledge      - context.knowledge { resources: [{ title, type, difficulty, estimatedHours, keyTopics, ... }], knowledgeGraph }
 * @param {object} memory         - context.memory { similarProjects, bestWorkflowModules, averageSpeeds, ... }
 * @param {object|Array|null} [reviewFeedback] - review_agent feedback from a prior revision (issues[] or {issues:[]})
 * @returns {string} prompt
 */
export function buildHierarchyPrompt(domainAnalysis, intent, priority, knowledge, memory, reviewFeedback = null) {
    const safeIntent = intent ?? {};
    const safeAnalysis = domainAnalysis ?? {};
    const safePriority = priority ?? {};

    return `You are an expert project planner building a complete work-breakdown structure.

GOAL: "${safeIntent.title ?? safeAnalysis.realGoal ?? 'Untitled goal'}"
REAL GOAL (from domain analysis): ${safeAnalysis.realGoal ?? 'n/a'}
HOW EXPERTS DO THIS: ${safeAnalysis.domainWorkflow ?? 'n/a'}
NATURAL PHASES: ${(safeAnalysis.naturalPhases ?? []).join(' → ') || 'n/a'}
CRITICAL DEPENDENCY: ${safeAnalysis.criticalDependency ?? 'n/a'}
DEFINITION OF DONE: ${safeAnalysis.doneDefinition ?? 'n/a'}
CATEGORY: ${safeIntent.category ?? 'other'} | COMPLEXITY: ${safeIntent.complexity ?? 'medium'} | URGENCY: ${safeIntent.urgency ?? 'Medium'}
PRIORITY SCORE: ${safePriority.priorityScore ?? 'n/a'} | RISK SCORE: ${safePriority.riskScore ?? 'n/a'}

${formatKnowledgeSection(knowledge)}

${formatMemorySection(memory)}

Build a hierarchy: Project → Milestones → Modules → Tasks.

RULES (must all be followed):
1. Generate 4 to 8 milestones. Every milestone MUST include: estimatedOutcome
   (the tangible result once the milestone is done), completionCriteria
   (array of checkable conditions), and riskLevel ("low"|"medium"|"high").
2. Each milestone has 2 to 6 modules. Every module MUST include
   acceptanceCriteria (array of checkable conditions for the module).
3. Each module has 2 to 8 tasks. Group closely related work into the same
   module/task — never mix unrelated concerns in one task.
4. Order matters: hard/uncertain tasks should appear EARLIER, not later.
   Learning/research tasks must come BEFORE the implementation tasks that
   depend on them.
5. Express dependencies between milestones/modules where real ordering
   constraints exist. Minimize task-to-task dependencies — prefer expressing
   ordering at the module/milestone level; only add a task dependency when
   two tasks in the SAME module truly cannot be reordered.
6. Never generate more hierarchy than the goal actually needs — if the goal
   is small, use fewer milestones/modules/tasks (but never below the stated
   minimums). Do not pad with filler.

DEPENDENCY FORMAT — IMPORTANT: dependencies are arrays of ZERO-BASED INDICES,
not strings:
- A milestone's "dependencies" are indices into the top-level "milestones" array.
- A module's "dependencies" are indices into a single flattened list of ALL
  modules across ALL milestones, in the order they appear in this response
  (module 0 is the first module of milestone 0, then milestone 0's next
  module, etc., continuing into milestone 1's modules, and so on).
- A task's "dependencies" are indices into a single flattened list of ALL
  tasks across ALL modules/milestones, in the same document order.
Omit self-references and leave "dependencies": [] when there is no real
ordering constraint.

For every task, also decide (this is FINAL — Stage 3 will only add workspace
detail, not change these): difficulty ("low"|"medium"|"high"|"very_high"),
requiredSkills (array of strings), estimatedMinutes (realistic, 15-480),
priority ("low"|"medium"|"high"|"critical"), reviewRequired (boolean —
true for tasks whose output should be checked before moving on), isBuffer
(boolean — true only for explicit slack/catch-up tasks, rare), isReview
(boolean — true only for a final review/polish/testing task).
${formatReviewFeedback(reviewFeedback)}

Respond ONLY with valid JSON, no markdown, in this exact shape:
{
  "milestones": [
    {
      "title": "string",
      "description": "string",
      "estimatedOutcome": "string",
      "completionCriteria": ["string"],
      "riskLevel": "low|medium|high",
      "dependencies": [],
      "modules": [
        {
          "title": "string",
          "description": "string",
          "acceptanceCriteria": ["string"],
          "dependencies": [],
          "tasks": [
            {
              "title": "string",
              "difficulty": "low|medium|high|very_high",
              "requiredSkills": ["string"],
              "estimatedMinutes": 60,
              "priority": "low|medium|high|critical",
              "reviewRequired": false,
              "isBuffer": false,
              "isReview": false,
              "dependencies": []
            }
          ]
        }
      ]
    }
  ],
  "planningNotes": "1-2 sentence overall strategy note",
  "realGoal": "restated real goal (1 sentence)"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Task Workspace Generation (batched)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Stage 3 task-workspace prompt for a BATCH of tasks.
 * Batching (rather than one call per task) keeps total LLM round-trips
 * reasonable; batch size is decided by the caller (agent.js).
 *
 * @param {Array<object>} tasksBatch - task stubs from Stage 2: { taskId, milestoneId, moduleId, title, difficulty, requiredSkills, estimatedMinutes, priority, reviewRequired, isBuffer, isReview, dependencies }
 * @param {object} domainAnalysis   - Stage 1 output, for grounding "why this task exists"
 * @param {object} knowledge        - context.knowledge (used only for topic awareness; resources are attached programmatically afterwards)
 * @returns {string} prompt
 */
export function buildTaskWorkspacePrompt(tasksBatch, domainAnalysis, knowledge) {
    const safeAnalysis = domainAnalysis ?? {};
    const resourceTopics = (knowledge?.resources ?? [])
        .flatMap((r) => r.keyTopics ?? [])
        .slice(0, 20);

    const tasksSection = (tasksBatch ?? [])
        .map((t) => JSON.stringify({
            taskId: t.taskId,
            milestoneId: t.milestoneId,
            moduleId: t.moduleId,
            title: t.title,
            difficulty: t.difficulty,
            requiredSkills: t.requiredSkills,
            estimatedMinutes: t.estimatedMinutes,
            priority: t.priority,
            isBuffer: t.isBuffer,
            isReview: t.isReview,
        }))
        .join('\n');

    return `You are an expert mentor writing detailed task workspaces for a project plan.

OVERALL GOAL: ${safeAnalysis.realGoal ?? 'n/a'}
DOMAIN WORKFLOW: ${safeAnalysis.domainWorkflow ?? 'n/a'}
DEFINITION OF DONE: ${safeAnalysis.doneDefinition ?? 'n/a'}
${resourceTopics.length ? `KNOWN LEARNING TOPICS IN THIS PROJECT: ${resourceTopics.join(', ')}` : ''}

For EACH task below, write a complete workspace blueprint. Do not change the
task's title, difficulty, or any decided metadata — only add the workspace
fields.

TASKS (one JSON object per line):
${tasksSection}

For each task, produce:
- overview: why this task exists and where it fits in the overall plan (2-3 sentences)
- objectives: 2 to 5 measurable objectives (array of strings)
- executionSteps: 3 to 8 sequential ATOMIC actions, each an object
  { "stepId": "S1", "action": "string", "order": 1 } — order strictly increasing from 1
- deliverables: array of strings — what should exist once the task is done
- successCriteria: array of strings, each starting with "✓ " (checkable conditions)
- commonMistakes: array of strings — realistic mistakes people make on this exact task
- aiGuidance: array of strings — implementation tips and best practices.
  NEVER reveal a complete, ready-to-copy solution — guide the approach, do not
  do the work for the user.
- reflectionQuestions: 2 to 4 questions that verify real understanding

Respond ONLY with valid JSON, no markdown, in this exact shape:
{
  "workspaces": [
    {
      "taskId": "T1",
      "overview": "string",
      "objectives": ["string"],
      "executionSteps": [{ "stepId": "S1", "action": "string", "order": 1 }],
      "deliverables": ["string"],
      "successCriteria": ["✓ string"],
      "commonMistakes": ["string"],
      "aiGuidance": ["string"],
      "reflectionQuestions": ["string"]
    }
  ]
}`;
}

export { CATEGORY_CONTEXT };
