import { useEffect, useRef } from 'react';

const AGENT_META = {
  parser:          { icon: '🔍', label: 'Task Parser',        color: 'text-sky-400',     border: 'border-sky-500/30',    bg: 'bg-sky-500/5'    },
  prioritization:  { icon: '⚖️', label: 'Prioritization',     color: 'text-violet-400',  border: 'border-violet-500/30', bg: 'bg-violet-500/5' },
  planning:        { icon: '📝', label: 'Planning',           color: 'text-amber-400',   border: 'border-amber-500/30',  bg: 'bg-amber-500/5'  },
  scheduler:       { icon: '📅', label: 'Scheduler',          color: 'text-emerald-400', border: 'border-emerald-500/30',bg: 'bg-emerald-500/5'},
  monitor:         { icon: '👁️', label: 'Monitor',            color: 'text-rose-400',    border: 'border-rose-500/30',   bg: 'bg-rose-500/5'   },
  system:          { icon: '⚡', label: 'System',             color: 'text-white/60',    border: 'border-white/10',      bg: 'bg-white/3'      },
};

function StatusDot({ status }) {
  if (status === 'done') return <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />;
  if (status === 'error') return <span className="w-2 h-2 rounded-full bg-rose-400 flex-shrink-0" />;
  if (status === 'warning') return <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse flex-shrink-0" />;
}

function AgentEvent({ event }) {
  const meta = AGENT_META[event.agent] || AGENT_META.system;

  return (
    <div className={`agent-step ${meta.border} ${meta.bg} animate-slide-in`}>
      <StatusDot status={event.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm">{meta.icon}</span>
          <span className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>
            {meta.label}
          </span>
          {event.ts && (
            <span className="text-[10px] text-white/20 ml-auto font-mono">
              {new Date(event.ts).toLocaleTimeString()}
            </span>
          )}
        </div>
        <p className="text-sm text-white/70 leading-relaxed">{event.message}</p>

        {/* Expanded data if present */}
        {event.data && (
          <div className="mt-2 p-2 rounded bg-black/20 font-mono text-[11px] text-white/50 overflow-x-auto">
            {Object.entries(event.data).map(([k, v]) => (
              <div key={k}>
                <span className={meta.color}>{k}:</span>{' '}
                <span className="text-white/70">
                  {typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * AgentTrace — live panel showing each agent's thoughts as they stream in.
 *
 * @param {object[]} events     – from useSSE hook
 * @param {boolean}  isStreaming
 * @param {object}   finalData  – set when pipeline completes
 */
export default function AgentTrace({ events, isStreaming, finalData, onDone }) {
  const bottomRef = useRef(null);

  // Auto-scroll to latest event
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Notify parent when done
  useEffect(() => {
    if (finalData) onDone?.(finalData);
  }, [finalData, onDone]);

  if (events.length === 0 && !isStreaming) return null;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-rose-500/60" />
          <span className="w-3 h-3 rounded-full bg-amber-500/60" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/60" />
        </div>
        <span className="font-mono text-xs text-white/40">agent_trace.log</span>
        {isStreaming && (
          <div className="ml-auto flex items-center gap-2 text-xs text-brand-400">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            LIVE
          </div>
        )}
        {finalData && (
          <div className="ml-auto flex items-center gap-2 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            COMPLETE
          </div>
        )}
      </div>

      {/* Events stream */}
      <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
        {events.map((event, i) => (
          <AgentEvent key={i} event={event} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-white/30 font-mono">
            <span className="cursor" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Summary bar when complete */}
      {finalData && (
        <div className="border-t border-white/5 px-4 py-3 bg-emerald-500/5">
          <div className="flex flex-wrap gap-4 text-xs text-white/60">
            {finalData.priorityScore && (
              <span>Priority: <strong className="text-white">{finalData.priorityScore}/100</strong></span>
            )}
            {finalData.riskScore !== undefined && (
              <span>Risk: <strong className="text-white">{finalData.riskScore}/100</strong></span>
            )}
            {finalData.subtaskCount && (
              <span>Subtasks: <strong className="text-white">{finalData.subtaskCount}</strong></span>
            )}
            {finalData.scheduledCount > 0 && (
              <span>Calendar: <strong className="text-emerald-400">{finalData.scheduledCount} events added</strong></span>
            )}
          </div>
          {finalData.warnings?.length > 0 && (
            <div className="mt-2 text-xs text-amber-400">
              ⚠️ {finalData.warnings[0]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
