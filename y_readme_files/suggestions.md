# 💡 Suggestions

A curated list of feature ideas worth considering. Each entry notes *why* it would add value and a rough effort estimate. Not prioritised — pick what resonates.

---

## 🆕 Manual Todo Mode (AI-Optional Fallback)

### 26. Manual Project Builder

**The idea.**
Let the user bypass the 15-agent pipeline entirely and create a project by hand — typing milestones, subtasks, and time estimates directly. This gives the app full utility even when:
- The **API quota is exhausted** (the most pressing motivation — the app is currently unusable at that point)
- The user is offline or on a slow connection
- The user already has a plan in mind and just wants tracking + scheduling

**How it would feel.**
On the Dashboard, next to the main "Activate →" submit button, a secondary link: **"Add manually →"**. Clicking it opens a lightweight builder page (no SSE, no agents) with:

1. **Project title** — free-text field.
2. **Modules / milestones** — user adds 1–N named modules with "+Add module".
3. **Subtasks per module** — each module has an inline "+Add subtask" input. Each subtask gets: `title`, `estimatedMinutes` (optional), `priority` (low/medium/high/critical), `deadline` (optional).
4. **Running total** — a footer line shows "Total estimated: X hours" as subtasks are added, so the user knows the scope before saving.
5. **Calendar sync toggle** — same pill as the AI flow; push to Google Calendar if connected.
6. **Save → Dashboard** — creates the Firestore task document in the same schema as the AI pipeline (`planning.tasks`, `metadata.pipelineStage = 'complete'`, `metadata.manualMode = true`). No AI schedule is generated initially.

**Why the same schema matters.**
Because Project Workspace, Task Workspace, Progress Tracker, CalendarSyncToggle, and archive all read from that schema, a manually-created project works in every existing view with zero extra code.

**Graceful AI upgrade path.**
Once the API quota resets, the user presses **"Let AI enhance this"** on the project detail page. This re-runs only the agents that haven't produced output yet (estimation, scheduler, feasibility) against the existing `planning.tasks` — turning a manual project into a fully AI-managed one. The orchestrator's checkpoint/resume logic already supports this pattern.

**Visual distinction.**
A small "✏️ manual" badge on the project card, so the user remembers AI scheduling hasn't been applied yet.

**Effort:** Medium — new route `/projects/new/manual`, a form component `ManualProjectBuilder.jsx`, and a `POST /api/tasks/manual` endpoint that skips the orchestrator and writes directly to Firestore. The hardest part is the builder UX, not the backend.

---

## 🆕 Scheduler Improvements — Expanded Detail

The 7 scheduler improvements listed as items 19–25 are worth deeper explanation because several are already partially plumbed in the codebase. Ordered by implementation difficulty (easiest first).

---

### 19. User-Defined Daily Capacity — Lowest Hanging Fruit

**Current state.**
`DEFAULT_DAILY_AVAILABLE_MINUTES = 120` is hardcoded in `scheduler_agent/agent.js` line 49. The code comment on lines 42–48 explicitly says *"a future `context.preferences.availableHoursPerDay` could override this"* — the hook is designed and documented, just not exposed yet.

**What to add:**
- A "How many hours/day can you work on this?" stepper (1–8h) in TaskInput (beside the deadline picker) or in Settings → Scheduling Preferences.
- Send it to the server → store in `context.preferences.availableHoursPerDay` → `resolveWorkingHours()` returns it → `buildScheduleSkeleton()` uses it instead of the constant.

**Impact:** The single most impactful scheduler change. A freelancer with 6h/day and a student with 45 min/day both currently get an identical "2h/day" plan. This makes scheduling personal.

---

### 20. Weekend Awareness

**Current state.**
`findNextFreeSlot` and `buildScheduleSkeleton` advance day-by-day with no concept of Saturday/Sunday. Tasks silently fall on weekends.

**What to add:**
- A `skipWeekends` boolean in `context.preferences` (default `true`).
- In `clampToWorkingHours()`: if `date.getDay() === 0 || date.getDay() === 6`, advance to Monday at `workStartHour`.
- A Settings toggle: "🗓 Skip weekends" (on by default; users who work weekends turn it off).

**Impact:** Most users are surprised to see "Saturday 10 AM — Write implementation" in their plan. Weekend awareness is a baseline expectation of any scheduling tool.

---

### 21. Priority-Weighted Within-Day Ordering

**Current state.**
The skeleton places tasks in topological order across days. Within a single day they appear in topo-sort order — ignoring priority and `memory.optimalWorkHours`. The LLM prompt already asks for this (Rule 5) but the model sometimes ignores it.

**What to add.**
A deterministic sort comparator on same-day tasks, applied *after* slot assignment in `buildScheduleSkeleton` and *before* passing the skeleton to the LLM:

```
Sort by: critical > high > medium > low priority,
         then by energyLevel matching optimalWorkHours early in the day.
```

Zero LLM calls — just `Array.sort`. The LLM still sees a priority-ordered skeleton and is nudged to preserve it.

**Impact:** Putting the hardest task at 9 AM instead of 4 PM is the most impactful productivity principle. This makes it guaranteed rather than luck-of-the-LLM.

---

### 22. Carry-Forward Rescheduling (Rolling Start Date)

**Current state.**
If a user ignores their project for 3 days, all early scheduled slots are in the past. The calendar shows missed events; the app shows nothing is wrong. The schedule becomes increasingly fictional.

**What to add.**
A check on project load (or a daily cron): if `>= N` non-completed scheduled tasks have `startTime` in the past, show a banner: **"3 tasks were missed — reschedule from today?"**. On confirm, shift the entire schedule forward from `now`, preserving relative order and the original deadline.

**Design choice:** prompted (not silent) — the user explicitly confirms so they aren't surprised by a changed plan.

**Impact:** Makes the schedule a living document rather than a one-time snapshot. Without this, users who fall behind get a plan that's detached from reality, which leads to ignoring the app entirely.

---

### 23. Intelligent Mid-Project Buffer Placement

**Current state.**
Buffer is reserved as a percentage of total time, but placement is entirely left to the LLM. In practice the LLM puts all buffer at the end ("polish / review time"), leaving zero slack in the middle where most slippages actually happen.

**What to add.**
In `buildScheduleSkeleton`, after every N implementation tasks (e.g. every 3rd non-buffer task, or at each module boundary), inject one buffer slot sized at 15–20% of the preceding task's `adjustedDuration`. Mark it `isBuffer: true`. The LLM prompt already says "preserve buffers" — this gives it concrete mid-project buffer positions to preserve rather than inventing its own.

**Impact:** A slip in task 3 of 10 currently has no slack. Mid-project buffers create natural "catch-up" windows and reduce the probability of deadline overruns cascading to the end.

---

### 24. Historical Calibration of Per-Task Estimates

**Current state.**
`memory.averageSpeeds` (e.g. `{ coding: 30, writing: 45, research: 60 }` — minutes per unit) is computed by the memory agent and already injected into the scheduler prompt. But **the time estimation agent never reads it**. Every user gets the same estimate for "write a 1000-word section" regardless of how long it actually took them before.

**What to add.**
A blend step at the end of `time_estimation_agent/agent.js`:

```
if memory.averageSpeeds[task.category] exists:
    historicalMinutes = speed × task.estimatedUnits
    finalEstimateMinutes = 0.6 × llmEstimate + 0.4 × historicalMinutes
```

Blend weights (60/40) exposed as a tunable constant. Over many projects, estimates converge to the user's actual pace.

**Impact:** This is what makes AI scheduling truly *personal*. Without it every user gets a generic estimate; with it the system learns that *you* take 90 min to write what the default says takes 30.

---

### 25. Cross-Project Conflict Detection

**Current state.**
The scheduler fetches Google Calendar busy slots to avoid double-booking external events. But it does not read other LifeSaver projects' `scheduledTasks`. Two concurrent LifeSaver projects can book the exact same calendar slot with no warning.

**What to add.**
Before calling `buildScheduleSkeleton` in the orchestrator, query Firestore for all the user's other active (`status !== 'completed' && archived !== true`) task documents and union their `schedule.scheduledTasks` into the `busySlots` array. The scheduler then treats other LifeSaver projects as opaque busy blocks.

**Impact:** Without this, a user running two projects simultaneously discovers impossible double-bookings only when they try to follow the plan. This is a correctness fix, not just a quality improvement.

---

## UX & Workflow

### 1. Task Templates
Save a completed project structure as a reusable template (e.g. "Launch a side project", "Write a research paper"). On the next submission the user picks a template and the AI pre-fills milestones/modules rather than starting cold.
**Effort:** Medium — needs a `templates` Firestore collection + a "Save as template" button in the Project Workspace.

---

### 2. Drag-to-Reorder Subtasks
Let users manually drag subtasks within a module to change their execution order. Right now the AI decides the order and the user cannot override without re-submitting. A `@dnd-kit` integration covers this without touching the server.
**Effort:** Medium — pure client change; treat reorder as a UI-only sort index persisted in the task document.

---

### 3. Dark / Light Theme Toggle
The UI is dark-only. A light-mode or auto-OS-preference toggle would widen the audience and make the app usable in bright environments.
**Effort:** Low-Medium — CSS custom properties already drive most colours; swapping a root class is enough.

---

### 4. Markdown Notes on Tasks
Attach a free-text markdown note to any subtask or execution step (separate from `completionEvidence`). Rendered inline with a minimal renderer. Useful for links, code snippets, or personal context the AI did not capture.
**Effort:** Low — `notes` already exists in the step schema; just needs a proper editor and renderer in the Task Workspace.

---

### 5. Task Time Tracker (Pomodoro-style)
A built-in timer in Focus Mode / Task Workspace. Counts up against `estimatedMinutes` for the active subtask and writes `actualMinutes` on stop. That field is already in the schema but has to be entered manually today.
**Effort:** Medium — pure client feature (timer state), writes to existing `actualMinutes` via the existing PATCH endpoint.

---

### 6. Quick-Add Subtask
A one-line text input inside each module card to append a new subtask without triggering the full AI pipeline. For when the user notices a step the AI missed.
**Effort:** Low — new `POST /api/projects/:projectId/tasks` endpoint + small UI input.

---

### 7. Project Archive (Soft-Delete)
Instead of permanent deletion, an "Archive" action hides the project from the active grid but keeps it in Firestore, searchable from an Archive view. Prevents accidental data loss and preserves memory-agent training material.
**Effort:** Low — `archived: true` flag in metadata + filter adjustment in the project list query. (This overlaps with the planned soft-delete for the calendar-toggle feature — can be implemented together.)

---

## AI & Intelligence

### 8. Progress-Aware Re-estimation
When a subtask is marked complete, compare `actualMinutes` to `estimatedMinutes` and nudge remaining subtask estimates accordingly. Over many projects the system calibrates to the user's actual pace.
**Effort:** Medium-High — extends the replanning agent to factor in `actualMinutes` history from `context.memory`.

---

### 9. Natural-Language Deadline Parser (Surfaced in UI)
Users can already write "by next Friday" in the task description and the parser agent handles it. Making this visible and explicit ("Type a deadline naturally, e.g. 'in 3 days'") with example hints in the TaskInput would make it discoverable.
**Effort:** Low — UI copy and example hints only; the parser already handles it.

---

### 10. AI Task Health Suggestions (Passive)
When a project's risk score exceeds 70, surface a one-sentence contextual suggestion inline on the project card ("4 subtasks overdue — consider splitting the scope or extending the deadline") without requiring the user to manually request a replan.
**Effort:** Medium — a lightweight rule in the progress-tracking agent + a hint component on ProjectCard.

---

### 11. Subtask Dependency Visualizer
An interactive directed graph (React Flow or a canvas-based renderer) showing which subtasks block others. The dependency data is already in `context.dependency`; it just has no visual representation.
**Effort:** Medium — pure client feature using existing data.

---

## Collaboration & Sharing

### 12. Read-Only Share Link
Generate a public, token-protected URL for a project that renders a read-only roadmap and progress view. Useful for sharing status with a manager or client without granting edit access.
**Effort:** Medium — new `shareToken` field on the task document + a public-facing route bypassing `requireAuth`.

---

### 13. Export to PDF / Markdown
One-click export of a project's full plan (milestones → subtasks → resources) to a formatted PDF or a plain Markdown file. Good for offline reference.
**Effort:** Low-Medium — client-side with `jsPDF` or a Markdown stringifier; no server changes needed.

---

### 14. Team Workspaces (Multi-user)
Multiple users sharing a project with role-based access (owner / editor / viewer). Real-time shared progress. A significant architectural change but the feature that would make the app competitive with Linear or Notion.
**Effort:** High — Firestore rules overhaul, `members` sub-collection, real-time listeners.

---

## Reliability & Power-User

### 15. Offline Mode / PWA
Cache the project list and last-viewed Task Workspace with a service worker so the app is usable read-only without internet. Push to home screen as a PWA.
**Effort:** Medium — standard `vite-plugin-pwa` configuration.

---

### 16. Keyboard Shortcuts
A shortcuts overlay (trigger: `?`) for common actions: submit task, open focus mode, mark step complete, navigate between milestones. Expected by power users.
**Effort:** Low — a `useKeyboard` hook + a shortcut-listing modal.

---

### 17. Activity Feed / Audit Log
Per-project timeline: "Step X marked complete at 14:23", "Deadline extended from Aug 5 to Aug 12", "Replanned — 3 subtasks rescheduled". Useful for retrospectives.
**Effort:** Medium — append to a `changes[]` array in the task document on every mutation; render chronologically.

---

### 18. Notification / Reminder System
Browser push notifications or email reminders for upcoming deadlines or overdue subtasks. Uses the existing `scheduledTasks` time data as the trigger source.
**Effort:** Medium-High — background cron, notification permission flow, email integration (Resend/SendGrid).

---

## Scheduler Improvements

### 19. User-Defined Daily Capacity (Hours/Day Override)
The scheduler hard-codes `DEFAULT_DAILY_AVAILABLE_MINUTES = 120` (2 hours/day). Different users have radically different availability — a freelancer may have 6 hours, a student may have 45 minutes. Expose a "How many hours per day can you work on this?" slider in TaskInput (or Settings). The value flows into `context.preferences.availableHoursPerDay` and replaces the hard-coded constant in `buildScheduleSkeleton` and `computeAvailableMinutes`.

The comment in `agent.js` line 42–48 explicitly flags this as a planned future improvement: *"a future `context.preferences.availableHoursPerDay` could override this"*. This is the lowest-hanging fruit in the scheduler.
**Effort:** Low — the hook is already stubbed; just needs a UI control and a one-line check in `resolveWorkingHours`.

---

### 20. Weekend Awareness
`findNextFreeSlot` and `buildScheduleSkeleton` treat every day identically. A task that falls on Saturday or Sunday gets scheduled there with no special handling. Add a `skipWeekends` preference (default on) that causes `clampToWorkingHours` to advance past Saturday and Sunday entirely. Users who do work weekends can toggle it off.
**Effort:** Low-Medium — a date utility function `isWeekend(date)` + a one-line guard in `clampToWorkingHours` + a preference toggle in Settings.

---

### 21. Priority-Weighted Daily Ordering (Within-Day Sequencing)
The scheduler places tasks in topological order across days, but within a single day tasks appear in whatever order the topo-sort produces, ignoring priority and energy. A post-processing pass could sort same-day tasks by: `(critical → high → medium → low)` priority first, then `energyLevel` matching the user's known productive hours (already in `memory.optimalWorkHours`). This is a pure deterministic change in `buildScheduleSkeleton` — no LLM involved.
**Effort:** Low — a sort comparator applied after slots are assigned, before the skeleton is handed to the LLM.

---

### 22. Carry-Forward Rescheduling (Rolling Start Date)
When a user resumes work on a project after a gap (e.g. they ignored it for 3 days), the schedule's early slots are all in the past. The replanning agent already handles this case when triggered manually, but there is no automatic detection. A lightweight check on project load: if `>= N` scheduled tasks have a `startTime` in the past and `status !== completed`, silently reanchor the schedule from `now` instead of the original `createdAt`. This prevents the calendar from being cluttered with missed-slot events.
**Effort:** Medium — logic in the orchestrator or a new `reanchorSchedule()` helper in `scheduler_agent/agent.js`, triggered either on project load or on the progress-tracking cron.

---

### 23. Intelligent Buffer Placement (Not Just at the End)
Currently buffer slots are reserved as a percentage of total time, but their placement is left to the LLM. In practice the LLM tends to put all buffer at the end of the project, which means a mid-project slip has no slack to absorb it. Add a deterministic rule to `buildScheduleSkeleton`: inject one buffer slot after every N implementation tasks (e.g. every 3rd task), sized at 15–20% of the preceding task's duration. The LLM can still adjust sizes but cannot move all buffers to the end.
**Effort:** Medium — extend `buildScheduleSkeleton` with a buffer-injection step after each N tasks; update the prompt to note that mid-project buffers should be preserved.

---

### 24. Historical Calibration of Per-Task Estimates
The time estimation agent applies difficulty, complexity, and user reliability multipliers. But it does not compare its estimate against how long similar tasks actually took in past projects (stored in `context.memory.averageSpeeds`). Adding a "historical match" step: if `memory.averageSpeeds` contains a category matching this task's type (e.g. "coding", "writing", "research"), blend the AI's estimate with the historical average at a configurable weight (e.g. 60% AI, 40% historical). Over time the estimates become tighter for that user's specific workflow.
**Effort:** Medium — a new post-processing step in `time_estimation_agent/agent.js` that reads `context.memory.averageSpeeds` and adjusts `finalEstimateMinutes`.

---

### 25. Schedule Conflict Detection Against Other Projects
The free/busy slots fetched from Google Calendar already prevent double-booking against external events. But if a user has two active LifeSaver projects, their tasks can overlap in calendar time with each other (the scheduler only sees the calendar's busy blocks, not other projects' scheduled slots). A cross-project conflict check at sync time — comparing the new project's `scheduledTasks` against other live projects' `scheduledTasks` in Firestore — would flag or prevent time conflicts between projects.
**Effort:** Medium-High — a new query in the Google Calendar agent or orchestrator; requires reading all of the user's active task documents at schedule-build time.

---

*Last updated: 2026-08-18*
