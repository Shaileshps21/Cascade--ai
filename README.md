# ⚡ Casade -AI - Powered Deadline Companion

> *"Don't miss deadlines. Let agents handle it."*

A multi-agent AI productivity system that turns a plain-English goal into a fully planned, prioritized, scheduled, and continuously self-correcting project — powered by a 15-agent pipeline, your choice of Groq or Gemini as the LLM provider, and Google Calendar auto-scheduling.

---

## 🤖 The 15-Agent Pipeline

Every task you type goes through a live, streaming agent pipeline (`server/agents/orchestrator.js`), each step's thinking streamed to the UI in real-time over Server-Sent Events:

```
Your Input (natural language)
       │
       ▼
 [0] Preferences load        — Firestore   — day/night scheduling preference
 [1] Memory Agent            — Firestore + LLM fallback — past-project history/success rate
 [2] Evaluation Benchmark    — Firestore   — read-only load of historical quality scores
 [3] Intent Context Agent    — LLM         — category, complexity, deadline inference
 [4] Knowledge Acquisition   — LLM + web   — learning objectives, concept graph, verified resource links
 [5] Prioritization Agent    — LLM         — risk/urgency scoring
 [6] Planning Agent          — LLM         — 5-level hierarchy: Milestones→Modules→Tasks→Execution Steps
 [7] Review Agent            — LLM         — plan quality gate (up to 2 auto-revisions)
 [8] Dependency Analysis     — LLM         — topological ordering, critical path, parallel groups
 [9] Time Estimation Agent   — LLM         — multi-factor duration estimates per task
[10] Deadline Feasibility    — deterministic + LLM — hard feasibility check before any schedule is built
[11] Scheduler Agent         — deterministic + LLM — day/night-aware slot placement, avoids Calendar conflicts
[12] Google Calendar Agent   — googleapis  — creates/updates real calendar events
[13] Progress Tracking Agent — deterministic — live risk score, initial status
[14] Evaluation Benchmark    — deterministic — records this run's quality snapshot
    + Replanning Agent       — triggered automatically by the 30-min cron, or on demand — reassigns missed/overrun tasks
    + Briefing Agent         — daily cron — morning summary + focus schedule
```

---

## 🧠 Memory & Personalization

The **Memory Agent** reads `task_history` and `user_benchmarks` for the signed-in user and builds a profile (past similar projects, success rate, common failure patterns, optimal work hours) that downstream agents (Time Estimation, Scheduler) read from `context.memory`. With fewer than 5 past projects it falls back to an LLM-generated starting profile instead.

The **Evaluation Benchmark Agent** is purely deterministic (no LLM calls) — it scores every run across 7 categories (planning quality, scheduling accuracy, dependency health, estimation accuracy, knowledge quality, calendar reliability, productivity) and appends a snapshot after every pipeline run and every task completion, so the system's own quality is trackable over time.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **AI Models** | Groq (Llama 3.3 70B, default) **or** Google Gemini — user picks the provider *and* the specific model per key |
| **Backend** | Node.js + Express |
| **Database** | Firebase Firestore |
| **Auth** | Firebase Authentication (Google Sign-In) |
| **Calendar** | Google Calendar API v3 (OAuth2 read/write, free/busy lookups) |
| **Frontend** | React + Vite + Tailwind CSS |
| **Real-time** | Server-Sent Events (agent trace streaming) |
| **Scheduling** | node-cron — progress sweep every 30 min; morning briefing daily at 03:30 UTC, with a 04:30 UTC catch-up sweep |

---

## 📁 Project Structure

```
last-minute-Casade/
├── server/
│   ├── index.js                          # Express server + cron (progress sweep, briefing)
│   ├── config/
│   │   ├── Llm.js                        # Groq/Gemini client factory, retries, JSON repair, cost tracking
│   │   └── firebase.js                   # Firebase Admin SDK
│   ├── agents/
│   │   ├── orchestrator.js               # Pipeline coordinator + SSE + Firestore persistence
│   │   ├── contextManager.js             # PlanningContext shape, Firestore (de)serialization, client shapes
│   │   ├── eventBus.js                   # Internal agent lifecycle events
│   │   ├── memory_agent/                 # Past-project history + success rate
│   │   ├── intent_context_agent/         # Category/complexity/deadline inference
│   │   ├── knowledge_acquisition_agent/  # Learning resources + live link verification
│   │   ├── prioritization_agent/         # Risk/urgency scoring
│   │   ├── planning_agent/               # Milestones → Modules → Tasks → Execution Steps
│   │   ├── review_agent/                 # Plan/schedule quality gate
│   │   ├── dependency_analysis_agent/    # Topological order, critical path
│   │   ├── time_estimation_agent/        # Multi-factor duration estimates
│   │   ├── deadline_feasibility_agent/   # Deterministic feasibility + reconciliation suggestions
│   │   ├── scheduler_agent/              # Day/night-aware slot placement
│   │   ├── google_calendar_agent/        # Free/busy lookup + event sync
│   │   ├── progress_tracking_agent/      # Live risk score, escalation detection
│   │   ├── replanning_agent/             # Reassigns missed/overrun tasks, re-syncs calendar
│   │   ├── evaluation_benchmark_agent/   # 7-category deterministic quality scoring
│   │   ├── briefing_agent/               # Daily morning briefing
│   │   ├── shared/                       # agentRunner, validator, logger, firestoreUtil
│   │   └── *_legacy.js                   # Superseded flat-schema agents, kept for reference
│   ├── routes/
│   │   ├── tasks.js                      # initiate / stream / complete / delete / replan
│   │   ├── projects.js                   # Project Workspace read/write surface
│   │   ├── calendar.js                   # OAuth flow + events
│   │   ├── settings.js                   # API key + scheduling preferences
│   │   ├── briefings.js                  # Daily briefing endpoints
│   │   └── auth.js                       # Token verification + profile
│   └── middleware/auth.js                # Firebase token verification
│
├── client/src/
│   ├── App.jsx                           # Router + auth guard
│   ├── api/index.js                      # Typed API client
│   ├── context/AuthContext.jsx           # Firebase auth state
│   ├── hooks/useSSE.js                   # EventSource lifecycle hook
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── ProjectWorkspace.jsx          # Overview/Roadmap/Schedule/Resources/Analytics/Notes/Settings tabs
│   │   └── TaskWorkspace.jsx             # Single task detail + Focus Mode
│   └── components/
│       ├── Dashboard.jsx                 # Project Cards grid — the home page
│       ├── ProjectCard.jsx               # Per-project summary + inline delete
│       ├── TaskInput.jsx                 # NL input → pipeline trigger
│       ├── AgentTrace.jsx                # Live SSE agent thinking panel
│       ├── ApiKeySetup.jsx               # Provider + model picker
│       ├── CalendarConnect.jsx           # Google Calendar OAuth connect/disconnect
│       ├── SchedulePreferences.jsx       # Day / Flexible / Night scheduling toggle
│       ├── RoadmapTree.jsx               # Milestones → Modules → Tasks tree
│       ├── ExecutionStepItem.jsx         # Interactive execution-step row
│       ├── FocusMode.jsx                 # Distraction-free "Start Working" view
│       ├── NextBestAction.jsx            # Continue-working suggestion card
│       ├── ResourceLink.jsx              # Renders a resource; inert text if no confident URL
│       ├── RiskMeter.jsx                 # Animated arc gauge (0–100)
│       ├── dailyBriefing.jsx             # Morning briefing card
│       ├── Breadcrumbs.jsx
│       └── Header.jsx
│
├── firestore.rules                       # Security rules (owner-only access)
├── firestore.indexes.json                # Composite indexes (queries also degrade gracefully without them)
├── firebase.json                         # Hosting (SPA rewrites, cache/security headers) + Firestore config
├── render.yaml                           # Render blueprint for the backend service
└── .gitignore
```

> `server/.env.example` and `client/.env.example` list every variable each side
> actually reads — copy them to `.env` to get started (see Local Setup below).

## 🎯 End-to-End Workflow

```text
Natural Language Task
        │
        ▼
 Memory + Benchmark (history load)
        │
        ▼
 Intent → Knowledge → Prioritization → Planning ⇄ Review
        │
        ▼
 Dependency Analysis → Time Estimation → Deadline Feasibility
        │
        ▼
 Scheduler Agent (day/night-aware, avoids Calendar conflicts)
        │
        ▼
 Google Calendar Events
        │
        ▼
 Progress Tracking (cron, every 30 min)
        │
        ├── on track ──────────────► keep going
        └── missed/overrun ───────► Replanning Agent → reschedule + re-sync Calendar
        │
        ▼
    Task Completed 🎉
```

---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- A **Groq** API key and/or a **Google Gemini** API key (either works; users can also supply their own key per-account in the app)
- A Google Cloud project with **Calendar API** and **Firebase** enabled
- Firebase project with **Firestore** and **Authentication** (Google provider) enabled

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/last-minute-Casade.git
cd last-minute-Casade

# Install backend
cd server && npm install

# Install frontend
cd ../client && npm install
```

### 2. Configure Backend

```bash
cd server
cp .env.example .env
```

Fill in `.env`:

```env
GROQ_API_KEY=           # console.groq.com (default provider — fast + free tier)
GEMINI_API_KEY=         # Google AI Studio → Get API Key (fallback provider)
GOOGLE_CLIENT_ID=       # Cloud Console → APIs & Services → Credentials
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5000/api/calendar/callback
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=  # From Service Account JSON
FIREBASE_PRIVATE_KEY=   # From Service Account JSON (include quotes)
CLIENT_URL=http://localhost:5173
PORT=5000
```

Every variable above is actually read by the server — auth is stateless (Firebase ID
tokens verified per-request in `middleware/auth.js`), so there is no session secret.

### 3. Configure Frontend

```bash
cd client
cp .env.example .env
```

Fill in `.env`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_API_URL=http://localhost:5000
```

### 4. Google Cloud Setup

In [Google Cloud Console](https://console.cloud.google.com):

1. Enable **Google Calendar API**
2. Create **OAuth 2.0 credentials** (Web application type)
3. Add authorized redirect URIs:
   - `http://localhost:5000/api/calendar/callback` (dev)
   - `https://your-deployed-url/api/calendar/callback` (prod)
4. Add authorized JavaScript origins:
   - `http://localhost:5173` (dev)
   - `https://your-project.web.app` (prod)

### 5. Firebase Setup

In [Firebase Console](https://console.firebase.google.com):

1. **Authentication** → Sign-in method → Enable **Google**
2. Add `localhost` and your production domain to Authorized domains
3. **Firestore** → Create database (production mode)
4. Deploy security rules: `firebase deploy --only firestore:rules`
5. **Deploy composite indexes — required:** `firebase deploy --only firestore:indexes`
   The *agents* (Memory, Evaluation Benchmark, Knowledge Acquisition cache) deliberately
   avoid needing an index — they filter on one field and sort in memory. But the two
   list endpoints behind the home page, `GET /api/projects` and `GET /api/tasks`, page
   with `.where('userId').orderBy('createdAt').limit(50)`, which Firestore cannot serve
   without the `tasks` composite index. Skip this step and the dashboard fails with
   `FAILED_PRECONDITION: The query requires an index`.
   These two can't use the in-memory trick the agents use: dropping `.orderBy` would make
   `.limit(50)` return an arbitrary 50 documents rather than the newest 50, and sorting
   those in memory would silently show the wrong projects. Keeping the index is correct;
   the alternative is an unbounded read of every task a user owns.
6. **Project Settings** → Service Accounts → Generate new private key → save JSON
7. **Project Settings** → Your apps → Add Web App → copy config values

### 6. Run Locally

```bash
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### 7. Run the Tests

```bash
cd server && npm test
```

**293 tests, all passing.** They run on Node's built-in test runner (`node --test`,
no test framework dependency) and are fully hermetic — every agent's pure logic is
covered without touching the network, Firestore, or an LLM, so the suite needs no
`.env` and no API key to run.

---

## 🌐 Deployment

The repo ships with a Render blueprint for the backend and a Firebase Hosting
config for the frontend.

### Backend → Render

1. Push the repo to GitHub
2. [render.com](https://render.com) → **New** → **Blueprint** → connect the repo —
   Render reads `render.yaml` and creates the service automatically
3. Fill in the `sync: false` environment variables in the Render dashboard
   (they're intentionally not stored in the repo)
4. Set `GOOGLE_REDIRECT_URI` to `https://<your-render-url>/api/calendar/callback`
   and `CLIENT_URL` to your deployed frontend origin
5. Add that same redirect URI to the OAuth client in Google Cloud Console —
   it must match exactly or the Calendar connect flow fails

> On Render's free tier the service spins down after ~15 minutes of inactivity.
> Since the progress sweep and briefing are `node-cron` jobs inside the server
> process, they only fire while the service is awake — use a paid instance if you
> need the autonomous replanning to run reliably around the clock.

### Frontend → Firebase Hosting

```bash
npm install -g firebase-tools
firebase login

cd client && npm run build
cd .. && firebase deploy --only hosting
```

Set `VITE_API_URL` to your Render URL **before** building — Vite inlines env vars
at build time, so changing it afterwards has no effect without a rebuild.

Deploy the Firestore rules and indexes too, if you haven't already:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Natural Language Input** | Type tasks exactly as you'd say them |
| **Live Agent Trace** | Watch each of the 15 agents think in real-time (SSE streaming) |
| **Bring Your Own Key** | Use the shared quota, or add a personal Groq/Gemini key and pick the exact model |
| **Verified Resource Links** | Every learning resource URL is actually checked (HEAD/GET) before being shown — dead or hallucinated links are blanked instead of shipped |
| **Day/Night Scheduling Preference** | Choose whether new tasks get scheduled into an early (7–19), balanced (9–21), or late/night (12–24) working-hours window |
| **Calendar-Aware Scheduling** | The scheduler reads your real Google Calendar free/busy blocks and places tasks around your existing commitments |
| **Automatic Missed-Task Reassignment** | A 30-minute sweep detects overrun/at-risk tasks and automatically reschedules them, re-syncing Google Calendar — no manual intervention needed (a manual "Reschedule now" button is also available) |
| **Project Workspace** | Dashboard → Project Workspace → Task Workspace navigation with Overview, Roadmap, Schedule, Resources, Analytics, Notes and Settings tabs |
| **One-Click Delete** | Remove a mistakenly-added project directly from the home page, no drill-down required |
| **Risk Score (0–100)** | Live, recalculated score per project from the gap between time-elapsed and work-completed |
| **Deterministic Feasibility Gate** | A hard deadline is checked against real available capacity before any LLM ever proposes a schedule — infeasible plans get an honest, task-grounded reconciliation suggestion instead of a fabricated one |
| **7-Category Benchmarking** | Every run's planning quality, scheduling accuracy, dependency health, estimation accuracy, and more are scored and tracked over time |

---

## 📜 Development History

A chronological record of every substantive change made to this codebase, in the order it happened, with the reasoning and how each change was verified.

### 1. Initial commit
Project scaffold: 5-agent pipeline (Parser → Prioritization → Planning → Scheduler → Monitor), Gemini-only, flat task list UI.

### 2. Revise README to enhance project overview and clarity
Removed the hackathon-submission framing, added the end-to-end workflow diagram and an evaluation matrix highlighting the system's differentiators.

### 3. checkpoint: restore in-progress v3 agent pipeline refactor
Carried over the partial server-side 15-agent pipeline work (intent, memory, shared agentRunner/validator/logger, the new `Llm.js` client, briefings and settings routes) plus matching client updates, as a stable base for the Project Workspace UI redesign.

### 4. Restore full v3 15-agent pipeline backend (5-level hierarchy)
Pulled in the complete set of remaining agents — planning, dependency analysis, time estimation, deadline feasibility, scheduler, review, evaluation benchmark, google calendar, progress tracking, replanning, knowledge acquisition, briefing — rewired `orchestrator.js` and all routes to them, and retired the superseded flat-schema agent files (kept as `*_legacy.js` for reference, not deleted).

### 5. Redesign client architecture around a Project Workspace hierarchy
Replaced the old "everything on one page" flat task list with a real Dashboard → Project Workspace → Task Workspace navigation:
- **Client:** Dashboard reduced to Project Cards only (title, progress, deadline, priority, AI confidence, risk, current milestone, next recommended task). New `/projects/:projectId` Project Workspace (Overview / Roadmap / Schedule / Resources / Analytics / Notes / Settings tabs) and `/projects/:projectId/tasks/:taskId` Task Workspace with interactive execution steps, a history timeline, and a distraction-free Focus Mode. Added Breadcrumbs, a "Next Best Action" card, and step-level resource views. Removed the dead flat TaskCard/Timeline components.
- **Server:** Execution steps became first-class interactive objects (status, progress, dependencies, resources, notes, completion evidence, optional flag, timestamps, blocked reason) instead of bare `{stepId, action, order}`. Added `routes/projects.js` with the full Project Workspace read/write surface; progress is derived bottom-up from step data on every read rather than stored redundantly at each hierarchy level.
- **Verified:** client built clean via `vite build`; server booted clean with all 15 agents + new routes resolving; new endpoints correctly returned 401 under `requireAuth` instead of 404.

### 6. Improve Llm.js: handle longer outputs, raise generation quality
- Per-model output ceilings instead of one hardcoded `max_tokens` for every Groq call; truncated responses now trigger one automatic continuation attempt at the model's real ceiling instead of silently handing clipped JSON to the repair pass (a real bug for Planning Agent's large hierarchy outputs).
- The JSON-repair pass now knows when its source was truncated and asks the repair model to *complete* the structure rather than just re-punctuate it; tries native JSON mode first, falls back to plain prompting if a model rejects it.
- Empty/content-filtered responses are now retryable failures instead of silently returning `""`; retry backoff adds jitter and honors provider `Retry-After` hints.
- **Verified:** server booted end-to-end; a standalone smoke test covering parse/repair/quota-detection/extraction (14/14 checks) passed, then the scratch file was removed.

### 7. Fix three bugs surfaced by a live run: crash, false validation failures, and a hard pipeline failure
- `toClientTask()`/`toTaskHistoryEntry()` crashed on any Firestore task doc missing `rawGoal` (e.g. from an earlier failed run) — since `GET /api/projects` iterates every doc for a user, one bad document took the whole list down. Now falls back to a placeholder title.
- `planning_agent`'s schema still required `executionSteps[].action`, a field the normalized step shape no longer has (it's `.title` now) — this failed schema validation on *every* run, burning a retry each time for nothing.
- `dependency_analysis_agent`'s `parallelGroups` (an array-of-arrays in memory) was hard-rejected by Firestore ("nested arrays are not supported"), hard-failing the orchestrator on every run. Now encoded as an array of `{taskIds}` objects on write and decoded back on read.
- **Verified:** standalone smoke test (Firestore round-trip, missing-`rawGoal` guard, both sides of the schema fix) 8/8 passed; clean end-to-end server boot.

### 8. Spread scheduling across the full deadline window, diversify resources, and show the real active model
- **Scheduler:** `buildScheduleSkeleton()` never enforced a daily time cap during placement, so a 7-day project's tasks packed back-to-back until the working-hours window was full before spilling to the next day. Added per-day minute tracking with rollover, and lowered the default daily-available-hours assumption from 6 to 2 (kept consistent between the feasibility check and the placement cap).
- **Knowledge acquisition:** resources were matched to tasks by keyword overlap, but the prompt only asked for "the single best" resource per goal — every task ended up sharing a tiny shared pool. Now asks for roughly one resource per concept in the knowledge graph, with per-resource (not goal-level) keywords so matching actually differentiates. Tightened the URL rule (a wrong link is worse than none) and added a `ResourceLink` component so resources with no confident URL render as inert text instead of a dead `#` anchor.
- **Model display:** added `getModelLabel()`/`getProviderSummary()` as the single source of truth for human-readable model names, so the dashboard's "using X key" banner reflects the actually-configured model instead of a hardcoded string.
- **Verified:** full server suite (278/278) passed; a standalone scheduler smoke test confirmed 9 hours of work across a 7-day window now spread across 5 distinct days instead of 1–2; `vite build` clean; live-browser-checked that the API key banner shows the real active model.

### 9. Fix three bugs surfaced by a live run, crash, false validation failures, and a hard pipeline failure
- The configured Groq model 404'd as unavailable on this account. Tried a cheaper alternative, which then 413'd ("Request too large") against this app's typically 3–6K-token prompts under its free-tier limit. Reverted to the model that had proven reliable, and added `isInvalidModelError()`/`isPayloadTooLargeError()` so both failure modes fail fast instead of burning the retry budget on an unwinnable retry.
- Added real per-model choice: `getAvailableModels(keyType)` exposes a curated list, `createClients()` takes a validated model override, `validateApiKey()` now live-tests the *chosen* model (not just a generic auth check) so a bad model choice is caught at save time. The API key UI gained a model dropdown, and the active-key banner shows the user's specific choice.
- **Verified:** full server suite (278/278) passed; a standalone smoke test (14/14) covered the new model-selection helpers and override rejection; `vite build` clean; live-browser-verified saving a model choice, seeing it reflected on the dashboard, and having an invalid model id rejected at save time.

### 10. Fix scheduler producing an empty schedule and hallucinated feasibility suggestions
- When total estimated effort exceeded the deadline window, `scheduler_agent` returned `scheduledTasks: []` entirely — live testing showed every task stuck in "Not Yet Scheduled" with no plan at all. It now falls back to the deterministic skeleton (which spreads work across all available days, running past the deadline if needed) instead of an empty list, while still honestly reporting `isFeasible: false`.
- `deadline_feasibility_agent`'s reconciliation prompt only received the project title, so its scope-reduction suggestions were generic hallucinations unrelated to the actual project (e.g. suggesting cutting a "mobile app" for a plain HTML/CSS learning project). It now receives the real planned task titles/priorities and is instructed to reference only those.
- **Verified:** live pipeline run producing a real 7-task/7-day schedule with Google Calendar sync instead of an empty list; standalone script confirmed the reconciliation prompt now lists real tasks.

### 11. Verify knowledge-acquisition links live, add day/night scheduling preference, auto-reassign missed tasks, fix memory-agent indexing, add home-page delete *(this update)*
Four requests, each root-caused and fixed:

- **Knowledge Acquisition — dead/wrong links.** Pattern-matching only caught obviously-fake placeholder URLs (`example.com`, etc.); the LLM could still confidently invent a plausible-looking but dead deep link on a real domain. Added `isUrlReachable()`/`verifyResourceUrls()` (`knowledge_acquisition_agent/validator.js`) — every resource URL now gets an actual HEAD-then-GET check (bounded concurrency, short timeout, non-fatal on network hiccups) before it reaches the user; anything that doesn't resolve is blanked instead of shown.

- **Scheduler — Calendar-aware, day/night preference, missed-task reassignment.** The Google Calendar free/busy lookup was already wired into the scheduler from earlier work; what was missing was user control over it. Added `resolveWorkingHours(context.preferences)` in `scheduler_agent/agent.js` with three presets (`day` 7–19, `flexible` 9–21, `night` 12–24 — the `night` window deliberately uses 24 as the end hour, which `Date#setHours(24,…)` correctly normalizes to midnight of the next day, so no midnight-wraparound handling was needed anywhere in the existing slot-placement math), a `SchedulePreferences` UI toggle, and `GET`/`PUT /api/settings/preferences`. Separately, `progress_tracking_agent`'s 30-minute risk-escalation sweep already *detected* missed/overrun tasks (`result.escalate`) but never *acted* on it — the cron in `server/index.js` now calls `orchestrator.replanTask()` for every escalated task, which re-runs the scheduler for just the affected tasks and re-syncs Google Calendar. A manual "Reschedule now" button was also added to the Project Workspace Schedule tab for on-demand use.

- **Memory Agent — Firestore indexing error.** `memory_agent`, `evaluation_benchmark_agent`, and the `knowledge_acquisition_agent` cache lookup all combined `.where(field).orderBy(otherField)` Firestore queries, which require a composite index that isn't guaranteed to be deployed in every environment — this was surfacing as `FAILED_PRECONDITION: The query requires an index`. Replaced all three with `.where()`-only queries (always index-free) plus in-memory sorting via a new shared `toMillis()`/`sortByFieldDesc()` helper (`shared/firestoreUtil.js`) that correctly handles Firestore `Timestamp` objects, ISO strings, and raw `Date`s alike.

- **Home page — delete a mistaken task.** The delete capability already existed (`DELETE /api/tasks/:taskId`, calendar cleanup included) but was only reachable from Project Workspace → Settings → Danger zone. Added a delete button directly on each `ProjectCard` on the Dashboard, with a confirmation prompt and optimistic removal from the list.

- **Verified:** full server suite grew from 278 to 293 passing tests (new coverage for URL verification and the day/night presets, including the midnight-boundary edge cases). Live-tested end-to-end via Chrome browser automation against a real Groq-backed pipeline run: resource URLs were correctly blanked when unreachable and kept when real; a newly-submitted task's 8 scheduled slots all landed inside the selected night-person window (12:00–19:00, none earlier); the 30-minute cron fired mid-session and automatically replanned 2 escalated tasks, deleting their stale Calendar events and creating fresh ones; the delete button removed a project via a real `200` `DELETE` response; and zero Firestore index errors appeared across the entire session (multiple pipeline runs plus cron sweeps).

---

# 💡 Why Casade?

Unlike traditional task managers, **Casade acts as an intelligent productivity partner**.

It doesn't simply record tasks—it understands user intent, learns from past behavior, creates personalized execution strategies, schedules work automatically around your real calendar and your own day/night rhythm, catches itself when a task is missed, and continuously adapts plans until the goal is achieved.

> **From natural language → to intelligent execution → to successful completion.**
