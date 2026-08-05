import { useState } from "react";

const data = {
  meta: {
    start: "June 18, 2026",
    deadline: "July 20, 2026",
    daysLeft: 32,
    goal: "SDE / AI-ML / GenAI roles (₹20L+)",
  },
  phases: [
    {
      id: "p1",
      label: "Phase 1",
      title: "Finish & Ship Projects",
      duration: "Jun 18 – Jun 30 (13 days)",
      color: "#7C3AED",
      accent: "#A78BFA",
      priority: "CRITICAL",
      why: "Recruiters screen portfolios before interviews. Incomplete projects = invisible candidate.",
      tasks: [
        {
          id: "t1",
          title: "BYOK Agentic RAG Chatbot",
          tag: "GenAI",
          effort: "High",
          steps: [
            "Finish BYOK key management + personal storage integration",
            "Add a working demo with 2–3 use-case screenshots",
            "Write a crisp README: problem → architecture → demo GIF → run steps",
            "Deploy on HuggingFace Spaces or Railway (free tier)",
          ],
          outcome: "Your #1 resume project for AI/GenAI roles",
        },
        {
          id: "t2",
          title: "Video Generation using Agents",
          tag: "GenAI",
          effort: "Medium",
          steps: [
            "Scope down to a 60-second demo clip pipeline",
            "Document the multi-agent workflow with a diagram",
            "Push to GitHub with architecture diagram in README",
            "Even a partial working demo is better than nothing",
          ],
          outcome: "Differentiator — very few students have video-gen projects",
        },
        {
          id: "t3",
          title: "Algorithmic Trading Platform",
          tag: "SDE",
          effort: "Medium",
          steps: [
            "Pick ONE strategy (e.g. momentum or mean-reversion) and make it run end-to-end",
            "Add backtesting results chart to the README",
            "Deploy a read-only dashboard (Streamlit or Vercel)",
            "Add system design notes: data pipeline, latency decisions",
          ],
          outcome: "Strong SDE signal — shows DS + engineering + domain",
        },
      ],
    },
    {
      id: "p2",
      label: "Phase 2",
      title: "DSA Finisher Sprint",
      duration: "Jun 18 – Jul 10 (running parallel)",
      color: "#0369A1",
      accent: "#38BDF8",
      priority: "HIGH",
      why: "You're at 80% of Striver's A-Z. The remaining 20% likely contains Hard DP, Graphs (advanced), and Tries — exactly what top companies ask.",
      tasks: [
        {
          id: "t4",
          title: "Complete Striver's A-Z remaining 20%",
          tag: "DSA",
          effort: "High",
          steps: [
            "Identify exact uncovered topics: Hard DP, Graphs (Dijkstra, Floyd-Warshall, Topo Sort), Tries, Segment Trees",
            "Do 1 topic block per day (2–3 problems + concept)",
            "After each topic: solve 1 medium + 1 hard on LeetCode",
            "Track solved count — aim for 250+ total before July 20",
          ],
          outcome: "Confident in any DSA round at product companies",
        },
        {
          id: "t5",
          title: "Contest practice",
          tag: "DSA",
          effort: "Medium",
          steps: [
            "Participate in 2 LeetCode weekly contests before July 20",
            "Do LeetCode company-tagged problems: Google, Amazon, Microsoft, Atlassian (top 30 each)",
            "Time yourself — solve under interview conditions (no hints for 20 min)",
          ],
          outcome: "Speed + accuracy under pressure",
        },
      ],
    },
    {
      id: "p3",
      label: "Phase 3",
      title: "Core CS — Strategic Coverage",
      duration: "Jul 1 – Jul 19 (19 days)",
      color: "#065F46",
      accent: "#34D399",
      priority: "HIGH",
      why: "SDE interviews always include OS/DBMS/OOPS/CN. AI roles ask DBMS + OS heavily for MLOps/system design context.",
      tasks: [
        {
          id: "t6",
          title: "OOPS (2 days)",
          tag: "Core CS",
          effort: "Low",
          steps: [
            "4 pillars with code examples in Python/Java/C++",
            "SOLID principles — know examples, not just definitions",
            "Design patterns: Singleton, Factory, Observer, Strategy",
            "Practice: design a parking lot / library system verbally",
          ],
          outcome: "Clears every OOPS screening question",
        },
        {
          id: "t7",
          title: "DBMS (3 days)",
          tag: "Core CS",
          effort: "Medium",
          steps: [
            "Normalization (1NF–BCNF), ACID, transactions, isolation levels",
            "SQL: JOINs, GROUP BY, window functions, subqueries",
            "Indexing: B-Tree vs Hash, when to use which",
            "CAP theorem + NoSQL basics (MongoDB vs Redis use cases)",
          ],
          outcome: "Handles DBMS rounds + system design storage questions",
        },
        {
          id: "t8",
          title: "OS (3 days)",
          tag: "Core CS",
          effort: "Medium",
          steps: [
            "Processes vs threads, scheduling algorithms",
            "Deadlock: conditions, prevention, banker's algorithm",
            "Memory: virtual memory, paging, segmentation, TLB",
            "File systems, semaphores, mutexes",
          ],
          outcome: "Strong OS fundamentals for SDE + backend roles",
        },
        {
          id: "t9",
          title: "Computer Networks (2 days)",
          tag: "Core CS",
          effort: "Low",
          steps: [
            "OSI vs TCP/IP model — layer-by-layer what happens",
            "TCP vs UDP, 3-way handshake, congestion control",
            "HTTP/HTTPS, DNS, CDN, Load Balancers",
            "Focus on application layer for web/API companies",
          ],
          outcome: "Clears CN rounds, feeds into system design",
        },
        {
          id: "t10",
          title: "System Design Basics (4 days)",
          tag: "System Design",
          effort: "High",
          steps: [
            "Learn the framework: requirements → capacity → HLD → components",
            "Study: URL shortener, Twitter feed, WhatsApp, YouTube",
            "Key concepts: horizontal scaling, caching (Redis), message queues (Kafka)",
            "For AI roles: ML system design — model serving, feature stores, A/B testing",
            "Resource: Grokking System Design (free summaries on GitHub)",
          ],
          outcome: "Mid-senior SDE interviews + AI infra roles",
        },
      ],
    },
    {
      id: "p4",
      label: "Phase 4",
      title: "AI/ML Interview Prep",
      duration: "Jul 5 – Jul 19 (parallel)",
      color: "#92400E",
      accent: "#FCD34D",
      priority: "HIGH",
      why: "GenAI roles ask ML fundamentals + LLM concepts + system design. You need depth here given your specialization.",
      tasks: [
        {
          id: "t11",
          title: "ML Fundamentals Quick Revision",
          tag: "ML",
          effort: "Medium",
          steps: [
            "Bias-variance tradeoff, overfitting, regularization (L1/L2)",
            "Loss functions, optimizers (SGD, Adam), backpropagation",
            "Evaluation metrics: precision/recall/F1, ROC-AUC, NDCG",
            "Classic algorithms: know when to use what (tree vs linear vs neural)",
          ],
          outcome: "Passes ML screening rounds at any company",
        },
        {
          id: "t12",
          title: "LLM & GenAI Concepts",
          tag: "GenAI",
          effort: "Medium",
          steps: [
            "Transformer architecture — attention, positional encoding, layer norm",
            "RAG pipeline: chunking, embedding, retrieval strategies, reranking",
            "Fine-tuning vs prompting vs RAG — when to use which",
            "Agents: tool use, memory types, ReAct pattern",
            "Evaluation: hallucination metrics, RAGAS framework",
          ],
          outcome: "Stands out in GenAI/AI engineer interviews",
        },
        {
          id: "t13",
          title: "Project Deep-dives (your own projects)",
          tag: "GenAI",
          effort: "Low",
          steps: [
            "For each project: prepare a 2-min verbal walkthrough",
            "Know every design decision and why you made it",
            "Prepare 3 'what would you do differently' answers",
            "Tie each project to real-world business value",
          ],
          outcome: "Aces behavioral + technical project rounds",
        },
      ],
    },
    {
      id: "p5",
      label: "Phase 5",
      title: "Resume, LinkedIn & Applications",
      duration: "Jun 25 – Jul 10",
      color: "#9D174D",
      accent: "#F472B6",
      priority: "MEDIUM",
      why: "A strong resume with deployed projects gets you past the first filter. Most students waste this.",
      tasks: [
        {
          id: "t14",
          title: "Resume rewrite",
          tag: "Branding",
          effort: "Medium",
          steps: [
            "1 page, clean format (Jake's Resume template on Overleaf)",
            "Projects section FIRST — above education for experienced/project-heavy profiles",
            "Each project: 2–3 bullets with metrics (e.g. 'reduced latency by 40%', 'handles 1000 req/s')",
            "Skills: Python, PyTorch, LangChain, FastAPI, SQL, Docker, Git — be specific",
            "Add GitHub links + live demo links for all 3 projects",
          ],
          outcome: "Passes resume screen at product companies",
        },
        {
          id: "t15",
          title: "GitHub & LinkedIn",
          tag: "Branding",
          effort: "Low",
          steps: [
            "Pin all 3 projects on GitHub, write good READMEs with screenshots",
            "LinkedIn: headline = 'Mtech AI/ML @ IIITA | LLMs • Agents • Full-stack'",
            "Post 1 short LinkedIn post about each project (with demo GIF) — this generates inbound",
            "Connect with IIITA alumni at target companies",
          ],
          outcome: "Passive inbound from recruiters before placements open",
        },
      ],
    },
  ],
  weekly: [
    { week: "Jun 18–22", focus: "RAG Chatbot done + DSA 3 topics", projects: true, dsa: true, core: false, ml: false },
    { week: "Jun 23–29", focus: "Video Gen + Trading MVP + DSA 3 topics", projects: true, dsa: true, core: false, ml: false },
    { week: "Jun 30–Jul 6", focus: "Resume done + OOPS/DBMS + DSA finish", projects: false, dsa: true, core: true, ml: false },
    { week: "Jul 7–13", focus: "OS/CN + System Design + ML fundamentals", projects: false, dsa: true, core: true, ml: true },
    { week: "Jul 14–19", focus: "Mock interviews + GenAI deep-dive + revise", projects: false, dsa: true, core: true, ml: true },
  ],
  dailyTemplate: [
    { slot: "6–8 AM", task: "DSA — 2 problems (fresh brain)", type: "dsa" },
    { slot: "8–10 AM", task: "Project work — coding only", type: "project" },
    { slot: "10 AM–12 PM", task: "Project work — coding only", type: "project" },
    { slot: "12–1 PM", task: "Break", type: "break" },
    { slot: "1–3 PM", task: "Core CS topic (DBMS / OS / CN / OOPS)", type: "core" },
    { slot: "3–5 PM", task: "ML/GenAI concepts or system design", type: "ml" },
    { slot: "5–6 PM", task: "DSA revision — 1 problem (from weak areas)", type: "dsa" },
    { slot: "6–7 PM", task: "Break / walk", type: "break" },
    { slot: "7–9 PM", task: "Project work or LinkedIn/GitHub", type: "project" },
    { slot: "9–10 PM", task: "Light reading — blogs, papers, Striver notes", type: "core" },
  ],
};

const tagColors = {
  GenAI: { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D" },
  SDE: { bg: "#EDE9FE", text: "#5B21B6", border: "#A78BFA" },
  DSA: { bg: "#DBEAFE", text: "#1E40AF", border: "#60A5FA" },
  "Core CS": { bg: "#D1FAE5", text: "#065F46", border: "#34D399" },
  "System Design": { bg: "#FCE7F3", text: "#9D174D", border: "#F472B6" },
  ML: { bg: "#FEF9C3", text: "#713F12", border: "#EAB308" },
  Branding: { bg: "#F3F4F6", text: "#374151", border: "#9CA3AF" },
};

const effortDot = { High: "#EF4444", Medium: "#F59E0B", Low: "#10B981" };

const typeColors = {
  dsa: "#3B82F6",
  project: "#7C3AED",
  core: "#059669",
  ml: "#D97706",
  break: "#9CA3AF",
};

export default function App() {
  const [activePhase, setActivePhase] = useState("p1");
  const [expandedTask, setExpandedTask] = useState(null);
  const [activeTab, setActiveTab] = useState("roadmap");
  const [checkedTasks, setCheckedTasks] = useState({});

  const toggleCheck = (id) => {
    setCheckedTasks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const totalTasks = data.phases.flatMap((p) => p.tasks).length;
  const completedTasks = Object.values(checkedTasks).filter(Boolean).length;
  const progress = Math.round((completedTasks / totalTasks) * 100);

  const activePhaseData = data.phases.find((p) => p.id === activePhase);

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#0F0F13", minHeight: "100vh", color: "#E2E8F0" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", borderBottom: "1px solid #1E293B", padding: "24px 20px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "#7C3AED", textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>
                IIITA Mtech IT · ML & Intelligent Systems
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, lineHeight: 1.2, color: "#F1F5F9" }}>
                Placement Prep Roadmap
              </h1>
              <p style={{ margin: "6px 0 0", color: "#94A3B8", fontSize: 13 }}>
                {data.meta.daysLeft} days to placement season · Target: {data.meta.goal}
              </p>
            </div>
            <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 12, padding: "12px 18px", textAlign: "center" }}>
              <div style={{ fontSize: 36, fontWeight: 900, color: completedTasks === 0 ? "#64748B" : "#7C3AED", lineHeight: 1 }}>
                {progress}%
              </div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{completedTasks}/{totalTasks} tasks</div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ background: "#1E293B", borderRadius: 4, height: 4, marginBottom: 16 }}>
            <div style={{ background: "linear-gradient(90deg, #7C3AED, #06B6D4)", height: 4, borderRadius: 4, width: `${progress}%`, transition: "width 0.4s ease" }} />
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {[{ id: "roadmap", label: "📋 Roadmap" }, { id: "schedule", label: "🗓 Weekly Plan" }, { id: "daily", label: "⏰ Daily Schedule" }].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ padding: "10px 16px", background: activeTab === tab.id ? "#0F0F13" : "transparent", border: "none", borderRadius: "8px 8px 0 0", color: activeTab === tab.id ? "#F1F5F9" : "#64748B", fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 400, cursor: "pointer", transition: "all 0.2s" }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px" }}>

        {/* ROADMAP TAB */}
        {activeTab === "roadmap" && (
          <div>
            {/* Phase selector */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {data.phases.map((phase) => {
                const phaseTasks = phase.tasks.map((t) => t.id);
                const done = phaseTasks.filter((id) => checkedTasks[id]).length;
                const isActive = activePhase === phase.id;
                return (
                  <button key={phase.id} onClick={() => setActivePhase(phase.id)}
                    style={{ padding: "8px 14px", borderRadius: 8, border: isActive ? `2px solid ${phase.color}` : "2px solid #1E293B", background: isActive ? `${phase.color}20` : "#1E293B", color: isActive ? phase.accent : "#64748B", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
                    {phase.label} · {done}/{phaseTasks.length}
                  </button>
                );
              })}
            </div>

            {/* Active phase detail */}
            {activePhaseData && (
              <div>
                <div style={{ background: `${activePhaseData.color}15`, border: `1px solid ${activePhaseData.color}40`, borderRadius: 14, padding: "18px 20px", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ background: activePhaseData.color, color: "white", fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 4, letterSpacing: 1 }}>
                          {activePhaseData.priority}
                        </span>
                        <span style={{ color: activePhaseData.accent, fontSize: 12, fontWeight: 600 }}>{activePhaseData.duration}</span>
                      </div>
                      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#F1F5F9" }}>{activePhaseData.title}</h2>
                    </div>
                  </div>
                  <p style={{ margin: "10px 0 0", color: "#94A3B8", fontSize: 13, lineHeight: 1.6, borderTop: `1px solid ${activePhaseData.color}30`, paddingTop: 10 }}>
                    💡 {activePhaseData.why}
                  </p>
                </div>

                {/* Tasks */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {activePhaseData.tasks.map((task) => {
                    const tag = tagColors[task.tag] || tagColors["Core CS"];
                    const isExpanded = expandedTask === task.id;
                    const isDone = checkedTasks[task.id];
                    return (
                      <div key={task.id} style={{ background: isDone ? "#0F2A1F" : "#1A1A2E", border: `1px solid ${isDone ? "#065F46" : "#2D2D44"}`, borderRadius: 12, overflow: "hidden", transition: "all 0.2s" }}>
                        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                          onClick={() => setExpandedTask(isExpanded ? null : task.id)}>
                          <div onClick={(e) => { e.stopPropagation(); toggleCheck(task.id); }}
                            style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${isDone ? "#10B981" : "#334155"}`, background: isDone ? "#10B981" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", transition: "all 0.2s" }}>
                            {isDone && <span style={{ color: "white", fontSize: 12, fontWeight: 900 }}>✓</span>}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: isDone ? "#64748B" : "#F1F5F9", textDecoration: isDone ? "line-through" : "none" }}>{task.title}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: tag.bg, color: tag.text, border: `1px solid ${tag.border}` }}>{task.tag}</span>
                              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748B" }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: effortDot[task.effort], display: "inline-block" }} />
                                {task.effort}
                              </span>
                            </div>
                          </div>
                          <span style={{ color: "#475569", fontSize: 16, transition: "transform 0.2s", transform: isExpanded ? "rotate(90deg)" : "none" }}>›</span>
                        </div>

                        {isExpanded && (
                          <div style={{ padding: "0 16px 16px 48px", borderTop: "1px solid #1E293B" }}>
                            <div style={{ paddingTop: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Steps</div>
                              {task.steps.map((step, i) => (
                                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                                  <span style={{ color: activePhaseData.accent, fontSize: 12, fontWeight: 800, minWidth: 18, marginTop: 1 }}>{i + 1}.</span>
                                  <span style={{ color: "#CBD5E1", fontSize: 13, lineHeight: 1.5 }}>{step}</span>
                                </div>
                              ))}
                              <div style={{ marginTop: 12, background: `${activePhaseData.color}15`, border: `1px solid ${activePhaseData.color}30`, borderRadius: 8, padding: "8px 12px" }}>
                                <span style={{ fontSize: 11, color: activePhaseData.accent, fontWeight: 700 }}>🎯 OUTCOME: </span>
                                <span style={{ fontSize: 12, color: "#94A3B8" }}>{task.outcome}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* WEEKLY TAB */}
        {activeTab === "schedule" && (
          <div>
            <div style={{ marginBottom: 16, padding: "12px 16px", background: "#1E293B", borderRadius: 10, fontSize: 13, color: "#94A3B8", lineHeight: 1.6 }}>
              ⚡ <strong style={{ color: "#F1F5F9" }}>Strategy:</strong> Phases 1 & 2 run in parallel from day 1. Core CS + ML starts Week 3. Final week is pure revision + mocks.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.weekly.map((w, i) => (
                <div key={i} style={{ background: "#1A1A2E", border: "1px solid #2D2D44", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#7C3AED", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Week {i + 1}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9", marginTop: 2 }}>{w.week}</div>
                      <div style={{ fontSize: 13, color: "#94A3B8", marginTop: 4 }}>{w.focus}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[["Projects", w.projects, "#7C3AED"], ["DSA", w.dsa, "#3B82F6"], ["Core CS", w.core, "#059669"], ["ML/AI", w.ml, "#D97706"]].map(([label, active, color]) => (
                        <span key={label} style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: active ? `${color}25` : "#1E293B", color: active ? color : "#334155", border: `1px solid ${active ? color + "50" : "#1E293B"}` }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Key milestones */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Key Milestones</div>
              {[
                { date: "Jun 25", milestone: "RAG Chatbot deployed + live demo link ready", color: "#7C3AED" },
                { date: "Jun 30", milestone: "All 3 projects on GitHub with READMEs", color: "#7C3AED" },
                { date: "Jul 5", milestone: "Resume finalized + Striver's A-Z 100% done", color: "#3B82F6" },
                { date: "Jul 10", milestone: "DBMS + OS + OOPS done, LinkedIn updated", color: "#059669" },
                { date: "Jul 17", milestone: "System Design + GenAI prep done", color: "#D97706" },
                { date: "Jul 19", milestone: "2 mock interviews done. You're ready.", color: "#10B981" },
              ].map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: m.color, flexShrink: 0, marginTop: 3 }} />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: m.color }}>{m.date} — </span>
                    <span style={{ fontSize: 13, color: "#CBD5E1" }}>{m.milestone}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DAILY TAB */}
        {activeTab === "daily" && (
          <div>
            <div style={{ marginBottom: 16, padding: "12px 16px", background: "#1E293B", borderRadius: 10, fontSize: 13, color: "#94A3B8", lineHeight: 1.6 }}>
              📌 <strong style={{ color: "#F1F5F9" }}>This is a template.</strong> Adjust based on your energy. Keep DSA in the morning (freshest brain). Shift project work to your peak hours.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.dailyTemplate.map((slot, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1A2E", border: `1px solid ${slot.type === "break" ? "#1E293B" : typeColors[slot.type] + "25"}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ width: 3, height: 36, borderRadius: 2, background: typeColors[slot.type], flexShrink: 0 }} />
                  <div style={{ minWidth: 80, fontSize: 12, fontWeight: 700, color: "#475569" }}>{slot.slot}</div>
                  <div style={{ fontSize: 13, color: slot.type === "break" ? "#475569" : "#CBD5E1" }}>{slot.task}</div>
                  <div style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: `${typeColors[slot.type]}20`, color: typeColors[slot.type], textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }}>
                    {slot.type}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { title: "Do NOT do", items: ["Grind 3 topics in one day", "Skip projects for more DSA", "Study without a timer", "Learn System Design in theory only"] },
                { title: "Non-negotiable", items: ["Deploy at least 1 project before Jul 5", "2 LeetCode contests before Jul 20", "1 mock interview before placements", "Sleep 7+ hours"] },
              ].map((box, i) => (
                <div key={i} style={{ background: "#1A1A2E", border: `1px solid ${i === 0 ? "#7F1D1D" : "#14532D"}`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: i === 0 ? "#EF4444" : "#10B981", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
                    {i === 0 ? "✗ " : "✓ "}{box.title}
                  </div>
                  {box.items.map((item, j) => (
                    <div key={j} style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, lineHeight: 1.5 }}>
                      {i === 0 ? "·" : "·"} {item}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
