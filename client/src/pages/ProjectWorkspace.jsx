import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import RiskMeter from '../components/RiskMeter.jsx';
import RoadmapTree from '../components/RoadmapTree.jsx';
import NextBestAction from '../components/NextBestAction.jsx';
import ResourceLink from '../components/ResourceLink.jsx';
import { getProject, deleteTask, replanTask, openAgentStream } from '../api/index.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '🏠' },
  { id: 'roadmap', label: 'Roadmap', icon: '🗺️' },
  { id: 'schedule', label: 'Schedule', icon: '🗓️' },
  { id: 'resources', label: 'Resources', icon: '📚' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
  { id: 'notes', label: 'Notes', icon: '📝' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

// Renders the deadline-feasibility agent's suggestion object in plain
// language. Falls back to a raw dump only for shapes we don't recognize,
// so an unexpected field never disappears silently.
function FeasibilitySuggestions({ suggestions }) {
  if (typeof suggestions === 'string') return <p>⏳ {suggestions}</p>;

  const { suggestedDeadline, additionalWorkHoursNeeded, reducedScope, priorityReductions } = suggestions ?? {};
  const known = suggestedDeadline || additionalWorkHoursNeeded != null || reducedScope?.length || priorityReductions?.length;
  if (!known) return <p>⏳ {JSON.stringify(suggestions)}</p>;

  return (
    <>
      <p>
        ⏳ This deadline isn't achievable as planned
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

function HealthTile({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] text-white/35 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-white/30 mt-0.5">{sub}</p>}
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
        <p className="text-xs text-white/35 uppercase tracking-wide font-semibold mb-2">Goal</p>
        <p className="text-sm text-white/70 leading-relaxed">{project.rawGoal}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <HealthTile label="Completion" value={`${project.progress}%`} color="text-brand-400" />
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
        <p className="text-xs text-white/35 uppercase tracking-wide font-semibold mb-2">Project Health</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="card p-4 flex items-center gap-4">
            <RiskMeter score={health.scheduleRisk ?? 0} size="sm" />
            <div>
              <p className="text-xs text-white/50">Schedule Risk</p>
              <p className="text-[11px] text-white/30 mt-0.5">Live, recalculated from progress vs. time</p>
            </div>
          </div>
          <HealthTile label="Planning Confidence" value={`${health.planningConfidence ?? 70}%`} />
          <HealthTile label="Knowledge Completion" value={`${health.knowledgeCompletion ?? 100}%`} />
          <HealthTile label="Completion Probability" value={`${health.completionProbability ?? 100}%`} color="text-emerald-400" />
          <HealthTile label="Current Bottleneck" value={health.currentBottleneck ?? 'None'} />
          {project.schedulingScore != null && (
            <HealthTile label="Scheduling Score" value={`${project.schedulingScore}/100`} />
          )}
        </div>
      </div>

      {(project.planningNotes || project.feasibilitySuggestions || project.schedulingWarnings?.length > 0) && (
        <div>
          <p className="text-xs text-white/35 uppercase tracking-wide font-semibold mb-2">AI Suggestions</p>
          <div className="space-y-2">
            {project.planningNotes && (
              <div className="card p-3 text-sm text-white/60 leading-relaxed">💡 {project.planningNotes}</div>
            )}
            {project.feasibilitySuggestions && (
              <div className="card p-3 text-sm text-amber-300/80 leading-relaxed border border-amber-500/20 space-y-1">
                <FeasibilitySuggestions suggestions={project.feasibilitySuggestions} />
              </div>
            )}
            {project.schedulingWarnings?.map((w, i) => (
              <div key={i} className="card p-3 text-sm text-rose-300/80 leading-relaxed border border-rose-500/20">⚠️ {w}</div>
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
    return <div className="card p-8 text-center text-sm text-white/30">Nothing scheduled yet.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-white/35">
          Missed or overrun tasks are re-scheduled automatically — or trigger it yourself:
        </p>
        <button
          type="button"
          onClick={handleReschedule}
          disabled={replanning}
          className="btn-ghost text-xs border border-white/10 hover:border-brand-500/40 disabled:opacity-50"
        >
          {replanning ? '🔄 Rescheduling…' : '🔄 Reschedule now'}
        </button>
      </div>
      {replanMessage && <p className="text-xs text-white/50">{replanMessage}</p>}

      {scheduled.length === 0 && project.schedulingWarnings?.length > 0 && (
        <div className="space-y-2">
          {project.schedulingWarnings.map((w, i) => (
            <div key={i} className="card p-3 text-sm text-rose-300/80 leading-relaxed border border-rose-500/20">⚠️ {w}</div>
          ))}
          {project.feasibilitySuggestions && (
            <div className="card p-3 text-sm text-amber-300/80 leading-relaxed border border-amber-500/20 space-y-1">
              <FeasibilitySuggestions suggestions={project.feasibilitySuggestions} />
            </div>
          )}
        </div>
      )}
      {scheduled.length > 0 && (
        <div className="space-y-2">
          {scheduled.map((t) => (
            <div key={t.id} className="card p-3 flex items-center gap-3">
              <div className="w-24 flex-shrink-0 text-xs text-white/40 font-mono">
                {format(new Date(t.scheduledStart), 'MMM d, HH:mm')}
              </div>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.status === 'completed' ? 'bg-emerald-400' : 'bg-brand-400'}`} />
              <span className="text-sm text-white/70 flex-1 min-w-0 truncate">{t.title}</span>
              {t.calendarEventId && <span className="text-[10px] text-emerald-400 flex-shrink-0">📅 synced</span>}
            </div>
          ))}
        </div>
      )}
      {unscheduled.length > 0 && (
        <div>
          <p className="text-xs text-white/35 uppercase tracking-wide font-semibold mb-2">Not yet scheduled</p>
          <div className="space-y-1.5">
            {unscheduled.map((t) => (
              <div key={t.id} className="text-sm text-white/50 px-3 py-2 rounded-lg bg-white/5">{t.title}</div>
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
    return <div className="card p-8 text-center text-sm text-white/30">No resources attached yet.</div>;
  }
  return (
    <div className="space-y-4">
      {byTask.map((t) => (
        <div key={t.id} className="card p-4">
          <p className="text-sm font-medium text-white/80 mb-2">{t.title}</p>
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
        <HealthTile label="Total Tasks" value={tasks.length} />
        <HealthTile label="Completed" value={tasks.filter((t) => t.status === 'completed').length} color="text-emerald-400" />
        <HealthTile label="Estimated" value={`${Math.round(totalEstimated / 60)}h`} />
        <HealthTile
          label="Actual so far"
          value={withActuals.length > 0 ? `${Math.round(totalActual / 60)}h` : '—'}
          sub={withActuals.length > 0 ? `${withActuals.length} tasks logged` : 'No completions yet'}
        />
      </div>

      <div>
        <p className="text-xs text-white/35 uppercase tracking-wide font-semibold mb-2">Difficulty Mix</p>
        <div className="space-y-1.5">
          {['low', 'medium', 'high', 'very_high'].filter((d) => byDifficulty[d]).map((d) => (
            <div key={d} className="flex items-center gap-3">
              <span className="text-xs text-white/40 w-16 capitalize">{d.replace('_', ' ')}</span>
              <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-brand-500/60 rounded-full" style={{ width: `${(byDifficulty[d] / tasks.length) * 100}%` }} />
              </div>
              <span className="text-xs text-white/40 w-6 text-right">{byDifficulty[d]}</span>
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
      <div className="card p-8 text-center text-sm text-white/30">
        No notes yet. Notes are attached per task — open a task's workspace to add one.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {withNotes.map((t) => (
        <div key={t.id} className="card p-4">
          <p className="text-sm font-medium text-white/80 mb-1.5">{t.title}</p>
          {(Array.isArray(t.notes) ? t.notes : [t.notes]).map((n, i) => (
            <p key={i} className="text-sm text-white/50 leading-relaxed">{typeof n === 'string' ? n : n?.text}</p>
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
        <div className="flex justify-between"><span className="text-white/40">Category</span><span className="text-white/70 capitalize">{project.category}</span></div>
        <div className="flex justify-between"><span className="text-white/40">Complexity</span><span className="text-white/70 capitalize">{project.complexity}</span></div>
        <div className="flex justify-between"><span className="text-white/40">Urgency</span><span className="text-white/70">{project.urgency}</span></div>
        <div className="flex justify-between"><span className="text-white/40">Pipeline version</span><span className="text-white/70 font-mono">{project.pipelineVersion}</span></div>
        <div className="flex justify-between"><span className="text-white/40">Re-planned</span><span className="text-white/70">{project.rePlannedCount}×</span></div>
        <div className="flex justify-between"><span className="text-white/40">Created</span><span className="text-white/70">{format(new Date(project.createdAt), 'MMM d, yyyy')}</span></div>
      </div>

      <div className="card p-4 border border-rose-500/20">
        <p className="text-sm font-medium text-rose-400 mb-1">Danger zone</p>
        <p className="text-xs text-white/40 mb-3">Deletes this project and any synced calendar events.</p>
        <button onClick={handleDelete} disabled={deleting} className="btn-ghost border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-sm">
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
  const [tab, setTab] = useState('overview');

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
        <div className="card h-40 animate-pulse bg-surface-800/50" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: 'Not found' }]} />
        <div className="card p-8 text-center text-sm text-rose-400">{error || 'Project not found'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: project.title }]} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">{project.title}</h1>
          <p className="text-sm text-white/40 mt-1">
            {project.progress}% complete
            {project.deadline && ` · due ${format(new Date(project.deadline), 'MMM d, yyyy')}`}
          </p>
        </div>
        <div className="w-16 h-16 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1c2136" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15.5" fill="none" stroke="#6366f1" strokeWidth="3"
              strokeDasharray={`${(project.progress / 100) * 97.4} 97.4`} strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/5 mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-brand-500 text-white' : 'border-transparent text-white/40 hover:text-white/70'
              }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab project={project} />}
      {tab === 'roadmap' && <RoadmapTree projectId={project.id} milestones={project.milestones} />}
      {tab === 'schedule' && <ScheduleTab project={project} onRescheduled={fetchProject} />}
      {tab === 'resources' && <ResourcesTab project={project} />}
      {tab === 'analytics' && <AnalyticsTab project={project} />}
      {tab === 'notes' && <NotesTab project={project} />}
      {tab === 'settings' && <SettingsTab project={project} />}
    </div>
  );
}
