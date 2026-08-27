import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reorderModuleTasks } from '../api/index.js';

const RISK_DOT = { high: 'bg-rose-400', medium: 'bg-amber-400', low: 'bg-emerald-400' };
const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
const STATUS_COLOR = { not_started: 'text-white/30', in_progress: 'text-brand-400', completed: 'text-emerald-400' };

function ProgressBar({ value, className = '' }) {
  return (
    <div className={`h-1.5 rounded-full bg-white/5 overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-500"
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
      className={`flex items-center rounded-lg transition-all ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-1 ring-brand-500/50 bg-brand-500/5' : ''}`}
    >
      {draggable && (
        <span
          className="cursor-grab active:cursor-grabbing text-white/15 hover:text-white/40 pl-1.5 pr-0.5 flex-shrink-0 select-none"
          title="Drag to reorder within this module"
        >
          ⠿
        </span>
      )}
      <Link
        to={`/projects/${projectId}/tasks/${task.id}`}
        draggable={false}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group flex-1 min-w-0"
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${task.status === 'completed' ? 'bg-emerald-400' : task.status === 'in_progress' ? 'bg-brand-400 animate-pulse' : 'bg-white/15'}`} />
        <span className="text-sm text-white/70 group-hover:text-white flex-1 min-w-0 truncate">{task.title}</span>
        <span className="text-[10px] text-white/30 capitalize hidden sm:inline">{task.difficulty}</span>
        <span className={`text-[11px] font-medium ${STATUS_COLOR[task.status] || 'text-white/30'}`}>
          {task.progress}%
        </span>
      </Link>
    </div>
  );
}

function ModuleBlock({ projectId, module, isOpen, onToggle, onReorderTasks }) {
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
    <div className="border border-white/5 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 bg-surface-900/40 hover:bg-surface-900/70 transition-colors text-left"
      >
        <span className={`text-white/30 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
        <span className="text-sm font-medium text-white/80 flex-1 min-w-0 truncate">{module.title}</span>
        <span className="text-[11px] text-white/40 flex-shrink-0">{module.tasks.length} tasks</span>
        <div className="w-16 flex-shrink-0"><ProgressBar value={module.progress} /></div>
        <span className="text-[11px] font-semibold text-white/50 w-9 text-right flex-shrink-0">{module.progress}%</span>
      </button>
      {isOpen && (
        <div className="px-2 py-1.5 bg-black/10">
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
    return <div className="card p-8 text-center text-sm text-white/30">No roadmap generated yet.</div>;
  }

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
        <p className="text-xs text-rose-400 px-1">{reorderError}</p>
      )}
      {milestones.map((milestone) => {
        const isOpen = openMilestone === milestone.id;
        return (
          <div key={milestone.id} className="card overflow-hidden">
            <button
              onClick={() => setOpenMilestone(isOpen ? null : milestone.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
            >
              <span className={`text-white/40 transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${RISK_DOT[milestone.riskLevel] || RISK_DOT.medium}`} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{milestone.title}</p>
                {milestone.estimatedOutcome && (
                  <p className="text-xs text-white/35 truncate mt-0.5">{milestone.estimatedOutcome}</p>
                )}
              </div>
              <span className="text-xs text-white/40 flex-shrink-0 hidden sm:inline">{milestone.modules.length} modules</span>
              <div className="w-20 flex-shrink-0 hidden sm:block"><ProgressBar value={milestone.progress} /></div>
              <span className="text-sm font-bold text-white/60 w-10 text-right flex-shrink-0">{milestone.progress}%</span>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
                {milestone.description && (
                  <p className="text-sm text-white/45 leading-relaxed mb-2">{milestone.description}</p>
                )}
                {milestone.modules.map((module) => (
                  <ModuleBlock
                    key={module.id}
                    projectId={projectId}
                    module={module}
                    isOpen={openModule === module.id}
                    onToggle={() => setOpenModule(openModule === module.id ? null : module.id)}
                    onReorderTasks={handleReorderTasks}
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
