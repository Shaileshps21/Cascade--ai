import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import { Home, Map, CalendarClock, BookOpen, BarChart3, StickyNote, Settings, Hourglass, Lightbulb, AlertTriangle, RefreshCw, Calendar } from 'lucide-react';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import RiskMeter from '../components/RiskMeter.jsx';
import RoadmapTree from '../components/RoadmapTree.jsx';
import NextBestAction from '../components/NextBestAction.jsx';
import ResourceLink from '../components/ResourceLink.jsx';
import { getProject, deleteTask, replanTask, openAgentStream } from '../api/index.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'roadmap', label: 'Roadmap', icon: Map },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'resources', label: 'Resources', icon: BookOpen },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'settings', label: 'Settings', icon: Settings },
];

// ── Planning-parameter label maps (UPDATED_design.md §9.9) ────────────────────
const WORK_STYLE_LABELS = { day: 'Day', flexible: 'Flexible', night: 'Night' };
const WEEKEND_LABELS = {
  skip: 'Weekends skipped', light: 'Light weekends',
  normal: 'Full weekends', heavy: 'Weekend heavy',
};

function planningContextLine(project) {
  const parts = [];
  if (project.workStyle && WORK_STYLE_LABELS[project.workStyle]) parts.push(WORK_STYLE_LABELS[project.workStyle]);
  if (project.availableHoursPerDay != null) parts.push(`${project.availableHoursPerDay}h/day`);
  if (project.weekendMode && WEEKEND_LABELS[project.weekendMode]) parts.push(WEEKEND_LABELS[project.weekendMode]);
  return parts.join(' · ');
}

// Renders the deadline-feasibility agent's suggestion object in plain
// language. Falls back to a raw dump only for shapes we don't recognize,
// so an unexpected field never disappears silently.
function FeasibilitySuggestions({ suggestions }) {
  if (typeof suggestions === 'string') return <p className="flex items-start gap-1.5"><Hourglass className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {suggestions}</p>;

  const { suggestedDeadline, additionalWorkHoursNeeded, reducedScope, priorityReductions } = suggestions ?? {};
  const known = suggestedDeadline || additionalWorkHoursNeeded != null || reducedScope?.length || priorityReductions?.length;
  if (!known) return <p className="flex items-start gap-1.5"><Hourglass className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {JSON.stringify(suggestions)}</p>;

  return (
    <>
      <p className="flex items-start gap-1.5">
        <Hourglass className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        This deadline isn't achievable as planned
        {additionalWorkHoursNeeded != null && ` — about ${additionalWorkHoursNeeded}h more than available`}.
        {suggestedDeadline && ` Consider pushing the deadline to ${format(new Date(suggestedDeadline), 'MMM d, yyyy')},`}
        {' '}or trim scope:
      </p>
      {reducedScope?.length > 0 && (
        <ul className="list-disc list-inside pl-1">
          {reducedScope.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      {priorityReductions?.length > 0 && (
        <ul className="list-disc list-inside pl-1">
          {priorityReductions.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
    </>
  );
}

function HealthTile({ label, value, sub, color = 'text-primary' }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] text-muted uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ project }) {
  const health = project.health ?? {};
  const remainingTasks = project.subtasks.filter((t) => t.status !== 'completed');
  const deadline = project.deadline ? new Date(project.deadline) : null;
  const hrs = Math.floor(health.estimatedRemainingMinutes / 60);
  const mins = Math.round(health.estimatedRemainingMinutes % 60);

  return (
    <div className="space-y-5">
      <NextBestAction projectId={project.id} action={project.nextBestAction} />

      <div className="card p-5">
        <p className="text-xs text-muted uppercase tracking-wide font-semibold mb-2">Goal</p>
        <p className="text-sm text-secondary leading-relaxed">{project.rawGoal}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <HealthTile label="Completion" value={`${project.progress}%`} color="text-brand-500 font-mono tabular-nums" />
        <HealthTile
          label="Deadline"
          value={deadline ? format(deadline, 'MMM d') : '—'}
          sub={deadline ? (isPast(deadline) ? 'overdue' : formatDistanceToNow(deadline, { addSuffix: true })) : null}
        />
        <HealthTile label="Remaining work" value={`${remainingTasks.length} tasks`} sub={`~${hrs}h ${mins}m left`} />
        <HealthTile
          label="Current milestone"
          value={project.currentMilestoneTitle ?? '—'}
        />
      </div>

      <div>
        <p className="text-xs text-muted uppercase tracking-wide font-semibold mb-2">Project Health</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="card p-4 flex items-center gap-4">
            <RiskMeter score={health.scheduleRisk ?? 0} size="sm" />
            <div>
              <p className="text-xs text-secondary">Schedule Risk</p>
              <p className="text-[11px] text-muted mt-0.5">Live, recalculated from progress vs. time</p>
            </div>
          </div>
          <HealthTile label="Planning Confidence" value={`${health.planningConfidence ?? 70}%`} color="text-primary font-mono tabular-nums" />
          <HealthTile label="Knowledge Completion" value={`${health.knowledgeCompletion ?? 100}%`} color="text-primary font-mono tabular-nums" />
          <HealthTile label="Completion Probability" value={`${health.completionProbability ?? 100}%`} color="text-success font-mono tabular-nums" />
          <HealthTile label="Current Bottleneck" value={health.currentBottleneck ?? 'None'} />
          {project.schedulingScore != null && (
            <HealthTile label="Scheduling Score" value={`${project.schedulingScore}/100`} color="text-primary font-mono tabular-nums" />
          )}
        </div>
      </div>

      {(project.planningNotes || project.feasibilitySuggestions || project.schedulingWarnings?.length > 0) && (
        <div>
          <p className="text-xs text-muted uppercase tracking-wide font-semibold mb-2">AI Suggestions</p>
          <div className="space-y-2">
            {project.planningNotes && (
              <div className="card p-3 text-sm text-secondary leading-relaxed flex items-start gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {project.planningNotes}
              </div>
            )}
            {project.feasibilitySuggestions && (
              <div className="card p-3 text-sm text-warning leading-relaxed border border-warning/20 space-y-1">
                <FeasibilitySuggestions suggestions={project.feasibilitySuggestions} />
              </div>
            )}
            {project.schedulingWarnings?.map((w, i) => (
              <div key={i} className="card p-3 text-sm text-danger leading-relaxed border border-danger/20 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {w}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schedule tab ──────────────────────────────────────────────────────────────
function ScheduleTab({ project, onRescheduled }) {
  const [replanning, setReplanning] = useState(false);
  const [replanMessage, setReplanMessage] = useState(null);

  const scheduled = project.subtasks
    .filter((t) => t.scheduledStart)
    .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
  const unscheduled = project.subtasks.filter((t) => !t.scheduledStart && t.status !== 'completed');

  const handleReschedule = async () => {
    if (replanning) return;
    setReplanning(true);
    setReplanMessage(null);
    try {
      const { processId } = await replanTask(project.id);
      const stream = openAgentStream(processId);
      stream.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.status === 'complete' || data.status === 'error') {
          stream.close();
          setReplanning(false);
          setReplanMessage(data.status === 'complete' ? 'Schedule updated.' : (data.message || 'Reschedule failed.'));
          if (data.status === 'complete') onRescheduled?.();
          setTimeout(() => setReplanMessage(null), 4000);
        }
      };
      stream.onerror = () => {
        stream.close();
        setReplanning(false);
      };
    } catch (err) {
      setReplanning(false);
      setReplanMessage(err.message || 'Reschedule failed.');
    }
  };

  if (scheduled.length === 0 && unscheduled.length === 0) {
    return <div className="card p-8 text-center text-sm text-muted">Nothing scheduled yet.</div>;
  }

  const contextLine = planningContextLine(project);

  return (
    <div className="space-y-4">
      {contextLine && <p className="text-xs text-muted">Planning: {contextLine}</p>}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted">
          Missed or overrun tasks are re-scheduled automatically — or trigger it yourself:
        </p>
        <button
          type="button"
          onClick={handleReschedule}
          disabled={replanning}
          className="btn-ghost text-xs border border-border hover:border-brand-500/40 disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3 h-3 ${replanning ? 'animate-spin' : ''}`} /> {replanning ? 'Rescheduling…' : 'Reschedule now'}
        </button>
      </div>
      {replanMessage && <p className="text-xs text-secondary">{replanMessage}</p>}

      {scheduled.length === 0 && project.schedulingWarnings?.length > 0 && (
        <div className="space-y-2">
          {project.schedulingWarnings.map((w, i) => (
            <div key={i} className="card p-3 text-sm text-danger leading-relaxed border border-danger/20 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {w}
            </div>
          ))}
          {project.feasibilitySuggestions && (
            <div className="card p-3 text-sm text-warning leading-relaxed border border-warning/20 space-y-1">
              <FeasibilitySuggestions suggestions={project.feasibilitySuggestions} />
            </div>
          )}
        </div>
      )}
      {scheduled.length > 0 && (
        <div className="space-y-2">
          {scheduled.map((t) => (
            <div key={t.id} className="card p-3 flex items-center gap-3">
              <div className="w-24 flex-shrink-0 text-xs text-muted font-mono tabular-nums">
                {format(new Date(t.scheduledStart), 'MMM d, HH:mm')}
              </div>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.status === 'completed' ? 'bg-success' : 'bg-brand-400'}`} />
              <span className="text-sm text-secondary flex-1 min-w-0 truncate">{t.title}</span>
              {t.calendarEventId && (
                <span className="flex items-center gap-1 text-[10px] text-success flex-shrink-0">
                  <Calendar className="w-3 h-3" /> synced
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {unscheduled.length > 0 && (
        <div>
          <p className="text-xs text-muted uppercase tracking-wide font-semibold mb-2">Not yet scheduled</p>
          <div className="space-y-1.5">
            {unscheduled.map((t) => (
              <div key={t.id} className="text-sm text-secondary px-3 py-2 rounded-lg bg-surface-hover">{t.title}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Resources tab ─────────────────────────────────────────────────────────────
function ResourcesTab({ project }) {
  const byTask = project.subtasks.filter((t) => t.resources?.length > 0);
  if (byTask.length === 0) {
    return <div className="card p-8 text-center text-sm text-muted">No resources attached yet.</div>;
  }
  return (
    <div className="space-y-4">
      {byTask.map((t) => (
        <div key={t.id} className="card p-4">
          <p className="text-sm font-medium text-secondary mb-2">{t.title}</p>
          <div className="space-y-1.5">
            {t.resources.map((r, i) => <ResourceLink key={i} resource={r} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Analytics tab ─────────────────────────────────────────────────────────────
function AnalyticsTab({ project }) {
  const tasks = project.subtasks;
  const byDifficulty = tasks.reduce((acc, t) => {
    acc[t.difficulty] = (acc[t.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  const totalEstimated = tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const totalActual = tasks.reduce((sum, t) => sum + (t.actualMinutes ?? 0), 0);
  const withActuals = tasks.filter((t) => t.actualMinutes != null);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <HealthTile label="Total Tasks" value={tasks.length} color="text-primary font-mono tabular-nums" />
        <HealthTile label="Completed" value={tasks.filter((t) => t.status === 'completed').length} color="text-success font-mono tabular-nums" />
        <HealthTile label="Estimated" value={`${Math.round(totalEstimated / 60)}h`} color="text-primary font-mono tabular-nums" />
        <HealthTile
          label="Actual so far"
          value={withActuals.length > 0 ? `${Math.round(totalActual / 60)}h` : '—'}
          sub={withActuals.length > 0 ? `${withActuals.length} tasks logged` : 'No completions yet'}
          color="text-primary font-mono tabular-nums"
        />
      </div>

      <div>
        <p className="text-xs text-muted uppercase tracking-wide font-semibold mb-2">Difficulty Mix</p>
        <div className="space-y-1.5">
          {['low', 'medium', 'high', 'very_high'].filter((d) => byDifficulty[d]).map((d) => (
            <div key={d} className="flex items-center gap-3">
              <span className="text-xs text-muted w-16 capitalize">{d.replace('_', ' ')}</span>
              <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(byDifficulty[d] / tasks.length) * 100}%` }} />
              </div>
              <span className="text-xs text-muted w-6 text-right font-mono tabular-nums">{byDifficulty[d]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Notes tab ─────────────────────────────────────────────────────────────────
function NotesTab({ project }) {
  const withNotes = project.subtasks.filter((t) => (t.notes?.length ?? 0) > 0 || (typeof t.notes === 'string' && t.notes));
  if (withNotes.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        No notes yet. Notes are attached per task — open a task's workspace to add one.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {withNotes.map((t) => (
        <div key={t.id} className="card p-4">
          <p className="text-sm font-medium text-secondary mb-1.5">{t.title}</p>
          {(Array.isArray(t.notes) ? t.notes : [t.notes]).map((n, i) => (
            <p key={i} className="text-sm text-muted leading-relaxed">{typeof n === 'string' ? n : n?.text}</p>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────
function SettingsTab({ project }) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteTask(project.id);
      navigate('/');
    } catch (err) {
      alert(err.message);
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card p-4 space-y-3 text-sm">
        <div className="flex justify-between"><span className="text-muted">Category</span><span className="text-secondary capitalize">{project.category}</span></div>
        <div className="flex justify-between"><span className="text-muted">Complexity</span><span className="text-secondary capitalize">{project.complexity}</span></div>
        <div className="flex justify-between"><span className="text-muted">Urgency</span><span className="text-secondary">{project.urgency}</span></div>
        <div className="flex justify-between"><span className="text-muted">Pipeline version</span><span className="text-secondary font-mono">{project.pipelineVersion}</span></div>
        <div className="flex justify-between"><span className="text-muted">Re-planned</span><span className="text-secondary font-mono tabular-nums">{project.rePlannedCount}×</span></div>
        <div className="flex justify-between"><span className="text-muted">Created</span><span className="text-secondary">{format(new Date(project.createdAt), 'MMM d, yyyy')}</span></div>
      </div>

      <div className="card p-4 border border-danger/20">
        <p className="text-sm font-medium text-danger mb-1">Danger zone</p>
        <p className="text-xs text-muted mb-3">Deletes this project and any synced calendar events.</p>
        <button onClick={handleDelete} disabled={deleting} className="btn-ghost border border-danger/30 text-danger hover:bg-danger/10 text-sm">
          {deleting ? 'Deleting…' : 'Delete Project'}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Active tab (and, for the Roadmap tab, which milestone/module is expanded)
  // lives in the URL rather than component state — component state resets to
  // its default on every remount, so the browser Back button from a task
  // page always landed on the Overview tab with the roadmap collapsed,
  // regardless of what was actually open before navigating away. Updates use
  // `replace` so expanding/collapsing doesn't itself pile up Back-button
  // stops; the real stop is the one navigating to a task already creates.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';
  const openMilestoneId = searchParams.get('milestone');
  const openModuleId = searchParams.get('module');

  const setTab = (id) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', id);
    return next;
  }, { replace: true });

  const setOpenMilestone = (id) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set('milestone', id); else next.delete('milestone');
    next.delete('module');
    return next;
  }, { replace: true });

  const setOpenModule = (id) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (id) next.set('module', id); else next.delete('module');
    return next;
  }, { replace: true });

  const fetchProject = useCallback(async () => {
    try {
      const { project: fetched } = await getProject(projectId);
      setProject(fetched);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="card h-40 animate-pulse bg-surface-hover" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: 'Not found' }]} />
        <div className="card p-8 text-center text-sm text-danger">{error || 'Project not found'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: project.title }]} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-primary">{project.title}</h1>
          <p className="text-sm text-muted mt-1">
            <span className="font-mono tabular-nums">{project.progress}%</span> complete
            {project.deadline && ` · due ${format(new Date(project.deadline), 'MMM d, yyyy')}`}
          </p>
          {planningContextLine(project) && (
            <p className="text-xs text-muted mt-0.5">{planningContextLine(project)}</p>
          )}
        </div>
        <div className="w-16 h-16 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" className="text-border" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" className="text-brand-500" strokeWidth="3"
              strokeDasharray={`${(project.progress / 100) * 97.4} 97.4`} strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-brand-500 text-primary' : 'border-transparent text-muted hover:text-secondary'
              }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab project={project} />}
      {tab === 'roadmap' && (
        <RoadmapTree
          projectId={project.id}
          milestones={project.milestones}
          openMilestoneId={openMilestoneId}
          openModuleId={openModuleId}
          onOpenMilestone={setOpenMilestone}
          onOpenModule={setOpenModule}
        />
      )}
      {tab === 'schedule' && <ScheduleTab project={project} onRescheduled={fetchProject} />}
      {tab === 'resources' && <ResourcesTab project={project} />}
      {tab === 'analytics' && <AnalyticsTab project={project} />}
      {tab === 'notes' && <NotesTab project={project} />}
      {tab === 'settings' && <SettingsTab project={project} />}
    </div>
  );
}
