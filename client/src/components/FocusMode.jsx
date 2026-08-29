import { useState, useEffect, useRef } from 'react';
import ResourceLink from './ResourceLink.jsx';

function useElapsedTimer(running) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => intervalRef.current && clearInterval(intervalRef.current);
  }, [running]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return { display: `${mm}:${ss}`, seconds };
}

/**
 * FocusMode — "Start Working" distraction-free overlay. Shows only the
 * current task, current execution step, its resources, a timer, notes and
 * AI guidance, per the plan's Smart Execution Mode spec.
 */
export default function FocusMode({ task, step, onUpdate, onClose }) {
  const [running, setRunning] = useState(true);
  const [notes, setNotes] = useState(step?.notes ?? '');
  const timer = useElapsedTimer(running);
  const startedRef = useRef(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Pomodoro-style time tracking (suggestions.md #5): mark the step
  // in_progress the instant focused work begins, so its startedAt is real
  // (also lights up the Task Workspace "Started" timeline node) and the
  // timer below reflects genuine elapsed focus time.
  useEffect(() => {
    if (!step || startedRef.current) return;
    if (step.status !== 'in_progress' && step.status !== 'completed') {
      startedRef.current = true;
      onUpdate(step.id, { status: 'in_progress' });
    }
  }, [step, onUpdate]);

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

  const complete = async () => {
    // The timer's own active seconds (paused time excluded) is a more
    // accurate measure of real focus than the wall-clock startedAt->now span
    // the backend would otherwise derive — pass it through when there's
    // anything to report. `undefined` is dropped by JSON.stringify, so an
    // instant-complete (0 seconds) cleanly falls back to the server's own
    // timestamp-based measurement instead of reporting a fabricated 0.
    const measuredMinutes = timer.seconds > 0 ? Math.max(1, Math.round(timer.seconds / 60)) : undefined;
    await onUpdate(step.id, { status: 'completed', notes, actualMinutes: measuredMinutes });
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
            <button
              onClick={() => setRunning((r) => !r)}
              className="mt-3 text-xs text-secondary hover:text-primary border border-border rounded-full px-4 py-1.5"
            >
              {running ? '⏸ Pause timer' : '▶ Resume timer'}
            </button>
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
