import { useState } from 'react';
import { setTaskCalendarSync } from '../api/index.js';

/**
 * CalendarSyncToggle — per-project pill toggle to enable/disable Google
 * Calendar sync. Disabled when the user has not connected their calendar.
 * Calls PATCH /api/tasks/:taskId/calendar-sync on change.
 */
export default function CalendarSyncToggle({ taskId, initialEnabled = true, calendarConnected, onChange }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  if (!calendarConnected) {
    return (
      <span className="text-xs text-white/25 flex items-center gap-1" title="Connect Google Calendar to enable per-project sync">
        <span>📅</span> Calendar not connected
      </span>
    );
  }

  const handleToggle = async () => {
    if (loading) return;
    const next = !enabled;
    setEnabled(next);
    setLoading(true);
    try {
      await setTaskCalendarSync(taskId, next);
      onChange?.(next);
    } catch (err) {
      console.error('[CalendarSyncToggle] toggle failed:', err.message);
      setEnabled(!next);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={loading}
      title={enabled ? 'Disable Google Calendar sync for this project' : 'Enable Google Calendar sync for this project'}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border
        ${enabled
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
          : 'bg-white/5 text-white/30 border-white/10 hover:bg-white/10 hover:text-white/50'
        } ${loading ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
    >
      {loading ? (
        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <span>{enabled ? '📅' : '🚫'}</span>
      )}
      {enabled ? 'Calendar synced' : 'Sync off'}
    </button>
  );
}
