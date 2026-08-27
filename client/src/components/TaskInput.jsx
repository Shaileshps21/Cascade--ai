// import { useState } from 'react';
// import { initiateTask } from '../api/index.js';

// const PLACEHOLDERS = [
//   'Submit ML assignment before Friday — it\'s complex...',
//   'Prepare investor pitch deck by tomorrow noon...',
//   'Fix production bug before client demo at 3 PM...',
//   'Write research paper intro by end of week...',
// ];

// export default function TaskInput({ onProcessStart }) {
//   const [input, setInput] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [placeholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]);

//   const handleSubmit = async () => {
//     const trimmed = input.trim();
//     if (!trimmed || loading) return;
//     if (trimmed.length < 10) {
//       setError('Please describe your task in a bit more detail.');
//       return;
//     }

//     setError('');
//     setLoading(true);

//     try {
//       const { processId } = await initiateTask(trimmed);
//       onProcessStart?.(processId);
//       setInput('');
//     } catch (err) {
//       setError(err.message || 'Failed to start. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleKeyDown = (e) => {
//     if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
//   };

//   return (
//     <div className="card p-5">
//       <div className="flex items-center gap-2 mb-3">
//         <span className="text-lg">⚡</span>
//         <h2 className="font-semibold text-white">Add a Task</h2>
//         <span className="text-xs text-white/30 ml-auto font-mono">⌘↵ to submit</span>
//       </div>

//       <textarea
//         value={input}
//         onChange={(e) => setInput(e.target.value)}
//         onKeyDown={handleKeyDown}
//         placeholder={placeholder}
//         rows={3}
//         disabled={loading}
//         className="input-field input-glow resize-none font-sans text-sm leading-relaxed disabled:opacity-50"
//       />

//       {error && (
//         <p className="mt-2 text-xs text-rose-400">{error}</p>
//       )}

//       <div className="flex items-center justify-between mt-3">
//         <p className="text-xs text-white/25">
//           AI agents will parse, prioritize, plan and schedule this automatically.
//         </p>
//         <button
//           onClick={handleSubmit}
//           disabled={loading || !input.trim()}
//           className="btn-primary flex items-center gap-2 text-sm"
//         >
//           {loading ? (
//             <>
//               <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
//                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//               </svg>
//               Launching agents...
//             </>
//           ) : (
//             <>
//               <span>Activate</span>
//               <span>→</span>
//             </>
//           )}
//         </button>
//       </div>
//     </div>
//   );
// }



// // -------------------------new  file---------------------------------------------------
// import { useState } from 'react';
// import { initiateTask } from '../api/index.js';

// const PLACEHOLDERS = [
//   "Submit ML assignment — it's complex and I haven't started...",
//   'Prepare investor pitch deck by tomorrow noon...',
//   'Fix production bug before client demo at 3 PM...',
//   'Write research paper intro section...',
// ];

// // Returns the datetime-local string for "N hours from now"
// function hoursFromNow(h) {
//   const d = new Date(Date.now() + h * 3_600_000);
//   // Round down to nearest 30 min for cleanliness
//   d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
//   return d.toISOString().slice(0, 16);
// }

// // Minimum value for the datetime picker = 15 min from now
// function minDateTime() {
//   return new Date(Date.now() + 15 * 60_000).toISOString().slice(0, 16);
// }

// // Human-readable time remaining label
// function timeLabel(isoString) {
//   if (!isoString) return '';
//   const diff = new Date(isoString) - Date.now();
//   if (diff <= 0) return '⚠️ Already passed';
//   const h = Math.floor(diff / 3_600_000);
//   const m = Math.floor((diff % 3_600_000) / 60_000);
//   if (h === 0) return `${m}m from now`;
//   if (h < 24) return `${h}h ${m}m from now`;
//   const days = Math.floor(h / 24);
//   const rem = h % 24;
//   return rem > 0 ? `${days}d ${rem}h from now` : `${days} day${days > 1 ? 's' : ''} from now`;
// }

// // Quick-pick deadline presets
// const PRESETS = [
//   { label: '2h', hours: 2 },
//   { label: '6h', hours: 6 },
//   { label: 'Tomorrow', hours: 24 },
//   { label: '3 days', hours: 72 },
//   { label: '1 week', hours: 168 },
// ];

// export default function TaskInput({ onProcessStart }) {
//   const [input, setInput] = useState('');
//   const [deadline, setDeadline] = useState('');   // ISO datetime-local string
//   const [showPicker, setShowPicker] = useState(false);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [placeholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]);

//   const handleSubmit = async () => {
//     const trimmed = input.trim();
//     if (!trimmed || loading) return;
//     if (trimmed.length < 8) {
//       setError('Please describe your task in a bit more detail.');
//       return;
//     }
//     if (deadline && new Date(deadline) <= new Date()) {
//       setError('Deadline must be in the future.');
//       return;
//     }

//     setError('');
//     setLoading(true);
//     try {
//       const { processId } = await initiateTask(
//         trimmed,
//         deadline ? new Date(deadline).toISOString() : null
//       );
//       onProcessStart?.(processId);
//       setInput('');
//       setDeadline('');
//       setShowPicker(false);
//     } catch (err) {
//       setError(err.message || 'Failed to start. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleKeyDown = (e) => {
//     if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
//   };

//   const applyPreset = (hours) => {
//     setDeadline(hoursFromNow(hours));
//   };

//   const clearDeadline = () => {
//     setDeadline('');
//     setShowPicker(false);
//   };

//   const deadlinePassed = deadline && new Date(deadline) <= new Date();

//   return (
//     <div className="card p-5 space-y-4">
//       {/* Header */}
//       <div className="flex items-center gap-2">
//         <span className="text-lg">⚡</span>
//         <h2 className="font-semibold text-white">Add a Task</h2>
//         <span className="text-xs text-white/25 ml-auto font-mono">⌘↵ submit</span>
//       </div>

//       {/* Task description */}
//       <textarea
//         value={input}
//         onChange={(e) => setInput(e.target.value)}
//         onKeyDown={handleKeyDown}
//         placeholder={placeholder}
//         rows={3}
//         disabled={loading}
//         className="input-field input-glow resize-none font-sans text-sm leading-relaxed disabled:opacity-50"
//       />

//       {/* Deadline section */}
//       <div className="space-y-2">
//         {/* Deadline toggle row */}
//         <div className="flex items-center gap-2 flex-wrap">
//           <button
//             onClick={() => setShowPicker((v) => !v)}
//             className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${deadline
//               ? deadlinePassed
//                 ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
//                 : 'border-brand-500/40 bg-brand-500/10 text-brand-400'
//               : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/50'
//               }`}
//           >
//             <span>📅</span>
//             {deadline ? (
//               <span className="font-medium">
//                 {new Date(deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
//               </span>
//             ) : (
//               <span>Set deadline</span>
//             )}
//           </button>

//           {/* Time remaining label */}
//           {deadline && (
//             <>
//               <span className={`text-xs ${deadlinePassed ? 'text-rose-400' : 'text-white/30'}`}>
//                 {timeLabel(deadline)}
//               </span>
//               <button
//                 onClick={clearDeadline}
//                 className="text-xs text-white/20 hover:text-white/50 ml-auto"
//               >
//                 ✕ clear
//               </button>
//             </>
//           )}

//           {!deadline && (
//             <span className="text-xs text-white/20 ml-1">
//               or let AI infer it from your description
//             </span>
//           )}
//         </div>

//         {/* Expanded picker */}
//         {showPicker && (
//           <div className="p-3 rounded-xl border border-white/10 bg-surface-900 space-y-3 animate-fade-in">
//             {/* Quick presets */}
//             <div>
//               <p className="text-[11px] text-white/30 mb-2 font-medium uppercase tracking-wider">Quick pick</p>
//               <div className="flex flex-wrap gap-1.5">
//                 {PRESETS.map((p) => (
//                   <button
//                     key={p.label}
//                     onClick={() => applyPreset(p.hours)}
//                     className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${deadline === hoursFromNow(p.hours)
//                       ? 'border-brand-500/60 bg-brand-500/15 text-brand-400'
//                       : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
//                       }`}
//                   >
//                     {p.label}
//                   </button>
//                 ))}
//               </div>
//             </div>

//             {/* Custom date-time picker */}
//             <div>
//               <p className="text-[11px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">Exact date & time</p>
//               <input
//                 type="datetime-local"
//                 value={deadline}
//                 min={minDateTime()}
//                 onChange={(e) => setDeadline(e.target.value)}
//                 className="input-field text-sm text-white/80 [color-scheme:dark]"
//               />
//             </div>

//             {deadlinePassed && (
//               <p className="text-xs text-rose-400">⚠️ This time has already passed.</p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Error */}
//       {error && <p className="text-xs text-rose-400">{error}</p>}

//       {/* Footer */}
//       <div className="flex items-center justify-between">
//         <p className="text-xs text-white/20">
//           AI agents parse → prioritize → plan → schedule automatically.
//         </p>
//         <button
//           onClick={handleSubmit}
//           disabled={loading || !input.trim() || deadlinePassed}
//           className="btn-primary flex items-center gap-2 text-sm"
//         >
//           {loading ? (
//             <>
//               <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
//                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//               </svg>
//               Launching agents...
//             </>
//           ) : (
//             <><span>Activate</span><span>→</span></>
//           )}
//         </button>
//       </div>
//     </div>
//   );
// }



// // -----------------------------------------------new file to resolve the issue of custom deadline-----------------------------------------------
// import { useState } from 'react';
// import { initiateTask } from '../api/index.js';

// const PLACEHOLDERS = [
//   "Submit ML assignment — it's complex and I haven't started...",
//   'Prepare investor pitch deck by tomorrow noon...',
//   'Fix production bug before client demo at 3 PM...',
//   'Write research paper intro section...',
// ];

// // ── Timezone-safe local datetime string for <input type="datetime-local"> ────
// // datetime-local expects: "YYYY-MM-DDTHH:MM" in LOCAL time, NOT UTC.
// function toLocalDatetimeString(date) {
//   const pad = (n) => String(n).padStart(2, '0');
//   return (
//     `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
//     `T${pad(date.getHours())}:${pad(date.getMinutes())}`
//   );
// }

// // N hours from now, snapped to nearest 30 min, in LOCAL time
// function hoursFromNow(h) {
//   const d = new Date(Date.now() + h * 3_600_000);
//   // Snap: if minutes < 30 → :00, else → :30
//   d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
//   return toLocalDatetimeString(d);
// }

// // Minimum selectable value = 15 min from now (local time)
// function minDateTime() {
//   return toLocalDatetimeString(new Date(Date.now() + 15 * 60_000));
// }

// // Human-readable countdown label
// function timeLabel(localString) {
//   if (!localString) return '';
//   // Parse datetime-local string as LOCAL time
//   const diff = new Date(localString) - Date.now();
//   if (diff <= 0) return '⚠️ Already passed';
//   const h = Math.floor(diff / 3_600_000);
//   const m = Math.floor((diff % 3_600_000) / 60_000);
//   if (h === 0) return `${m}m from now`;
//   if (h < 24) return `${h}h ${m}m from now`;
//   const days = Math.floor(h / 24);
//   const rem = h % 24;
//   return rem > 0 ? `${days}d ${rem}h from now` : `${days} day${days > 1 ? 's' : ''} from now`;
// }

// // Convert datetime-local string to a proper ISO string preserving local intent
// // "2025-07-03T14:30" → interpreted as local time → converted to UTC ISO
// function localStringToISO(localString) {
//   if (!localString) return null;
//   // new Date('2025-07-03T14:30') is treated as LOCAL time in browsers
//   return new Date(localString).toISOString();
// }

// // Format for the toggle button display
// function formatDeadlineDisplay(localString) {
//   if (!localString) return '';
//   const d = new Date(localString); // interpreted as local time
//   return d.toLocaleDateString('en-US', {
//     month: 'short', day: 'numeric',
//     hour: '2-digit', minute: '2-digit',
//     hour12: true,
//   });
// }

// const PRESETS = [
//   { label: '2h', hours: 2 },
//   { label: '6h', hours: 6 },
//   { label: 'Tomorrow', hours: 24 },
//   { label: '3 days', hours: 72 },
//   { label: '1 week', hours: 168 },
// ];

// export default function TaskInput({ onProcessStart }) {
//   const [input, setInput] = useState('');
//   const [deadline, setDeadline] = useState(''); // datetime-local string in LOCAL time
//   const [showPicker, setShowPicker] = useState(false);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [placeholder] = useState(
//     () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]
//   );

//   const deadlinePassed = deadline && new Date(deadline) <= new Date();

//   const handleSubmit = async () => {
//     const trimmed = input.trim();
//     if (!trimmed || loading) return;
//     if (trimmed.length < 8) { setError('Please describe your task in a bit more detail.'); return; }
//     if (deadlinePassed) { setError('Deadline must be in the future.'); return; }

//     setError('');
//     setLoading(true);
//     try {
//       // Convert local datetime string to UTC ISO string before sending
//       const isoDeadline = deadline ? localStringToISO(deadline) : null;

//       // Sanity check: log what we're sending
//       if (isoDeadline) {
//         console.log('[TaskInput] Sending deadline:', {
//           localString: deadline,
//           isoUTC: isoDeadline,
//           humanReadable: new Date(isoDeadline).toLocaleString(),
//         });
//       }

//       const { processId } = await initiateTask(trimmed, isoDeadline);
//       onProcessStart?.(processId);
//       setInput('');
//       setDeadline('');
//       setShowPicker(false);
//     } catch (err) {
//       setError(err.message || 'Failed to start. Please try again.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleKeyDown = (e) => {
//     if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
//   };

//   return (
//     <div className="card p-5 space-y-4">
//       {/* Header */}
//       <div className="flex items-center gap-2">
//         <span className="text-lg">⚡</span>
//         <h2 className="font-semibold text-white">Add a Task</h2>
//         <span className="text-xs text-white/25 ml-auto font-mono">⌘↵ submit</span>
//       </div>

//       {/* Task description */}
//       <textarea
//         value={input}
//         onChange={(e) => setInput(e.target.value)}
//         onKeyDown={handleKeyDown}
//         placeholder={placeholder}
//         rows={3}
//         disabled={loading}
//         className="input-field input-glow resize-none font-sans text-sm leading-relaxed disabled:opacity-50"
//       />

//       {/* Deadline row */}
//       <div className="space-y-2">
//         <div className="flex items-center gap-2 flex-wrap">
//           <button
//             onClick={() => setShowPicker((v) => !v)}
//             className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${deadline
//               ? deadlinePassed
//                 ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
//                 : 'border-brand-500/40 bg-brand-500/10 text-brand-400'
//               : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/50'
//               }`}
//           >
//             <span>📅</span>
//             {deadline
//               ? <span className="font-medium">{formatDeadlineDisplay(deadline)}</span>
//               : <span>Set deadline</span>
//             }
//           </button>

//           {deadline && (
//             <>
//               <span className={`text-xs ${deadlinePassed ? 'text-rose-400' : 'text-white/30'}`}>
//                 {timeLabel(deadline)}
//               </span>
//               <button
//                 onClick={() => { setDeadline(''); setShowPicker(false); }}
//                 className="text-xs text-white/20 hover:text-white/50 ml-auto"
//               >
//                 ✕ clear
//               </button>
//             </>
//           )}

//           {!deadline && (
//             <span className="text-xs text-white/20 ml-1">
//               or let AI infer from your description
//             </span>
//           )}
//         </div>

//         {/* Expanded picker */}
//         {showPicker && (
//           <div className="p-3 rounded-xl border border-white/10 bg-surface-900 space-y-3 animate-fade-in">
//             {/* Quick presets */}
//             <div>
//               <p className="text-[11px] text-white/30 mb-2 font-medium uppercase tracking-wider">
//                 Quick pick
//               </p>
//               <div className="flex flex-wrap gap-1.5">
//                 {PRESETS.map((p) => {
//                   const presetVal = hoursFromNow(p.hours);
//                   return (
//                     <button
//                       key={p.label}
//                       onClick={() => setDeadline(presetVal)}
//                       className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${deadline === presetVal
//                         ? 'border-brand-500/60 bg-brand-500/15 text-brand-400'
//                         : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
//                         }`}
//                     >
//                       {p.label}
//                     </button>
//                   );
//                 })}
//               </div>
//             </div>

//             {/* Exact date-time */}
//             <div>
//               <p className="text-[11px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">
//                 Exact date & time
//               </p>
//               <input
//                 type="datetime-local"
//                 value={deadline}
//                 min={minDateTime()}
//                 onChange={(e) => setDeadline(e.target.value)}
//                 className="input-field text-sm text-white/80 [color-scheme:dark]"
//               />
//               {/* Confirm what was selected */}
//               {deadline && !deadlinePassed && (
//                 <p className="text-[11px] text-emerald-400/70 mt-1.5">
//                   ✓ Deadline set: {new Date(deadline).toLocaleString()} — {timeLabel(deadline)}
//                 </p>
//               )}
//             </div>

//             {deadlinePassed && (
//               <p className="text-xs text-rose-400">⚠️ This time has already passed.</p>
//             )}
//           </div>
//         )}
//       </div>

//       {error && <p className="text-xs text-rose-400">{error}</p>}

//       {/* Footer */}
//       <div className="flex items-center justify-between">
//         <p className="text-xs text-white/20">
//           AI agents parse → prioritize → plan → schedule automatically.
//         </p>
//         <button
//           onClick={handleSubmit}
//           disabled={loading || !input.trim() || deadlinePassed}
//           className="btn-primary flex items-center gap-2 text-sm"
//         >
//           {loading ? (
//             <>
//               <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
//                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//               </svg>
//               Launching agents...
//             </>
//           ) : (
//             <><span>Activate</span><span>→</span></>
//           )}
//         </button>
//       </div>
//     </div>
//   );
// }


// ------------------------------new file-------------------------------------------------------------
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { initiateTask } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';

const PLACEHOLDERS = [
  "Submit ML assignment — it's complex and I haven't started...",
  'Prepare investor pitch deck by tomorrow noon...',
  'Fix production bug before client demo at 3 PM...',
  'Write research paper intro section...',
];

// ── Timezone-safe local datetime string for <input type="datetime-local"> ────
// datetime-local expects: "YYYY-MM-DDTHH:MM" in LOCAL time, NOT UTC.
function toLocalDatetimeString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// N hours from now, snapped to nearest 30 min, in LOCAL time
function hoursFromNow(h) {
  const d = new Date(Date.now() + h * 3_600_000);
  // Snap: if minutes < 30 → :00, else → :30
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
  return toLocalDatetimeString(d);
}

// Minimum selectable value = 15 min from now (local time)
function minDateTime() {
  return toLocalDatetimeString(new Date(Date.now() + 15 * 60_000));
}

// Human-readable countdown label
function timeLabel(localString) {
  if (!localString) return '';
  // Parse datetime-local string as LOCAL time
  const diff = new Date(localString) - Date.now();
  if (diff <= 0) return '⚠️ Already passed';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h === 0) return `${m}m from now`;
  if (h < 24) return `${h}h ${m}m from now`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  return rem > 0 ? `${days}d ${rem}h from now` : `${days} day${days > 1 ? 's' : ''} from now`;
}

// Convert datetime-local string to a proper ISO string preserving local intent
// "2025-07-03T14:30" → interpreted as local time → converted to UTC ISO
function localStringToISO(localString) {
  if (!localString) return null;
  // new Date('2025-07-03T14:30') is treated as LOCAL time in browsers
  return new Date(localString).toISOString();
}

// Format for the toggle button display
function formatDeadlineDisplay(localString) {
  if (!localString) return '';
  const d = new Date(localString); // interpreted as local time
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  });
}

const PRESETS = [
  { label: '2h', hours: 2 },
  { label: '6h', hours: 6 },
  { label: 'Tomorrow', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
];

export default function TaskInput({ onProcessStart }) {
  const { profile } = useAuth();
  const [input, setInput] = useState('');
  const [deadline, setDeadline] = useState(''); // datetime-local string in LOCAL time
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [calendarSync, setCalendarSync] = useState(true); // default: sync if calendar is connected
  const [placeholder] = useState(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]
  );

  const deadlinePassed = deadline && new Date(deadline) <= new Date();

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    if (trimmed.length < 8) { setError('Please describe your task in a bit more detail.'); return; }
    if (deadlinePassed) { setError('Deadline must be in the future.'); return; }

    setError('');
    setLoading(true);
    try {
      // Convert local datetime string to UTC ISO string before sending
      const isoDeadline = deadline ? localStringToISO(deadline) : null;

      // Sanity check: log what we're sending
      if (isoDeadline) {
        console.log('[TaskInput] Sending deadline:', {
          localString: deadline,
          isoUTC: isoDeadline,
          humanReadable: new Date(isoDeadline).toLocaleString(),
        });
      }

      const { processId } = await initiateTask(trimmed, isoDeadline, calendarSync);
      onProcessStart?.(processId);
      setInput('');
      setDeadline('');
      setShowPicker(false);
    } catch (err) {
      setError(err.message || 'Failed to start. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  return (
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-lg">⚡</span>
        <h2 className="font-semibold text-white">Add a Task</h2>
        <span className="text-xs text-white/25 ml-auto font-mono">⌘↵ submit</span>
      </div>

      {/* Task description */}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        disabled={loading}
        className="input-field input-glow resize-none font-sans text-sm leading-relaxed disabled:opacity-50"
      />

      {/* Deadline row */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowPicker((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${deadline
              ? deadlinePassed
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                : 'border-brand-500/40 bg-brand-500/10 text-brand-400'
              : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/50'
              }`}
          >
            <span>📅</span>
            {deadline
              ? <span className="font-medium">{formatDeadlineDisplay(deadline)}</span>
              : <span>Set deadline</span>
            }
          </button>

          {deadline && (
            <>
              <span className={`text-xs ${deadlinePassed ? 'text-rose-400' : 'text-white/30'}`}>
                {timeLabel(deadline)}
              </span>
              <button
                onClick={() => { setDeadline(''); setShowPicker(false); }}
                className="text-xs text-white/20 hover:text-white/50 ml-auto"
              >
                ✕ clear
              </button>
            </>
          )}

          {!deadline && (
            <span className="text-xs text-white/20 ml-1">
              or let AI infer from your description
            </span>
          )}
        </div>

        {/* Expanded picker */}
        {showPicker && (
          <div className="p-3 rounded-xl border border-white/10 bg-surface-900 space-y-3 animate-fade-in">
            {/* Quick presets */}
            <div>
              <p className="text-[11px] text-white/30 mb-2 font-medium uppercase tracking-wider">
                Quick pick
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => {
                  const presetVal = hoursFromNow(p.hours);
                  return (
                    <button
                      key={p.label}
                      onClick={() => setDeadline(presetVal)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${deadline === presetVal
                        ? 'border-brand-500/60 bg-brand-500/15 text-brand-400'
                        : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
                        }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Exact date-time */}
            <div>
              <p className="text-[11px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">
                Exact date & time
              </p>
              <input
                type="datetime-local"
                value={deadline}
                min={minDateTime()}
                onChange={(e) => setDeadline(e.target.value)}
                className="input-field text-sm text-white/80 [color-scheme:dark]"
              />
              {/* Confirm what was selected */}
              {deadline && !deadlinePassed && (
                <p className="text-[11px] text-emerald-400/70 mt-1.5">
                  ✓ Deadline set: {new Date(deadline).toLocaleString()} — {timeLabel(deadline)}
                </p>
              )}
            </div>

            {deadlinePassed && (
              <p className="text-xs text-rose-400">⚠️ This time has already passed.</p>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {/* Calendar sync option — shown only if calendar is connected */}
      {profile?.calendarConnected && (
        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={calendarSync}
            onChange={(e) => setCalendarSync(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-brand-500 cursor-pointer"
          />
          <span className="text-xs text-white/40 hover:text-white/60 transition-colors">
            📅 Sync to Google Calendar
          </span>
        </label>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-white/20 hidden sm:block">
          AI agents parse → prioritize → plan → schedule automatically.
        </p>
        <div className="flex items-center gap-3 ml-auto">
          {/* Manual Todo Mode — bypass the AI pipeline entirely. Useful when
              the API quota is exhausted, offline, or the user already has a
              plan and just wants tracking + scheduling. */}
          <Link
            to="/projects/new/manual"
            className="text-xs text-white/40 hover:text-white/70 transition-colors whitespace-nowrap"
          >
            Add manually →
          </Link>
          <button
            onClick={handleSubmit}
            disabled={loading || !input.trim() || deadlinePassed}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Launching agents...
              </>
            ) : (
              <><span>Activate</span><span>→</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}