import { useState, useEffect, useCallback, useRef } from 'react';
import { Zap, AlertTriangle, CircleDot, CheckCircle2, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import PlanningSurface from './PlanningSurface.jsx';
import AgentTrace from './AgentTrace.jsx';
import ProjectCard from './ProjectCard.jsx';
import CalendarConnect from './CalendarConnect.jsx';
import ApiKeySetup from './ApiKeySetup.jsx';
import DailyBriefing from './dailyBriefing.jsx';
import Onboarding from './Onboarding.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSSE } from '../hooks/useSSE.js';
import { getProjects, getApiKeyStatus, getFailedTasks, resumeTask, deleteTask, getOnboardingStatus } from '../api/index.js';

const FILTERS = ['all', 'active', 'at_risk', 'completed', 'overdue'];

// ── Today Summary — compact inline stat row (UPDATED_design.md §9.5) ──────────
// Replaces the 4 large bordered StatCards with one flat row: same onClick/
// active-filter wiring, no per-tile border/ring/donut decoration.
const STAT_ITEMS = [
  { key: 'active', label: 'Active', icon: Zap, color: 'text-brand-500' },
  { key: 'atRisk', label: 'At Risk', icon: AlertTriangle, color: 'text-warning' },
  { key: 'overdue', label: 'Overdue', icon: CircleDot, color: 'text-danger' },
  { key: 'done', label: 'Done', icon: CheckCircle2, color: 'text-success' },
];

function TodaySummary({ stats, filter, onFilter }) {
  const filterFor = { active: 'active', atRisk: 'at_risk', overdue: 'overdue', done: 'completed' };
  return (
    <div className="card flex items-stretch divide-x divide-border overflow-hidden">
      {STAT_ITEMS.map(({ key, label, icon: Icon, color }) => {
        const value = stats[key];
        const f = filterFor[key];
        const active = filter === f;
        return (
          <button
            key={key}
            onClick={() => onFilter(active ? 'all' : f)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 transition-colors ${active ? 'bg-brand-500/5' : 'hover:bg-surface-hover'}`}
          >
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
            <span className={`text-base font-bold font-mono tabular-nums ${color}`}>{value}</span>
            <span className="text-xs text-muted font-medium hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── System Status — collapsed by default unless attention is required ────────
function SystemStatus({ attentionNeeded, ...apiKeyProps }) {
  const [open, setOpen] = useState(attentionNeeded);
  return (
    <div className="space-y-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs font-medium text-muted hover:text-secondary uppercase tracking-wide"
      >
        <Settings className="w-3.5 h-3.5" />
        System Status
        {attentionNeeded && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="space-y-3">
          <CalendarConnect />
          <ApiKeySetup {...apiKeyProps} />
        </div>
      )}
    </div>
  );
}

// ── Urgency banner ────────────────────────────────────────────────────────────
function UrgencyBanner({ projects, onFilter }) {
  const overdue = projects.filter((p) => p.status === 'overdue');
  const critical = projects.filter((p) => p.riskLevel === 'high' && p.status !== 'completed');
  if (overdue.length === 0 && critical.length === 0) return null;
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-danger text-base">🚨</span>
      <div className="flex-1 min-w-0">
        {overdue.length > 0 && (
          <p className="text-sm font-semibold text-danger">
            {overdue.length} project{overdue.length > 1 ? 's' : ''} overdue
            {overdue.length <= 2 && ': ' + overdue.map((p) => p.title).join(', ')}
          </p>
        )}
        {critical.length > 0 && (
          <p className="text-xs text-warning mt-0.5">
            {critical.length} project{critical.length > 1 ? 's' : ''} at high risk
          </p>
        )}
      </div>
      <button
        onClick={() => onFilter(overdue.length > 0 ? 'overdue' : 'at_risk')}
        className="text-xs text-secondary hover:text-primary border border-border hover:border-border-strong px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
      >
        View →
      </button>
    </div>
  );
}

// ── Interrupted tasks (quota / pipeline-failed) resume banner ─────────────────
function ResumeBanner({ failedTasks, quotaEvent, onResume, onDelete, resumingId, deletingId }) {
  // Merge: show quota event task first (most recent), then any pre-existing failed tasks
  const allResumable = [];

  if (quotaEvent?.taskId) {
    allResumable.push({
      taskId: quotaEvent.taskId,
      rawGoal: quotaEvent.rawGoal ?? 'Your interrupted task',
      pipelineStage: quotaEvent.pipelineStage ?? 'mid-pipeline',
      isQuotaEvent: true,
      isPersonal: quotaEvent.isPersonal ?? false,
    });
  }

  for (const t of failedTasks ?? []) {
    if (!allResumable.find((r) => r.taskId === t.taskId)) {
      allResumable.push(t);
    }
  }

  if (allResumable.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-warning text-base">⏸️</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-warning">
            {allResumable.length === 1
              ? 'Pipeline interrupted — pick up where you left off'
              : `${allResumable.length} interrupted pipelines`}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {quotaEvent
              ? quotaEvent.isPersonal
                ? 'Your API key quota was exhausted. Try again after it resets, or wait — work is saved.'
                : 'Shared quota reached. Add your own API key then resume below — work is saved.'
              : 'These runs hit an error mid-way. All completed stages are saved.'}
          </p>
        </div>
      </div>

      <div className="border-t border-border divide-y divide-border">
        {allResumable.map((task) => {
          const isBusy = resumingId === task.taskId || deletingId === task.taskId;
          return (
            <div key={task.taskId} className="flex items-center gap-2 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-secondary truncate">{task.rawGoal}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  Stopped at: <span className="text-warning">{task.pipelineStage}</span>
                </p>
              </div>

              {/* Resume button */}
              <button
                id={`resume-btn-${task.taskId}`}
                onClick={() => onResume(task.taskId)}
                disabled={!!(resumingId || deletingId)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0
                  ${resumingId === task.taskId
                    ? 'bg-warning/20 text-warning cursor-wait'
                    : 'bg-warning/15 hover:bg-warning/25 text-warning border border-warning/30'}`}
              >
                {resumingId === task.taskId ? (
                  <>
                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Resuming…
                  </>
                ) : (
                  <>▶ Resume</>
                )}
              </button>

              {/* Delete button */}
              <button
                id={`delete-failed-btn-${task.taskId}`}
                onClick={() => onDelete(task.taskId)}
                disabled={isBusy}
                title="Delete this interrupted task"
                className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors flex-shrink-0
                  ${deletingId === task.taskId
                    ? 'bg-danger/10 text-danger/50 cursor-wait'
                    : 'text-muted hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/20'}`}
              >
                {deletingId === task.taskId ? (
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
// Per the Project Workspace redesign: the Dashboard answers exactly one
// question — "what projects am I currently working on?" — as a grid of
// Project Cards. Subtasks, execution steps, resources, notes and schedules
// all live one click away in the Project Workspace / Task Workspace.
export default function Dashboard() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProcessId, setActiveProcessId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyType, setApiKeyType] = useState(null);
  const [defaultProviderInfo, setDefaultProviderInfo] = useState(null);
  const [models, setModels] = useState(null);
  const [availableModels, setAvailableModels] = useState(null);
  const [savedModel, setSavedModel] = useState(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  // ── Onboarding flow ───────────────────────────────────────────────────────
  // Shown once to new users with zero projects. After dismissal (skip or
  // "Get Started") the state is persisted in Firestore so it never reappears.
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── Quota resume state ────────────────────────────────────────────────────
  // `quotaEvent` carries { taskId, rawGoal, pipelineStage, isPersonal } from
  // the most-recent quota_exceeded SSE event. `failedTasks` is the list fetched
  // from GET /api/tasks/failed on mount (pre-existing interrupted runs).
  const [quotaEvent, setQuotaEvent] = useState(null);
  const [failedTasks, setFailedTasks] = useState([]);
  const [resumingId, setResumingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // ── AgentTrace auto-scroll ref ────────────────────────────────────────────
  const traceRef = useRef(null);
  // ── Project grid ref — clicking a Today Summary stat scrolls here so the
  // filtered result is actually visible (the grid now sits well below the
  // fold since the §9.5 reorder moved Stats/Briefing/System Status above it).
  const projectsRef = useRef(null);
  // Guards the one-shot page scroll: once we've scrolled to the trace panel
  // for this run we must not scroll again (e.g. on a React re-render while
  // isStreaming is still true), otherwise the page keeps jumping back whenever
  // React reconciles. Reset when the stream ends so the next submission works.
  const hasScrolledRef = useRef(false);

  const { events, isStreaming, finalData } = useSSE(activeProcessId);

  // Scroll the PAGE to the AgentTrace exactly once when a new stream begins.
  // After that, all scrolling is handled inside the panel itself (see
  // AgentTrace.jsx — it scrolls the container div, not the page).
  useEffect(() => {
    if (isStreaming && traceRef.current && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      // Small delay so the element has mounted and the browser knows its height
      setTimeout(() => {
        traceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
    if (!isStreaming) {
      // Reset for the next submission
      hasScrolledRef.current = false;
    }
  }, [isStreaming]);

  const fetchProjects = useCallback(async () => {
    try {
      const { projects: fetched } = await getProjects();
      setProjects(fetched || []);
    } catch (err) {
      console.error('[Dashboard] fetchProjects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch pre-existing interrupted tasks on mount (quota hits from a previous session)
  const fetchFailedTasks = useCallback(async () => {
    try {
      const { failed } = await getFailedTasks();
      setFailedTasks(failed || []);
    } catch {
      // Non-fatal — silently ignore (e.g. composite index not yet deployed)
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchFailedTasks(); }, [fetchFailedTasks]);

  // Show onboarding to brand-new users who have no projects yet and haven't
  // completed the tour. Only runs once after the initial projects fetch settles.
  useEffect(() => {
    if (loading) return; // wait until the first fetch is done
    if (projects.length > 0) return; // existing users never see this
    getOnboardingStatus()
      .then(({ completed }) => { if (!completed) setShowOnboarding(true); })
      .catch(() => {}); // non-fatal — silently skip if endpoint unavailable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]); // intentionally only runs once when loading flips to false

  const fetchApiKeyStatus = useCallback(() => {
    return getApiKeyStatus()
      .then((r) => {
        setHasApiKey(r.hasKey);
        setApiKeyType(r.keyType);
        setDefaultProviderInfo(r.default ?? null);
        setModels(r.models ?? null);
        setAvailableModels(r.availableModels ?? null);
        setSavedModel(r.model ?? null);
      })
      .catch(() => { });
  }, []);

  useEffect(() => { fetchApiKeyStatus(); }, [fetchApiKeyStatus]);

  // Pick up quota_exceeded events from the SSE stream
  useEffect(() => {
    if (!events.length) return;
    const last = events[events.length - 1];
    if (last?.status === 'quota_exceeded') {
      setQuotaExceeded(true);
      setActiveProcessId(null);
      // Carry the taskId + stage through to the ResumeBanner
      setQuotaEvent({
        taskId: last.data?.taskId ?? null,
        rawGoal: null,           // not available in SSE payload — shown as generic label
        pipelineStage: 'mid-pipeline',
        isPersonal: last.data?.isPersonal ?? false,
      });
    }
  }, [events]);

  const handleAgentDone = useCallback(() => {
    setTimeout(fetchProjects, 600);
    setActiveProcessId(null);
    // Clear any stale resume state once a run completes successfully
    setQuotaEvent(null);
  }, [fetchProjects]);

  const handleProjectDeleted = useCallback((projectId) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }, []);

  // Set the filter and scroll the project grid into view so the result of
  // clicking a Today Summary stat is actually visible on screen.
  const handleStatFilter = useCallback((f) => {
    setFilter(f);
    setTimeout(() => {
      projectsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const handleKeyUpdated = (has, type) => {
    setHasApiKey(has);
    setApiKeyType(type);
    if (has) setQuotaExceeded(false);
    fetchApiKeyStatus();
  };

  // ── Delete a failed/interrupted task permanently ─────────────────────────
  const handleDeleteFailed = useCallback(async (taskId) => {
    if (deletingId || resumingId) return;
    setDeletingId(taskId);
    try {
      await deleteTask(taskId);
      // Remove from both sources optimistically
      setFailedTasks((prev) => prev.filter((t) => t.taskId !== taskId));
      if (quotaEvent?.taskId === taskId) setQuotaEvent(null);
    } catch (err) {
      console.error('[Dashboard] Delete failed task error:', err.message);
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, resumingId, quotaEvent]);

  // ── Resume a failed/interrupted task ─────────────────────────────────────
  const handleResume = useCallback(async (taskId) => {
    if (resumingId) return;
    setResumingId(taskId);
    try {
      const { processId } = await resumeTask(taskId);
      // Remove from the failed list optimistically
      setFailedTasks((prev) => prev.filter((t) => t.taskId !== taskId));
      if (quotaEvent?.taskId === taskId) setQuotaEvent(null);
      setQuotaExceeded(false);
      setActiveProcessId(processId);
    } catch (err) {
      console.error('[Dashboard] Resume failed:', err.message);
    } finally {
      setResumingId(null);
    }
  }, [resumingId, quotaEvent]);

  const total = projects.length;
  const stats = {
    active: projects.filter((p) => p.status === 'active').length,
    atRisk: projects.filter((p) => p.riskLevel === 'high' && p.status !== 'completed').length,
    overdue: projects.filter((p) => p.status === 'overdue').length,
    done: projects.filter((p) => p.status === 'completed').length,
  };

  const filteredProjects = projects
    .filter((p) => {
      if (filter === 'all') return true;
      if (filter === 'at_risk') return p.riskLevel === 'high' && p.status !== 'completed';
      if (filter === 'completed') return p.status === 'completed';
      return p.status === filter;
    })
    .sort((a, b) => {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1;
      if (b.status === 'overdue' && a.status !== 'overdue') return 1;
      return new Date(a.deadline ?? 0) - new Date(b.deadline ?? 0);
    });

  // Whether the resume / failed-tasks banner should be visible
  const showResumeBanner = (quotaEvent?.taskId || failedTasks.length > 0);

  return (
    <div className="dashboard-page min-h-screen">
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

      {/* First-run onboarding overlay — shown only to new users with zero projects */}
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}

      {/* ── 1. Today Summary — compact, not dominant ─────────────────────────── */}
      <TodaySummary stats={stats} filter={filter} onFilter={handleStatFilter} />

      {/* ── 2. Today's Focus + Morning Briefing ──────────────────────────────── */}
      <DailyBriefing />

      {/* ── 3. System Status — collapsed unless attention is needed ──────────── */}
      <SystemStatus
        attentionNeeded={quotaExceeded || !profile?.calendarConnected}
        hasKey={hasApiKey}
        keyType={apiKeyType}
        savedModel={savedModel}
        defaultProvider={defaultProviderInfo}
        models={models}
        availableModels={availableModels}
        quotaExceeded={quotaExceeded}
        onKeyUpdated={handleKeyUpdated}
      />

      {/* ── 4. Plan Composer — the dominant action (UPDATED_design.md §9.5) ──── */}
      <PlanningSurface onProcessStart={setActiveProcessId} />

      {/* ── AgentTrace — immediately after the Planning Surface so agents are    */}
      {/* front-and-center the moment streaming starts. The page auto-scrolls    */}
      {/* to traceRef when isStreaming becomes true (see the useEffect above).   */}
      {(events.length > 0 || isStreaming) && (
        <div ref={traceRef}>
          <AgentTrace events={events} isStreaming={isStreaming} finalData={finalData} onDone={handleAgentDone} />
        </div>
      )}

      {/* ── 5. Projects — monitoring, not primary ────────────────────────────── */}
      <UrgencyBanner projects={projects} onFilter={setFilter} />

      {/* Resume banner — shown when quota hit or pre-existing failed tasks exist */}
      {showResumeBanner && (
        <ResumeBanner
          failedTasks={failedTasks}
          quotaEvent={quotaEvent}
          onResume={handleResume}
          onDelete={handleDeleteFailed}
          resumingId={resumingId}
          deletingId={deletingId}
        />
      )}

      {/* Filters */}
      <div ref={projectsRef} />
      {total > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map((f) => {
            const count = f === 'all' ? total : f === 'at_risk' ? stats.atRisk : f === 'completed' ? stats.done : stats[f] ?? 0;
            const hasAlert = (f === 'overdue' && stats.overdue > 0) || (f === 'at_risk' && stats.atRisk > 0);
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border flex items-center gap-1 ${filter === f
                  ? 'border-brand-500 bg-brand-500/20 text-brand-500'
                  : hasAlert ? 'border-border-strong text-secondary hover:text-primary' : 'border-border text-muted hover:text-secondary'
                  }`}
              >
                {f.replace('_', ' ')}
                {count > 0 && f !== 'all' && (
                  <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full font-mono ${f === 'overdue' ? 'bg-danger/20 text-danger' : f === 'at_risk' ? 'bg-warning/20 text-warning' : 'bg-surface-hover text-muted'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Project grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((n) => <div key={n} className="card h-48 animate-pulse bg-surface-hover" />)}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-muted text-sm">
            {filter === 'all' ? 'No projects yet. Add one above and watch the agents work.' : `No ${filter.replace('_', ' ')} projects.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDeleted={handleProjectDeleted}
              onEnhance={handleResume}
              enhancing={resumingId === project.id}
            />
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
