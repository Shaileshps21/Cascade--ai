// /**
//  * DailyBriefing — Morning briefing card
//  * ─────────────────────────────────────────────────────────────────────────────
//  * Shown once per day at the top of the dashboard.
//  * Generates on-demand if no briefing exists yet for today.
//  * Dismissed state prevents re-showing until tomorrow.
//  */

// import { useState, useEffect, useCallback } from 'react';
// import { getTodaysBriefing, generateBriefing, markBriefingSeen, dismissBriefing } from '../api/index.js';

// // Urgency level styles
// const URGENCY = {
//     calm: {
//         border: 'border-emerald-500/20',
//         bg: 'bg-emerald-500/5',
//         badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
//         icon: '🌅',
//         label: 'All Clear',
//         glow: '',
//     },
//     watchful: {
//         border: 'border-brand-500/25',
//         bg: 'bg-brand-500/5',
//         badge: 'bg-brand-500/15 text-brand-400 border-brand-500/30',
//         icon: '👁️',
//         label: 'Stay Alert',
//         glow: '',
//     },
//     urgent: {
//         border: 'border-amber-500/35',
//         bg: 'bg-amber-500/5',
//         badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
//         icon: '⚠️',
//         label: 'Urgent',
//         glow: 'ring-1 ring-amber-500/20',
//     },
//     critical: {
//         border: 'border-rose-500/40',
//         bg: 'bg-rose-500/5',
//         badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
//         icon: '🚨',
//         label: 'Critical',
//         glow: 'ring-1 ring-rose-500/30',
//     },
// };

// const STATUS_DOT = {
//     on_track: 'bg-emerald-400',
//     at_risk: 'bg-amber-400',
//     critical: 'bg-rose-400 animate-pulse',
//     overdue: 'bg-rose-500 animate-pulse',
// };

// function TaskRow({ task }) {
//     const dot = STATUS_DOT[task.status] || 'bg-white/20';
//     return (
//         <div className="flex items-center gap-2.5 py-1.5">
//             <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
//             <span className="text-sm text-white/80 flex-1 min-w-0 truncate">{task.title}</span>
//             <span className="text-xs text-white/30 flex-shrink-0">
//                 {task.hoursLeft < 24
//                     ? `${Math.round(task.hoursLeft)}h left`
//                     : `${Math.round(task.hoursLeft / 24)}d left`}
//             </span>
//             <span className="text-xs text-white/30 flex-shrink-0">{task.progress}%</span>
//         </div>
//     );
// }

// export default function DailyBriefing({ onFocusTask }) {
//     const [briefing, setBriefing] = useState(null);
//     const [loading, setLoading] = useState(true);
//     const [generating, setGenerating] = useState(false);
//     const [dismissed, setDismissed] = useState(false);
//     const [expanded, setExpanded] = useState(true);
//     const [error, setError] = useState('');

//     // ── Fetch today's briefing on mount ────────────────────────────────────────
//     const fetchBriefing = useCallback(async () => {
//         setLoading(true);
//         try {
//             const { briefing: b } = await getTodaysBriefing();
//             if (b) {
//                 setBriefing(b);
//                 if (b.dismissed) setDismissed(true);
//                 // Mark as seen
//                 if (!b.seen) markBriefingSeen().catch(() => { });
//             }
//         } catch (err) {
//             console.error('[Briefing]', err.message);
//         } finally {
//             setLoading(false);
//         }
//     }, []);

//     useEffect(() => { fetchBriefing(); }, [fetchBriefing]);

//     // ── Generate on demand ─────────────────────────────────────────────────────
//     const handleGenerate = async () => {
//         setGenerating(true);
//         setError('');
//         try {
//             const { briefing: b } = await generateBriefing();
//             setBriefing(b);
//             setDismissed(false);
//         } catch (err) {
//             setError(err.message || 'Could not generate briefing');
//         } finally {
//             setGenerating(false);
//         }
//     };

//     // ── Dismiss ────────────────────────────────────────────────────────────────
//     const handleDismiss = async () => {
//         setDismissed(true);
//         dismissBriefing().catch(() => { });
//     };

//     // ── Render states ──────────────────────────────────────────────────────────
//     if (loading) {
//         return (
//             <div className="card p-4 border border-white/5 animate-pulse">
//                 <div className="h-4 bg-white/5 rounded w-48 mb-2" />
//                 <div className="h-3 bg-white/5 rounded w-72" />
//             </div>
//         );
//     }

//     if (dismissed && !generating) {
//         return (
//             <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/5 bg-white/2">
//                 <span className="text-white/20 text-sm">🌅</span>
//                 <span className="text-xs text-white/25">Today's briefing dismissed</span>
//                 <button
//                     onClick={() => { setDismissed(false); if (!briefing) handleGenerate(); }}
//                     className="ml-auto text-xs text-white/25 hover:text-brand-400 transition-colors"
//                 >
//                     Show again
//                 </button>
//             </div>
//         );
//     }

//     if (!briefing && !generating) {
//         return (
//             <div className="card p-4 border border-white/8">
//                 <div className="flex items-center gap-3">
//                     <span className="text-2xl">🌅</span>
//                     <div className="flex-1">
//                         <p className="text-sm font-medium text-white">No briefing yet today</p>
//                         <p className="text-xs text-white/35">
//                             Auto-generates at 9 AM · or generate now for instant insights
//                         </p>
//                     </div>
//                     <button onClick={handleGenerate} className="btn-primary text-sm flex-shrink-0">
//                         Generate Now
//                     </button>
//                 </div>
//                 {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
//             </div>
//         );
//     }

//     if (generating) {
//         return (
//             <div className="card p-5 border border-brand-500/20 bg-brand-500/3">
//                 <div className="flex items-center gap-3">
//                     <svg className="animate-spin w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24">
//                         <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                         <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//                     </svg>
//                     <div>
//                         <p className="text-sm font-medium text-white">Generating your morning briefing...</p>
//                         <p className="text-xs text-white/35">Analysing your tasks with AI</p>
//                     </div>
//                 </div>
//             </div>
//         );
//     }

//     const urgency = URGENCY[briefing.urgencyLevel] || URGENCY.watchful;

//     return (
//         <div className={`card border ${urgency.border} ${urgency.bg} ${urgency.glow} overflow-hidden transition-all duration-300`}>

//             {/* ── Header ─────────────────────────────────────────────────────────── */}
//             <div className="px-4 pt-4 pb-3">
//                 <div className="flex items-start gap-3">
//                     <span className="text-2xl flex-shrink-0">{urgency.icon}</span>

//                     <div className="flex-1 min-w-0">
//                         <div className="flex items-center gap-2 mb-1 flex-wrap">
//                             <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${urgency.badge}`}>
//                                 {urgency.label.toUpperCase()}
//                             </span>
//                             <span className="text-[11px] text-white/25 font-mono">
//                                 {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
//                             </span>
//                             <span className="text-[11px] text-white/20 ml-auto">AI Briefing</span>
//                         </div>

//                         <p className="text-base font-semibold text-white leading-snug">
//                             {briefing.greeting}
//                         </p>
//                         <p className="text-sm text-white/60 mt-0.5">
//                             {briefing.headline}
//                         </p>
//                     </div>

//                     {/* Controls */}
//                     <div className="flex items-center gap-1 flex-shrink-0">
//                         <button
//                             onClick={() => setExpanded((v) => !v)}
//                             className="text-white/20 hover:text-white/60 p-1 text-xs"
//                         >
//                             {expanded ? '▲' : '▼'}
//                         </button>
//                         <button
//                             onClick={handleDismiss}
//                             className="text-white/15 hover:text-white/50 p-1 text-xs"
//                             title="Dismiss for today"
//                         >
//                             ✕
//                         </button>
//                     </div>
//                 </div>
//             </div>

//             {/* ── Expanded content ────────────────────────────────────────────────── */}
//             {expanded && (
//                 <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-3 animate-fade-in">

//                     {/* Task overview */}
//                     {briefing.taskOverview?.length > 0 && (
//                         <div>
//                             <p className="text-[11px] font-semibold text-white/30 uppercase tracking-wider mb-2">
//                                 Task Overview
//                             </p>
//                             <div className="divide-y divide-white/5">
//                                 {briefing.taskOverview.map((task, i) => (
//                                     <TaskRow key={i} task={task} />
//                                 ))}
//                             </div>
//                         </div>
//                     )}

//                     {/* Top priority */}
//                     {briefing.topPriority && (
//                         <div className={`p-3 rounded-xl border ${urgency.border} ${urgency.bg}`}>
//                             <div className="flex items-start justify-between gap-3">
//                                 <div className="flex-1 min-w-0">
//                                     <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-1">
//                                         🎯 Top Priority
//                                     </p>
//                                     <p className="text-sm font-semibold text-white">{briefing.topPriority.taskTitle}</p>
//                                     <p className="text-xs text-white/50 mt-0.5">{briefing.topPriority.reason}</p>
//                                     <div className="flex items-center gap-2 mt-2">
//                                         <span className="text-xs bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-white/60">
//                                             Next: {briefing.topPriority.firstSubtask}
//                                         </span>
//                                         {briefing.topPriority.estimatedMinutes && (
//                                             <span className="text-xs text-white/30">
//                                                 {briefing.topPriority.estimatedMinutes}m
//                                             </span>
//                                         )}
//                                         {briefing.topPriority.scheduledTime && (
//                                             <span className="text-xs text-brand-400">
//                                                 @ {briefing.topPriority.scheduledTime}
//                                             </span>
//                                         )}
//                                     </div>
//                                 </div>
//                                 <button
//                                     onClick={() => onFocusTask?.(briefing.topPriority.taskTitle)}
//                                     className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
//                                 >
//                                     Focus →
//                                 </button>
//                             </div>
//                         </div>
//                     )}

//                     {/* Insight + Motivational note */}
//                     <div className="space-y-2">
//                         {briefing.insight && (
//                             <div className="flex items-start gap-2">
//                                 <span className="text-sm flex-shrink-0">💡</span>
//                                 <p className="text-xs text-white/55 leading-relaxed">{briefing.insight}</p>
//                             </div>
//                         )}
//                         {briefing.motivationalNote && (
//                             <div className="flex items-start gap-2">
//                                 <span className="text-sm flex-shrink-0">
//                                     {briefing.urgencyLevel === 'critical' ? '⚡' : '✨'}
//                                 </span>
//                                 <p className="text-xs text-white/55 leading-relaxed italic">
//                                     {briefing.motivationalNote}
//                                 </p>
//                             </div>
//                         )}
//                         {briefing.todayGoal && (
//                             <div className="flex items-start gap-2 pt-1 border-t border-white/5">
//                                 <span className="text-sm flex-shrink-0">🎯</span>
//                                 <p className="text-xs text-white/40 leading-relaxed">
//                                     <strong className="text-white/60">Today's goal:</strong> {briefing.todayGoal}
//                                 </p>
//                             </div>
//                         )}
//                     </div>

//                     {/* Footer: refresh button */}
//                     <div className="flex items-center justify-between pt-1">
//                         <p className="text-[10px] text-white/20">
//                             Generated {new Date(briefing.generatedAt?.seconds
//                                 ? briefing.generatedAt.seconds * 1000
//                                 : briefing.generatedAt).toLocaleTimeString()}
//                         </p>
//                         <button
//                             onClick={handleGenerate}
//                             disabled={generating}
//                             className="text-[11px] text-white/25 hover:text-brand-400 transition-colors"
//                         >
//                             ↻ Refresh briefing
//                         </button>
//                     </div>
//                 </div>
//             )}
//         </div>
//     );
// }









// --------------------------------------new file ---------------------------------------
/**
 * DailyBriefing — Improved morning briefing card
 * Shows: urgency level, focus schedule, triage overview, AI insight
 */

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Sunrise, Eye, Zap, Siren, Pin, Flame, AlertTriangle, Calendar, CheckCircle2, Lightbulb, Sparkles, Target, ChevronUp, ChevronDown, X, RefreshCw } from 'lucide-react';
import { getTodaysBriefing, generateBriefing, markBriefingSeen, dismissBriefing } from '../api/index.js';

// Format an ISO instant as 24h "HH:mm" in the VIEWER's own timezone — same
// token ProjectWorkspace.jsx's Schedule tab already uses for
// `scheduledStart`, so a task's time in the briefing always matches its time
// in the Roadmap/Schedule tab. The server sends `startISO`/`endISO` (real
// instants) precisely so this can happen client-side instead of being baked
// into a fixed-zone string server can't know the viewer's offset for.
function formatLocalTime(iso, fallback) {
  if (!iso) return fallback ?? '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? (fallback ?? '') : format(d, 'HH:mm');
}

const URGENCY_STYLES = {
    calm: {
        border: 'border-success/20', bg: 'bg-success/5',
        badge: 'bg-success/15 text-success border-success/30',
        icon: Sunrise, label: 'All Clear',
    },
    watchful: {
        border: 'border-brand-500/25', bg: 'bg-brand-500/5',
        badge: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
        icon: Eye, label: 'Stay Alert',
    },
    urgent: {
        border: 'border-warning/35', bg: 'bg-warning/5',
        badge: 'bg-warning/15 text-warning border-warning/30',
        icon: Zap, label: 'Urgent',
    },
    critical: {
        border: 'border-danger/40', bg: 'bg-danger/5',
        badge: 'bg-danger/15 text-danger border-danger/30',
        icon: Siren, label: 'Critical',
    },
};

const URGENCY_COLORS = {
    overdue: 'text-danger bg-danger/10 border-danger/25',
    critical: 'text-danger bg-danger/10 border-danger/25',
    urgent: 'text-warning bg-warning/10 border-warning/25',
    normal: 'text-brand-500 bg-brand-500/10 border-brand-500/25',
};

function FocusBlock({ block, index }) {
    const colors = URGENCY_COLORS[block.urgency] || URGENCY_COLORS.normal;
    return (
        <div className={`flex items-start gap-3 p-3 rounded-xl border ${colors}`}>
            <div className="flex-shrink-0 text-center min-w-[52px] font-mono tabular-nums">
                <p className="text-xs font-bold text-current">{formatLocalTime(block.startISO, block.time)}</p>
                <p className="text-[10px] text-current/60">{formatLocalTime(block.endISO, block.endTime)}</p>
            </div>
            <div className="w-px self-stretch bg-current/20 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-primary leading-tight">{block.subtask}</p>
                <p className="text-xs text-muted mt-0.5">{block.task}</p>
            </div>
            <div className="flex-shrink-0 text-right font-mono tabular-nums">
                <p className="text-xs font-medium text-current">{block.duration}m</p>
                {block.hoursLeft < 24 && (
                    <p className="text-[10px] text-current/60">{Math.round(block.hoursLeft)}h left</p>
                )}
            </div>
        </div>
    );
}

function TriagePill({ icon: Icon, label, tasks, color }) {
    if (!tasks?.length) return null;
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`flex items-center gap-1 text-[11px] font-medium ${color}`}>
                <Icon className="w-3 h-3 flex-shrink-0" /> {label}
            </span>
            {tasks.map((t, i) => (
                <span key={i} className="text-[11px] bg-surface-hover border border-border px-2 py-0.5 rounded-full text-secondary">
                    {t.title}
                    {t.hoursLeft < 48 && (
                        <span className="ml-1 text-muted font-mono tabular-nums">
                            {t.hoursLeft < 1 ? `${Math.round(t.hoursLeft * 60)}m` : `${Math.round(t.hoursLeft)}h`}
                        </span>
                    )}
                </span>
            ))}
        </div>
    );
}

export default function DailyBriefing() {
    const [briefing, setBriefing] = useState(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [expanded, setExpanded] = useState(true);
    const [error, setError] = useState('');

    const fetchBriefing = useCallback(async () => {
        setLoading(true);
        try {
            const { briefing: b } = await getTodaysBriefing();
            if (b) {
                setBriefing(b);
                if (b.dismissed) setDismissed(true);
                if (!b.seen) markBriefingSeen().catch(() => { });
            }
        } catch { }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchBriefing(); }, [fetchBriefing]);

    const handleGenerate = async () => {
        setGenerating(true); setError('');
        try {
            const { briefing: b } = await generateBriefing();
            setBriefing(b); setDismissed(false); setExpanded(true);
        } catch (e) { setError(e.message); }
        finally { setGenerating(false); }
    };

    const handleDismiss = () => {
        setDismissed(true);
        dismissBriefing().catch(() => { });
    };

    // ── Loading ───────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="card p-4 border border-border animate-pulse">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-hover" />
                    <div className="space-y-1.5 flex-1">
                        <div className="h-3.5 bg-surface-hover rounded w-32" />
                        <div className="h-2.5 bg-surface-hover rounded w-64" />
                    </div>
                </div>
            </div>
        );
    }

    // ── Dismissed ─────────────────────────────────────────────────────────────
    if (dismissed && !generating) {
        return (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-surface">
                <Sunrise className="w-4 h-4 text-muted" />
                <span className="text-xs text-muted">Briefing dismissed for today</span>
                <button
                    onClick={() => { setDismissed(false); if (!briefing) handleGenerate(); }}
                    className="ml-auto text-xs text-muted hover:text-brand-500 transition-colors"
                >
                    Show again
                </button>
            </div>
        );
    }

    // ── Generating ────────────────────────────────────────────────────────────
    if (generating) {
        return (
            <div className="card p-5 border border-brand-500/20 bg-brand-500/3">
                <div className="flex items-center gap-3">
                    <svg className="animate-spin w-5 h-5 text-brand-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <div>
                        <p className="text-sm font-medium text-primary">Generating your morning briefing...</p>
                        <p className="text-xs text-muted">Analysing tasks · Building focus schedule · Writing insights</p>
                    </div>
                </div>
            </div>
        );
    }

    // ── No briefing yet ───────────────────────────────────────────────────────
    if (!briefing) {
        return (
            <div className="card p-4 border border-border">
                <div className="flex items-center gap-3">
                    <Sunrise className="w-6 h-6 flex-shrink-0 text-muted" />
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-primary">Morning briefing</p>
                        <p className="text-xs text-muted">
                            Auto-generates at 9 AM · Includes focus schedule + AI insights
                        </p>
                    </div>
                    <button onClick={handleGenerate} className="btn-primary text-sm flex-shrink-0">
                        Generate Now
                    </button>
                </div>
                {error && <p className="text-xs text-danger mt-2 px-1">{error}</p>}
            </div>
        );
    }

    const u = URGENCY_STYLES[briefing.urgencyLevel] || URGENCY_STYLES.watchful;

    return (
        <div className={`card border ${u.border} ${u.bg} overflow-hidden`}>

            {/* ── Header ─────────────────────────────────────────────────────────── */}
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <u.icon className="w-6 h-6 flex-shrink-0 mt-0.5 text-current" />

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${u.badge}`}>
                                {u.label}
                            </span>
                            <span className="text-[11px] text-muted font-mono">
                                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                            </span>
                            <span className="text-[10px] text-muted ml-auto">AI Briefing · {briefing.llmProvider}</span>
                        </div>
                        <p className="text-sm font-semibold text-primary leading-snug">{briefing.greeting}</p>
                        <p className="text-sm text-secondary mt-0.5 leading-snug">{briefing.headline}</p>
                    </div>

                    <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => setExpanded(v => !v)} className="text-muted hover:text-secondary p-1">
                            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={handleDismiss} title="Dismiss" className="text-muted hover:text-secondary p-1">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Expanded ───────────────────────────────────────────────────────── */}
            {expanded && (
                <div className="border-t border-border px-4 pb-4 pt-3 space-y-4 animate-fade-in">

                    {/* Focus Schedule */}
                    {briefing.focusSchedule?.length > 0 && (
                        <div>
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">
                                <Pin className="w-3 h-3" /> Today's Focus Blocks
                            </p>
                            <div className="space-y-2">
                                {briefing.focusSchedule.map((block, i) => (
                                    <FocusBlock key={i} block={block} index={i} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Triage pills */}
                    {briefing.triage && (
                        <div className="space-y-1.5">
                            <TriagePill icon={Flame} label="Fire now" tasks={briefing.triage.fireNow} color="text-danger" />
                            <TriagePill icon={AlertTriangle} label="Due today" tasks={briefing.triage.dueToday} color="text-warning" />
                            <TriagePill icon={Calendar} label="This week" tasks={briefing.triage.dueWeek} color="text-brand-500" />
                            <TriagePill icon={CheckCircle2} label="On track" tasks={briefing.triage.onTrack} color="text-success" />
                            {briefing.triage.overdue?.length > 0 && (
                                <TriagePill icon={Siren} label="Overdue" tasks={briefing.triage.overdue} color="text-danger" />
                            )}
                        </div>
                    )}

                    {/* AI insights */}
                    <div className="space-y-2 pt-1 border-t border-border">
                        {briefing.warning && (
                            <div className="flex gap-2 p-2.5 rounded-lg bg-danger/10 border border-danger/20">
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-danger mt-0.5" />
                                <p className="text-xs text-danger leading-relaxed">{briefing.warning}</p>
                            </div>
                        )}
                        {briefing.insight && (
                            <div className="flex gap-2">
                                <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 text-muted mt-0.5" />
                                <p className="text-xs text-secondary leading-relaxed">{briefing.insight}</p>
                            </div>
                        )}
                        {briefing.motivationalNote && (
                            <div className="flex gap-2">
                                <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-muted mt-0.5" />
                                <p className="text-xs text-secondary leading-relaxed italic">{briefing.motivationalNote}</p>
                            </div>
                        )}
                        {briefing.todayGoal && (
                            <div className="flex gap-2 pt-1 border-t border-border">
                                <Target className="w-3.5 h-3.5 flex-shrink-0 text-muted mt-0.5" />
                                <p className="text-xs text-muted leading-relaxed">
                                    <strong className="text-secondary">Today's goal:</strong> {briefing.todayGoal}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1">
                        <p className="text-[10px] text-muted">
                            Generated {formatLocalTime(
                                typeof briefing.generatedAt === 'string'
                                    ? briefing.generatedAt
                                    : new Date(briefing.generatedAt?.seconds * 1000).toISOString()
                            )}
                        </p>
                        <button
                            onClick={handleGenerate}
                            disabled={generating}
                            className="flex items-center gap-1 text-[11px] text-muted hover:text-brand-500 transition-colors"
                        >
                            <RefreshCw className="w-3 h-3" /> Refresh
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}