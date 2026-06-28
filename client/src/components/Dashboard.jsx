import { useState, useEffect, useCallback } from 'react';
import TaskInput from './TaskInput.jsx';
import AgentTrace from './AgentTrace.jsx';
import TaskCard from './TaskCard.jsx';
import Timeline from './Timeline.jsx';
import CalendarConnect from './CalendarConnect.jsx';
import { useSSE } from '../hooks/useSSE.js';
import { getTasks } from '../api/index.js';

const FILTERS = ['all', 'active', 'at_risk', 'completed', 'overdue'];

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProcessId, setActiveProcessId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('tasks'); // 'tasks' | 'timeline'

  const { events, isStreaming, finalData } = useSSE(activeProcessId);

  // ── Fetch tasks ────────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    try {
      const { tasks: fetched } = await getTasks();
      setTasks(fetched || []);
    } catch (err) {
      console.error('[Dashboard] Fetch tasks failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Refresh when pipeline completes
  const handleAgentDone = useCallback((data) => {
    setTimeout(fetchTasks, 500); // Small delay for Firestore write
    setActiveProcessId(null);
  }, [fetchTasks]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = {
    total: tasks.length,
    active: tasks.filter((t) => t.status === 'active').length,
    atRisk: tasks.filter((t) => t.status === 'at_risk').length,
    overdue: tasks.filter((t) => t.status === 'overdue').length,
    done: tasks.filter((t) => t.status === 'completed').length,
  };

  // ── Filtered tasks ─────────────────────────────────────────────────────────
  const filteredTasks = tasks.filter((t) => filter === 'all' || t.status === filter)
    .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)); // Sort by risk

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active',  value: stats.active,  color: 'text-brand-400'   },
          { label: 'At Risk', value: stats.atRisk,  color: 'text-amber-400'   },
          { label: 'Overdue', value: stats.overdue, color: 'text-rose-400'    },
          { label: 'Done',    value: stats.done,    color: 'text-emerald-400' },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-white/40 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Calendar connect (if not connected) */}
      <CalendarConnect />

      {/* Task input */}
      <TaskInput onProcessStart={setActiveProcessId} />

      {/* Agent trace panel — visible while pipeline runs */}
      {(events.length > 0 || isStreaming) && (
        <AgentTrace
          events={events}
          isStreaming={isStreaming}
          finalData={finalData}
          onDone={handleAgentDone}
        />
      )}

      {/* View toggle + filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-800 rounded-lg p-1 border border-white/5">
          {['tasks', 'timeline'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                view === v ? 'bg-brand-500 text-white' : 'text-white/40 hover:text-white'
              }`}
            >
              {v === 'tasks' ? '📋 Tasks' : '🗓 Timeline'}
            </button>
          ))}
        </div>

        {view === 'tasks' && (
          <div className="flex items-center gap-1 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                  filter === f
                    ? 'border-brand-500 bg-brand-500/20 text-brand-400'
                    : 'border-white/10 text-white/30 hover:text-white/60'
                }`}
              >
                {f.replace('_', ' ')}
                {f !== 'all' && stats[f === 'at_risk' ? 'atRisk' : f] > 0 && (
                  <span className="ml-1.5 text-white/50">
                    {stats[f === 'at_risk' ? 'atRisk' : f]}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Task list or timeline */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="card h-24 animate-pulse bg-surface-800/50" />
          ))}
        </div>
      ) : view === 'tasks' ? (
        <div className="space-y-3">
          {filteredTasks.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-white/30 text-sm">
                {filter === 'all'
                  ? 'No tasks yet. Add one above — AI agents will take it from there.'
                  : `No ${filter.replace('_', ' ')} tasks.`}
              </p>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdate={fetchTasks}
                onDelete={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
              />
            ))
          )}
        </div>
      ) : (
        <Timeline tasks={tasks} />
      )}
    </div>
  );
}
