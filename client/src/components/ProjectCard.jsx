import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, isPast } from 'date-fns';
import { deleteTask } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import CalendarSyncToggle from './CalendarSyncToggle.jsx';

const RISK_STYLES = {
  high: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  low: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
};

const PRIORITY_STYLES = {
  high: 'text-rose-400',
  medium: 'text-amber-400',
  low: 'text-white/40',
};

/**
 * ProjectCard — the ONLY thing the Dashboard shows per project. Deliberately
 * excludes subtasks/execution steps/resources/notes/schedules/dependencies —
 * that detail lives one click away in the Project Workspace.
 */
export default function ProjectCard({ project, onDeleted, onEnhance, enhancing }) {
  const { profile } = useAuth();
  const risk = RISK_STYLES[project.riskLevel] || RISK_STYLES.low;
  const priorityColor = PRIORITY_STYLES[project.priority] || PRIORITY_STYLES.low;
  const deadline = project.deadline ? new Date(project.deadline) : null;
  const overdue = deadline && isPast(deadline) && project.status !== 'completed';
  const [deleting, setDeleting] = useState(false);
  const isManualUnenhanced = project.manualMode && !project.hasSchedule;

  // Archive = soft-delete. Confirmation text clarifies data is preserved.
  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    if (!window.confirm(`Archive "${project.title}"? It will be removed from your dashboard but its history is preserved for AI learning.`)) return;
    setDeleting(true);
    try {
      await deleteTask(project.id);
      onDeleted?.(project.id);
    } catch (err) {
      console.error('[ProjectCard] archive failed:', err);
      alert(err.message || 'Failed to archive project');
      setDeleting(false);
    }
  };

  return (
    <Link
      to={`/projects/${project.id}`}
      className="card p-5 flex flex-col gap-4 hover:border-brand-500/40 transition-all duration-200 hover:-translate-y-0.5 group relative"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-white truncate group-hover:text-brand-400 transition-colors flex items-center gap-1.5">
            {project.title}
            {isManualUnenhanced && (
              <span
                title="Created manually — no AI scheduling applied yet"
                className="text-[10px] font-medium text-white/40 border border-white/10 rounded-full px-1.5 py-0.5 flex-shrink-0"
              >
                ✏️ manual
              </span>
            )}
          </h3>
          {project.currentMilestone && (
            <p className="text-xs text-white/40 mt-0.5 truncate">📍 {project.currentMilestone}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`risk-badge border ${risk}`}>
            {project.riskLevel === 'high' ? '⚠️' : project.riskLevel === 'medium' ? '◐' : '●'} {project.riskLevel}
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Archive project"
            aria-label="Archive project"
            className="w-6 h-6 flex items-center justify-center rounded-md text-white/20 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
          >
            {deleting ? '…' : '🗑'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-white/40">Progress</span>
          <span className="font-semibold text-white/70 tabular-nums">{project.progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-700"
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <span className="text-white/30">Deadline</span>
          <p className={`font-medium mt-0.5 ${overdue ? 'text-rose-400' : 'text-white/70'}`}>
            {deadline ? (overdue ? 'Overdue' : formatDistanceToNow(deadline, { addSuffix: true })) : '—'}
          </p>
        </div>
        <div>
          <span className="text-white/30">Remaining</span>
          <p className="font-medium mt-0.5 text-white/70">
            {project.remainingDays != null ? `${project.remainingDays}d` : '—'}
            {project.remainingHours ? ` · ${project.remainingHours}h left` : ''}
          </p>
        </div>
        <div>
          <span className="text-white/30">Priority</span>
          <p className={`font-medium mt-0.5 capitalize ${priorityColor}`}>{project.priority}</p>
        </div>
        <div>
          <span className="text-white/30">AI Confidence</span>
          <p className="font-medium mt-0.5 text-white/70">{project.aiConfidence}%</p>
        </div>
      </div>

      {/* Next recommended task */}
      {project.nextRecommendedTask && (
        <div className="bg-brand-500/5 border border-brand-500/20 rounded-lg px-3 py-2">
          <span className="text-[10px] font-semibold text-brand-400 uppercase tracking-wide">Next up</span>
          <p className="text-xs text-white/70 mt-0.5 truncate">{project.nextRecommendedTask}</p>
        </div>
      )}

      {/* Manual mode → AI upgrade path (suggestions.md #26) */}
      {isManualUnenhanced && onEnhance && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEnhance(project.id);
          }}
          disabled={enhancing}
          className="text-xs font-medium text-brand-400 hover:text-brand-300 border border-brand-500/30 hover:border-brand-500/50 bg-brand-500/5 hover:bg-brand-500/10 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50 disabled:cursor-wait"
        >
          {enhancing ? '✨ Enhancing…' : '✨ Let AI enhance this'}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5 -mx-1 px-1 pt-3">
        {/* Calendar sync toggle — stops click from navigating into the project */}
        <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <CalendarSyncToggle
            taskId={project.id}
            initialEnabled={project.calendarSync !== false}
            calendarConnected={!!profile?.calendarConnected}
          />
        </div>
        <span className="text-xs font-medium text-brand-400 group-hover:translate-x-0.5 transition-transform">
          Open Project →
        </span>
      </div>
    </Link>
  );
}
