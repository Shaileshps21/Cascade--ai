import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import ExecutionStepItem from '../components/ExecutionStepItem.jsx';
import FocusMode from '../components/FocusMode.jsx';
import ResourceLink from '../components/ResourceLink.jsx';
import { getProjectTask, updateExecutionStep } from '../api/index.js';

const DIFFICULTY_COLOR = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-rose-400', very_high: 'text-rose-500' };

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs text-white/35 uppercase tracking-wide font-semibold mb-2">{title}</p>
      {children}
    </div>
  );
}

function BulletList({ items, icon = '•' }) {
  if (!items || items.length === 0) return <p className="text-sm text-white/25">None listed.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-white/60 leading-relaxed flex gap-2">
          <span className="text-white/25 flex-shrink-0">{icon}</span>
          <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
        </li>
      ))}
    </ul>
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
            <span className={`w-2.5 h-2.5 rounded-full ${s.at ? 'bg-brand-400' : 'bg-white/10'}`} />
            <span className={`text-[11px] whitespace-nowrap ${s.at ? 'text-white/60' : 'text-white/25'}`}>{s.label}</span>
            {s.at && <span className="text-[10px] text-white/25 whitespace-nowrap">{format(new Date(s.at), 'MMM d')}</span>}
          </div>
          {i < stages.length - 1 && <div className={`w-8 h-px flex-shrink-0 ${s.at ? 'bg-brand-400/40' : 'bg-white/10'}`} />}
        </div>
      ))}
    </div>
  );
}

export default function TaskWorkspace() {
  const { projectId, taskId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focusMode, setFocusMode] = useState(false);

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
        <div className="card h-40 animate-pulse bg-surface-800/50" />
      </div>
    );
  }

  if (error || !data?.task) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: 'Not found' }]} />
        <div className="card p-8 text-center text-sm text-rose-400">{error || 'Task not found'}</div>
      </div>
    );
  }

  const { project, task } = data;

  if (focusMode) {
    return (
      <FocusMode
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
            <span className={`text-xs font-semibold capitalize ${DIFFICULTY_COLOR[task.difficulty] || 'text-white/40'}`}>{task.difficulty?.replace('_', ' ')}</span>
            <span className="text-white/15">·</span>
            <span className="text-xs text-white/40 capitalize">{task.priority} priority</span>
            {task.status === 'completed' && <span className="text-xs text-emerald-400">· ✓ Completed</span>}
          </div>
          <h1 className="text-2xl font-bold text-white">{task.title}</h1>
        </div>
        <button onClick={() => setFocusMode(true)} className="btn-primary flex-shrink-0">▶ Start Working</button>
      </div>

      {/* Progress */}
      <div className="card p-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-white/40">Progress</span>
          <span className="font-semibold text-white/70">{task.progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-500" style={{ width: `${task.progress}%` }} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <div><span className="text-white/30">Estimated</span><p className="text-white/70 font-medium mt-0.5">{task.estimatedMinutes ?? '—'} min</p></div>
          <div><span className="text-white/30">Actual</span><p className="text-white/70 font-medium mt-0.5">{task.actualMinutes ?? '—'} min</p></div>
          <div><span className="text-white/30">Dependencies</span><p className="text-white/70 font-medium mt-0.5">{task.dependencies?.length || 'None'}</p></div>
          <div><span className="text-white/30">Steps</span><p className="text-white/70 font-medium mt-0.5">{sortedSteps.filter(s => s.status === 'completed').length}/{sortedSteps.length}</p></div>
        </div>
      </div>

      {task.overview && (
        <Section title="Overview">
          <p className="text-sm text-white/60 leading-relaxed">{task.overview}</p>
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

      {task.notes?.length > 0 && (
        <Section title="Notes">
          <BulletList items={task.notes.map((n) => (typeof n === 'string' ? n : n?.text))} icon="📝" />
        </Section>
      )}

      <Section title="History">
        <TaskTimeline project={project} task={task} />
      </Section>
    </div>
  );
}
