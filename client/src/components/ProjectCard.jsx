import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, isPast } from 'date-fns';
import { Pencil, MapPin, Trash2, Sparkles } from 'lucide-react';
import { deleteTask } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import CalendarSyncToggle from './CalendarSyncToggle.jsx';

// Flat colored dot, not a colored pill (UPDATED_design.md §3.3/§7 step 3) —
// the badge itself stays neutral (bg-surface-hover text-secondary below).
const RISK_DOT = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-success',
};

const PRIORITY_STYLES = {
  high: 'text-danger',
  medium: 'text-warning',
  low: 'text-muted',
};

/**
 * ProjectCard — the ONLY thing the Dashboard shows per project. Deliberately
 * excludes subtasks/execution steps/resources/notes/schedules/dependencies —
 * that detail lives one click away in the Project Workspace.
 */
export default function ProjectCard({ project, onDeleted, onEnhance, enhancing }) {
  const { profile } = useAuth();
  const riskDot = RISK_DOT[project.riskLevel] || RISK_DOT.low;
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
      className="card-interactive p-5 flex flex-col gap-4 hover:-translate-y-0.5 transition-all duration-200 group relative"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-primary truncate group-hover:text-brand-500 transition-colors flex items-center gap-1.5">
            {project.title}
            {isManualUnenhanced && (
              <span
                title="Created manually — no AI scheduling applied yet"
                className="flex items-center gap-1 text-[10px] font-medium text-muted border border-border rounded-full px-1.5 py-0.5 flex-shrink-0"
              >
                <Pencil className="w-2.5 h-2.5" /> manual
              </span>
            )}
          </h3>
          {project.currentMilestone && (
            <p className="flex items-center gap-1 text-xs text-muted mt-0.5 truncate">
              <MapPin className="w-3 h-3 flex-shrink-0" /> {project.currentMilestone}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="risk-badge bg-surface-hover text-secondary">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${riskDot}`} />
            {project.riskLevel}
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Archive project"
            aria-label="Archive project"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-40"
          >
            {deleting ? '…' : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted">Progress</span>
          <span className="font-semibold text-secondary font-mono tabular-nums">{project.progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-700"
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <span className="text-muted">Deadline</span>
          <p className={`font-medium mt-0.5 ${overdue ? 'text-danger' : 'text-secondary'}`}>
            {deadline ? (overdue ? 'Overdue' : formatDistanceToNow(deadline, { addSuffix: true })) : '—'}
          </p>
        </div>
        <div>
          <span className="text-muted">Remaining</span>
          <p className="font-medium mt-0.5 text-secondary font-mono tabular-nums">
            {project.remainingDays != null ? `${project.remainingDays}d` : '—'}
            {project.remainingHours ? ` · ${project.remainingHours}h left` : ''}
          </p>
        </div>
        <div>
          <span className="text-muted">Priority</span>
          <p className={`font-medium mt-0.5 capitalize ${priorityColor}`}>{project.priority}</p>
        </div>
        <div>
          <span className="text-muted">AI Confidence</span>
          <p className="font-medium mt-0.5 text-secondary font-mono tabular-nums">{project.aiConfidence}%</p>
        </div>
      </div>

      {/* Next recommended task */}
      {project.nextRecommendedTask && (
        <div className="bg-brand-500/5 border border-brand-500/20 rounded-lg px-3 py-2">
          <span className="text-[10px] font-semibold text-brand-500 uppercase tracking-wide">Next up</span>
          <p className="text-xs text-secondary mt-0.5 truncate">{project.nextRecommendedTask}</p>
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
          className="flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-400 border border-brand-500/30 hover:border-brand-500/50 bg-brand-500/5 hover:bg-brand-500/10 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          <Sparkles className="w-3.5 h-3.5" /> {enhancing ? 'Enhancing…' : 'Let AI enhance this'}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border -mx-1 px-1 pt-3">
        {/* Calendar sync toggle — stops click from navigating into the project */}
        <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <CalendarSyncToggle
            taskId={project.id}
            initialEnabled={project.calendarSync !== false}
            calendarConnected={!!profile?.calendarConnected}
          />
        </div>
        <span className="text-xs font-medium text-brand-500 group-hover:translate-x-0.5 transition-transform">
          Open Project →
        </span>
      </div>
    </Link>
  );
}
