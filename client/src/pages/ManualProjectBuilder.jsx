import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { createManualProject } from '../api/index.js';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const PRIORITY_STYLES = {
  low: 'text-muted border-border',
  medium: 'text-warning border-warning/30',
  high: 'text-orange-400 border-orange-500/30',
  critical: 'text-danger border-danger/30',
};

let uid = 0;
const nextId = () => `local-${++uid}-${Date.now()}`;

function newSubtask() {
  return { id: nextId(), title: '', estimatedMinutes: '', priority: 'medium', deadline: '', startTime: '' };
}

function newModule() {
  return { id: nextId(), title: '', subtasks: [newSubtask()] };
}

/**
 * ManualProjectBuilder — "Manual Todo Mode" (AI-optional fallback).
 * Lets the user create a project by hand: title, modules, subtasks with
 * estimates/priority/deadline. No SSE, no agents — POSTs straight to
 * /api/tasks/manual, which writes the same PlanningContext schema the AI
 * pipeline produces, so every other view (Project Workspace, Task Workspace,
 * archive) works with zero extra code. Useful when the API quota is
 * exhausted, offline, or the user already has a plan in mind.
 */
export default function ManualProjectBuilder() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [calendarSync, setCalendarSync] = useState(true);
  const [modules, setModules] = useState([newModule()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const totalMinutes = modules.reduce(
    (sum, m) => sum + m.subtasks.reduce((s, t) => s + (Number(t.estimatedMinutes) || 0), 0),
    0
  );
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const totalSubtasks = modules.reduce((n, m) => n + m.subtasks.length, 0);
  const scheduledSubtasks = modules.reduce(
    (n, m) => n + m.subtasks.filter((s) => s.title.trim() && s.startTime).length,
    0
  );
  // Calendar sync fires immediately on save only when every titled subtask
  // has a start time — a partially-timed project still needs "Let AI
  // enhance" to fill in the rest before anything can go on the calendar.
  const allSubtasksScheduled = totalSubtasks > 0 && scheduledSubtasks === totalSubtasks;

  const updateModule = (moduleId, patch) => {
    setModules((prev) => prev.map((m) => (m.id === moduleId ? { ...m, ...patch } : m)));
  };

  const updateSubtask = (moduleId, subtaskId, patch) => {
    setModules((prev) =>
      prev.map((m) =>
        m.id !== moduleId
          ? m
          : { ...m, subtasks: m.subtasks.map((s) => (s.id === subtaskId ? { ...s, ...patch } : s)) }
      )
    );
  };

  const addModule = () => setModules((prev) => [...prev, newModule()]);
  const removeModule = (moduleId) => setModules((prev) => prev.filter((m) => m.id !== moduleId));

  const addSubtask = (moduleId) =>
    updateModule(moduleId, {
      subtasks: [...modules.find((m) => m.id === moduleId).subtasks, newSubtask()],
    });

  const removeSubtask = (moduleId, subtaskId) => {
    const mod = modules.find((m) => m.id === moduleId);
    updateModule(moduleId, { subtasks: mod.subtasks.filter((s) => s.id !== subtaskId) });
  };

  const handleSave = async () => {
    if (saving) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Give your project a title.'); return; }

    const cleanModules = modules
      .map((m) => ({
        title: m.title.trim(),
        subtasks: m.subtasks
          .filter((s) => s.title.trim())
          .map((s) => ({
            title: s.title.trim(),
            estimatedMinutes: s.estimatedMinutes ? Number(s.estimatedMinutes) : undefined,
            priority: s.priority,
            deadline: s.deadline ? new Date(s.deadline).toISOString() : undefined,
            startTime: s.startTime ? new Date(s.startTime).toISOString() : undefined,
          })),
      }))
      .filter((m) => m.title && m.subtasks.length > 0);

    if (cleanModules.length === 0) {
      setError('Add at least one module with a titled subtask.');
      return;
    }
    if (deadline && new Date(deadline) <= new Date()) {
      setError('Deadline must be in the future.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      const { taskId } = await createManualProject({
        title: trimmedTitle,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        calendarSync,
        modules: cleanModules,
      });
      navigate(`/projects/${taskId}`);
    } catch (err) {
      setError(err.message || 'Failed to save project.');
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: 'Add manually' }]} />

      <div>
        <h1 className="text-2xl font-bold text-primary">✏️ Build a project manually</h1>
        <p className="text-sm text-muted mt-1">
          Skip the AI pipeline — type your milestones and subtasks directly. Works offline, and
          even when the API quota is exhausted. You can always press "Let AI enhance" later.
        </p>
      </div>

      {/* Project title + deadline */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="text-xs text-muted uppercase tracking-wide font-semibold">Project title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Launch the new landing page"
            className="input-field mt-1.5"
          />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="text-xs text-muted uppercase tracking-wide font-semibold">
              Overall deadline (optional)
            </label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="input-field mt-1.5 text-sm"
            />
          </div>
          {profile?.calendarConnected && (
            <div className="mt-5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={calendarSync}
                  onChange={(e) => setCalendarSync(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-brand-500 cursor-pointer"
                />
                <span className="text-xs text-muted hover:text-secondary transition-colors">
                  📅 Sync to Google Calendar
                </span>
              </label>
              {calendarSync && (
                <p className="text-[11px] text-muted mt-1 pl-5.5">
                  {allSubtasksScheduled
                    ? 'Every subtask has a start time — this will sync to your calendar as soon as you save.'
                    : `Give every subtask a start time to sync immediately (${scheduledSubtasks}/${totalSubtasks} set) — otherwise sync happens once you "Let AI enhance" this project.`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modules */}
      <div className="space-y-4">
        {modules.map((mod, mi) => (
          <div key={mod.id} className="card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted font-mono flex-shrink-0">M{mi + 1}</span>
              <input
                value={mod.title}
                onChange={(e) => updateModule(mod.id, { title: e.target.value })}
                placeholder="Module name (e.g. Design)"
                className="input-field flex-1 font-medium"
              />
              {modules.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeModule(mod.id)}
                  className="text-muted hover:text-danger transition-colors px-1.5 flex-shrink-0"
                  title="Remove module"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="space-y-2 pl-2 sm:pl-6 border-l border-border">
              {mod.subtasks.map((st) => (
                <div key={st.id} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <input
                    value={st.title}
                    onChange={(e) => updateSubtask(mod.id, st.id, { title: e.target.value })}
                    placeholder="Subtask title"
                    className="input-field flex-1 min-w-[140px] text-sm py-1.5"
                  />
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={st.estimatedMinutes}
                    onChange={(e) => updateSubtask(mod.id, st.id, { estimatedMinutes: e.target.value })}
                    placeholder="min"
                    className="input-field w-20 text-sm py-1.5"
                    title="Estimated minutes"
                  />
                  <select
                    value={st.priority}
                    onChange={(e) => updateSubtask(mod.id, st.id, { priority: e.target.value })}
                    className={`input-field w-28 text-xs py-1.5 capitalize border ${PRIORITY_STYLES[st.priority] || ''}`}
                  >
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input
                    type="date"
                    value={st.deadline}
                    onChange={(e) => updateSubtask(mod.id, st.id, { deadline: e.target.value })}
                    className="input-field w-36 text-xs py-1.5"
                    title="Subtask deadline (optional)"
                  />
                  <input
                    type="datetime-local"
                    value={st.startTime}
                    onChange={(e) => updateSubtask(mod.id, st.id, { startTime: e.target.value })}
                    className="input-field w-44 text-xs py-1.5"
                    title="Start time (optional) — set this to place the subtask on your calendar"
                  />
                  {mod.subtasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSubtask(mod.id, st.id)}
                      className="text-muted hover:text-danger transition-colors px-1 flex-shrink-0"
                      title="Remove subtask"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addSubtask(mod.id)}
                className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
              >
                + Add subtask
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addModule}
          className="w-full py-2.5 rounded-xl border border-dashed border-border text-sm text-muted hover:text-secondary hover:border-border-strong transition-colors"
        >
          + Add module
        </button>
      </div>

      {/* Running total + save */}
      <div className="card p-4 flex items-center justify-between flex-wrap gap-3 sticky bottom-4">
        <p className="text-xs text-muted">
          {totalSubtasks} subtask{totalSubtasks === 1 ? '' : 's'} · Total estimated:{' '}
          <span className="text-secondary font-semibold font-mono tabular-nums">{totalHours}h</span>
        </p>
        <div className="flex items-center gap-3">
          {error && <p className="text-xs text-danger">{error}</p>}
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Saving…' : 'Save → Dashboard'}
          </button>
        </div>
      </div>
    </div>
  );
}
