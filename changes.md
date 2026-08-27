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

## 2026-08-27 — Task Time Tracker / Focus Timer ✅

**What.** Focus Mode now measures real working time instead of only deriving it from `startedAt`/`completedAt` timestamps. Opening Focus Mode on a not-yet-started step marks it `in_progress` immediately (so `startedAt` reflects when work actually began, and the Task Workspace timeline's "Started" node lights up), and completing from Focus Mode reports the timer's own active seconds — pause time excluded — as `actualMinutes`, with a live comparison against the step's estimate that turns amber once you run over. Implements suggestions.md #5.

**How it works.** `applyStepUpdate()` (`server/agents/shared/stepProgress.js`) now accepts an optional `actualMinutes` in the patch: when a step transitions to `completed`, an explicit, plausible value (`0 < actualMinutes <= MAX_PLAUSIBLE_SESSION_MINUTES`) takes precedence over timestamp derivation; anything missing, non-positive, or implausibly large falls back to the existing `computeStepActualMinutes()` behavior unchanged. `summarizeTaskActuals()` (`duration.js`) was updated to respect that same explicit value when rolling per-step actuals up to the task level, rather than re-deriving every step from timestamps regardless of what was already set. `FocusMode.jsx` sends `Math.round(timer.seconds / 60)` (minimum 1) on `complete()`, or nothing at all for an instant-complete with zero elapsed time, so the server's own measurement is used instead of a fabricated zero.

**Files changed:**
- `server/agents/shared/stepProgress.js` — `applyStepUpdate()` accepts and prioritizes explicit `actualMinutes`.
- `server/agents/shared/duration.js` — `summarizeTaskActuals()` respects a step's pre-set `actualMinutes` before falling back to timestamp derivation.
- `server/agents/shared/stepProgress.test.js` — 4 new tests: explicit value takes precedence, applies on straight-to-completed, non-positive/implausible values ignored, ignored when the patch doesn't also complete the step.
- `server/routes/projects.js` — `PATCH /:projectId/tasks/:taskId/steps/:stepId` passes `actualMinutes` through.
- `client/src/api/index.js` — `updateExecutionStep` JSDoc documents the new field.
- `client/src/components/FocusMode.jsx` — marks the step `in_progress` on open; `complete()` reports measured minutes; timer UI shows estimate comparison and an over-estimate warning color.

**Verified:** `npm test` (server) and `npm run build` (client) both pass — see the combined verification note at the end of this batch (Drag-to-Reorder entry below).

---

## 2026-08-27 — Markdown Notes on Tasks ✅

**What.** Both per-step notes (in the execution step list) and a new per-task note (Task Workspace's Notes section) now render as lightweight markdown — `**bold**`, `*italic*`, `` `code` ``, `[links](url)`, and `- `/`* ` bullet lists — instead of raw text, with an explicit Edit toggle rather than an always-on textarea. Implements suggestions.md #4.

**How it works.** `MarkdownText.jsx` is a small dependency-free renderer (no markdown library) built for short freeform text, not full documents — inline formatting is regex-split, blank lines separate paragraphs, and a block where every line starts with `- `/`* ` renders as a `<ul>`. Task-level notes get a new endpoint, `PATCH /api/projects/:projectId/tasks/:taskId/notes`, since the existing schema's `task.notes` is a single-entry array with no prior writer besides the planning agent's `notes: []` initializer — this is the first thing to ever populate it after creation.

**XSS guard.** `[link](url)` only renders as a live `<a href>` when the URL matches `^(https?:|mailto:)`; anything else (`javascript:`, `data:`, etc.) renders as plain text instead. `task.notes` and step notes are both agent- and user-writable today, and a future read-only share link (suggestions.md #12) would otherwise turn this into a stored-XSS vector.

**Files changed:**
- `client/src/components/MarkdownText.jsx` — **NEW**. Renderer + href-scheme guard.
- `client/src/components/ExecutionStepItem.jsx` — Notes section rewritten with an Edit toggle; renders `MarkdownText` when not editing. `autoFocus` on the notes textarea now only fires on an explicit Edit click (previously it fired on every step expand, since `editingNotes` defaulted to `true` for any step without existing notes and the whole panel remounts on expand/collapse — stealing focus just from opening a step to read its description).
- `client/src/pages/TaskWorkspace.jsx` — new `TaskNote` component (edit/view toggle, `PATCH .../notes` on save) replaces the old static read-only notes list.
- `server/routes/projects.js` — `PATCH /:projectId/tasks/:taskId/notes`.
- `client/src/api/index.js` — `setTaskNote(projectId, taskId, text)`.

**Verified:** see combined verification note below (Drag-to-Reorder entry).

---

## 2026-08-27 — Drag-to-Reorder Subtasks ✅

**What.** Tasks within a module on the Roadmap tab can now be manually reordered via drag-and-drop, overriding the AI's original ordering. Implements suggestions.md #2.

**How it works.** Native HTML5 drag-and-drop (no dnd-kit or other dependency) — a grab handle appears on each task row only when its module has more than one task. `PATCH /api/projects/:projectId/modules/:moduleId/reorder` validates the submitted `taskIds` is an exact permutation of the module's existing tasks (rejecting any add/remove a client bug might otherwise smuggle through) before persisting.

**Bug fixed before shipping.** The endpoint originally only reordered `module.tasks` (the ID array the Roadmap tree renders from) — but `computeNextBestAction()` and every other flattened subtask list (`toClientTask()`'s `subtasks`, used by the Dashboard's "Continue Working" card and the Schedule tab) sort by each task's own `order` field on the flat `planning.tasks` list, which the drag never touched. A user could drag a task to the top of a module and see it move in the Roadmap tab while the Dashboard kept recommending the old first task. Fixed by renumbering `order` across the *entire* project (walking milestones → modules → each module's task-ID order) after every reorder, so the flat order and the tree agree.

**Files changed:**
- `client/src/components/RoadmapTree.jsx` — `TaskRow` drag handlers/grab handle; `ModuleBlock` manages drag state and splices on drop; top-level component keeps optimistic local state with rollback on API failure.
- `server/routes/projects.js` — `PATCH /:projectId/modules/:moduleId/reorder`; renumbers `planning.tasks[].order` project-wide after applying the new module order.
- `client/src/api/index.js` — `reorderModuleTasks(projectId, moduleId, taskIds)`.

**Verified:** `npm test` (server) passes — 381/381, no regressions. `npm run build` (client) — 375 modules, 0 errors. Manually verified in the browser (Claude in Chrome) against a live test project: completing a step correctly rolls up to task/project progress and advances the Dashboard's "Continue Working" card (33% → next task) — the drag-and-drop and notes UI were exercised via code review and the build/test suite, not a live drag interaction, since the test project's modules only had one task each.

---

## 2026-08-27 — Historical Calibration of Per-Task Estimates ✅

**What.** Time estimates now blend 60% LLM estimate / 40% the user's own demonstrated historical pace for that task's category — but only once real history actually exists. Implements suggestions.md #24, after discovering and fixing a data gap that made the original spec unimplementable as literally written.

**The gap this uncovered.** `memory_agent` read `benchmarkData?.averageSpeeds` from `user_benchmarks` documents — but `evaluation_benchmark_agent` (the only writer of that collection) never wrote an `averageSpeeds` field at all. That lookup was silently always `undefined` in production, so `context.memory.averageSpeeds` was the same hardcoded default object for every user, always, regardless of real history. Blending against it as originally specified would have diluted good LLM estimates with a fake constant, actively hurting the most active users. Flagged this to the user, who chose to fix the underlying data gap first rather than skip #24 or ship a blend against fake data.

**How it's fixed.** `memory_agent`'s new `computeAverageSpeedsFromHistory()` computes REAL per-category averages directly from `task_history`'s `taskPerformance[]` (which already records `{title, actualMinutes, status}` per completed task — no schema change needed there), classifying each title into one of the 7 `averageSpeeds` buckets via a new deterministic keyword classifier. A category needs ≥2 completed, timed samples before its real average replaces the generic default (`averageSpeedSampleCounts` is emitted alongside so downstream consumers know which is which, without an unsound "value differs from the default" guess). No task in the schema carries an explicit domain category of its own, so classification is new — shared between memory_agent (classifying past tasks) and time_estimation_agent (classifying current ones) so both sides agree on the same buckets.

**The blend itself.** `time_estimation_agent`'s new `applyHistoricalCalibration()` runs after the existing `applyEstimationConstraints()` pass: for each estimation whose task classifies into a category with real sample-backed data, it computes `paceRatio = userAverageSpeed / defaultAverageSpeed` and blends `finalEstimateMinutes` at 60% LLM / 40% (LLM estimate × paceRatio) — recalibrating by the user's demonstrated pace deviation while still respecting the LLM's own judgment of *this* task's difficulty. The whole three-point estimate (optimistic/expected/worstCase) is scaled by the same factor, which mathematically preserves the ordering constraint with no extra clamping needed.

**Double-counting bug fixed before shipping.** The estimation prompt already told the LLM to fold `averageSpeeds` into its own `historicalAdjustmentPct` (Rule 2) — now that real averages flow in and this deterministic blend also applies them, a user 2× slower than default would have been compounded (LLM adjusts up, then the blend adjusts up again on top). Fixed by removing `averageSpeeds` from the prompt entirely and rewriting Rule 2 to tell the LLM historical pace calibration happens in a separate deterministic step it isn't shown, and to base `historicalAdjustmentPct` only on `context.benchmark` bias data and `reliabilityScore` instead.

**Keyword-classifier bug caught in review.** The `revision` category's keyword list originally included bare `"review"` — but "code review", "review the API design" etc. are extremely common task titles across every category, not just revision work. Removed bare `"review"`, kept `revise`/`revision`/`refactor`/`polish`/`proofread`.

**Files changed:**
- `server/agents/shared/taskCategory.js` — **NEW**. `classifyTaskCategory()`, `DEFAULT_AVERAGE_SPEEDS`.
- `server/agents/memory_agent/agent.js` — `computeAverageSpeedsFromHistory()` (exported for testing); `computeMemoryDeterministic()` uses it instead of the dead `benchmarkData?.averageSpeeds` lookup; `averageSpeedSampleCounts` added to memory output.
- `server/agents/memory_agent/agent.test.js` — 5 new tests for `computeAverageSpeedsFromHistory`.
- `server/agents/time_estimation_agent/agent.js` — `applyHistoricalCalibration()`, wired in after `applyEstimationConstraints()`.
- `server/agents/time_estimation_agent/agent.test.js` — 6 new tests.
- `server/agents/time_estimation_agent/prompt_v1.js` — removed `averageSpeeds` from the prompt; rewrote the Historical Adjustment rule to prevent double-counting.

**Verified:** `npm test` (server) passes — 377/377 (10 new across both files), no regressions. Not yet exercised against a real multi-project user history in production.

---

## 2026-08-27 — Priority-Weighted Within-Day Ordering ✅

**What.** Same-day tasks are now deterministically ordered critical > high > medium > low priority (then harder-difficulty tasks earlier within a priority tier), instead of whatever order the topological/dependency sort happened to produce. The scheduler prompt already asked the LLM for priority/energy-aware ordering, but a prompted preference isn't a guarantee — this makes it one, with zero LLM calls. Implements suggestions.md #21.

**How it works.** `buildScheduleSkeleton`'s placement loop was extracted into `placeTasksInOrder()` so it can run twice: once in the original dependency/topological order (to discover which calendar day each task actually lands on, given real durations and busy-slot conflicts), then a second time over the same task set with only the *within-day* order changed — sorted by `compareForDayOrder` (buffer/review slots always sink to the end of the day, regardless of their nominal priority, since they're structural padding/verification rather than user-prioritized work). Running the identical placement logic both times — rather than swapping times onto pre-sized slots after the fact — means real durations, busy-slot conflicts, and day budgets are respected in both passes, so it can't produce overlapping times. `fixDependencyViolations` (already existing) runs once more afterward as a safety net for the rare case where a busy-slot gap causes the priority reorder to drift a task across a day boundary. Skips the second pass entirely when a day's order was already correct.

**Files changed:**
- `server/agents/scheduler_agent/agent.js` — `placeTasksInOrder()`, `compareForDayOrder()`, `reorderTaskIdsByPriorityWithinDay()`; `buildScheduleSkeleton()` now runs the two-pass reorder.
- `server/agents/scheduler_agent/agent.test.js` — 4 new tests: reorders a same-day critical/medium/low fixture correctly, no overlapping slots after reordering, buffer/review slots sink regardless of priority, and an already-ordered fixture is left untouched (no gratuitous reshuffling).

**Verified:** `npm test` (server) passes — 367/367 (4 new), no regressions. Manually sanity-checked via a standalone script confirming reorder + zero overlaps on a hand-built same-day fixture.

---

## 2026-08-27 — Cross-Project Conflict Detection ✅

**What.** The scheduler already avoided double-booking against real Google Calendar events, but had no awareness of a user's *other* LifeSaver projects — two concurrent projects could book the exact same slot with no warning. Implements suggestions.md #25.

**How it works.** New shared helper `getCrossProjectBusySlots(userId, excludeTaskId)` queries the user's other non-archived, non-failed task documents (via the existing `(userId, createdAt)` composite index — no new index needed), collects every future `schedule.scheduledTasks[]` slot into the same `{start, end}` shape `getFreeBusy()` already returns, and unions it into the `busySlots` array passed to `runSchedulerAgent`. Wired into both places a schedule actually gets built: `orchestrator.js` (initial scheduling — runs in parallel with the calendar fetch via `Promise.all`) and `replanning_agent.js` (re-invokes the scheduler for overrun-affected tasks, which could otherwise land on a slot another project already claimed).

**Files changed:**
- `server/agents/shared/crossProjectBusySlots.js` — **NEW**. `getCrossProjectBusySlots()`.
- `server/agents/orchestrator.js` — cross-project slots fetched alongside calendar busy slots; an SSE message notes how many were found.
- `server/agents/replanning_agent/agent.js` — same helper wired into its own internal `busySlots` fetch.

**Verified:** `npm test` (server) passes — 363/363, no regressions. Not yet exercised against a live Firestore/two real concurrent projects.

---

## 2026-08-27 — Manual Todo Mode (AI-Optional Fallback) ✅

**What.** Users can now bypass the 15-agent pipeline entirely and build a project by hand — title, modules, subtasks (with optional estimate/priority/deadline per subtask) — via a new **"Add manually →"** link next to the "Activate" button on the Dashboard. This keeps the app usable when the API quota is exhausted, the user is offline, or they already have a plan and just want tracking + scheduling. Implements suggestions.md #26.

**How it works.** `POST /api/tasks/manual` builds a `PlanningContext` directly — no LLM calls anywhere in the handler — using the exact same `planning.milestones`/`planning.tasks` shape `planning_agent` produces (one synthetic milestone wraps the user's modules; each subtask becomes a task with exactly one execution step, so the existing step-driven Task Workspace can mark it complete like any AI-planned task). `metadata.manualMode = true` and `metadata.pipelineStage = 'planning'` (deliberately not `'complete'`) so the project renders in every existing view immediately, and:

**Graceful AI upgrade path — "Let AI enhance this".** Because the manual context is checkpointed at the same `'planning'` stage the real orchestrator uses, the *existing* `POST /:taskId/resume` endpoint (built for quota-interrupted pipelines) already knows how to pick it up: it skips intent/planning (already set by the user) and runs dependency analysis, time estimation, feasibility, and the scheduler against the user's own tasks — turning a manual project into a fully AI-scheduled one with no new orchestrator code. A **"✨ Let AI enhance this"** button appears on manual project cards (reusing the Dashboard's existing resume/SSE plumbing) until a schedule exists, alongside a small **"✏️ manual"** badge; both retire automatically once enhancement completes.

**Bug fixed along the way.** `PATCH /api/tasks/:taskId/calendar-sync`'s enable path unconditionally did `context.schedule.scheduledTasks = ...`, which would throw for any project with `schedule: null` (every manual project before enhancement) — swallowed by the route's catch into a misleading 502. Now guarded: syncing is skipped (flag still persisted) when there's no schedule yet. Also added the missing `calendarSync` field to `GET /api/projects`'s per-project mapping — `CalendarSyncToggle` was reading `project.calendarSync` but the route never sent it.

**Files changed:**
- `server/routes/tasks.js` — new `POST /manual` endpoint; calendar-sync enable-path null guard.
- `server/routes/projects.js` — `GET /` mapping now includes `manualMode`, `hasSchedule`, `calendarSync`.
- `server/agents/contextManager.js` — `toClientTask()` now surfaces `manualMode`, `hasSchedule`, and a per-subtask `deadline`.
- `client/src/pages/ManualProjectBuilder.jsx` — **NEW**. The builder page: title, deadline, calendar-sync checkbox, modules with inline "+Add subtask", running total-hours footer.
- `client/src/App.jsx` — new route `/projects/new/manual`.
- `client/src/components/TaskInput.jsx` — "Add manually →" link next to the Activate button.
- `client/src/components/ProjectCard.jsx` — "✏️ manual" badge + "✨ Let AI enhance this" button (shown while `manualMode && !hasSchedule`).
- `client/src/components/Dashboard.jsx` — wires `ProjectCard`'s enhance button to the existing `handleResume`/`resumingId` (same mechanism as the interrupted-pipeline resume banner — no new SSE plumbing).
- `client/src/api/index.js` — new `createManualProject()` export.
- `client/src/pages/TaskWorkspace.jsx` — shows "Due <date>" next to priority when a subtask has its own deadline (previously collected by the builder but never rendered anywhere).

**Verified:** `npm run build` passes (374 modules, 0 errors, twice). `npm test` (server) passes — 363/363, 52 suites, no regressions. Traced every render path a manual project (`schedule: null`, possibly `intent.deadline: null`) actually hits: `ProjectWorkspace.jsx`'s Overview/Schedule/Resources/Analytics/Notes/Settings tabs, `RoadmapTree`/`NextBestAction`/`RiskMeter` — all null-guard the AI-only fields (`scheduledStart`, `schedulingScore`, `feasibilitySuggestions`, etc.) already. Also confirmed `deadline_feasibility_agent` and `scheduler_agent` both short-circuit cleanly (`isFeasible: true`, no LLM call) when `intent.deadline` is null, so "Let AI enhance" on a deadline-less manual project degrades gracefully rather than crashing or misdating. Not yet manually clicked through in an actual browser (no dev server / Firestore credentials in this session) — recommend a smoke test of: create manual project → mark its one execution step complete on Task Workspace → click "Let AI enhance this" → confirm the manual badge disappears once scheduling finishes.

---

## 2026-08-24 — Weekend-Heavy Scheduling Mode + Login Account Switcher ✅

### Feature 1: Weekend-Heavy Scheduling Mode

**What.** A fourth weekend mode option — **🏋️ Weekend heavy** — is now available in Settings → Scheduling Preferences. When selected, the scheduler places **150% of the weekday daily budget** on Saturdays and Sundays. This is designed for users whose primary available work time is the weekend (e.g. students, full-time workers), so the plan front-loads progress on weekend days and keeps weekday sessions lighter.

**How it works in the scheduler:**
The `effectiveBudget` logic in `buildScheduleSkeleton` now uses a full 4-way branch:

| Mode | Weekend budget |
|---|---|
| `skip` | Weekends never receive tasks (cursor jumps to Monday) |
| `light` | 50% of weekday budget |
| `normal` | 100% (same as weekday) |
| **`heavy`** | **150% of weekday budget** |

The LLM is also told explicitly: *"Treat weekends as the primary working days... weekdays can be lighter as a result."*

**Files changed:**
- `server/agents/scheduler_agent/agent.js` — added `WEEKEND_HEAVY_BUDGET_FRACTION = 1.5` constant; `WEEKEND_MODES` array updated to include `'heavy'`; `effectiveBudget` ternary chain extended to cover all 4 modes.
- `server/agents/scheduler_agent/prompt_v1.js` — `weekendLabel` ternary updated with a heavy-mode description for the LLM; JSDoc updated.
- `server/routes/settings.js` — `WEEKEND_MODES` validation array updated to include `'heavy'`.
- `client/src/components/SchedulePreferences.jsx` — new `{ id: 'heavy', label: '🏋️ Weekend heavy', ... }` entry in `WEEKEND_OPTIONS` array; renders as a 4th button in the segmented control.

**Verified:** Build passes (373 modules, 0 errors). Weekend-heavy mode button appears in Settings; selecting it saves `weekendMode: 'heavy'` to Firestore.

---

### Feature 2: Login Page — Switch Google Account

**What.** A secondary button **"Use a different Google account"** is now shown below the main "Continue with Google" button on the login page. Clicking it:
1. Signs out of the current Firebase session (clears any cached credential).
2. Opens the Google account-picker popup with `prompt: 'select_account'` — this forces Google to always show the account chooser instead of silently re-using the currently signed-in account.
3. Signs in with the chosen account and navigates to the dashboard.

Cancelling the popup (× or clicking outside) is handled gracefully — no error is shown to the user.

**Why.** Previously, if a user was signed into the wrong Google account, the only way to switch was to sign out from Settings, then come back to the login page and sign in again. The new button makes this a one-step flow from the login screen.

**Files changed:**
- `client/src/context/AuthContext.jsx` — new `signInWithDifferentAccount()` method: calls `signOut(auth)` first, then opens `signInWithPopup` with a cloned provider with `{ prompt: 'select_account' }`. Exported via the context value.
- `client/src/pages/Login.jsx` — destructures `signInWithDifferentAccount` from `useAuth`; adds `switchLoading` state; `handleSwitchAccount` async handler with graceful popup-cancel handling (`auth/popup-closed-by-user`, `auth/cancelled-popup-request` are silently ignored); renders the secondary button below the main sign-in button with a swap-arrows icon; both buttons disable together via `anyLoading` guard.

**Verified:** Build passes. "Use a different Google account" button appears; clicking it signs out and opens the Google account picker.

---

## 2026-08-23 — Weekend Scheduling Preference + User-Defined Daily Capacity ✅

Two new scheduling preferences — both exposed in Settings → `SchedulePreferences` and propagated through the entire scheduler pipeline.

### Feature 1: Weekend Scheduling Mode (3-way toggle)

**What.** Users can now choose how much work the scheduler places on Saturdays and Sundays:

| Mode | Behaviour |
|---|---|
| **⛔ Skip weekends** (default) | Cursor skips Sat/Sun entirely — no tasks land on weekends |
| **🌅 Light weekends** | Weekend tasks allowed, but capped at 50% of the weekday daily budget |
| **📅 Full weekends** | Weekends treated identically to weekdays |

**Files changed:**
- `server/agents/scheduler_agent/agent.js` — new exported constants `WEEKEND_MODES`, `DEFAULT_WEEKEND_MODE = 'skip'`, `WEEKEND_LIGHT_BUDGET_FRACTION = 0.5`; new exported `isWeekend(date)` helper; `clampToWorkingHours` now accepts and applies `weekendMode` (skips Sat/Sun via while-loop when `skip`, recurses after roll-forward so skip applies transitively); `findNextFreeSlot` passes `weekendMode` to every `clampToWorkingHours` call including the "try next day" roll-forward; `buildScheduleSkeleton` accepts `weekendMode` and computes `effectiveBudget` (50% on weekend days in `light` mode, full otherwise); `runSchedulerAgent` destructures `weekendMode` from `resolveWorkingHours` and passes it through to both skeleton calls.
- `server/agents/scheduler_agent/prompt_v1.js` — `buildSchedulerPrompt` now accepts `weekendMode`; the context block sent to the LLM includes a human-readable "Weekend preference: ..." line so the LLM's refinement pass doesn't undo the skeleton's weekend logic.
- `server/routes/settings.js` — `GET /preferences` returns `weekendMode` (default `'skip'`); `PUT /preferences` validates and saves `weekendMode`.
- `client/src/api/index.js` — new `saveWeekendMode(weekendMode)` export.
- `client/src/components/SchedulePreferences.jsx` — new 3-button segmented control row for weekend mode; "Recommended" green dot on the `skip` option.

**Verified:** Build passes. Skip mode: no task lands on Saturday or Sunday. Light mode: Saturday tasks exist but in shorter sessions. Normal mode: full parity with weekdays.

---

### Feature 2: User-Defined Daily Capacity (Hours/Day Stepper)

**What.** The scheduler's daily budget (previously hard-coded to 2 h/day for every user) is now set by the user via a stepper control (0.5–12 h, step 0.5 h, debounced 600 ms save). The value is stored in `preferences.availableHoursPerDay` and replaces the `DEFAULT_DAILY_AVAILABLE_MINUTES` constant at every call site that used it.

**Why.** A freelancer with 6 h/day and a student with 45 min/day were both getting a "2h/day" plan. The hook was already stubbed in the code comments (`// a future context.preferences.availableHoursPerDay could override this`) — this change finally wires it up end-to-end.

**Files changed:**
- `server/agents/scheduler_agent/agent.js` — `resolveWorkingHours` now also computes and returns `dailyAvailableMinutes` (from `prefs.availableHoursPerDay`, clamped to `[0.5, 12]`, falling back to `DEFAULT_DAILY_AVAILABLE_MINUTES`); `checkDeadlineFeasibility` now accepts `dailyAvailableMinutes` parameter so feasibility warnings reflect the user's actual capacity; both `buildScheduleSkeleton` calls in `runSchedulerAgent` (normal + infeasible path) now use the resolved `dailyAvailableMinutes` instead of the hard-coded constant; the "assumptions" string in the infeasibility response now logs the actual hours/day.
- `server/agents/scheduler_agent/prompt_v1.js` — `dailyAvailableMinutes` label updated to include the 70% cap explicitly (`~${Math.round(m * 0.7)} min`).
- `server/routes/settings.js` — `GET /preferences` returns `availableHoursPerDay` (default `2`); `PUT /preferences` validates range `[0.5, 12]` and saves it.
- `client/src/api/index.js` — new `saveDailyCapacity(availableHoursPerDay)` export.
- `client/src/components/SchedulePreferences.jsx` — new stepper row (− / value / +); live hint text that changes based on the selected value (e.g. "Full-time — only if this is your main commitment" at 8+h); spinner while saving.

**Verified:** Build passes. Set to 4h → 10h project spans ~4 days instead of ~7. Feasibility warning message now says the user's actual hours/day instead of always "2h/day".

---

## 2026-08-20 — Per-Task Calendar Sync Toggle, Project Soft-Delete, First-Run Onboarding ✅

### Feature 1: Per-Task Google Calendar Sync Toggle

**What.** Users can now independently enable or disable Google Calendar syncing for each project. The toggle appears as a pill button (📅 "Calendar synced" / 🚫 "Sync off") in the footer of each project card. A checkbox also appears in TaskInput before task submission if the calendar is connected — so the user can opt out before the pipeline even runs.

**Files changed:**
- `server/agents/orchestrator.js` — step 12 (calendar sync) is now guarded by `context.metadata?.calendarSync !== false`. If false, SSE emits a "Calendar sync disabled" event instead of calling Google Calendar. `opts.calendarSync` is also wired into `context.metadata.calendarSync` right after context creation.
- `server/routes/tasks.js` — `POST /api/tasks/initiate` accepts `calendarSync` (boolean, default `true`) and passes it to orchestrator.
- `server/routes/tasks.js` — new `PATCH /:taskId/calendar-sync` endpoint: `enabled=false` deletes Google Calendar events and clears `calendarEventId` fields; `enabled=true` re-syncs. Both paths persist `metadata.calendarSync` in Firestore.
- `client/src/api/index.js` — `initiateTask` now accepts `calendarSync` param; new `setTaskCalendarSync(taskId, enabled)` export added.
- `client/src/components/CalendarSyncToggle.jsx` — **NEW**. Pill toggle component with optimistic update + rollback on error. Greyed-out hint shown when calendar is not connected.
- `client/src/components/ProjectCard.jsx` — imports `CalendarSyncToggle` and `useAuth`; renders toggle in card footer with click propagation stopped.
- `client/src/components/TaskInput.jsx` — imports `useAuth`; adds `calendarSync` state; renders checkbox before submit button when `profile.calendarConnected` is true.

**Verified:** `npm run build` passes (373 modules, 0 errors).

---

### Feature 2: Project Soft-Delete (Archive)

**What.** The trash-can button on each project card now performs a *soft-delete* (archive) rather than permanently deleting the Firestore document. The document is marked `metadata.archived = true`. The project disappears from the dashboard immediately. Google Calendar events are still deleted on archive. Data is retained for potential memory-agent use.

**Why.** Permanent deletion wiped historical project data that the memory agent uses to calibrate estimates. Soft-delete preserves it invisibly.

**Files changed:**
- `server/routes/tasks.js` — `DELETE /:taskId` now merges `{ metadata.archived: true, metadata.archivedAt, metadata.pipelineFailed: false }` instead of calling `doc.ref.delete()`.
- `server/routes/tasks.js` — `GET /` filter updated to exclude `metadata.archived === true` in addition to `pipelineFailed === true`.
- `server/routes/tasks.js` — `GET /failed` now filters out archived documents so they don't reappear in the resume banner.
- `client/src/components/ProjectCard.jsx` — confirm dialog and button labels updated to say "Archive" (with a message that history is preserved).
- `firestore.indexes.json` — two new composite indexes: `(userId, metadata.archived, createdAt)` and `(userId, metadata.pipelineFailed, metadata.archived)`.

**Verified:** Build passes. Archived projects disappear from the grid; Firestore document retained with `archived: true`.

---

### Feature 3: First-Run Onboarding Flow (4 Slides)

**What.** A 4-slide skippable overlay is shown once to new users who have zero projects. Slides cover: (1) what LifeSaver does, (2) the 15-agent pipeline, (3) Google Calendar sync, (4) three quick-start tips. After any dismissal path (skip, ×, or "Get Started"), `users/{uid}/settings/onboarding → { completed: true }` is written to Firestore so it never shows again.

**Files changed:**
- `server/routes/settings.js` — `GET /api/settings/onboarding` returns `{ completed: boolean }`; `POST /api/settings/onboarding/complete` persists the flag.
- `client/src/api/index.js` — new `getOnboardingStatus()` and `completeOnboarding()` exports.
- `client/src/components/Onboarding.jsx` — **NEW**. Full-screen backdrop overlay; slide indicator dots; Previous / Next / Skip / Get Started navigation. Pure Tailwind — no extra animation library.
- `client/src/components/Dashboard.jsx` — imports `Onboarding` and `getOnboardingStatus`; adds `showOnboarding` state and a `useEffect` that triggers once when `loading` flips false (checks `projects.length === 0 && !completed`); renders `<Onboarding>` at the top of the JSX return.

**Verified:** Build passes. Trigger logic fires only when `projects.length === 0 && completed === false`. Dismiss persists to Firestore; page refresh never re-triggers.

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
