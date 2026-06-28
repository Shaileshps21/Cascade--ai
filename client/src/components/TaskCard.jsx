import { useState } from 'react';
import { formatDistanceToNow, isPast, format } from 'date-fns';
import RiskMeter from './RiskMeter.jsx';
import { completeSubtask, completeTask, deleteTask } from '../api/index.js';

const STATUS_STYLES = {
  active:    { bg: 'bg-brand-500/10',   border: 'border-brand-500/20',   dot: 'bg-brand-400',   label: 'Active'   },
  at_risk:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   dot: 'bg-amber-400',   label: 'At Risk'  },
  overdue:   { bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    dot: 'bg-rose-400',    label: 'Overdue'  },
  completed: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400', label: 'Done'     },
};

const COMPLEXITY_COLORS = {
  low: 'text-emerald-400',
  medium: 'text-amber-400',
  high: 'text-rose-400',
  very_high: 'text-rose-500',
};

export default function TaskCard({ task, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(null); // subtaskId being completed
  const [deleting, setDeleting] = useState(false);

  const style = STATUS_STYLES[task.status] || STATUS_STYLES.active;
  const deadline = new Date(task.deadline);
  const timeLeft = isPast(deadline) ? 'Overdue' : `${formatDistanceToNow(deadline)} left`;
  const completedSubtasks = (task.subtasks || []).filter((s) => s.completed).length;
  const totalSubtasks = (task.subtasks || []).length;

  const handleSubtaskComplete = async (subtaskId) => {
    if (completing) return;
    setCompleting(subtaskId);
    try {
      const result = await completeSubtask(task.id, subtaskId);
      onUpdate?.();
      if (result.replanTriggered) {
        // Small notification that re-plan happened
        console.log('[TaskCard] Re-plan triggered by monitor agent');
      }
    } catch (err) {
      console.error('[TaskCard] Complete subtask failed:', err);
    } finally {
      setCompleting(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    setDeleting(true);
    try {
      await deleteTask(task.id);
      onDelete?.(task.id);
    } catch (err) {
      console.error('[TaskCard] Delete failed:', err);
      setDeleting(false);
    }
  };

  return (
    <div className={`card border ${style.border} ${style.bg} overflow-hidden transition-all duration-200`}>
      {/* Header row */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Risk meter */}
          <div className="flex-shrink-0 pt-1">
            <RiskMeter score={task.riskScore || 0} size="sm" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${style.border} ${style.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
              <span className={`text-xs font-medium ${COMPLEXITY_COLORS[task.complexity] || 'text-white/50'}`}>
                {task.complexity?.replace('_', ' ')} complexity
              </span>
              <span className="text-xs text-white/30 capitalize">{task.category}</span>
            </div>

            <h3 className="font-semibold text-white text-base leading-tight">{task.title}</h3>

            <div className="flex items-center gap-3 mt-1.5 text-xs text-white/40">
              <span>⏱ {timeLeft}</span>
              <span>📅 {format(deadline, 'MMM d, h:mm a')}</span>
              {task.estimatedHours && <span>~{task.estimatedHours}h</span>}
            </div>

            {/* Progress bar */}
            {totalSubtasks > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] text-white/40 mb-1">
                  <span>{completedSubtasks}/{totalSubtasks} subtasks</span>
                  <span>{task.progress || 0}%</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${task.progress || 0}%`,
                      backgroundColor: style.dot.replace('bg-', '#'),
                      background: task.status === 'completed' ? '#10b981' : undefined,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="btn-ghost text-xs px-2 py-1"
            >
              {expanded ? '▲' : '▼'}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn-ghost text-xs px-2 py-1 text-rose-400/60 hover:text-rose-400"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Expanded: subtasks + insights */}
      {expanded && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-4 animate-fade-in">

          {/* Personalization insights */}
          {task.personalizationInsights?.length > 0 && (
            <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
              <p className="text-xs font-semibold text-violet-400 mb-2">🧠 AI Personalization Insights</p>
              <ul className="space-y-1">
                {task.personalizationInsights.map((insight, i) => (
                  <li key={i} className="text-xs text-white/60">• {insight}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Warning flags */}
          {task.warningFlags?.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-400">
              <span>⚠️</span>
              <span>{task.warningFlags.join(' • ')}</span>
            </div>
          )}

          {/* Subtasks */}
          {task.subtasks?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-white/40 mb-2 uppercase tracking-wider">Subtasks</p>
              <div className="space-y-2">
                {task.subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                      subtask.completed
                        ? 'border-white/5 bg-white/2 opacity-50'
                        : 'border-white/10 bg-white/3 hover:border-white/20'
                    }`}
                  >
                    <button
                      onClick={() => !subtask.completed && handleSubtaskComplete(subtask.id)}
                      disabled={subtask.completed || completing === subtask.id}
                      className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 transition-all ${
                        subtask.completed
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-white/20 hover:border-brand-400'
                      } flex items-center justify-center`}
                    >
                      {completing === subtask.id ? (
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : subtask.completed ? (
                        <span className="text-[10px]">✓</span>
                      ) : null}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <p className={`text-sm font-medium ${subtask.completed ? 'line-through text-white/30' : 'text-white'}`}>
                          {subtask.title}
                        </p>
                        <span className="text-[11px] text-white/30">{subtask.estimatedMinutes}m</span>
                      </div>
                      {subtask.description && (
                        <p className="text-xs text-white/40 mt-0.5">{subtask.description}</p>
                      )}
                      {subtask.scheduledStart && !subtask.completed && (
                        <p className="text-[11px] text-brand-400/70 mt-1">
                          📅 {format(new Date(subtask.scheduledStart), 'MMM d, h:mm a')}
                        </p>
                      )}
                      {subtask.tips?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {subtask.tips.map((tip, i) => (
                            <span key={i} className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded">
                              💡 {tip}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Re-plan badge */}
          {task.rePlannedCount > 0 && (
            <div className="text-[11px] text-white/25 text-right">
              🔄 Auto-replanned {task.rePlannedCount}×
            </div>
          )}
        </div>
      )}
    </div>
  );
}
