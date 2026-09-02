import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocusTimer } from '../context/FocusTimerContext.jsx';
import { updateExecutionStep } from '../api/index.js';

function formatElapsed(elapsedMs) {
  const seconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * FocusTimerBar — persistent strip shown on every in-app page while a focus
 * session is active. FocusMode's own full-screen overlay (z-50, fixed
 * inset-0) covers this bar visually whenever it's open, so no extra
 * "is the overlay open" flag is needed to avoid a double display.
 */
export default function FocusTimerBar() {
  const { session, elapsedMs, pause, resume, completeSession, discardSession } = useFocusTimer();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  if (!session) return null;

  const complete = async () => {
    // completeSession() clears the session before the request resolves (the
    // elapsed time has to be read synchronously) — if the PATCH fails, the
    // step is left not-completed server-side, so surface that instead of
    // quietly acting like it worked. Opening the task directly still lets
    // the user complete it normally either way.
    const finalMs = completeSession();
    const measuredMinutes = finalMs > 0 ? Math.max(1, Math.round(finalMs / 60_000)) : undefined;
    try {
      await updateExecutionStep(session.projectId, session.taskId, session.stepId, {
        status: 'completed',
        actualMinutes: measuredMinutes,
      });
    } catch (err) {
      setError(err.message || 'Failed to complete the step — open the task to try again.');
    }
  };

  if (error) {
    return (
      <div className="sticky top-0 z-40 bg-danger/10 border-b border-danger/30 px-4 py-2 flex items-center gap-3 text-sm">
        <span className="text-danger flex-1 min-w-0">{error}</span>
        <button
          onClick={() => navigate(`/projects/${session.projectId}/tasks/${session.taskId}`)}
          className="text-xs text-brand-500 hover:text-brand-400 flex-shrink-0"
        >
          Open task
        </button>
        <button onClick={() => setError(null)} className="text-xs text-muted hover:text-primary flex-shrink-0">✕</button>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-40 bg-brand-500/10 border-b border-brand-500/30 px-4 py-2 flex items-center gap-3 text-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse flex-shrink-0" />
      <span className="text-secondary truncate flex-1 min-w-0">
        Focusing: <span className="font-medium text-primary">{session.stepTitle}</span>
      </span>
      <span className="font-mono tabular-nums font-semibold text-primary flex-shrink-0">
        {formatElapsed(elapsedMs)}
      </span>
      <button
        onClick={() => (session.running ? pause() : resume())}
        className="text-xs text-secondary hover:text-primary border border-border rounded-full px-3 py-1 flex-shrink-0"
      >
        {session.running ? '⏸ Pause' : '▶ Resume'}
      </button>
      <button
        onClick={() => navigate(`/projects/${session.projectId}/tasks/${session.taskId}`, { state: { openFocusMode: true } })}
        className="text-xs text-brand-500 hover:text-brand-400 flex-shrink-0"
      >
        Resume Focus Mode
      </button>
      <button onClick={complete} className="text-xs text-success hover:opacity-80 flex-shrink-0">
        ✓ Complete
      </button>
      <button onClick={discardSession} title="Discard timer" className="text-xs text-muted hover:text-danger flex-shrink-0">
        ✕
      </button>
    </div>
  );
}
