import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { GripVertical, Plus } from 'lucide-react';
import { reorderModuleTasks, addModuleTask } from '../api/index.js';
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
function TaskRow({ projectId, task, draggable, isDragging, isDropTarget, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) {
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
        <span className="text-sm text-secondary group-hover:text-primary flex-1 min-w-0 truncate">{task.title}</span>
        <span className="text-[10px] text-muted capitalize hidden sm:inline">{task.difficulty}</span>
        <span className={`text-[11px] font-medium font-mono tabular-nums ${STATUS_COLOR[task.status] || 'text-muted'}`}>
          {task.progress}%
        </span>
      </Link>
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

function ModuleBlock({ projectId, module, isOpen, onToggle, onReorderTasks, onQuickAdd }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const draggableList = module.tasks.length > 1;

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

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 bg-base hover:bg-surface-hover transition-colors text-left"
      >
        <span className={`text-muted text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
        <span className="text-sm font-medium text-secondary flex-1 min-w-0 truncate">{module.title}</span>
        <span className="text-[11px] text-muted flex-shrink-0 font-mono tabular-nums">{module.tasks.length} tasks</span>
        <div className="w-16 flex-shrink-0"><ProgressBar value={module.progress} /></div>
        <span className="text-[11px] font-semibold text-secondary w-9 text-right flex-shrink-0 font-mono tabular-nums">{module.progress}%</span>
      </button>
      {isOpen && (
        <div className="px-2 py-1.5 bg-base">
          {module.tasks.map((task, i) => (
            <TaskRow
              key={task.id}
              projectId={projectId}
              task={task}
              draggable={draggableList}
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
 */
export default function RoadmapTree({ projectId, milestones: milestonesProp }) {
  const [openMilestone, setOpenMilestone] = useState(null);
  const [openModule, setOpenModule] = useState(null);
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
        const isOpen = openMilestone === milestone.id;
        return (
          <div key={milestone.id} className="card overflow-hidden">
            <button
              onClick={() => setOpenMilestone(isOpen ? null : milestone.id)}
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
                    isOpen={openModule === module.id}
                    onToggle={() => setOpenModule(openModule === module.id ? null : module.id)}
                    onReorderTasks={handleReorderTasks}
                    onQuickAdd={handleQuickAdd}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
