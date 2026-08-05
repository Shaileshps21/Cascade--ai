import { useState, useEffect, useCallback, useRef } from 'react';
import TaskInput from './TaskInput.jsx';
import AgentTrace from './AgentTrace.jsx';
import ProjectCard from './ProjectCard.jsx';
import CalendarConnect from './CalendarConnect.jsx';
import SchedulePreferences from './SchedulePreferences.jsx';
import ResourceModeToggle from './ResourceModeToggle.jsx';
import ApiKeySetup from './ApiKeySetup.jsx';
import DailyBriefing from './dailyBriefing.jsx';
import { useSSE } from '../hooks/useSSE.js';
import { getProjects, getApiKeyStatus, getFailedTasks, resumeTask, deleteTask } from '../api/index.js';

const FILTERS = ['all', 'active', 'at_risk', 'completed', 'overdue'];

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, total, color, bgColor, borderColor, icon, urgent, onClick, active }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <button
      onClick={onClick}
      className={`card px-4 py-3 text-left transition-all duration-200 hover:scale-[1.02] active:scale-95
        ${active ? `${borderColor} ${bgColor}` : 'border-white/5'}
        ${urgent && value > 0 ? 'ring-1 ring-offset-0 ' + borderColor : ''}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-lg leading-none">{icon}</span>
          <p className={`text-2xl font-bold mt-1 tabular-nums ${urgent && value > 0 ? color + ' animate-pulse' : color}`}>
            {value}
          </p>
        </div>
        {value > 0 && total > 0 && (
          <div className="relative w-8 h-8">
            <svg viewBox="0 0 32 32" className="w-8 h-8 -rotate-90">
              <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" className="text-white/5" strokeWidth="3" />
              <circle
                cx="16" cy="16" r="12" fill="none" stroke="currentColor" className={color} strokeWidth="3"
                strokeDasharray={`${(pct / 100) * 75.4} 75.4`} strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[9px] font-bold ${color}`}>{pct}%</span>
          </div>
        )}
      </div>
      <p className="text-xs text-white/40 font-medium">{label}</p>
      {value > 0 && total > 0 && (
        <div className="mt-1.5 h-0.5 rounded-full bg-white/5 overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${bgColor.replace('/5', '/60')}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </button>
  );
}

// ── Urgency banner ────────────────────────────────────────────────────────────
function UrgencyBanner({ projects, onFilter }) {
  const overdue = projects.filter((p) => p.status === 'overdue');
  const critical = projects.filter((p) => p.riskLevel === 'high' && p.status !== 'completed');
  if (overdue.length === 0 && critical.length === 0) return null;
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-rose-400 text-base animate-pulse">🚨</span>
      <div className="flex-1 min-w-0">
        {overdue.length > 0 && (
          <p className="text-sm font-semibold text-rose-400">
            {overdue.length} project{overdue.length > 1 ? 's' : ''} overdue
            {overdue.length <= 2 && ': ' + overdue.map((p) => p.title).join(', ')}
          </p>
        )}
        {critical.length > 0 && (
          <p className="text-xs text-amber-400 mt-0.5">
            {critical.length} project{critical.length > 1 ? 's' : ''} at high risk
          </p>
        )}
      </div>
      <button
        onClick={() => onFilter(overdue.length > 0 ? 'overdue' : 'at_risk')}
        className="text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition-all flex-shrink-0"
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
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-amber-400 text-base">⏸️</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-400">
            {allResumable.length === 1
              ? 'Pipeline interrupted — pick up where you left off'
              : `${allResumable.length} interrupted pipelines`}
          </p>
          <p className="text-xs text-white/40 mt-0.5">
            {quotaEvent
              ? quotaEvent.isPersonal
                ? 'Your API key quota was exhausted. Try again after it resets, or wait — work is saved.'
                : 'Shared quota reached. Add your own API key then resume below — work is saved.'
              : 'These runs hit an error mid-way. All completed stages are saved.'}
          </p>
        </div>
      </div>

      <div className="border-t border-white/5 divide-y divide-white/5">
        {allResumable.map((task) => {
          const isBusy = resumingId === task.taskId || deletingId === task.taskId;
          return (
            <div key={task.taskId} className="flex items-center gap-2 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/80 truncate">{task.rawGoal}</p>
                <p className="text-[11px] text-white/30 mt-0.5">
                  Stopped at: <span className="text-amber-400/70">{task.pipelineStage}</span>
                </p>
              </div>

              {/* Resume button */}
              <button
                id={`resume-btn-${task.taskId}`}
                onClick={() => onResume(task.taskId)}
                disabled={!!(resumingId || deletingId)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0
                  ${resumingId === task.taskId
                    ? 'bg-amber-500/20 text-amber-400 cursor-wait'
                    : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30'}`}
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
                className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all flex-shrink-0
                  ${deletingId === task.taskId
                    ? 'bg-rose-500/10 text-rose-400/50 cursor-wait'
                    : 'text-white/25 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20'}`}
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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active" value={stats.active} total={total} color="text-brand-400" bgColor="bg-brand-500/5" borderColor="border-brand-500/30" icon="⚡" urgent={false} onClick={() => setFilter(filter === 'active' ? 'all' : 'active')} active={filter === 'active'} />
        <StatCard label="At Risk" value={stats.atRisk} total={total} color="text-amber-400" bgColor="bg-amber-500/5" borderColor="border-amber-500/30" icon="⚠️" urgent={stats.atRisk > 0} onClick={() => setFilter(filter === 'at_risk' ? 'all' : 'at_risk')} active={filter === 'at_risk'} />
        <StatCard label="Overdue" value={stats.overdue} total={total} color="text-rose-400" bgColor="bg-rose-500/5" borderColor="border-rose-500/30" icon="🔴" urgent={stats.overdue > 0} onClick={() => setFilter(filter === 'overdue' ? 'all' : 'overdue')} active={filter === 'overdue'} />
        <StatCard label="Done" value={stats.done} total={total} color="text-emerald-400" bgColor="bg-emerald-500/5" borderColor="border-emerald-500/30" icon="✅" urgent={false} onClick={() => setFilter(filter === 'completed' ? 'all' : 'completed')} active={filter === 'completed'} />
      </div>

      <UrgencyBanner projects={projects} onFilter={setFilter} />

      <DailyBriefing />

      <ApiKeySetup
        hasKey={hasApiKey}
        keyType={apiKeyType}
        savedModel={savedModel}
        defaultProvider={defaultProviderInfo}
        models={models}
        availableModels={availableModels}
        quotaExceeded={quotaExceeded}
        onKeyUpdated={handleKeyUpdated}
      />

      <CalendarConnect />

      <SchedulePreferences />

      {/* Resource mode toggle — controls whether the Knowledge Agent verifies URLs */}
      <ResourceModeToggle />

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

      <TaskInput onProcessStart={setActiveProcessId} />

      {/* ── AgentTrace — immediately after TaskInput so agents are front-and-center ── */}
      {/* Mounted here (above filters + grid) so the user sees it the moment      */}
      {/* streaming starts. The page auto-scrolls to traceRef when isStreaming     */}
      {/* becomes true (see the useEffect above).                                  */}
      {(events.length > 0 || isStreaming) && (
        <div ref={traceRef}>
          <AgentTrace events={events} isStreaming={isStreaming} finalData={finalData} onDone={handleAgentDone} />
        </div>
      )}

      {/* Filters */}
      {total > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map((f) => {
            const count = f === 'all' ? total : f === 'at_risk' ? stats.atRisk : f === 'completed' ? stats.done : stats[f] ?? 0;
            const hasAlert = (f === 'overdue' && stats.overdue > 0) || (f === 'at_risk' && stats.atRisk > 0);
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all border flex items-center gap-1 ${filter === f
                  ? 'border-brand-500 bg-brand-500/20 text-brand-400'
                  : hasAlert ? 'border-white/20 text-white/50 hover:text-white/70' : 'border-white/10 text-white/30 hover:text-white/60'
                  }`}
              >
                {f.replace('_', ' ')}
                {count > 0 && f !== 'all' && (
                  <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full ${f === 'overdue' ? 'bg-rose-500/20 text-rose-400' : f === 'at_risk' ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-white/40'}`}>
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
          {[1, 2].map((n) => <div key={n} className="card h-48 animate-pulse bg-surface-800/50" />)}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-white/30 text-sm">
            {filter === 'all' ? 'No projects yet. Add one above and watch the agents work.' : `No ${filter.replace('_', ' ')} projects.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} onDeleted={handleProjectDeleted} />
          ))}
        </div>
      )}
    </div>
  );
}
