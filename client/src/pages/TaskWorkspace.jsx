import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import ExecutionStepItem from '../components/ExecutionStepItem.jsx';
import FocusMode from '../components/FocusMode.jsx';
import ResourceLink from '../components/ResourceLink.jsx';
import MarkdownText from '../components/MarkdownText.jsx';
import { getProjectTask, updateExecutionStep, setTaskNote } from '../api/index.js';
import { useFocusTimer } from '../context/FocusTimerContext.jsx';

const DIFFICULTY_COLOR = { low: 'text-success', medium: 'text-warning', high: 'text-danger', very_high: 'text-danger' };

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs text-muted uppercase tracking-wide font-semibold mb-2">{title}</p>
      {children}
    </div>
  );
}

function BulletList({ items, icon = '•' }) {
  if (!items || items.length === 0) return <p className="text-sm text-muted">None listed.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-secondary leading-relaxed flex gap-2">
          <span className="text-muted flex-shrink-0">{icon}</span>
          <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
        </li>
      ))}
    </ul>
  );
}

// TaskNote — a single free-text markdown note per task, separate from
// per-step notes and completionEvidence (suggestions.md #4).
function TaskNote({ projectId, taskId, initialText, onSaved }) {
  const [editing, setEditing] = useState(!initialText);
  const [text, setText] = useState(initialText ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (text === (initialText ?? '')) { setEditing(false); return; }
    setSaving(true);
    try {
      await setTaskNote(projectId, taskId, text);
      onSaved?.(text);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  return (
    <div>
      {!editing && (
        <div className="flex justify-end mb-1">
          <button onClick={() => setEditing(true)} className="text-xs text-brand-500 hover:text-brand-400">
            {initialText ? 'Edit' : '+ Add note'}
          </button>
        </div>
      )}
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          disabled={saving}
          autoFocus
          rows={3}
          placeholder="Add a note for this task..."
          className="input-field text-sm"
        />
      ) : (
        <MarkdownText text={initialText} className="text-sm text-secondary leading-relaxed" />
      )}
    </div>
  );
}

function TaskTimeline({ project, task }) {
  const started = task.executionSteps
    .map((s) => s.startedAt)
    .filter(Boolean)
    .sort()[0];

  const stages = [
    { label: 'Created', at: project.createdAt },
    { label: 'Scheduled', at: task.scheduledStart },
    { label: 'Started', at: started },
    { label: 'Completed', at: task.completedAt },
    { label: 'Reviewed', at: task.reviewRequired && task.completedAt ? null : undefined },
  ].filter((s) => s.at !== undefined);

  return (
    <div className="flex items-center gap-0 overflow-x-auto">
      {stages.map((s, i) => (
        <div key={s.label} className="flex items-center flex-shrink-0">
          <div className="flex flex-col items-center gap-1.5 px-2">
            <span className={`w-2.5 h-2.5 rounded-full ${s.at ? 'bg-brand-400' : 'bg-border'}`} />
            <span className={`text-[11px] whitespace-nowrap ${s.at ? 'text-secondary' : 'text-muted'}`}>{s.label}</span>
            {s.at && <span className="text-[10px] text-muted whitespace-nowrap">{format(new Date(s.at), 'MMM d')}</span>}
          </div>
          {i < stages.length - 1 && <div className={`w-8 h-px flex-shrink-0 ${s.at ? 'bg-brand-400/40' : 'bg-border'}`} />}
        </div>
      ))}
    </div>
  );
}

export default function TaskWorkspace() {
  const { projectId, taskId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { session: focusSession, discardSession } = useFocusTimer();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focusMode, setFocusMode] = useState(false);
  const prevSessionKeyRef = useRef(null);

  const fetchTask = useCallback(async () => {
    try {
      const res = await getProjectTask(projectId, taskId);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  // "Resume Focus Mode" (from the persistent FocusTimerBar shown elsewhere
  // in the app) navigates here with router state rather than relying on
  // route params alone — navigating to a path you're already on doesn't
  // re-trigger a param-keyed effect, so clicking the bar's button while
  // already sitting on this exact task's page would otherwise do nothing.
  // The flag is cleared right after so a later refresh/back-navigation to
  // this same URL doesn't reopen the overlay on its own.
  useEffect(() => {
    if (location.state?.openFocusMode) {
      setFocusMode(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  // If a session for this exact task ends elsewhere (e.g. "✓ Complete" or
  // discard clicked on the persistent FocusTimerBar while this page's own
  // overlay is closed), refetch so the step list doesn't keep showing a now
  // stale in-progress/incomplete state. Keyed by projectId+taskId together —
  // taskIds like "T1" are only unique *within* a project, so comparing
  // taskId alone would misfire when a different project's task happens to
  // share the same id.
  useEffect(() => {
    const matches = focusSession && focusSession.projectId === projectId && focusSession.taskId === taskId;
    const key = matches ? `${focusSession.projectId}:${focusSession.taskId}` : null;
    const wasThisTask = prevSessionKeyRef.current === `${projectId}:${taskId}`;
    if (wasThisTask && !key) fetchTask();
    prevSessionKeyRef.current = key;
  }, [focusSession, projectId, taskId, fetchTask]);

  // A background Focus Mode session can be running on this task's step while
  // the user finishes the work by clicking the plain checkboxes on this page
  // instead of through the Focus Mode overlay/bar. That never goes through
  // completeSession()/discardSession(), so the session would otherwise sit
  // in sessionStorage forever "focusing" on a step that's already done (or a
  // task that's already fully completed). Whenever fresh task data shows
  // that, clear it.
  useEffect(() => {
    if (!data?.task || !focusSession) return;
    if (focusSession.projectId !== projectId || focusSession.taskId !== taskId) return;
    const trackedStep = data.task.executionSteps.find((s) => (s.id ?? s.stepId) === focusSession.stepId);
    if (data.task.status === 'completed' || trackedStep?.status === 'completed') {
      discardSession();
    }
  }, [data, focusSession, projectId, taskId, discardSession]);

  const handleStepUpdate = async (stepId, patch) => {
    await updateExecutionStep(projectId, taskId, stepId, patch);
    await fetchTask();
  };

  const currentStep = useMemo(() => {
    if (!data?.task) return null;
    const steps = [...data.task.executionSteps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return steps.find((s) => s.status === 'in_progress')
      ?? steps.find((s) => s.status !== 'completed' && !(s.isOptional && s.status === 'skipped'))
      ?? null;
  }, [data]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="card h-40 animate-pulse bg-surface-hover" />
      </div>
    );
  }

  if (error || !data?.task) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: 'Not found' }]} />
        <div className="card p-8 text-center text-sm text-danger">{error || 'Task not found'}</div>
      </div>
    );
  }

  const { project, task } = data;

  if (focusMode) {
    return (
      <FocusMode
        projectId={projectId}
        task={task}
        step={currentStep}
        onUpdate={handleStepUpdate}
        onClose={() => { setFocusMode(false); fetchTask(); }}
      />
    );
  }

  const sortedSteps = [...task.executionSteps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', to: '/' },
        { label: project.title, to: `/projects/${projectId}` },
        { label: task.title },
      ]} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-xs font-semibold capitalize ${DIFFICULTY_COLOR[task.difficulty] || 'text-muted'}`}>{task.difficulty?.replace('_', ' ')}</span>
            <span className="text-muted">·</span>
            <span className="text-xs text-muted capitalize">{task.priority} priority</span>
            {task.scheduledStart && (
              <>
                <span className="text-muted">·</span>
                {task.rescheduleCount > 0 && task.originalScheduledStart ? (
                  <span className="text-xs text-muted">
                    <span className="line-through">{format(new Date(task.originalScheduledStart), 'MMM d, h:mm a')}</span>
                    {' → '}
                    <span className="text-warning font-medium">{format(new Date(task.scheduledStart), 'MMM d, h:mm a')}</span>
                    {' '}(rescheduled {task.rescheduleCount}x)
                  </span>
                ) : (
                  <span className="text-xs text-muted">{format(new Date(task.scheduledStart), 'MMM d, h:mm a')}</span>
                )}
              </>
            )}
            {task.deadline && (
              <>
                <span className="text-muted">·</span>
                <span className="text-xs text-muted">Due {format(new Date(task.deadline), 'MMM d, yyyy')}</span>
              </>
            )}
            {task.status === 'completed' && <span className="text-xs text-success">· ✓ Completed</span>}
          </div>
          <h1 className="text-2xl font-bold text-primary">{task.title}</h1>
        </div>
        <button onClick={() => setFocusMode(true)} className="btn-primary flex-shrink-0">▶ Start Working</button>
      </div>

      {/* Progress */}
      <div className="card p-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted">Progress</span>
          <span className="font-semibold text-secondary font-mono tabular-nums">{task.progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-border overflow-hidden">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${task.progress}%` }} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <div><span className="text-muted">Estimated</span><p className="text-secondary font-medium mt-0.5 font-mono tabular-nums">{task.estimatedMinutes ?? '—'} min</p></div>
          <div><span className="text-muted">Actual</span><p className="text-secondary font-medium mt-0.5 font-mono tabular-nums">{task.actualMinutes ?? '—'} min</p></div>
          <div><span className="text-muted">Dependencies</span><p className="text-secondary font-medium mt-0.5">{task.dependencies?.length || 'None'}</p></div>
          <div><span className="text-muted">Steps</span><p className="text-secondary font-medium mt-0.5 font-mono tabular-nums">{sortedSteps.filter(s => s.status === 'completed').length}/{sortedSteps.length}</p></div>
        </div>
      </div>

      {task.overview && (
        <Section title="Overview">
          <p className="text-sm text-secondary leading-relaxed">{task.overview}</p>
        </Section>
      )}

      <Section title="Objectives"><BulletList items={task.objectives} icon="🎯" /></Section>

      {/* Execution steps */}
      <Section title={`Execution Steps (${sortedSteps.length})`}>
        <div className="space-y-2">
          {sortedSteps.map((step) => (
            <ExecutionStepItem key={step.id} step={step} onUpdate={(patch) => handleStepUpdate(step.id, patch)} />
          ))}
        </div>
      </Section>

      {task.deliverables?.length > 0 && <Section title="Deliverables"><BulletList items={task.deliverables} icon="📦" /></Section>}
      {task.successCriteria?.length > 0 && <Section title="Success Criteria"><BulletList items={task.successCriteria} icon="✅" /></Section>}
      {task.commonMistakes?.length > 0 && <Section title="Common Mistakes"><BulletList items={task.commonMistakes} icon="⚠️" /></Section>}
      {task.aiGuidance?.length > 0 && <Section title="AI Guidance"><BulletList items={task.aiGuidance} icon="💡" /></Section>}
      {task.reflectionQuestions?.length > 0 && <Section title="Reflection Questions"><BulletList items={task.reflectionQuestions} icon="❓" /></Section>}

      {task.resources?.length > 0 && (
        <Section title="Resources">
          <div className="space-y-1.5">
            {task.resources.map((r, i) => <ResourceLink key={i} resource={r} className="text-sm" />)}
          </div>
        </Section>
      )}

      <Section title="Notes">
        <TaskNote
          projectId={projectId}
          taskId={task.id}
          initialText={typeof task.notes?.[0] === 'string' ? task.notes[0] : task.notes?.[0]?.text ?? ''}
          onSaved={() => fetchTask()}
        />
      </Section>

      <Section title="History">
        <TaskTimeline project={project} task={task} />
      </Section>
    </div>
  );
}
