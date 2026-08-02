# ⚡ LifeSaver — AI-Powered Deadline Companion

> *"Don't miss deadlines. Let agents handle it."*

A multi-agent AI productivity system that proactively plans, prioritizes, and schedules your tasks before deadlines hit — powered by Google Gemini, RAG personalization, and Google Calendar auto-scheduling.

---

## 🤖 The 5-Agent Pipeline

Every task you type in plain English goes through a live, streaming agent pipeline:

```
Your Input (natural language)
       ↓
[1] Task Parser Agent         — Gemini Flash   — Extracts deadline, complexity, category
       ↓
[2] Prioritization Agent      — Gemini Pro     — RAG search of your history → risk/urgency scores
       ↓
[3] Planning Agent            — Gemini Pro     — Breaks into 3–8 concrete subtasks with tips
       ↓
[4] Scheduler Agent           — googleapis     — Finds free calendar slots, books events
       ↓
[5] Monitor Agent (cron/30m)  — Gemini Flash   — Watches progress, autonomously re-plans
```

Each agent's thinking streams to the UI in real-time via Server-Sent Events.

---

## 🧠 RAG Personalization

The Prioritization Agent uses **Gemini `text-embedding-004`** to embed every task and store it in a personal vector store (Firestore). When you add a new task, it semantically searches your history and surfaces insights like:

> *"Last time you had a high-complexity academic task, you underestimated by 3 hours — risk score adjusted."*

This means the system gets smarter the more you use it.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **AI Models** | Gemini 1.5 Pro (reasoning), Gemini 1.5 Flash (speed), text-embedding-004 (RAG) |
| **Backend** | Node.js + Express (deployed on Render) |
| **Database** | Firebase Firestore |
| **Auth** | Firebase Authentication (Google Sign-In) |
| **Calendar** | Google Calendar API v3 (OAuth2 read/write) |
| **Frontend** | React + Vite + Tailwind CSS |
| **Hosting** | Firebase Hosting (frontend) + Render (backend) |
| **Real-time** | Server-Sent Events (agent trace streaming) |
| **Scheduling** | node-cron (monitor agent runs every 30 min) |

---

## 📁 Project Structure

```
last-minute-lifesaver/
├── server/                          # Node.js backend (Render)
│   ├── index.js                     # Express server + cron
│   ├── config/
│   │   ├── gemini.js                # Gemini Pro/Flash/Embedding clients
│   │   └── firebase.js              # Firebase Admin SDK
│   ├── agents/
│   │   ├── parserAgent.js           # Agent 1 — NL → structured task
│   │   ├── prioritizationAgent.js   # Agent 2 — RAG + priority scoring
│   │   ├── planningAgent.js         # Agent 3 — subtask decomposition
│   │   ├── schedulerAgent.js        # Agent 4 — Google Calendar booking
│   │   ├── monitorAgent.js          # Agent 5 — cron watcher + re-planner
│   │   └── orchestrator.js          # Pipeline coordinator + SSE + Firestore
│   ├── rag/
│   │   ├── embeddings.js            # text-embedding-004 wrapper
│   │   ├── vectorStore.js           # Cosine similarity search on Firestore
│   │   └── sseManager.js            # Server-Sent Events connection manager
│   ├── routes/
│   │   ├── tasks.js                 # POST initiate, GET stream, CRUD
│   │   ├── calendar.js              # OAuth flow + events endpoints
│   │   └── auth.js                  # Token verification + profile
│   └── middleware/
│       └── auth.js                  # Firebase token verification
│
├── client/                          # React frontend (Firebase Hosting)
│   └── src/
│       ├── App.jsx                  # Router + auth guard
│       ├── firebase.js              # Firebase client config
│       ├── api/index.js             # Typed API client
│       ├── context/AuthContext.jsx  # Firebase auth state
│       ├── hooks/useSSE.js          # EventSource lifecycle hook
│       ├── pages/Login.jsx          # Google sign-in page
│       └── components/
│           ├── Dashboard.jsx        # Main view: stats, tasks, timeline
│           ├── TaskInput.jsx        # NL input → pipeline trigger
│           ├── AgentTrace.jsx       # Live SSE agent thinking panel ★
│           ├── TaskCard.jsx         # Task + subtasks + risk meter
│           ├── RiskMeter.jsx        # Animated arc gauge (0–100)
│           ├── Timeline.jsx         # Upcoming scheduled work blocks
│           ├── CalendarConnect.jsx  # OAuth connect/disconnect
│           └── Header.jsx           # Nav + user info
│
├── firebase.json                    # Firebase hosting + Firestore config
├── firestore.rules                  # Security rules (owner-only access)
├── firestore.indexes.json           # Compound indexes
├── render.yaml                      # Render deployment blueprint
└── .gitignore
```

# 🎯 End-to-End Workflow

```text
Natural Language Task
           │
           ▼
     Parser Agent
           │
           ▼
 Prioritization Agent
      (RAG Memory)
           │
           ▼
    Planning Agent
           │
           ▼
   Scheduler Agent
           │
           ▼
 Google Calendar Events
           │
           ▼
   Monitor Agent (Cron)
           │
           ▼
 Continuous Replanning
           │
           ▼
    Task Completed 🎉
```


---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- A Google Cloud project with **Gemini API**, **Calendar API**, and **Firebase** enabled
- Firebase project with **Firestore** and **Authentication** (Google provider) enabled

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/last-minute-lifesaver.git
cd last-minute-lifesaver

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
GEMINI_API_KEY=         # Google AI Studio → Get API Key
GOOGLE_CLIENT_ID=       # Cloud Console → APIs & Services → Credentials
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5000/api/calendar/callback
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=  # From Service Account JSON
FIREBASE_PRIVATE_KEY=   # From Service Account JSON (include quotes)
SESSION_SECRET=any_long_random_string
CLIENT_URL=http://localhost:5173
```

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
   - `https://your-render-url.onrender.com/api/calendar/callback` (prod)
4. Add authorized JavaScript origins:
   - `http://localhost:5173` (dev)
   - `https://your-project.web.app` (prod)

### 5. Firebase Setup

In [Firebase Console](https://console.firebase.google.com):

1. **Authentication** → Sign-in method → Enable **Google**
2. Add `localhost` and your production domain to Authorized domains
3. **Firestore** → Create database (production mode)
4. Deploy security rules: `firebase deploy --only firestore:rules`
5. **Project Settings** → Service Accounts → Generate new private key → save JSON
6. **Project Settings** → Your apps → Add Web App → copy config values

### 6. Run Locally

```bash
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
cd client && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 🌐 Deployment

### Backend → Render

1. Push repo to GitHub (must be public for free tier)
2. [render.com](https://render.com) → New → Blueprint → connect repo
3. Render reads `render.yaml` and creates the service automatically
4. Add all environment variables in Render dashboard
5. Set `GOOGLE_REDIRECT_URI` to `https://<your-render-url>/api/calendar/callback`

### Frontend → Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools
firebase login

# Build and deploy
cd client
npm run build
cd ..
firebase deploy --only hosting
```

Update `VITE_API_URL` in your client `.env` to your Render URL before building.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Natural Language Input** | Type tasks exactly as you'd say them |
| **Live Agent Trace** | Watch each AI agent think in real-time (SSE streaming) |
| **RAG Personalization** | System learns your patterns — adjusts estimates based on history |
| **Risk Score (0–100)** | Live animated gauge per task, auto-updated by monitor agent |
| **Auto Calendar Booking** | Subtasks appear in Google Calendar with reminders automatically |
| **Autonomous Re-planning** | Monitor agent reschedules missed blocks without you asking |
| **Deadline Escalation** | Alert fires when < 2h left and task isn't done |
| **Timeline View** | Visual schedule of all upcoming work blocks across all tasks |

---

# 💡 Why LifeSaver?

Unlike traditional task managers, **LifeSaver acts as an intelligent productivity partner**.

It doesn't simply record tasks—it understands user intent, learns from past behavior, creates personalized execution strategies, schedules work automatically, and continuously adapts plans until the goal is achieved.

> **From natural language → to intelligent execution → to successful completion.**
