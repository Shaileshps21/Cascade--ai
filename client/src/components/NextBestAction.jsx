import { Link } from 'react-router-dom';

/**
 * NextBestAction — "▶ Continue Working" card. Instead of forcing the user
 * to decide what to do next, surfaces the single next actionable step.
 */
export default function NextBestAction({ projectId, action }) {
  if (!action) {
    return (
      <div className="card p-4 border border-emerald-500/20 bg-emerald-500/5 text-center">
        <p className="text-sm text-emerald-400 font-medium">🎉 Everything's done here.</p>
      </div>
    );
  }

  return (
    <Link
      to={`/projects/${projectId}/tasks/${action.taskId}`}
      className="card p-4 border border-brand-500/25 bg-brand-500/5 flex items-center gap-4 hover:border-brand-500/50 transition-colors group"
    >
      <span className="text-2xl flex-shrink-0">▶</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-brand-400 uppercase tracking-wide">Continue Working</p>
        <p className="text-sm font-semibold text-white mt-0.5 truncate">{action.taskTitle}</p>
        {action.stepTitle && (
          <p className="text-xs text-white/45 mt-0.5 truncate">Next step: {action.stepTitle}</p>
        )}
      </div>
      {action.estimatedMinutes != null && (
        <span className="text-xs font-medium text-white/50 flex-shrink-0 bg-white/5 px-2.5 py-1 rounded-full">
          ~{action.estimatedMinutes} min
        </span>
      )}
      <span className="text-brand-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0">→</span>
    </Link>
  );
}
