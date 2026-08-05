# 📋 Changes

A running log of every change made to LifeSaver — **newest first**.

Each entry records *what* changed, *why* (the root cause, not just the symptom),
and *how it was verified*. If a change wasn't verified, that's stated explicitly
rather than left implied.

> **Relationship to the README's Development History:** the README section is the
> narrative story of how the architecture arrived at its current shape, written for
> someone reading the project cold. This file is the operational log — terser,
> append-only, and meant for scanning "what moved recently". New entries go here.

---

## 2026-08-02 — AgentTrace inner-scroll fix (page no longer drifts while agents run) ✅

**The problem.** While the pipeline was streaming, the dashboard page was
continuously scrolling *downward* with every new agent event — away from the
trace panel the user was already looking at. The experience was that the view
kept drifting to show the bottom of the project grid or the footer, forcing
the user to manually scroll back up to the log after each event.

**Root cause — two independent scroll calls were fighting each other.**

1. `AgentTrace.jsx` called `bottomRef.current.scrollIntoView({ behavior: 'smooth' })`
   on every `events` change. `scrollIntoView` is not scoped to a specific
   overflow container — it walks up the DOM and scrolls *every ancestor that
   needs to move* to bring the target into view, including the `<html>` / `body`
   scroll. Because the panel sits mid-page, the browser calculated that the
   `bottomRef` div was below or near the viewport edge and scrolled the page
   down on every single event.

2. `Dashboard.jsx` guarded the page-level `traceRef.scrollIntoView` with
   `if (isStreaming)`, but since `isStreaming` stays `true` for the entire run,
   React could re-fire that effect during reconciliation passes, adding further
   page-level scroll calls.

**What changed.**

- **`client/src/components/AgentTrace.jsx`**

  Replaced `bottomRef` + `scrollIntoView` with a `scrollContainerRef` attached
  directly to the `<div>` that has `overflow-y-auto`. On every new event, the
  handler now does:

  ```js
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (nearBottom) el.scrollTop = el.scrollHeight;
  ```

  `scrollTop` is scoped entirely to the element it is set on — it never
  propagates to any ancestor. The 80 px "near bottom" guard means a user who
  has manually scrolled up to re-read earlier events is not forcibly bounced
  back to the bottom on the next arriving event. The `bottomRef` sentinel `<div>`
  and its ref are removed.

- **`client/src/components/Dashboard.jsx`**

  Added `hasScrolledRef` (a `useRef(false)`) that gates the page-level
  `scrollIntoView` so it fires **at most once per pipeline run** — on the
  leading edge of `isStreaming` going `true`. The ref is reset to `false` when
  `isStreaming` returns to `false` (run ends), so the next submission gets its
  own one-shot scroll. This eliminates any possibility of the page-level scroll
  re-firing mid-run due to React re-renders.

**Net result.** When a task is submitted:
- The page scrolls once to the trace panel (smooth, one-shot).
- As each agent event arrives, only the panel's inner scroll position moves.
- The page scroll position is untouched for the rest of the run.
- If the user scrolls the page away from the trace panel while agents are
  running, the page stays exactly where the user put it.
- If the user has scrolled up inside the panel to read earlier events, new
  events do not auto-scroll the panel back down either.

**Verified:** `vite build` clean — 371 modules, 0 errors. Behaviour confirmed
by inspection of the DOM: `scrollContainerRef.current.scrollTop` increments
with each event; `document.documentElement.scrollTop` is stable.

---

## 2026-08-02 — Delete button for interrupted pipeline tasks ✅

**The problem.** The `ResumeBanner` (added in the previous session) lists every
interrupted pipeline run so the user can pick up where they left off. But
there was no way to discard one — if a user submitted a task by accident, or
no longer wants to continue a specific run, they were stuck looking at it in
the banner indefinitely, with no option other than resuming.

**What changed — one file only.**

- **`client/src/components/Dashboard.jsx`**

  *`ResumeBanner` component* — a trash-can icon button is now rendered to the
  right of the **▶ Resume** button for every task row. The icon uses the
  Heroicons micro trash SVG (inline, no icon-library dependency). While the
  delete request is in flight the icon is replaced by a spinner and both
  buttons on that row are disabled to prevent a simultaneous resume + delete
  race. The button is intentionally un-labelled (icon only, `title` tooltip
  for screen readers) so it does not crowd the row on narrow viewports.

  *`handleDeleteFailed` handler* — calls the existing `DELETE /api/tasks/:taskId`
  endpoint (which already handles Google Calendar event cleanup and Firestore
  document removal). On success, removes the task from `failedTasks` state and
  clears `quotaEvent` if it was the same task. On error, logs to console and
  releases the lock — no visible error state is shown (a transient network
  failure doesn't warrant alarming UI; the task stays in the list and the user
  can try again).

  *`deletingId` state* — mirrors the existing `resumingId` pattern: a single
  string holding the `taskId` currently being deleted, used to show the spinner
  and disable controls on that row only.

  *Import* — `deleteTask` added to the existing `import … from '../api/index.js'`
  line. No new API function was needed; `deleteTask` already existed.

**No server changes.** `DELETE /api/tasks/:taskId` was already implemented,
authenticated, and calendar-event-aware. This is a client-only change.

**Verified:** `vite build` clean — 371 modules, 0 errors. The delete path goes
through the same Firestore + Calendar cleanup that the existing Project Workspace
"Delete project" button uses, so it has the same level of coverage.

---

## 2026-08-02 — Quota resume, resource-mode toggle, and AgentTrace auto-visibility

Three independent improvements made together in one session. No agents were
modified beyond a one-line resource-mode guard in the knowledge acquisition
agent, no new Firestore collections were added, and no existing API contracts
were broken. `vite build` clean — 371 modules transformed.

---

### 1. Pipeline resume after quota exhaustion ✅

**The problem.** When a pipeline run hit a quota error the orchestrator already
checkpointed everything it had finished and marked the document
`pipelineFailed: true`. That document was deliberately excluded from
`GET /api/projects` and `GET /api/tasks` so it wouldn't render as a broken
card. But there was no way back in — the user saw an error banner and had to
start over from scratch, re-paying for every completed stage.

The backend half already existed: `POST /api/tasks/:taskId/resume` and
`resumeTask()` in the orchestrator were both implemented in the earlier
"make runs resumable" change. The gap was entirely on the client side, plus
one missing server endpoint.

**What changed.**

- **`server/agents/orchestrator.js`** — Both `quota_exceeded` SSE branches
  (shared quota and personal quota) now include `data: { taskId, resumable: true }`
  in the event payload. Previously the personal-quota branch called
  `closeWithError` directly without emitting a structured `quota_exceeded` event
  at all, so the client never captured a `taskId`.

- **`server/routes/tasks.js`** — New `GET /api/tasks/failed` endpoint. Queries
  `tasks` where `metadata.pipelineFailed === true` for the authenticated user
  (limit 10) and returns `taskId`, `rawGoal`, `pipelineStage`, `pipelineError`,
  and `checkpointedAt`. These documents are hidden from every other list endpoint.

- **`client/src/api/index.js`** — `resumeTask(taskId)` → `POST /api/tasks/:taskId/resume`
  and `getFailedTasks()` → `GET /api/tasks/failed`.

- **`client/src/components/Dashboard.jsx`** — New inline `ResumeBanner` component.
  On mount the Dashboard calls `getFailedTasks()` (catches pre-existing failed
  tasks from prior sessions). When a `quota_exceeded` SSE event arrives the
  `taskId` is captured from its `data` field. If either source has tasks,
  `ResumeBanner` renders above `TaskInput` with a **▶ Resume** button per task.
  Clicking calls `resumeTask(taskId)`, opens a new SSE stream, removes the task
  from the banner optimistically, and routes the stream into the AgentTrace panel.

**Three decisions worth recording.**

- *`getFailedTasks()` runs on mount, not only after a quota event.* A quota hit
  from a previous browser session would not fire an SSE event in the current
  session — the list fetch is the only way to surface those. Both code paths
  share the same `ResumeBanner`.

- *`rawGoal` is not in the SSE quota event.* The orchestrator does not have the
  original natural-language input to hand at that point. The banner labels SSE-
  sourced tasks as "Your interrupted task"; tasks fetched from the `/failed`
  endpoint do carry `rawGoal` from Firestore.

- *The personal-quota branch previously called `closeWithError` directly* without
  emitting a `quota_exceeded` event first, so the client never set
  `quotaExceeded: true`. Both branches now emit the structured event before closing.

**Verified:** `vite build` clean. Existing `orchestrator.integration.spec.js`
covers both quota branches and was not changed — those tests continue to pass.
The resume endpoint was verified in the earlier "make runs resumable" session.
End-to-end browser verification of the full resume flow requires a real quota
hit under a rate-limited key and is at source + test level only.

---

### 2. Resource-mode toggle: URL verification vs. info-only ✅

**The problem.** The Knowledge Acquisition Agent makes one HEAD-then-GET HTTP
request per generated resource URL to confirm it resolves. For a typical
knowledge package with 8–12 resources this adds 15–30 seconds of wall-clock
time to every pipeline run. Users on slow connections, or who do not need
clickable links, had no way to skip it.

**What changed.**

- **`server/routes/settings.js`** — `GET /api/settings/preferences` now returns
  `resourceMode` (default `'urls'`) alongside `workStyle`. `PUT` now accepts
  either field independently — sending only `resourceMode` without `workStyle`
  is valid; the handler merges with `{ merge: true }`. Added
  `RESOURCE_MODES = ['urls', 'info_only']` constant parallel to `WORK_STYLES`
  for the same validation pattern. `SchedulePreferences`, which sends only
  `workStyle`, is unaffected.

- **`server/agents/knowledge_acquisition_agent/agent.js`** — Reads
  `ctx.preferences?.resourceMode` (already attached by the orchestrator before
  any agent runs). In `'info_only'` mode: `verifyResourceUrls()` is skipped
  entirely; all resource `url` fields are nulled so the UI renders them as
  inert text via `ResourceLink` rather than a broken anchor; a note is emitted
  over SSE. `stripPlaceholderResourceUrls()` still runs in both modes —
  even in info-only mode the LLM should not surface `example.com` placeholders.

- **`client/src/api/index.js`** — `saveResourcePreference(resourceMode)` →
  `PUT /api/settings/preferences` with `{ resourceMode }` only.

- **`client/src/components/ResourceModeToggle.jsx`** — New self-contained
  component (same pattern as `SchedulePreferences`): fetches current preference
  on mount, renders a pill toggle with optimistic update and rollback on failure.
  States: **🔗 With Links** and **📄 Info Only**, each with a hint line explaining
  the trade-off.

- **`client/src/components/Dashboard.jsx`** — Renders `<ResourceModeToggle />`
  between `<SchedulePreferences />` and the resume banner.

**Verified:** `vite build` clean. The knowledge-agent change is a one-condition
guard around `verifyResourceUrls()`, which is exercised by the existing 40-test
suite for that agent. No new tests added — the guard is a leaf call into an
already-tested function.

---

### 3. AgentTrace always visible during active pipeline run ✅

**The problem.** `AgentTrace` was rendered at the bottom of `Dashboard.jsx`,
after `TaskInput`, the stat filters, and the entire project grid. On any
dashboard with more than two or three projects the live agent log was out of
view the moment a task was submitted. The panel was correct; it just wasn't
visible by default.

**What changed.**

- **`client/src/components/Dashboard.jsx`** — `<AgentTrace>` is now wrapped in
  a `div` with a `traceRef` and rendered *immediately after* `<TaskInput>`, above
  the filter chips and project grid. A `useEffect` watching `isStreaming` fires
  `traceRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })` with
  a 120 ms delay (enough time for the element to mount and expand before the
  browser calculates its position). No new state required — `isStreaming` from
  `useSSE` is already available.

- **`client/src/components/AgentTrace.jsx`** — Two visual changes:
  - `max-h-96` → `max-h-[480px]`: shows ~6–8 agent steps without internal
    scrolling instead of ~4–5.
  - Absolutely-positioned `div` with a sweeping indigo-purple CSS gradient along
    the top edge of the panel while `isStreaming` is true — immediate "live"
    signal without layout shift or interaction cost.

- **`client/src/index.css`** — Added `@keyframes shimmer` (background-position
  sweep, used by the AgentTrace live border), `@keyframes slide-in` (opacity +
  translateY for individual event cards), and `.animate-slide-in` utility class.
  `animate-slide-in` was already referenced in `AgentTrace.jsx` but the keyframe
  was never defined — this closes that gap.

**Verified:** `vite build` clean. Auto-scroll behaviour and gradient border are
visual-only with no logic impact; not covered by unit tests (the project's 363
tests are pure Node logic tests with no DOM environment).

---

## 2026-07-23 — Added `RAG_CHATBOT_PLAN.md` (planning doc, no code changed)

Added a root-level build plan for a **separate** RAG chatbot project. No LifeSaver
code was touched — this is a planning artefact only, logged here because it adds a
file to the repo root. It will move to the new `rag-chat/` repo once that is
scaffolded.

**Why it's relevant to LifeSaver:** the plan lifts four LifeSaver components rather
than rewriting them — `config/secrets.js` (AES-256-GCM envelope encryption for BYO
API keys), `config/Llm.js` (multi-provider client with retry/fallback/cost capture),
`rag/sseManager.js` and `client/src/hooks/useSSE.js` (streaming), plus the Firebase
auth middleware. These are **copied, not imported**, so the two repos stay
independent and changes do not propagate in either direction.

It also records a limitation of the current `server/rag/vectorStore.js` that is worth
knowing here: it pulls the 200 most recent Firestore entries and ranks cosine
similarity in JavaScript. That is correct for LifeSaver's task-history use case, but
it silently truncates any corpus larger than 200 entries — which is why the chatbot
uses Postgres + pgvector instead of extending it. No change made to LifeSaver's copy;
its current usage stays within the limit.

**Decisions recorded in the plan:** separate repo; Postgres + pgvector; all four chat
providers (Anthropic, Gemini, Groq, OpenAI).

**Second pass, same day** — scope extended per user request: dark theme with a
cursor-reactive background, image upload with OCR, audio upload with transcription,
web search and URL ingestion, and Claude-style Projects. Three of these changed the
architecture rather than the surface: images need both native vision *and* OCR
indexing (they solve different problems), audio needs a third provider slot because
no chat model accepts raw audio through the messages API, and the capability gaps
between providers (Groq cannot see images; only Anthropic/Gemini/OpenAI can) now
drive a capability matrix that the model picker reads. Reuse ratio revised from
~40% lifted to ~25% — the scope grew, the reusable base did not.

**Verified:** nothing to verify — documentation only, no code or tests changed.

---

## 2026-07-23 — Audit of the four earlier feature changes, and the wrong-links fix

Re-verified commit `8bc39f7` (knowledge-acquisition links, day/night scheduling +
missed-task reassignment, memory-agent indexing, home-page delete) against the code
rather than against its commit message. **Three of the four are correctly implemented
and needed no work.** The fourth was fixed in the wrong place, and the reported
"wrong links" turned out to be a different defect from the one that was fixed.

**Verified:** 363 unit + 13 integration tests pass (up from 352). Not browser-tested
this round — the user's Chrome was in use for another project, so verification is at
the test and source level only, and the two live behaviours below are reasoned from
code rather than observed in a running pipeline.

### Audit result

| Earlier change | Status |
|---|---|
| Day/night presets, Calendar-aware scheduling, missed-task auto-replan | ✅ correct — presets are `day 7–19 / flexible 9–21 / night 12–24`, `PUT /api/settings/preferences` and the UI toggle are wired, and the escalation→replan path survived the cron refactor into `runProgressSweepWithReplan()` |
| Home-page delete | ✅ correct — `ProjectCard` → `deleteTask` → `onDeleted` → `Dashboard` |
| Memory-agent indexing | ✅ correct **in the agents** — Memory, Evaluation Benchmark and the Knowledge cache all use `.where()`-only queries with an in-memory `toMillis` sort |
| Knowledge-acquisition links | ⚠️ verification was real but aimed at the wrong failure — see below |

### 1. "Wrong links" was a different bug from "dead links" ✅

The earlier fix added `isUrlReachable()`, which checks that a URL answers with a
status under 400. That catches *dead* links. The complaint was *wrong* links — and a
wrong link usually answers 200, so reachability could never see it.

Two ways a URL passes a status check and is still the wrong page:

- **Redirect collapse.** `isUrlReachable` fetches with `redirect: 'follow'`. When an
  LLM invents a plausible deep link, hosts very commonly 301 it to their homepage
  instead of 404ing — so the final response is a healthy 200 and the link ships. The
  card reads "Docker Networking Deep Dive" and the user lands on docker.com's front
  page. This is almost certainly the reported symptom.
- **Soft 404.** SPAs and doc sites with catch-all routing serve "page not found"
  bodies with HTTP 200.

Added two pure, separately-tested predicates and wired them into `isUrlReachable`:

- `isRedirectCollapse(requested, final)` — fires only on a *full* collapse to site
  root from a URL that had a real path. Kept deliberately narrow so ordinary
  redirects survive: trailing-slash normalisation, http→https, and cross-domain doc
  reorganisations like `reactjs.org/docs/hooks` → `react.dev/reference/react/hooks`
  all keep a non-empty path and are left alone.
- `looksLikeNotFoundTitle(html)` — scans only the `<title>`, not the body. Scanning
  the body would flag any legitimate page *about* HTTP 404s (an error-handling
  tutorial), which is a worse failure than the one being fixed.

The body check runs only for deep links (path depth ≥ 2) — the paths a model is
actually liable to invent — so canonical root URLs stay on the cheap HEAD-only path
and cost nothing extra.

**A regression caught mid-change.** The first version treated any non-`ok` HEAD as
final. That silently broke the existing contract: servers that reject HEAD with
405/403 are common on doc sites and CDNs, and the original code deliberately fell
through to GET for exactly that reason. Restored — only a *positive* HEAD is trusted;
every negative retries as GET.

**Verified:** 40/40 in this agent (11 new), covering both predicates' boundaries,
legitimate-redirect false positives, the HEAD-405 fall-through, deep-vs-shallow
dispatch, and an unreadable body leaving the earlier verdict standing.

### 2. The indexing fix missed the two queries that matter most ✅

The agents were correctly made index-free. But `routes/projects.js:54` and
`routes/tasks.js:104` still run `.where('userId').orderBy('createdAt').limit(50)` —
the exact composite-index pattern that produced the original
`FAILED_PRECONDITION: The query requires an index`. `GET /api/projects` is the home
page query.

**The fix here is documentation, not code.** The required index *is* defined in
`firestore.indexes.json`, so this works wherever indexes were deployed. Applying the
agents' in-memory trick to these two routes would be a regression: without `.orderBy`,
`.limit(50)` returns an *arbitrary* 50 documents, so sorting them in memory yields 50
random projects rather than the 50 newest. Staying correct without the index would
mean an unbounded read of every task a user owns, on the most-hit endpoint in the app.

The real defect was the README calling index deployment *"optional but recommended"*
and claiming things work without it — false for these two routes, and precisely how a
fresh deployment would reproduce the reported error. That step is now marked required,
with the reasoning recorded so the in-memory trick isn't "helpfully" applied here later.

### 3. Removed dead code ✅

`sortByFieldDesc()` in `agents/shared/firestoreUtil.js` had zero consumers — not even
a test. It was introduced by the earlier indexing fix, but the three agents ended up
using an inline `.sort()` with `toMillis` instead. Deleted; `toMillis`/`toMillisOrNull`
remain in use.

### Not changed

"Improve the overall quality of all the agents" was deliberately scoped to defects
with evidence behind them. The other twelve agents were left alone: refactoring
working code carries regression risk and no demonstrated benefit, and the three
audited features above were confirmed correct rather than rewritten.

---

## 2026-07-22 — Eight follow-up improvements

Working through the recommendations from the post-README audit, in priority order.
**Verified:** 352 unit tests + 13 integration tests pass (`npm run test:all`, up from
293); client `vite build` clean; server boots with all 15 agents and both providers.

### 1. Closed the `actualMinutes` learning loop ✅

**The problem.** The README's central claim is that the system learns from past
behaviour, and the machinery for it exists — the Memory Agent reads `actualHours`,
the Evaluation Benchmark Agent scores estimation accuracy against
`task.progress.actualMinutes`, and Time Estimation consumes `context.memory`.
But **nothing wrote `actualMinutes` in the current UI path**. The only writer was
the legacy `POST /api/tasks/:id/complete` route, which requires the client to
supply the number; the Project Workspace instead calls
`PATCH /api/projects/.../steps/:stepId`, which recorded `startedAt` and
`completedAt` but never derived elapsed time from them. Estimation accuracy was
therefore scored against `null` forever and the personalisation was hollow.

**The fix.** New pure helper `agents/shared/duration.js`:
`computeStepActualMinutes()` derives a step's duration from its own timestamps,
and `summarizeTaskActuals()` rolls steps up into a task-level figure plus
coverage. Wired into the step PATCH handler, which now writes both
`task.progress.actualMinutes` and `actualMinutesIsComplete`.

Three judgement calls worth recording, all in the direction of refusing to
fabricate a signal the system will later grade itself against:

- **Unstarted steps stay unmeasured.** The UI offers a checkbox that jumps
  `pending → completed` with no `startedAt`. Backfilling the estimate there would
  be self-confirming — estimates would be scored against themselves and accuracy
  would always look perfect. Those steps report `null`.
- **Abandoned steps are discarded.** "Start", walk away, complete two days later
  measures tab-open time, not work. Spans beyond 16h are rejected
  (`MAX_PLAUSIBLE_SESSION_MINUTES`); one such value would skew a user's profile badly.
- **Partial coverage is excluded from scoring.** If only some steps were measured,
  the sum is still shown, but `actualMinutesIsComplete: false` makes
  `computeEstimationAccuracy()` skip the task — comparing a partial actual against
  a whole-task estimate reads as systematic overestimation and would teach the
  profile to shrink every future estimate. Legacy actuals predate the flag and
  remain eligible.

**Two bugs found along the way.**

- *Reopening a completed step never cleared `completedAt`.* Pre-existing, latent
  until now: the stale timestamp would later pair with a fresh `startedAt` and
  yield a nonsense duration. The handler now clears the completion trail on
  reopen, and resets `task.progress.completedAt` when a task drops back to
  not-started.
- *`toMillis()` is unsafe for arithmetic.* The first implementation reused it, but
  it maps missing values to epoch `0` by design so unknown dates sort oldest. In a
  subtraction that sentinel silently means "1970", turning an absent timestamp into
  a ~56-year duration. Most cases passed only by accidentally tripping the
  plausibility ceiling — the unit test for `null` input caught it. Added
  `toMillisOrNull()` alongside it and documented the sort-vs-arithmetic split.

**Verified:** 307/307 tests pass (14 new, covering both helpers — boundary values,
clock skew, skipped steps, partial coverage, and the null-vs-zero distinction).

### 2. Encrypted users' API keys at rest ✅

`users/{uid}/settings/llm_key` stored raw provider keys. Firestore rules kept other
users out, but did nothing about anyone holding a service-account credential or a
console seat, who could read every user's paid API key in the clear. Asking people
to bring their own billable key sets a higher bar than that.

New `config/secrets.js` does AES-256-GCM envelope encryption
(`v1.<iv>.<authTag>.<ciphertext>`, version-tagged so a future algorithm change is a
migration rather than a break). Wired into the one writer (`routes/settings.js`) and
both readers (`orchestrator.js`, `briefing_agent`).

- **Encryption is on by default, not opt-in.** `SECRETS_KEY` is the intended
  production setting, but when it is absent the key is derived from
  `FIREBASE_PRIVATE_KEY` via HKDF-SHA256 — the server cannot boot without that
  variable anyway. The failure mode of an optional security feature is that nobody
  turns it on. Documented caveat: rotating either value makes stored keys
  unreadable and those users must re-enter theirs.
- **Old keys keep working.** `decryptSecret()` passes through anything without the
  `v1.` prefix, so pre-existing plaintext records don't break on deploy; they get
  re-encrypted the next time the user saves.
- **Firestore rules tightened to deny the client entirely.** The `settings`
  subcollection holds API keys *and* Google Calendar refresh tokens. The client was
  verified never to touch Firestore directly — it uses Firebase purely for auth and
  reaches all data through the API — so `allow read, write: if false` costs nothing
  and closes a path a stolen ID token or an XSS could otherwise use. The Admin SDK
  bypasses rules, so the server is unaffected.

**Verified:** 321/321 (14 new — round-trip, tamper detection, wrong-key rejection,
legacy passthrough, key-resolution precedence); clean boot.

### 3. Guarded the Firestore 1MB document limit ✅

The whole PlanningContext went into one `tasks/{taskId}` document with no size
check. The failure mode was expensive: a large project ran all 15 agents, spent the
full LLM budget, and only then failed on the final write — losing everything.

`shrinkContextForWrite()` now measures the serialized size and sheds optional
fields in a fixed order (`review` → `benchmark` → `memory` → `knowledge`, least
valuable first) until it fits, stopping as soon as it does. `planning`, `schedule`,
`intent`, `estimation` and `dependency` are never shed — without them the stored
project cannot be displayed or worked at all. If the required data alone is too
big, it now fails with a clear message instead of an opaque Firestore rejection.
The threshold is 900KB rather than 1,048,576: Firestore's own accounting (field
names, per-type overhead, index entries) runs above a plain JSON byte count, so the
estimate is a lower bound and needs headroom.

**Verified:** 331/331 (10 new). One test initially failed and the *test* was wrong,
not the code — at 400KB/field, shedding two fields already fits, which is the
"stop as soon as it fits" behaviour asserted immediately below it.

### 4. Added orchestrator integration tests ✅

293 tests, all of them pure agent logic; `orchestrator.js` and all six route files
had zero coverage. That is precisely where the bugs in this project's history came
from — a Firestore nested-array rejection, a crash on a malformed document, a
scheduler returning an empty list — all composition bugs no unit test could catch.

Two pieces of work:

- **Extracted the step state machine** into `agents/shared/stepProgress.js`
  (`applyStepUpdate`). It holds the only genuinely stateful rules in the Project
  Workspace, and they were inline in an Express handler wrapped around Firestore
  I/O, which made them untestable. 16 tests now cover transitions, the completion
  trail, blocking, and the rollup.
- **Mocked-module integration tests** (`orchestrator.integration.spec.js`, 13
  tests): Firebase, the LLM clients, SSE and all fifteen agents replaced with
  doubles, so they run with no network, credentials or API spend. They cover the
  agent ordering fix, the allSettled fatal/non-fatal split, the Review revision
  loop *and* its cap, checkpoint writes, failure preservation, resume skipping
  completed stages, ownership checks, and both quota branches.

These need `--experimental-test-module-mocks`, so they live in a `.spec.js` file
that Node's default discovery ignores and run via `npm run test:integration`
(`npm run test:all` runs both). Keeping the flag out of the main suite avoids
warning noise on every run and a broken `npm test` if the flag changes.

### 5. Parallelised independent stages — and fixed a real ordering bug ✅

Investigating what could safely run concurrently surfaced a genuine pre-existing
bug. **The Memory Agent ran first, at step 1, but reads `context.intent?.category`
and `?.complexity` — which the Intent Agent doesn't populate until step 3.** Both
were always null, so every project was profiled as category `other`, complexity
`medium`. History matching and the LLM starting-profile fallback were both running
against the wrong project shape, silently degrading exactly the personalisation
that feature exists to provide. Optional chaining meant it never threw.

Restructured to: Intent first (concurrently with the independent preferences read),
then Memory · Benchmark · Knowledge together — verified independent, all three key
only off `context.intent` and none reads what another writes. Knowledge was
confirmed not to depend on `planning` (its own header comment says so).

`Promise.allSettled`, not `Promise.all`: the benchmark load is explicitly
best-effort while Memory and Knowledge failures were fatal before and stay fatal.
`Promise.all` would have let a benchmark hiccup abort the entire pipeline.

*Known cosmetic effect:* three agents now stream to the live trace concurrently, so
their lines interleave rather than appearing in strict sequence. Each line is
labelled with its agent, so it stays readable.

### 6. Made runs resumable ✅

A run makes a dozen-plus LLM calls and previously wrote nothing until the final
step, so a failure at the Scheduler discarded all the Planning, Dependency and
Estimation work — and the user paid for it again on retry.

Checkpoints now land after the expensive stages only (planning, estimation,
schedule — three writes, not fifteen; Firestore writes cost money too). Each stage
is guarded by `if (!context.x)`, a no-op on fresh runs and the mechanism that lets
`resumeTask()` skip completed work. On failure the partial context is preserved and
marked `pipelineFailed`.

**Regression this introduced, and its fix:** failed runs now leave a document
behind, which would have rendered as a half-empty broken card on the dashboard.
Both list endpoints filter `pipelineFailed === true`. Preferences are deliberately
re-read rather than resumed, so a day/night change between attempts takes effect.

*Deliberately deferred:* resumable runs are reachable via
`POST /api/tasks/:taskId/resume` but are not yet surfaced in the UI, so a user
cannot currently trigger one themselves. Wiring that button is follow-up work.

### 7. Added authenticated cron endpoints ✅

Both schedules live inside the Express process, so they only fire while it is
awake. On Render's free tier (spins down after ~15 min idle) the 30-minute sweep
and the morning briefing simply never run, silently disabling autonomous
replanning — the product's most distinctive behaviour.

`POST /api/cron/progress` and `POST /api/cron/briefing` let any external scheduler
drive them. The sweep logic moved into `runProgressSweepWithReplan()` so the timer
and the endpoint run byte-identical code rather than drifting copies.

**An unset `CRON_SECRET` disables the endpoints (503) rather than opening them.**
That is the important property: these trigger expensive all-user LLM work, and a
missing-secret-means-no-auth default is how an ops convenience becomes an open
endpoint. Comparison is constant-time over SHA-256 digests, so unequal lengths
return a clean 401 instead of throwing.

**Verified live over HTTP:** 401 with a wrong secret, 401 with none, 503 when
unset, 200 on `/health`. Plus 7 unit tests.

### 8. Hygiene ✅

- **`.gitignore` had `*.json` with a four-entry allowlist** — every new JSON added
  to the project was silently ignored, surfacing only as something missing from a
  deploy. Replaced with patterns targeting credential files specifically. Checked
  afterwards that nothing was actually being hidden and no credential file became
  exposed.
- **Removed 468 lines of dead code from `config/Llm.js`** (1,103 → 635). The entire
  tail was a commented-out "previous version without more models". Confirmed no
  live statement existed past the cut and diffed the export list before/after —
  identical.
- **Added the MIT `LICENSE`** the README has always claimed.

### Browser verification (Chrome)

Ran the worktree build in a real browser on isolated ports (server 5002, client
5180) so the developer's own instances on 5001/5173 were left untouched — 5173 and
5174 turned out to be a different project entirely ("LookBook"), so LifeSaver's
client was not actually running.

Confirmed working: the app builds and serves, the login page renders, CORS
correctly echoes the client origin, all four protected API routes return 401
unauthenticated, and `/api/cron/progress` returns 503-disabled with no secret set.
The running dev server was already on the new code (nodemon had reloaded it) —
`/api/tasks/:id/resume` returns 401 rather than 404.

**Two findings:**

- **Stale copy — fixed.** The login page advertised "5 AI Agents" for what is now a
  15-agent system. Corrected in `client/src/pages/Login.jsx`.
- **`GOOGLE_REDIRECT_URI` points at the wrong port — not fixed, needs a decision.**
  The local `.env` has `PORT=5001` but `GOOGLE_REDIRECT_URI=http://localhost:5000/...`.
  A Google Calendar consent flow observed during testing redirected to
  `localhost:5000/api/calendar/callback`, where nothing is listening — so
  connecting Google Calendar silently fails in this local setup. Fixing it means
  either changing the port or the redirect URI, and the chosen value must also be
  registered on the OAuth client in Google Cloud Console, so it is left to the
  developer rather than guessed at.

**Not verified:** anything behind Google Sign-In. The popup is blocked in this
browser context, and authenticating or granting OAuth consent on the developer's
behalf is out of scope for an automated run. The authenticated flows this change
touches — the execution-step timer writing `actualMinutes`, resume, and the
dashboard filtering failed runs — are covered by the integration tests but have not
been clicked through by hand.

---

## 2026-07-22 — Repair the setup path, document the test suite, fix the deploy blueprint

Audited the rewritten README against the actual codebase. Every technical claim in
it held up (15-agent pipeline order, the day/flexible/night hour presets, the
2h/day capacity default, the 293-test count, the file tree). The problems were all
in the *supporting* files the README points at.

### Fixed

**`.env.example` didn't exist — in either directory.**
Setup steps 2 and 3 both instruct `cp .env.example .env`, which failed immediately
for anyone cloning the repo. This blocked onboarding at the first real step.
Created `server/.env.example` and `client/.env.example`, derived from what the code
actually reads (`process.env.*` and `import.meta.env.*`) rather than from a live
`.env` — so unrelated leftover keys present in the local environment (Astra,
OpenAI, LangChain, HuggingFace) were deliberately excluded, and no real values were
copied into a committed file.

**No `npm test` script.**
The README cites the test suite as verification eight separate times, but there was
no scripted way to run it — the 293-test claim was unreproducible by a reader.
Added `"test": "node --test"` to `server/package.json`.
*Note:* the first attempt used `node --test agents`, which fails on Node 22 — passing
a directory makes Node try to load it as a module rather than treat it as a search
root. Bare `node --test` recurses correctly and skips `node_modules`.

**`server/test.js` — leaked credential, and the only failing test.**
An untracked 16-line scratch file containing a hardcoded Groq API key in plaintext.
Because Node's test runner matches any `test.js`, it also turned a clean 293/293
into `294 tests, 1 fail`. Deleted. **The key itself still needs rotating** — deleting
the file does not undo it having been written to disk.

**`render.yaml` would have deployed a broken backend.**
The blueprint listed `GEMINI_API_KEY` but **not `GROQ_API_KEY`** — and Groq is now the
default provider. A Render deploy from this file would have come up with its primary
LLM unconfigured. Added `GROQ_API_KEY`, and labelled Gemini as the fallback.

**`SESSION_SECRET` was dead config.**
Documented in the README, present in the local `.env`, and auto-generated by
`render.yaml` — but never read anywhere in the codebase. Auth is stateless (Firebase
ID tokens verified per-request in `middleware/auth.js`). Removed from both the README
and the blueprint.

**Deployment was undocumented.**
The rewritten README dropped the deployment section entirely, while `render.yaml`,
`firebase.json`, `.firebaserc`, and `client/.env.production` all remained in the repo —
leaving a reader unable to tell whether deploying was unsupported or just unwritten.
Restored a Deployment section written against the actual configs, including two
non-obvious constraints: Vite inlines `VITE_API_URL` at build time (so it must be set
*before* `npm run build`), and Render's free tier spins down after ~15 min idle, which
silently stops the in-process `node-cron` jobs that drive autonomous replanning.

**Cron documentation was incomplete.**
The tech-stack table described two cron jobs; `server/index.js` registers three —
the 30-minute progress sweep, the 03:30 UTC briefing, and an undocumented 04:30 UTC
catch-up sweep. Corrected.

### Verified

| Check | Result |
|---|---|
| `cd server && npm test` | **293 passed, 0 failed** |
| `cd client && npm run build` | clean — 370 modules transformed |
| `node index.js` boot | clean — Firebase ✅, Groq ✅, Gemini ✅, 15 agents + crons registered |

Boot was confirmed on a free port; the first attempt returned `EADDRINUSE` on 5001
because a dev server was already running there. Worth noting the local `.env` uses
`PORT=5001` while the code default and all documentation use `5000`.

### Deliberately not done

- **`test.jsx`** (repo root) — 552 lines of hand-authored UI (a placement-prep
  roadmap), untracked and therefore unrecoverable if deleted. It's inert: not
  imported anywhere, outside `client/`, and it does not affect the test run. Left in
  place pending a decision on whether to delete it or move it into `client/src/`.
- **Moving the README's Development History into this file** — it currently accounts
  for roughly 40% of the README, which pushes the "Why LifeSaver?" pitch below ~1,500
  words of changelog. Migrating it is a reasonable next step but was not part of this
  change.

---
