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

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (!step) {
    return (
      <div className="fixed inset-0 z-50 bg-surface-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/60">🎉 No remaining steps — nothing to focus on.</p>
          <button onClick={onClose} className="btn-ghost mt-4">Close</button>
        </div>
      </div>
    );
  }

  const complete = async () => {
    await onUpdate(step.id, { status: 'completed', notes });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-950 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <span className="text-xs text-white/30 uppercase tracking-widest font-semibold">Focus Mode</span>
        <button onClick={onClose} className="text-white/40 hover:text-white text-sm">✕ Exit</button>
      </div>

      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 py-8">
        <div className="max-w-xl w-full space-y-6">
          <div className="text-center">
            <p className="text-xs text-brand-400 uppercase tracking-wide font-semibold mb-1">{task.title}</p>
            <h1 className="text-2xl font-bold text-white">{step.title}</h1>
            {step.description && <p className="text-sm text-white/45 mt-2 leading-relaxed">{step.description}</p>}
          </div>

          {/* Timer */}
          <div className="text-center">
            <div className="text-5xl font-mono font-bold text-white tabular-nums">{timer.display}</div>
            <button
              onClick={() => setRunning((r) => !r)}
              className="mt-3 text-xs text-white/40 hover:text-white border border-white/10 rounded-full px-4 py-1.5"
            >
              {running ? '⏸ Pause timer' : '▶ Resume timer'}
            </button>
          </div>

          {/* Resources */}
          {step.resources?.length > 0 && (
            <div className="card p-4">
              <p className="text-[11px] text-white/30 uppercase tracking-wide font-semibold mb-2">Resources</p>
              {step.resources.map((r, i) => <ResourceLink key={i} resource={r} className="text-sm py-1" />)}
            </div>
          )}

          {/* AI guidance */}
          {task.aiGuidance?.length > 0 && (
            <div className="card p-4">
              <p className="text-[11px] text-white/30 uppercase tracking-wide font-semibold mb-2">AI Guidance</p>
              <ul className="space-y-1.5">
                {task.aiGuidance.map((g, i) => (
                  <li key={i} className="text-sm text-white/55 leading-relaxed">💡 {g}</li>
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
