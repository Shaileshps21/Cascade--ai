import { useState } from 'react';
import ResourceLink from './ResourceLink.jsx';
import MarkdownText from './MarkdownText.jsx';

const STATUS_META = {
  pending: { label: 'Pending', dot: 'bg-white/20', text: 'text-white/40' },
  in_progress: { label: 'In progress', dot: 'bg-brand-400 animate-pulse', text: 'text-brand-400' },
  completed: { label: 'Completed', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  blocked: { label: 'Blocked', dot: 'bg-rose-400', text: 'text-rose-400' },
  skipped: { label: 'Skipped', dot: 'bg-white/20', text: 'text-white/30' },
};

/**
 * ExecutionStepItem — one interactive execution step. Users can Start,
 * Pause, Complete, Skip (if optional), add notes, attach evidence and open
 * step-scoped resources, per the plan's interactive execution steps spec.
 *
 * @param {object} step
 * @param {(patch: object) => Promise<void>} onUpdate - PATCH the step
 */
export default function ExecutionStepItem({ step, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(step.notes ?? '');
  const [editingNotes, setEditingNotes] = useState(!step.notes);
  const [busy, setBusy] = useState(false);
  const [focusNotes, setFocusNotes] = useState(false);
  const meta = STATUS_META[step.status] || STATUS_META.pending;

  const run = async (patch) => {
    setBusy(true);
    try {
      await onUpdate(patch);
    } finally {
      setBusy(false);
    }
  };

  const handleBlock = () => {
    const reason = prompt('What is blocking this step?');
    if (reason === null) return;
    run({ status: 'blocked', blockedReason: reason });
  };

  const saveNotes = () => {
    if (notes !== (step.notes ?? '')) run({ notes });
    setEditingNotes(false);
    setFocusNotes(false);
  };

  return (
    <div className={`card overflow-hidden ${step.status === 'blocked' ? 'border-rose-500/25' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status toggle checkbox */}
        <button
          disabled={busy}
          onClick={() => run({ status: step.status === 'completed' ? 'pending' : 'completed' })}
          title={step.status === 'completed' ? 'Reopen' : 'Mark complete'}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${step.status === 'completed' ? 'bg-emerald-500 border-emerald-500' : 'border-white/20 hover:border-white/40'
            }`}
        >
          {step.status === 'completed' && <span className="text-white text-[11px] font-bold">✓</span>}
        </button>

        <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded((e) => !e)}>
          <span className={`text-sm ${step.status === 'completed' ? 'text-white/40 line-through' : 'text-white/85'}`}>
            {step.title}
          </span>
          {step.isOptional && <span className="ml-2 text-[10px] text-white/25 border border-white/10 rounded px-1 py-0.5">optional</span>}
        </button>

        <span className={`text-[11px] font-medium flex-shrink-0 flex items-center gap-1.5 ${meta.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>

        {step.estimatedMinutes != null && (
          <span className="text-[11px] text-white/30 flex-shrink-0 hidden sm:inline">{step.estimatedMinutes}m</span>
        )}

        <button onClick={() => setExpanded((e) => !e)} className={`text-white/25 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}>
          ›
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3">
          {step.description && <p className="text-sm text-white/50 leading-relaxed">{step.description}</p>}

          {step.status === 'blocked' && step.blockedReason && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              🚧 {step.blockedReason}
            </div>
          )}

          {step.resources?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-white/30 uppercase tracking-wide font-semibold">Resources</p>
              {step.resources.map((r, i) => <ResourceLink key={i} resource={r} />)}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {step.status !== 'in_progress' && step.status !== 'completed' && (
              <button disabled={busy} onClick={() => run({ status: 'in_progress' })} className="btn-primary text-xs py-1.5 px-3">
                ▶ Start
              </button>
            )}
            {step.status === 'in_progress' && (
              <>
                <button disabled={busy} onClick={() => run({ status: 'pending' })} className="btn-ghost text-xs py-1.5 px-3 border border-white/10">
                  ⏸ Pause
                </button>
                <button disabled={busy} onClick={() => run({ status: 'completed' })} className="btn-primary text-xs py-1.5 px-3">
                  ✓ Complete
                </button>
              </>
            )}
            {step.status === 'blocked' && (
              <button disabled={busy} onClick={() => run({ status: 'in_progress' })} className="btn-primary text-xs py-1.5 px-3">
                Unblock
              </button>
            )}
            {step.status !== 'blocked' && step.status !== 'completed' && (
              <button disabled={busy} onClick={handleBlock} className="btn-ghost text-xs py-1.5 px-3 border border-rose-500/20 text-rose-400">
                🚧 Mark blocked
              </button>
            )}
            {step.isOptional && step.status !== 'completed' && step.status !== 'skipped' && (
              <button disabled={busy} onClick={() => run({ status: 'skipped' })} className="btn-ghost text-xs py-1.5 px-3">
                Skip
              </button>
            )}
          </div>

          {/* Notes — markdown supported (suggestions.md #4) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-white/30 uppercase tracking-wide font-semibold">Notes</p>
              {!editingNotes && (
                <button onClick={() => { setEditingNotes(true); setFocusNotes(true); }} className="text-[11px] text-brand-400 hover:text-brand-300">
                  Edit
                </button>
              )}
            </div>
            {editingNotes ? (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                placeholder="Add a note for this step... (markdown: **bold**, *italic*, `code`, [link](url), - list)"
                rows={2}
                autoFocus={focusNotes}
                className="input-field text-xs py-2"
              />
            ) : (
              <MarkdownText text={notes} className="text-xs text-white/60 leading-relaxed" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
