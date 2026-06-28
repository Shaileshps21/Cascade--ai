import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { getCalendarAuthUrl, disconnectCalendar } from '../api/index.js';

export default function CalendarConnect({ compact = false }) {
  const { user, profile, refreshProfile } = useAuth();
  const [disconnecting, setDisconnecting] = useState(false);

  const connected = profile?.calendarConnected;

  const handleConnect = () => {
    if (!user) return;
    window.location.href = getCalendarAuthUrl(user.uid);
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar?')) return;
    setDisconnecting(true);
    try {
      await disconnectCalendar();
      await refreshProfile();
    } catch (err) {
      console.error('[CalendarConnect]', err);
    } finally {
      setDisconnecting(false);
    }
  };

  if (compact) {
    return connected ? (
      <div className="flex items-center gap-2 text-xs text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Calendar synced
      </div>
    ) : (
      <button onClick={handleConnect} className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2">
        Connect Calendar
      </button>
    );
  }

  return (
    <div className={`card p-4 border ${connected ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${connected ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
            <span className="text-lg">📅</span>
          </div>
          <div>
            <p className="text-sm font-medium text-white">Google Calendar</p>
            <p className={`text-xs ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
              {connected ? '✓ Connected — subtasks are auto-scheduled' : 'Not connected — connect to enable auto-scheduling'}
            </p>
          </div>
        </div>

        {connected ? (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="btn-ghost text-xs text-rose-400/60 hover:text-rose-400"
          >
            {disconnecting ? '...' : 'Disconnect'}
          </button>
        ) : (
          <button onClick={handleConnect} className="btn-primary text-sm">
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
