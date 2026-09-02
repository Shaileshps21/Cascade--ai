# Plan: Background Pomodoro Timer, Add Module (AI + Manual), Delete Subtasks of Manually-Added Modules

Three features, planned before any code changes. Each section states current
behavior (with file/line references), the design, exact files to touch, and
how it'll be verified. Written against the repo as of commit `efd1474`
(2026-09-02).

**Revision note:** this supersedes the first draft of this plan. Two
corrections from your feedback:
1. Deletion is gated on the **module's** origin, not the task's — "only the
   manually added module's subtasks can be deleted." A quick-added subtask
   dropped into an *AI-generated* module is **not** deletable; every subtask
   inside a *manually-added* module is deletable, regardless of who typed
   that particular subtask.
2. The focus timer must survive backgrounding/tab-switching/reload, but must
   **not** survive the browser (or tab) being closed — so it uses
   `sessionStorage`, not `localStorage`.

---

## 1. Pomodoro / Focus timer keeps running across tabs, dies with the browser

### Current behavior
`FocusMode.jsx`'s `useElapsedTimer()` (`client/src/components/FocusMode.jsx:4-20`)
is a plain tick-counter: `setInterval(() => setSeconds(s => s + 1), 1000)`,
state owned by the `FocusMode` overlay component itself. Two problems:
1. **Tick-counting drifts under throttling/suspension.** Switching to
   another Chrome tab backgrounds this one; browsers throttle background-tab
   timers, and if the tab is suspended for a stretch, ticks get missed and
   that time is never recovered — the displayed total falls behind real
   elapsed time.
2. **The timer is destroyed the moment `FocusMode` unmounts** — closing the
   overlay or navigating anywhere else in the SPA clears the interval and
   discards `seconds` entirely.

### Design
**Elapsed time is computed from timestamps, never accumulated by tick:**
```js
elapsedMs = accumulatedMs + (running ? Date.now() - startedAt : 0)
```
A 1-second `setInterval` still exists purely to force a re-render of the
`mm:ss` display — it does no counting itself, so missed/throttled ticks
don't lose time. On `visibilitychange` (tab refocused), recompute
immediately instead of waiting for the next tick, so switching back from
another Chrome tab shows the correct time with no catch-up lag.

**State lives in a new app-level context**, not the `FocusMode` component,
so it survives navigating away from the overlay:

`client/src/context/FocusTimerContext.jsx` (new — follows the existing
`AuthContext.jsx`/`ThemeContext.jsx` provider pattern):
```js
{ projectId, taskId, taskTitle, stepId, stepTitle, estimatedMinutes,
  startedAt, accumulatedMs, running }
```
- `startSession(project, task, step)` — refuses to start a second session
  while one is active; the caller should surface the existing one instead
  (see Edge Cases).
- `pause()` / `resume()` — folds the current run into `accumulatedMs`, flips
  `running`.
- `completeSession()` — computes final elapsed minutes, lets the caller fire
  the existing `PATCH .../steps/:stepId` with `actualMinutes` exactly as
  today, then clears the session.
- `discardSession()` — clears without completing.

**Storage: `sessionStorage`, deliberately not `localStorage`.** This is the
part that directly implements your requirement:
- `sessionStorage` is scoped to one tab's browsing session. It survives that
  tab being backgrounded, another Chrome tab being focused instead, and even
  an in-tab page reload (F5) — all without any special-case code, because
  none of those events touch it.
- It is **automatically and reliably cleared** the moment that tab (or the
  whole browser) closes — this is a browser-native guarantee, not something
  built on `beforeunload`/`unload` listeners (which don't fire reliably on a
  real browser close, crash, or force-quit, and would be the wrong tool
  here). Using `sessionStorage` means "dies when the browser closes" is
  correct by construction, not by best-effort cleanup code.
- Net effect matches exactly what you asked: alive across tab-switching and
  backgrounding, gone once you close the browser. A reload while the tab
  stays open also keeps it — treated as a bonus, not a requirement, and
  doesn't conflict with anything you said.
- On rehydrate (context mounts and finds a `sessionStorage` entry), re-fetch
  the referenced task (`getProjectTask`) and silently drop the session if the
  step no longer exists or is already completed (e.g. finished from the Task
  Workspace directly while the timer was running elsewhere).

**Wiring (`client/src/App.jsx`):** wrap `AppLayout` in `FocusTimerProvider`
(alongside the existing `ThemeProvider`/`AuthProvider`) so the timer survives
route changes within the tab.

**`FocusMode.jsx` becomes a thin view over the context:**
- On mount, calls `startSession(...)` (no-op if this exact step is already
  the active session).
- The existing Pause/Resume button calls `pause()`/`resume()`.
- `✕ Exit` just hides the overlay — it no longer stops the timer. Only
  "Complete this step" or an explicit "Stop & discard" ends the session.
- Displayed `mm:ss` reads `elapsedMs` from context.

**New: `client/src/components/FocusTimerBar.jsx`** — a slim bar rendered
once in `AppLayout` next to `<Header/>`, visible on every in-app page
whenever a session is active and the full-screen overlay isn't open. Shows
step title, live `mm:ss`, pause/resume, "Resume Focus Mode," and
complete/discard — so leaving the Focus Mode screen to do something else
*inside the app* still shows the running timer, not just correctness while
it's invisible.

### Edge cases
- **Starting a second session while one is active:** disallowed; UI should
  say "You have an active focus session on '<other step>' — finish or
  discard it first," surfaced via `FocusTimerBar`.
- **Step completed/removed elsewhere while timer runs:** validated on
  rehydrate and when "Resume Focus Mode" is clicked from the bar.
- **Multiple tabs of the app open at once:** each tab has its own
  `sessionStorage`, so each tab can independently track its own session —
  no cross-tab collision to worry about (unlike the `localStorage` design
  this replaces, which would have shared/raced across tabs).
- **Browser/tab close mid-session:** the in-progress time is intentionally
  lost, per your requirement — no `actualMinutes` gets reported for that
  step; the next "Start Working" on it begins a fresh session.

### Files touched
- `client/src/context/FocusTimerContext.jsx` — **new**.
- `client/src/components/FocusTimerBar.jsx` — **new**.
- `client/src/components/FocusMode.jsx` — rewritten to consume the context.
- `client/src/App.jsx` — add `FocusTimerProvider`, render `FocusTimerBar`.

### No server changes needed
`actualMinutes` already flows through the existing
`PATCH /api/projects/:projectId/tasks/:taskId/steps/:stepId` — client-only.

### Verification plan
- Start a session, switch to another Chrome tab for >60s, switch back —
  elapsed time matches a real stopwatch.
- Start a session, close the Focus Mode overlay (not complete), navigate to
  the Dashboard/another project — `FocusTimerBar` shows the same running
  time; resume and complete — `actualMinutes` matches.
- Start a session, reload the page (same tab) — session survives.
- Start a session, close the tab (or the whole browser), reopen the app —
  confirm no session is restored and no stale `FocusTimerBar` appears.
- Start a session, mark that step completed from the Task Workspace step
  list directly — confirm the session cleans itself up.

---

## 2. Add a module — available on both AI-generated and manually-built projects

### Current behavior
Modules can only be created **at initial Manual Project Builder time**
(`client/src/pages/ManualProjectBuilder.jsx:16,34,53-68`, before the project
is ever saved) or by `planning_agent` during an AI run
(`server/agents/planning_agent/agent.js:200-238`). Once a project exists —
either kind — there is no way to add a new module to it.

### Design
Both project types already store the identical Milestones → Modules → Tasks
shape (`context.planning.milestones[].modules[]`) — this is the same reason
Quick-Add Subtask (`server/routes/projects.js:250-356`) already works
identically on AI-generated and manual projects. Add Module needs **no
special-casing per project type** for the same reason; it's one route, one
UI component, used everywhere `RoadmapTree` renders.

**New shared helper:** `server/agents/shared/quickAddModule.js` (parallels
`quickAddTask.js`):
- `nextModuleId(milestones)` — scans every module across every milestone for
  the `MOD<n>` pattern (matches `planning_agent`'s own project-wide-unique
  numbering — `agent.js:200`, `moduleIds = flatModules.map((_, i) =>
  \`MOD${i + 1}\`)`), returns `MOD<max+1>`.
- `buildManualModule({ id, title })` → `{ id, title, description: '',
  acceptanceCriteria: [], dependencies: [], tasks: [], source: 'manual' }`.
  The `source: 'manual'` tag is the actual point of this feature — it's what
  §3's delete gate reads.
- `resolveModuleSource(mod, metadata)` — the one place the fallback rule for
  *old, untagged* modules lives (see §3 for why this needs to be more than
  just "no tag = ai"), shared by both `toClientProject()` (decides whether
  the UI shows a delete button) and the new DELETE route (decides whether to
  allow it), so display and enforcement can never drift apart.
- Unit tests mirroring `quickAddTask.test.js`.

**New route:** `POST /api/projects/:projectId/modules` in
`server/routes/projects.js`, next to the Quick-Add Subtask route.
- Body: `{ milestoneId, title }`. 400 if either is missing/empty. 404 if the
  project or milestone doesn't exist (reuse the `loadOwnedContext` +
  milestone-lookup pattern already used by the reorder/module-GET routes).
- Builds the module via `buildManualModule()`, appends to
  `milestone.modules`, writes back via `toFirestoreDocument`, returns
  `{ success: true, module, project: withHealth(context) }`. The returned
  module has `tasks: []` — it renders as an empty `ModuleBlock`, and
  Quick-Add Subtask (already built, unchanged) works inside it immediately.

**Client API:** `client/src/api/index.js`:
```js
export const addProjectModule = (projectId, { milestoneId, title }) =>
  apiFetch(`/api/projects/${projectId}/modules`, {
    method: 'POST',
    body: JSON.stringify({ milestoneId, title }),
  });
```

**`RoadmapTree.jsx`:** add a `QuickAddModule` component (title-only field),
rendered once per open milestone, below its list of `ModuleBlock`s — on
either an AI-generated or manually-built project, since both render through
the same `milestone.modules.map(...)` (`RoadmapTree.jsx:239-249`). On
success, append the returned module into that milestone's `modules` array in
local state (real server-issued `id`, same pattern `handleQuickAdd` already
uses for subtasks).

### Files touched
- `server/agents/shared/quickAddModule.js` — **new**.
- `server/agents/shared/quickAddModule.test.js` — **new**.
- `server/routes/projects.js` — new `POST /:projectId/modules` route.
- `server/routes/tasks.js` — `POST /manual`'s module-building loop
  (`routes/tasks.js:218-225`) adds `source: 'manual'` to each pushed module,
  so modules created going forward by the Manual Project Builder are tagged
  the same way as ones created via Add Module (see §3 for why old,
  already-existing manual projects don't need a data migration for this).
- `server/agents/contextManager.js` — `toClientProject()`'s module mapping
  (`contextManager.js:465-473`) gains
  `source: resolveModuleSource(mod, context.metadata)`.
- `client/src/api/index.js` — `addProjectModule()`.
- `client/src/components/RoadmapTree.jsx` — `QuickAddModule` + wiring.

### Verification plan
- Unit tests for `nextModuleId`/`buildManualModule`/`resolveModuleSource`.
- Live: add a module to an AI-generated project's milestone — appears
  expanded/collapsible with 0 tasks; Quick-Add a subtask into it, confirm it
  opens/completes identically to any other task. Repeat on a manually-built
  project.
- Confirm adding a module never disturbs any existing module's id/tasks.

---

## 3. Delete a subtask — only when its module was manually added

### Current behavior
No per-task delete exists today. The only delete is project-level
(`DELETE /api/tasks/:taskId`, `server/routes/tasks.js:591-629`), which
archives the whole project.

### Design — gate on the **module's** origin, not the task's
A subtask is deletable exactly when the module it lives in has
`source === 'manual'` — i.e., the module was created via §2's Add Module
(on either an AI-generated or manual project), or is an original module from
a from-scratch Manual Project Builder project. It does **not** matter how
the individual subtask itself was added: a subtask quick-added into an
**AI-generated** module is *not* deletable (the module it's sitting in is
AI's), while *every* subtask in a **manually-added** module is deletable,
including ones the AI might have contributed if such a module is ever
touched by a later enhancement pass. This is a deliberate simplification —
no per-task tagging needed at all, only a `source` field on the module.

**Backward compatibility for old data — `resolveModuleSource()`:**
Modules created before this change (all `planning_agent` output, and every
Manual Project Builder module created before today) have no `source` field
at all. Rather than requiring a data migration, `resolveModuleSource(mod,
metadata)` (in `quickAddModule.js`, §2) computes it:
```js
mod.source ?? (metadata?.manualMode && !metadata?.aiEnhanced ? 'manual' : 'ai')
```
- **AI-generated project, never manual:** `manualMode` is false/absent →
  falls back to `'ai'`. Correct — protected.
- **From-scratch Manual Todo Mode project, not yet AI-enhanced:**
  `manualMode` true, `aiEnhanced` false → falls back to `'manual'`. Correct
  — every original hand-typed module is deletable, matching "manually added
  module," with zero migration needed for projects that already exist.
- **A manual project after "Let AI enhance this" regenerates the plan:**
  `manualMode` stays `true` forever (it marks how the project was *created*,
  per the existing convention documented at `contextManager.js:390-399`) —
  but `aiEnhanced` flips `true` once the pipeline completes. The `&&
  !metadata?.aiEnhanced` clause is exactly what keeps the AI's regenerated
  modules reading as `'ai'` in this case, instead of incorrectly falling
  back to `'manual'` just because the project's origin was manual. This is
  the one case a naive "no tag = ai" or "no tag = manual" rule would get
  wrong, which is why this needs its own helper rather than an inline
  `?? 'ai'`.
- **A module explicitly created via Add Module or the (now-tagging) Manual
  Project Builder route**, in any project, at any time: always carries its
  own explicit `source: 'manual'`, so it's unaffected by any of the above
  fallback reasoning.

**New route:** `DELETE /api/projects/:projectId/tasks/:taskId` in
`server/routes/projects.js`.
- 404 if project or task not found.
- Find the task's owning module (via `task.moduleId`/`task.milestoneId`,
  same lookup as the reorder route, `routes/projects.js:377-382`).
- **403 if `resolveModuleSource(module, context.metadata) !== 'manual'`**,
  with an explicit message ("This subtask belongs to an AI-generated module
  and can't be deleted.") — a real, visible rejection, not a silent no-op.
- On success:
  1. Remove the task from `context.planning.tasks`.
  2. Remove its `taskId` from the module's `tasks[]`.
  3. Remove any matching `context.schedule.scheduledTasks` entry; if it had
     a `calendarEventId`, call the existing
     `deleteCalendarEvents(userId, [eventId])`
     (`server/agents/google_calendar_agent/agent.js:275`) — non-fatal on
     failure, same pattern as `routes/tasks.js:601-607`.
  4. Strip the deleted `taskId` out of every other task's `dependencies[]`
     (defensive; cheap).
  5. Renumber `order` project-wide, reusing the walk the reorder route
     already does (`routes/projects.js:398-407`).
  6. `context.metadata.updatedAt = now`; write back; return
     `{ success: true, project: withHealth(context) }`.

**Client API:** `client/src/api/index.js`:
```js
export const deleteModuleTask = (projectId, taskId) =>
  apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });
```

**`RoadmapTree.jsx`:** `ModuleBlock` already knows its own `module.source`
(threaded through from `toClientProject()`) — pass
`deletable={module.source === 'manual'}` down to each `TaskRow`, which shows
a small trash-icon button only when `deletable` is true, regardless of that
particular task's own history. Clicking asks for confirmation (matching the
existing convention on `ProjectCard.jsx`'s project delete), then calls
`deleteModuleTask` and removes the row from local state, reverting with an
inline error on failure — same optimistic-with-rollback pattern
`handleReorderTasks` already uses (`RoadmapTree.jsx:189-206`).

### Explicitly not building (flagging, not silently scoping in)
- **Deleting a module itself.** Once §2 ships, an accidentally-added empty
  module has no delete path either — a natural follow-up, not in this plan
  unless you want it added.
- **Deleting from the Task Workspace page.** Ships on the Roadmap tab only,
  matching where Quick-Add Subtask already lives.

### Files touched
- `server/agents/shared/quickAddModule.js` — `resolveModuleSource()` (also
  listed under §2, since both features share it).
- `server/routes/projects.js` — new `DELETE /:projectId/tasks/:taskId` route.
- `client/src/api/index.js` — `deleteModuleTask()`.
- `client/src/components/RoadmapTree.jsx` — `ModuleBlock`/`TaskRow` gain the
  delete button, confirm step, optimistic removal/rollback.
- Test coverage: `quickAddModule.test.js` covers `resolveModuleSource()`'s
  three branches directly (no Firestore needed); route-level coverage for
  the DELETE endpoint added if/when `routes/projects.js` gains its first
  test file, matching whatever precedent exists at implementation time
  (no route in this file has direct tests today).

### Verification plan
- Unit: all three `resolveModuleSource()` branches above, directly.
- Live: on an AI-generated project, confirm no delete button appears on any
  task in an AI-planned module, **including** one you just quick-added a
  subtask into. Add a new module via §2, quick-add a subtask into *that*
  module, confirm its delete button appears and works (row disappears,
  calendar event cleaned up if it had one).
- Live: attempt the DELETE route directly against a task inside an
  AI-generated module and confirm a 403 with the explicit message.
- Live: on an existing (pre-this-change) from-scratch Manual Todo Mode
  project, confirm its original subtasks show the delete button without any
  data migration; then run "Let AI enhance this" on a copy and confirm the
  regenerated tasks/modules come back *without* the delete button.

---

## Implementation order

1. **`resolveModuleSource()` + module `source` tagging** (§2/§3 shared
   groundwork) — small, no UI yet.
2. **Add Module** (§2) — needed before delete is useful in practice.
3. **Delete subtask** (§3) — route + `RoadmapTree` UI.
4. **Background timer** (§1) — fully independent, client-only, any order.

Per [[track-changes-in-changes-md]], log the finished work in
`y_readme_files/changes.md` (newest-first, what/why/how-verified) once
implemented, and update the README's numbered Development History / Key
Features table if these ship as described here.
