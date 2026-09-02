import { useState, useEffect, useRef } from 'react';
import ResourceLink from './ResourceLink.jsx';
import { useFocusTimer } from '../context/FocusTimerContext.jsx';

function formatElapsed(elapsedMs) {
  const seconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return { display: `${mm}:${ss}`, seconds };
}

/**
 * FocusMode — "Start Working" distraction-free overlay. Shows only the
 * current task, current execution step, its resources, a timer, notes and
 * AI guidance, per the plan's Smart Execution Mode spec.
 *
 * The timer itself lives in FocusTimerContext, not here — closing this
 * overlay (or navigating away entirely) no longer stops it; only Complete
 * or Discard end the session. See FocusTimerBar for the persistent view
 * shown elsewhere in the app while a session is active.
 */
export default function FocusMode({ projectId, task, step, onUpdate, onClose }) {
  const { session, elapsedMs, startSession, pause, resume, completeSession, discardSession } = useFocusTimer();
  const [notes, setNotes] = useState(step?.notes ?? '');
  const startedRef = useRef(false);

  const stepId = step?.id ?? step?.stepId;
  // taskIds like "T1" are only unique *within* a project, so projectId must
  // be part of this comparison — otherwise this screen would mistake a
  // session running in a different project's identically-numbered task for
  // this one.
  const isThisStepActive = !!session && session.projectId === projectId && session.taskId === task?.id && session.stepId === stepId;
  const conflictingSession = !!session && !isThisStepActive;

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Join (or start) this step's timing session — a no-op if it's already
  // the active one (e.g. re-entering Focus Mode via "Resume Focus Mode").
  useEffect(() => {
    if (!step || conflictingSession || isThisStepActive) return;
    startSession(projectId, task, step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, projectId, task?.id, conflictingSession, isThisStepActive]);

  // Pomodoro-style time tracking (suggestions.md #5): mark the step
  // in_progress the instant focused work begins, so its startedAt is real
  // (also lights up the Task Workspace "Started" timeline node) and the
  // timer reflects genuine elapsed focus time.
  useEffect(() => {
    if (!step || startedRef.current || conflictingSession) return;
    if (step.status !== 'in_progress' && step.status !== 'completed') {
      startedRef.current = true;
      onUpdate(step.id, { status: 'in_progress' });
    }
  }, [step, onUpdate]);

  if (conflictingSession) {
    return (
      <div className="fixed inset-0 z-50 bg-base flex items-center justify-center px-6">
        <div className="text-center max-w-sm space-y-4">
          <p className="text-secondary">
            You have an active focus session on "<span className="font-medium text-primary">{session.stepTitle}</span>."
            Finish or discard it before starting a new one.
          </p>
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      </div>
    );
  }

  if (!step) {
    return (
      <div className="fixed inset-0 z-50 bg-base flex items-center justify-center">
        <div className="text-center">
          <p className="text-secondary">🎉 No remaining steps — nothing to focus on.</p>
          <button onClick={onClose} className="btn-ghost mt-4">Close</button>
        </div>
      </div>
    );
  }

  const timer = formatElapsed(elapsedMs);
  const running = !!session?.running;

  const complete = async () => {
    // The session's own active time (paused time excluded) is a more
    // accurate measure of real focus than the wall-clock startedAt->now span
    // the backend would otherwise derive — pass it through when there's
    // anything to report. `undefined` is dropped by JSON.stringify, so an
    // instant-complete (0 elapsed) cleanly falls back to the server's own
    // timestamp-based measurement instead of reporting a fabricated 0.
    const finalMs = completeSession();
    const measuredMinutes = finalMs > 0 ? Math.max(1, Math.round(finalMs / 60_000)) : undefined;
    await onUpdate(step.id, { status: 'completed', notes, actualMinutes: measuredMinutes });
    onClose();
  };

  const discard = () => {
    discardSession();
    onClose();
  };

  const estimatedMinutes = step.estimatedMinutes ?? null;
  const overEstimate = estimatedMinutes != null && timer.seconds / 60 > estimatedMinutes;

  return (
    <div className="fixed inset-0 z-50 bg-base flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <span className="text-xs text-muted uppercase tracking-widest font-semibold">Focus Mode</span>
        <button onClick={onClose} className="text-muted hover:text-primary text-sm">✕ Exit</button>
      </div>

      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 py-8">
        <div className="max-w-xl w-full space-y-6">
          <div className="text-center">
            <p className="text-xs text-brand-500 uppercase tracking-wide font-semibold mb-1">{task.title}</p>
            <h1 className="text-2xl font-bold text-primary">{step.title}</h1>
            {step.description && <p className="text-sm text-muted mt-2 leading-relaxed">{step.description}</p>}
          </div>

          {/* Timer */}
          <div className="text-center">
            <div className={`text-5xl font-mono font-bold tabular-nums ${overEstimate ? 'text-warning' : 'text-primary'}`}>
              {timer.display}
            </div>
            {estimatedMinutes != null && (
              <p className={`text-xs mt-1 ${overEstimate ? 'text-warning' : 'text-muted'}`}>
                Estimated ~<span className="font-mono tabular-nums">{estimatedMinutes}</span> min{overEstimate ? ' — running over' : ''}
              </p>
            )}
            <div className="flex items-center justify-center gap-2 mt-3">
              <button
                onClick={() => (running ? pause() : resume())}
                className="text-xs text-secondary hover:text-primary border border-border rounded-full px-4 py-1.5"
              >
                {running ? '⏸ Pause timer' : '▶ Resume timer'}
              </button>
              <button
                onClick={discard}
                title="Stop timing this step without completing it"
                className="text-xs text-muted hover:text-danger px-2 py-1.5"
              >
                Discard timer
              </button>
            </div>
          </div>

          {/* Resources */}
          {step.resources?.length > 0 && (
            <div className="card p-4">
              <p className="text-[11px] text-muted uppercase tracking-wide font-semibold mb-2">Resources</p>
              {step.resources.map((r, i) => <ResourceLink key={i} resource={r} className="text-sm py-1" />)}
            </div>
          )}

          {/* AI guidance */}
          {task.aiGuidance?.length > 0 && (
            <div className="card p-4">
              <p className="text-[11px] text-muted uppercase tracking-wide font-semibold mb-2">AI Guidance</p>
              <ul className="space-y-1.5">
                {task.aiGuidance.map((g, i) => (
                  <li key={i} className="text-sm text-secondary leading-relaxed">💡 {g}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes while you work..."
            rows={3}
            className="input-field text-sm"
          />

          <div className="flex items-center justify-center gap-3">
            <button onClick={complete} className="btn-primary px-6">✓ Complete this step</button>
          </div>
        </div>
      </div>
    </div>
  );
}
