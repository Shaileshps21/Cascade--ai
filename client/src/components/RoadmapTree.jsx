import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { reorderModuleTasks, addModuleTask, addProjectModule, deleteModuleTask, deleteProjectModule } from '../api/index.js';
import { SubtaskFieldsRow, emptySubtaskValue, serializeSubtaskValue } from './SubtaskFields.jsx';

const RISK_DOT = { high: 'bg-danger', medium: 'bg-warning', low: 'bg-success' };
const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
const STATUS_COLOR = { not_started: 'text-muted', in_progress: 'text-brand-500', completed: 'text-success' };

function ProgressBar({ value, className = '' }) {
  return (
    <div className={`h-1.5 rounded-full bg-border overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full bg-brand-500 transition-all duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

// TaskRow — draggable when its module has more than one task (drag-to-
// reorder, suggestions.md #2). Native HTML5 drag-and-drop, no dependency:
// the row itself is the drag source, `draggable={false}` on the inner Link
// stops the browser's own link-drag from taking over.
//
// `deletable` is the module's own source, not this task's — every subtask
// of a manually-added module can be deleted, regardless of how that
// particular subtask itself was created (server-enforced too, see
// routes/projects.js's DELETE route).
function TaskRow({ projectId, task, draggable, deletable, onDelete, isDragging, isDropTarget, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) {
  const handleDelete = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm(`Delete "${task.title}"? This can't be undone.`)) {
      onDelete();
    }
  };

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`flex items-center rounded-lg transition-colors ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-1 ring-brand-500/50 bg-brand-500/5' : ''}`}
    >
      {draggable && (
        <span
          className="cursor-grab active:cursor-grabbing text-muted hover:text-secondary pl-1.5 pr-0.5 flex-shrink-0 select-none"
          title="Drag to reorder within this module"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>
      )}
      <Link
        to={`/projects/${projectId}/tasks/${task.id}`}
        draggable={false}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group flex-1 min-w-0"
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${task.status === 'completed' ? 'bg-success' : task.status === 'in_progress' ? 'bg-brand-400 animate-pulse' : 'bg-border-strong'}`} />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-sm text-secondary group-hover:text-primary truncate">{task.title}</span>
          {task.scheduledStart && (
            <span className="text-[10px] text-muted truncate">{format(new Date(task.scheduledStart), 'MMM d, h:mm a')}</span>
          )}
        </span>
        <span className="text-[10px] text-muted capitalize hidden sm:inline">{task.difficulty}</span>
        <span className={`text-[11px] font-medium font-mono tabular-nums ${STATUS_COLOR[task.status] || 'text-muted'}`}>
          {task.progress}%
        </span>
      </Link>
      {deletable && (
        <button
          type="button"
          onClick={handleDelete}
          title="Delete this subtask"
          className="text-muted hover:text-danger transition-colors pl-0.5 pr-2 flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// QuickAddModule — appends a new, empty module to this milestone with no AI
// pipeline run. Works on AI-generated and manually-built projects alike; the
// new module is tagged manually-added server-side, which is what makes its
// (future) subtasks deletable.
function QuickAddModule({ onAdd }) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(title.trim());
      setTitle('');
    } catch (err) {
      setError(err.message || 'Failed to add module.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pt-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="New module name…"
          disabled={submitting}
          autoComplete="off"
          className="input-field text-sm flex-1"
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !title.trim()}
          className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400 transition-colors px-2 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> {submitting ? 'Adding…' : 'Add module'}
        </button>
      </div>
      {error && <p className="text-[11px] text-danger pt-1">{error}</p>}
    </div>
  );
}

// QuickAddSubtask — appends a subtask to this module with no AI pipeline run.
// Same labeled Subtask/Priority/Est. minutes/Start Date/Start Time/End Date
// field group as the Manual Project Builder (SubtaskFields.jsx) — one shared
// component, so a subtask looks and behaves identically whether it's being
// added to an AI-generated or a manually-built module.
function QuickAddSubtask({ onAdd }) {
  const [value, setValue] = useState(emptySubtaskValue());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!value.title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(serializeSubtaskValue(value));
      setValue(emptySubtaskValue());
    } catch (err) {
      setError(err.message || 'Failed to add subtask.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pt-2">
      <div className="flex items-start gap-2 px-1.5">
        <SubtaskFieldsRow value={value} onChange={(patch) => setValue((v) => ({ ...v, ...patch }))} disabled={submitting} />
      </div>
      {error && <p className="text-[11px] text-danger px-1.5 pt-1">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || !value.title.trim()}
        className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400 transition-colors px-1.5 pt-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus className="w-3.5 h-3.5" /> {submitting ? 'Adding…' : 'Add subtask'}
      </button>
    </div>
  );
}

function ModuleBlock({ projectId, module, isOpen, onToggle, onReorderTasks, onQuickAdd, onDeleteTask, onDeleteModule }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const draggableList = module.tasks.length > 1;
  const tasksDeletable = module.source === 'manual';
  // A manually-added module can only be deleted while it's still empty — see
  // routes/projects.js's DELETE .../modules/:moduleId for why (no cascading
  // delete of a non-empty module's subtasks).
  const moduleDeletable = tasksDeletable && module.tasks.length === 0;

  const handleDrop = (dropIndex) => {
    if (dragIndex !== null && dragIndex !== dropIndex) {
      const reordered = [...module.tasks];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(dropIndex, 0, moved);
      onReorderTasks(module.id, reordered.map((t) => t.id));
    }
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDeleteModule = (e) => {
    e.stopPropagation();
    if (window.confirm(`Delete the empty module "${module.title}"? This can't be undone.`)) {
      onDeleteModule(module.id);
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="w-full flex items-center bg-base hover:bg-surface-hover transition-colors">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 px-3 py-2.5 flex-1 min-w-0 text-left"
        >
          <span className={`text-muted text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
          <span className="text-sm font-medium text-secondary flex-1 min-w-0 truncate">{module.title}</span>
          <span className="text-[11px] text-muted flex-shrink-0 font-mono tabular-nums">{module.tasks.length} tasks</span>
          <div className="w-16 flex-shrink-0"><ProgressBar value={module.progress} /></div>
          <span className="text-[11px] font-semibold text-secondary w-9 text-right flex-shrink-0 font-mono tabular-nums">{module.progress}%</span>
        </button>
        {moduleDeletable && (
          <button
            type="button"
            onClick={handleDeleteModule}
            title="Delete this empty module"
            className="text-muted hover:text-danger transition-colors px-3 flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {isOpen && (
        <div className="px-2 py-1.5 bg-base">
          {module.tasks.map((task, i) => (
            <TaskRow
              key={task.id}
              projectId={projectId}
              task={task}
              draggable={draggableList}
              deletable={tasksDeletable}
              onDelete={() => onDeleteTask(module.id, task.id)}
              isDragging={dragIndex === i}
              isDropTarget={overIndex === i && dragIndex !== i}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => { e.preventDefault(); setOverIndex(i); }}
              onDragLeave={() => setOverIndex((cur) => (cur === i ? null : cur))}
              onDrop={(e) => { e.preventDefault(); handleDrop(i); }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
            />
          ))}
          <QuickAddSubtask onAdd={(subtaskData) => onQuickAdd(module.id, subtaskData)} />
        </div>
      )}
    </div>
  );
}

/**
 * RoadmapTree — Milestones → Modules → Tasks, collapsed by default,
 * expanding only what the user selects (per the plan's Roadmap tab spec).
 *
 * Which milestone/module is expanded is controlled by the parent (backed by
 * URL search params — see ProjectWorkspace.jsx) rather than local state, so
 * the browser Back button from a task page restores the same tree state
 * instead of always coming back collapsed.
 */
export default function RoadmapTree({ projectId, milestones: milestonesProp, openMilestoneId = null, openModuleId = null, onOpenMilestone, onOpenModule }) {
  const [milestones, setMilestones] = useState(milestonesProp);
  const [reorderError, setReorderError] = useState(null);

  // Re-sync when the parent refetches (e.g. after a reschedule) — but our
  // own optimistic reorders below own the array in between those refetches.
  useEffect(() => { setMilestones(milestonesProp); }, [milestonesProp]);

  if (!milestones || milestones.length === 0) {
    return <div className="card p-8 text-center text-sm text-muted">No roadmap generated yet.</div>;
  }

  // Quick-Add Subtask: no optimistic insert — the new task needs a real
  // taskId from the server (module.tasks entries are full task objects, and
  // every downstream link/drag/complete action depends on that id being
  // real), so the module simply re-renders with it once the request resolves.
  const handleQuickAdd = async (moduleId, subtaskData) => {
    const { task } = await addModuleTask(projectId, moduleId, subtaskData);
    setMilestones((prev) =>
      prev.map((m) => ({
        ...m,
        modules: m.modules.map((mod) =>
          mod.id !== moduleId ? mod : { ...mod, tasks: [...mod.tasks, { ...task, progress: task.progress ?? 0 }] }
        ),
      }))
    );
  };

  // Add Module: no optimistic insert — the new module needs a real,
  // server-issued id (same reasoning as Quick-Add Subtask above).
  const handleAddModule = async (milestoneId, title) => {
    const { module } = await addProjectModule(projectId, { milestoneId, title });
    setMilestones((prev) =>
      prev.map((m) => (m.id !== milestoneId ? m : { ...m, modules: [...m.modules, module] }))
    );
  };

  // Delete Subtask: optimistic removal with rollback on failure, matching
  // the reorder pattern below. The server independently re-checks that the
  // task's module is manually-added — the UI only ever offers this button
  // for such tasks in the first place (see ModuleBlock's tasksDeletable).
  const handleDeleteTask = async (moduleId, taskId) => {
    const previous = milestones;
    setMilestones((prev) =>
      prev.map((m) => ({
        ...m,
        modules: m.modules.map((mod) =>
          mod.id !== moduleId ? mod : { ...mod, tasks: mod.tasks.filter((t) => t.id !== taskId) }
        ),
      }))
    );
    setReorderError(null);
    try {
      await deleteModuleTask(projectId, taskId);
    } catch (err) {
      setMilestones(previous);
      setReorderError(err.message || 'Failed to delete the subtask.');
    }
  };

  // Delete Module: only ever offered by ModuleBlock for an empty,
  // manually-added module — the server independently re-checks both
  // conditions.
  const handleDeleteModule = async (moduleId) => {
    const previous = milestones;
    setMilestones((prev) =>
      prev.map((m) => ({ ...m, modules: m.modules.filter((mod) => mod.id !== moduleId) }))
    );
    setReorderError(null);
    try {
      await deleteProjectModule(projectId, moduleId);
    } catch (err) {
      setMilestones(previous);
      setReorderError(err.message || 'Failed to delete the module.');
    }
  };

  const handleReorderTasks = async (moduleId, newTaskIds) => {
    const previous = milestones;
    setMilestones((prev) =>
      prev.map((m) => ({
        ...m,
        modules: m.modules.map((mod) =>
          mod.id !== moduleId ? mod : { ...mod, tasks: newTaskIds.map((id) => mod.tasks.find((t) => t.id === id)) }
        ),
      }))
    );
    setReorderError(null);
    try {
      await reorderModuleTasks(projectId, moduleId, newTaskIds);
    } catch (err) {
      setMilestones(previous);
      setReorderError(err.message || 'Failed to save the new order.');
    }
  };

  return (
    <div className="space-y-3">
      {reorderError && (
        <p className="text-xs text-danger px-1">{reorderError}</p>
      )}
      {milestones.map((milestone) => {
        const isOpen = openMilestoneId === milestone.id;
        return (
          <div key={milestone.id} className="card overflow-hidden">
            <button
              onClick={() => onOpenMilestone?.(isOpen ? null : milestone.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors text-left"
            >
              <span className={`text-secondary transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${RISK_DOT[milestone.riskLevel] || RISK_DOT.medium}`} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-primary truncate">{milestone.title}</p>
                {milestone.estimatedOutcome && (
                  <p className="text-xs text-muted truncate mt-0.5">{milestone.estimatedOutcome}</p>
                )}
              </div>
              <span className="text-xs text-muted flex-shrink-0 hidden sm:inline font-mono tabular-nums">{milestone.modules.length} modules</span>
              <div className="w-20 flex-shrink-0 hidden sm:block"><ProgressBar value={milestone.progress} /></div>
              <span className="text-sm font-bold text-secondary w-10 text-right flex-shrink-0 font-mono tabular-nums">{milestone.progress}%</span>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                {milestone.description && (
                  <p className="text-sm text-muted leading-relaxed mb-2">{milestone.description}</p>
                )}
                {milestone.modules.map((module) => (
                  <ModuleBlock
                    key={module.id}
                    projectId={projectId}
                    module={module}
                    isOpen={openModuleId === module.id}
                    onToggle={() => onOpenModule?.(openModuleId === module.id ? null : module.id)}
                    onReorderTasks={handleReorderTasks}
                    onQuickAdd={handleQuickAdd}
                    onDeleteTask={handleDeleteTask}
                    onDeleteModule={handleDeleteModule}
                  />
                ))}
                <QuickAddModule onAdd={(title) => handleAddModule(milestone.id, title)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
