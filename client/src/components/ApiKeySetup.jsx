// import { useState } from 'react';
// import { saveApiKey, deleteApiKey } from '../api/index.js';

// export default function ApiKeySetup({ hasKey, onKeyUpdated }) {
//     const [showForm, setShowForm] = useState(false);
//     const [apiKey, setApiKey] = useState('');
//     const [loading, setLoading] = useState(false);
//     const [error, setError] = useState('');
//     const [success, setSuccess] = useState(false);

//     const handleSave = async () => {
//         if (!apiKey.trim() || loading) return;
//         setLoading(true);
//         setError('');
//         setSuccess(false);
//         try {
//             await saveApiKey(apiKey.trim());
//             setSuccess(true);
//             setApiKey('');
//             setShowForm(false);
//             onKeyUpdated?.(true);
//         } catch (err) {
//             setError(err.message || 'Invalid key — please check and try again.');
//         } finally {
//             setLoading(false);
//         }
//     };

//     const handleRemove = async () => {
//         if (!window.confirm('Remove your Gemini API key?')) return;
//         await deleteApiKey();
//         onKeyUpdated?.(false);
//     };

//     // ── Already has a key ────────────────────────────────────────────────────
//     if (hasKey) {
//         return (
//             <div className="card p-4 border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-between gap-4">
//                 <div className="flex items-center gap-3">
//                     <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-lg">🔑</div>
//                     <div>
//                         <p className="text-sm font-medium text-white">Gemini API Key</p>
//                         <p className="text-xs text-emerald-400">✓ Connected — using your personal quota</p>
//                     </div>
//                 </div>
//                 <div className="flex gap-2">
//                     <button onClick={() => { setShowForm(true); }} className="btn-ghost text-xs py-1 px-3">
//                         Update
//                     </button>
//                     <button onClick={handleRemove} className="btn-ghost text-xs py-1 px-3 text-rose-400/60 hover:text-rose-400">
//                         Remove
//                     </button>
//                 </div>

//                 {/* Inline update form */}
//                 {showForm && (
//                     <div className="absolute mt-2 p-4 card border border-white/10 z-10 w-full left-0 top-full">
//                         <input
//                             type="password"
//                             value={apiKey}
//                             onChange={(e) => setApiKey(e.target.value)}
//                             placeholder="AIza... paste new Gemini API key"
//                             className="input-field text-sm mb-3"
//                         />
//                         {error && <p className="text-xs text-rose-400 mb-3">{error}</p>}
//                         <div className="flex gap-2">
//                             <button onClick={handleSave} disabled={loading || !apiKey.trim()} className="btn-primary text-sm">
//                                 {loading ? 'Validating...' : 'Save'}
//                             </button>
//                             <button onClick={() => setShowForm(false)} className="btn-ghost text-sm">Cancel</button>
//                         </div>
//                     </div>
//                 )}
//             </div>
//         );
//     }

//     // ── No key yet ───────────────────────────────────────────────────────────
//     return (
//         <div className="card border border-amber-500/30 bg-amber-500/5 overflow-hidden">
//             <div className="p-4">
//                 <div className="flex items-start gap-3">
//                     <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-lg flex-shrink-0">
//                         🔑
//                     </div>
//                     <div className="flex-1">
//                         <p className="text-sm font-semibold text-white">Add your Gemini API Key</p>
//                         <p className="text-xs text-white/50 mt-0.5">
//                             Required to run AI agents. Your key is stored securely and only used for your tasks.
//                         </p>
//                         <a
//                             href="https://aistudio.google.com/apikey"
//                             target="_blank"
//                             rel="noreferrer"
//                             className="text-xs text-amber-400 underline underline-offset-2 mt-1 inline-block"
//                         >
//                             Get a free key from Google AI Studio →
//                         </a>
//                     </div>
//                     <button
//                         onClick={() => setShowForm((v) => !v)}
//                         className="btn-primary text-sm flex-shrink-0"
//                     >
//                         {showForm ? 'Cancel' : 'Add Key'}
//                     </button>
//                 </div>

//                 {showForm && (
//                     <div className="mt-4 space-y-3">
//                         <div className="relative">
//                             <input
//                                 type="password"
//                                 value={apiKey}
//                                 onChange={(e) => setApiKey(e.target.value)}
//                                 onKeyDown={(e) => e.key === 'Enter' && handleSave()}
//                                 placeholder="AIzaSy... paste your Gemini API key here"
//                                 className="input-field text-sm pr-24"
//                                 autoFocus
//                             />
//                             <button
//                                 onClick={handleSave}
//                                 disabled={loading || !apiKey.trim()}
//                                 className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs py-1.5 px-3"
//                             >
//                                 {loading ? (
//                                     <span className="flex items-center gap-1.5">
//                                         <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
//                                             <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                                             <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//                                         </svg>
//                                         Checking...
//                                     </span>
//                                 ) : 'Save'}
//                             </button>
//                         </div>

//                         {error && (
//                             <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
//                                 <span className="text-rose-400 text-xs flex-1">{error}</span>
//                             </div>
//                         )}

//                         <p className="text-[11px] text-white/25">
//                             🔒 Stored encrypted in your private Firestore account. Never shared.
//                         </p>
//                     </div>
//                 )}

//                 {success && (
//                     <div className="mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
//                         ✅ API key validated and saved. You can now add tasks!
//                     </div>
//                 )}
//             </div>
//         </div>
//     );
// }


// // -----------------------------------------NEW FILE---------------------------------------------------------------
// /**
//  * ApiKeySetup — lets users add either a Gemini or Groq API key.
//  * Validates the key live against the backend before saving.
// */
// import { useState } from 'react';
// import { saveApiKey, deleteApiKey } from '../api/index.js';

// const PROVIDERS = [
//     {
//         id: 'gemini',
//         name: 'Google Gemini',
//         icon: '✦',
//         iconBg: 'bg-blue-500/10',
//         iconColor: 'text-blue-400',
//         placeholder: 'AIzaSy...',
//         hint: 'Free at aistudio.google.com/apikey',
//         link: 'https://aistudio.google.com/apikey',
//         linkLabel: 'Get free Gemini key →',
//         badge: 'Gemini 2.5 Flash + RAG',
//         badgeColor: 'text-blue-400',
//     },
//     {
//         id: 'groq',
//         name: 'Groq',
//         icon: '⚡',
//         iconBg: 'bg-violet-500/10',
//         iconColor: 'text-violet-400',
//         placeholder: 'gsk_...',
//         hint: 'Free at console.groq.com',
//         link: 'https://console.groq.com/keys',
//         linkLabel: 'Get free Groq key →',
//         badge: 'Llama 3.3 70B · Ultra-fast',
//         badgeColor: 'text-violet-400',
//     },
// ];

// // ── Small provider badge shown in the connected state ─────────────────────
// function ProviderBadge({ keyType }) {
//     const p = PROVIDERS.find((x) => x.id === keyType) || PROVIDERS[0];
//     return (
//         <span className={`text-xs font-medium ${p.badgeColor} flex items-center gap-1`}>
//             {p.icon} {p.name} · {p.badge}
//         </span>
//     );
// }

// // ── Form: input + save button ─────────────────────────────────────────────
// function KeyForm({ selectedType, onSaved, onCancel }) {
//     const [apiKey, setApiKey] = useState('');
//     const [loading, setLoading] = useState(false);
//     const [error, setError] = useState('');

//     const provider = PROVIDERS.find((p) => p.id === selectedType);

//     const handleSave = async () => {
//         if (!apiKey.trim() || loading) return;
//         setLoading(true);
//         setError('');
//         try {
//             await saveApiKey(apiKey.trim(), selectedType);
//             onSaved?.();
//         } catch (err) {
//             setError(err.message || 'Invalid key — please check and try again.');
//         } finally {
//             setLoading(false);
//         }
//     };

//     return (
//         <div className="mt-4 space-y-3">
//             <div className="relative">
//                 <input
//                     type="password"
//                     value={apiKey}
//                     onChange={(e) => setApiKey(e.target.value)}
//                     onKeyDown={(e) => e.key === 'Enter' && handleSave()}
//                     placeholder={provider?.placeholder || 'Paste API key here...'}
//                     className="input-field text-sm pr-28"
//                     autoFocus
//                     />
//                 <button
//                     onClick={handleSave}
//                     disabled={loading || !apiKey.trim()}
//                     className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs py-1.5 px-3"
//                     >
//                     {loading ? (
//                         <span className="flex items-center gap-1.5">
//                             <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
//                                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//                             </svg>
//                             Verifying...
//                         </span>
//                     ) : 'Save & Verify'}
//                 </button>
//             </div>

//             {error && (
//                 <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
//                     {error}
//                 </div>
//             )}

//             <div className="flex items-center justify-between">
//                 <p className="text-[11px] text-white/25">
//                     🔒 Verified then stored in your private account. Never shared or logged.
//                 </p>
//                 {onCancel && (
//                     <button onClick={onCancel} className="text-xs text-white/30 hover:text-white/60">
//                         Cancel
//                     </button>
//                 )}
//             </div>
//         </div>
//     );
// }

// // ── Main component ────────────────────────────────────────────────────────
// export default function ApiKeySetup({ hasKey, keyType: savedKeyType, onKeyUpdated }) {
//     const [showForm, setShowForm] = useState(false);
//     const [selectedType, setSelectedType] = useState('gemini');

//     const handleSaved = () => {
//         setShowForm(false);
//         onKeyUpdated?.(true, selectedType);
//     };

//     const handleRemove = async () => {
//         if (!window.confirm('Remove your API key? You\'ll need to add one again to use LifeSaver.')) return;
//         await deleteApiKey();
//         onKeyUpdated?.(false, null);
//     };

//     // ── Connected state ───────────────────────────────────────────────────
//     if (hasKey && !showForm) {
//         return (
//             <div className="card p-4 border border-emerald-500/20 bg-emerald-500/5">
//                 <div className="flex items-center justify-between gap-4 flex-wrap">
//                     <div className="flex items-center gap-3">
//                         <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
//                             <span className="text-base">🔑</span>
//                         </div>
//                         <div>
//                             <p className="text-sm font-medium text-white">API Key Connected</p>
//                             <ProviderBadge keyType={savedKeyType} />
//                         </div>
//                     </div>
//                     <div className="flex gap-2">
//                         <button
//                             onClick={() => { setSelectedType(savedKeyType || 'gemini'); setShowForm(true); }}
//                             className="btn-ghost text-xs py-1 px-3"
//                             >
//                             Change
//                         </button>
//                         <button
//                             onClick={handleRemove}
//                             className="btn-ghost text-xs py-1 px-3 text-rose-400/60 hover:text-rose-400"
//                             >
//                             Remove
//                         </button>
//                     </div>
//                 </div>
//             </div>
//         );
//     }

//     // ── Setup state ───────────────────────────────────────────────────────
//     return (
//         <div className="card border border-amber-500/30 bg-amber-500/5 overflow-hidden">
//             <div className="p-4">

//                 {/* Header */}
//                 <div className="flex items-start gap-3 mb-4">
//                     <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-lg flex-shrink-0">
//                         🔑
//                     </div>
//                     <div>
//                         <p className="text-sm font-semibold text-white">
//                             {hasKey ? 'Change your API key' : 'Add an API key to get started'}
//                         </p>
//                         <p className="text-xs text-white/40 mt-0.5">
//                             Your key powers all 5 AI agents. Choose either provider — both are free.
//                         </p>
//                     </div>
//                     {hasKey && (
//                         <button onClick={() => setShowForm(false)} className="ml-auto text-xs text-white/30 hover:text-white/60">
//                             Cancel
//                         </button>
//                     )}
//                 </div>

//                 {/* Provider selector */}
//                 <div className="grid grid-cols-2 gap-2 mb-1">
//                     {PROVIDERS.map((p) => (
//                         <button
//                         key={p.id}
//                         onClick={() => setSelectedType(p.id)}
//                         className={`flex flex-col items-start p-3 rounded-xl border transition-all text-left ${selectedType === p.id
//                             ? 'border-brand-500/60 bg-brand-500/10'
//                             : 'border-white/10 bg-white/2 hover:border-white/20'
//                         }`}
//                         >
//                             <div className="flex items-center gap-2 mb-2">
//                                 <div className={`w-7 h-7 rounded-lg ${p.iconBg} flex items-center justify-center`}>
//                                     <span className={`text-sm ${p.iconColor}`}>{p.icon}</span>
//                                 </div>
//                                 <span className="text-sm font-semibold text-white">{p.name}</span>
//                                 {selectedType === p.id && (
//                                     <span className="ml-auto text-brand-400 text-xs">✓</span>
//                                 )}
//                             </div>
//                             <span className={`text-[11px] font-medium ${p.badgeColor}`}>{p.badge}</span>
//                             <a
//                                 href={p.link}
//                                 target="_blank"
//                                 rel="noreferrer"
//                                 onClick={(e) => e.stopPropagation()}
//                                 className="text-[11px] text-white/30 hover:text-white/60 underline underline-offset-2 mt-1"
//                                 >
//                                 {p.linkLabel}
//                             </a>
//                         </button>
//                     ))}
//                 </div>

//                 {/* Key input form */}
//                 <KeyForm
//                     selectedType={selectedType}
//                     onSaved={handleSaved}
//                     onCancel={hasKey ? () => setShowForm(false) : null}
//                     />
//             </div>
//         </div>
//     );
// }



// // -----------------------------------------NEW FILE , to use the google as default service use this one  --------------------------------------------------------------
// /**
//  * ApiKeySetup
//  * ─────────────────────────────────────────────────────────────────────────────
//  * Three states:
//  *   1. DEFAULT  — no personal key, using shared server quota (green, subtle)
//  *   2. PERSONAL — user's own Gemini/Groq key connected (emerald)
//  *   3. QUOTA    — shared quota exhausted, must add own key (red, prominent)
//  */
// import { useState } from 'react';
// import { saveApiKey, deleteApiKey } from '../api/index.js';

// const PROVIDERS = [
//     {
//         id: 'gemini',
//         name: 'Google Gemini',
//         icon: '✦',
//         color: 'text-blue-400',
//         bg: 'bg-blue-500/10',
//         border: 'border-blue-500/30',
//         placeholder: 'AIzaSy...',
//         badge: 'Gemini 2.5 Flash · RAG support',
//         link: 'https://aistudio.google.com/apikey',
//         linkLabel: 'Get free Gemini key →',
//     },
//     {
//         id: 'groq',
//         name: 'Groq',
//         icon: '⚡',
//         color: 'text-violet-400',
//         bg: 'bg-violet-500/10',
//         border: 'border-violet-500/30',
//         placeholder: 'gsk_...',
//         badge: 'Llama 3.3 70B · Ultra-fast',
//         link: 'https://console.groq.com/keys',
//         linkLabel: 'Get free Groq key →',
//     },
// ];

// // ── Small inline form ─────────────────────────────────────────────────────
// function KeyForm({ selectedType, setSelectedType, onSaved, onCancel, compact = false }) {
//     const [apiKey, setApiKey] = useState('');
//     const [loading, setLoading] = useState(false);
//     const [error, setError] = useState('');

//     const provider = PROVIDERS.find((p) => p.id === selectedType) || PROVIDERS[0];

//     const handleSave = async () => {
//         if (!apiKey.trim() || loading) return;
//         setLoading(true);
//         setError('');
//         try {
//             await saveApiKey(apiKey.trim(), selectedType);
//             onSaved?.();
//         } catch (err) {
//             setError(err.message || 'Invalid key — please check and try again.');
//         } finally {
//             setLoading(false);
//         }
//     };

//     return (
//         <div className={`space-y-3 ${compact ? '' : 'mt-4'}`}>
//             {/* Provider toggle */}
//             <div className="flex gap-2">
//                 {PROVIDERS.map((p) => (
//                     <button
//                         key={p.id}
//                         onClick={() => setSelectedType(p.id)}
//                         className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${selectedType === p.id
//                             ? `${p.border} ${p.bg} ${p.color}`
//                             : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
//                             }`}
//                     >
//                         <span>{p.icon}</span>
//                         <span>{p.name}</span>
//                     </button>
//                 ))}
//             </div>

//             {/* Key input */}
//             <div className="relative">
//                 <input
//                     type="password"
//                     value={apiKey}
//                     onChange={(e) => setApiKey(e.target.value)}
//                     onKeyDown={(e) => e.key === 'Enter' && handleSave()}
//                     placeholder={provider.placeholder}
//                     className="input-field text-sm pr-32"
//                     autoFocus
//                 />
//                 <button
//                     onClick={handleSave}
//                     disabled={loading || !apiKey.trim()}
//                     className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs py-1.5 px-3"
//                 >
//                     {loading ? (
//                         <span className="flex items-center gap-1.5">
//                             <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
//                                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
//                                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
//                             </svg>
//                             Verifying...
//                         </span>
//                     ) : 'Save & Verify'}
//                 </button>
//             </div>

//             {error && (
//                 <p className="text-xs text-rose-400 px-1">{error}</p>
//             )}

//             <div className="flex items-center justify-between">
//                 <a
//                     href={provider.link}
//                     target="_blank"
//                     rel="noreferrer"
//                     className="text-xs text-white/30 hover:text-white/60 underline underline-offset-2"
//                 >
//                     {provider.linkLabel}
//                 </a>
//                 <div className="flex items-center gap-3">
//                     <p className="text-[11px] text-white/20">🔒 Stored privately. Never shared.</p>
//                     {onCancel && (
//                         <button onClick={onCancel} className="text-xs text-white/30 hover:text-white/60">
//                             Cancel
//                         </button>
//                     )}
//                 </div>
//             </div>
//         </div>
//     );
// }

// // ── Main component ────────────────────────────────────────────────────────────
// export default function ApiKeySetup({ hasKey, keyType: savedKeyType, quotaExceeded, onKeyUpdated }) {
//     const [showForm, setShowForm] = useState(false);
//     const [selectedType, setSelectedType] = useState('gemini');

//     const handleSaved = () => { setShowForm(false); onKeyUpdated?.(true, selectedType); };
//     const handleRemove = async () => {
//         if (!window.confirm('Remove your personal API key? The shared quota will be used instead.')) return;
//         await deleteApiKey();
//         onKeyUpdated?.(false, null);
//     };

//     // ── State 1: Personal key connected ──────────────────────────────────────
//     if (hasKey && !showForm) {
//         const p = PROVIDERS.find((x) => x.id === savedKeyType) || PROVIDERS[0];
//         return (
//             <div className="card p-3 border border-emerald-500/20 bg-emerald-500/5">
//                 <div className="flex items-center justify-between gap-3">
//                     <div className="flex items-center gap-2.5">
//                         <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">🔑</div>
//                         <div>
//                             <p className="text-xs font-medium text-white">Your {p.name} key active</p>
//                             <p className="text-[11px] text-emerald-400">{p.badge} · Private quota</p>
//                         </div>
//                     </div>
//                     <div className="flex gap-1.5">
//                         <button
//                             onClick={() => { setSelectedType(savedKeyType || 'gemini'); setShowForm(true); }}
//                             className="btn-ghost text-xs py-1 px-2"
//                         >
//                             Change
//                         </button>
//                         <button onClick={handleRemove} className="btn-ghost text-xs py-1 px-2 text-white/20 hover:text-rose-400">
//                             ✕
//                         </button>
//                     </div>
//                 </div>
//             </div>
//         );
//     }

//     // ── State 2: Quota exceeded — must add own key ────────────────────────────
//     if (quotaExceeded && !hasKey && !showForm) {
//         return (
//             <div className="card border border-rose-500/40 bg-rose-500/5 overflow-hidden">
//                 <div className="p-4">
//                     <div className="flex items-start gap-3 mb-1">
//                         <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center text-xl flex-shrink-0">⚠️</div>
//                         <div>
//                             <p className="text-sm font-bold text-rose-400">Shared quota reached</p>
//                             <p className="text-xs text-white/50 mt-0.5">
//                                 The free shared limit is used up for now. Add your own free API key to keep going — takes 30 seconds.
//                             </p>
//                         </div>
//                         <button
//                             onClick={() => setShowForm(true)}
//                             className="btn-primary text-sm flex-shrink-0 ml-auto"
//                         >
//                             Add Key
//                         </button>
//                     </div>
//                     <KeyForm
//                         selectedType={selectedType}
//                         setSelectedType={setSelectedType}
//                         onSaved={handleSaved}
//                     />
//                 </div>
//             </div>
//         );
//     }

//     // ── State 3: No personal key — using shared quota (default) ──────────────
//     if (!hasKey && !showForm) {
//         return (
//             <div className="card p-3 border border-white/5 bg-white/2">
//                 <div className="flex items-center justify-between gap-3">
//                     <div className="flex items-center gap-2.5">
//                         <div className="w-7 h-7 rounded-lg bg-brand-500/10 flex items-center justify-center text-sm">✦</div>
//                         <div>
//                             <p className="text-xs font-medium text-white/70">Using shared Gemini quota</p>
//                             <p className="text-[11px] text-white/30">Free · No setup needed</p>
//                         </div>
//                     </div>
//                     <button
//                         onClick={() => setShowForm(true)}
//                         className="text-xs text-white/30 hover:text-brand-400 transition-colors border border-white/10 hover:border-brand-500/40 px-2.5 py-1 rounded-lg"
//                     >
//                         Use own key
//                     </button>
//                 </div>
//             </div>
//         );
//     }

//     // ── State 4: Add / change key form ───────────────────────────────────────
//     return (
//         <div className="card border border-brand-500/20 bg-brand-500/3 overflow-hidden">
//             <div className="p-4">
//                 <div className="flex items-center gap-2 mb-4">
//                     <span className="text-base">🔑</span>
//                     <p className="text-sm font-semibold text-white">
//                         {hasKey ? 'Change your API key' : 'Add your own API key'}
//                     </p>
//                     <p className="text-xs text-white/30 ml-1">— unlimited personal quota</p>
//                     <button
//                         onClick={() => setShowForm(false)}
//                         className="ml-auto text-xs text-white/25 hover:text-white/60"
//                     >
//                         ✕
//                     </button>
//                 </div>

//                 <KeyForm
//                     selectedType={selectedType}
//                     setSelectedType={setSelectedType}
//                     onSaved={handleSaved}
//                     onCancel={() => setShowForm(false)}
//                 />
//             </div>
//         </div>
//     );
// }


// --------------------------------------------------------NEW FILE TO MAKE GROQ AS DEFUALT-------------------------------------------
/**
 * ApiKeySetup
 * ─────────────────────────────────────────────────────────────────────────────
 * Groq is shown first and recommended as the preferred provider.
 * When shared quota is exceeded, the banner specifically recommends Groq.
 *
 * Three states:
 *   1. DEFAULT      — no personal key, using shared server quota
 *   2. PERSONAL     — user's own key connected (Groq or Gemini)
 *   3. QUOTA        — shared quota exhausted → prompt to add own Groq key
 */

import { useState } from 'react';
import { Zap, Sparkles, Lock, Check, X, AlertTriangle } from 'lucide-react';
import { saveApiKey, deleteApiKey } from '../api/index.js';

// ── Provider definitions — Groq FIRST (preferred) ─────────────────────────────
// Model names come from the `models` prop (server's live Llm.js config, see
// routes/settings.js getProviderSummary()) so this never drifts out of sync
// with whatever model the backend is actually configured to call. Falls back
// to a generic label if `models` hasn't loaded yet.
function buildProviders(models) {
    const groqLabel = models?.groq?.modelLabel ?? 'Llama';
    const geminiLabel = models?.gemini?.modelLabel ?? 'Gemini';
    return [
        {
            id: 'groq',
            name: 'Groq',
            icon: Zap,
            recommended: true,
            color: 'text-violet-400',
            bg: 'bg-violet-500/10',
            border: 'border-violet-500/30',
            ringColor: 'ring-violet-500/40',
            placeholder: 'gsk_...',
            badge: `${groqLabel} · Ultra-fast · Recommended`,
            badgeColor: 'text-violet-400',
            link: 'https://console.groq.com/keys',
            linkLabel: 'Get free Groq key (30 sec) →',
            why: 'Faster responses, higher free limits, no credit card needed',
        },
        {
            id: 'gemini',
            name: 'Google Gemini',
            icon: Sparkles,
            recommended: false,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/30',
            ringColor: 'ring-blue-500/40',
            placeholder: 'AIzaSy...',
            badge: `${geminiLabel} · Includes RAG`,
            badgeColor: 'text-blue-400',
            link: 'https://aistudio.google.com/apikey',
            linkLabel: 'Get free Gemini key →',
            why: 'Enables personalization history (RAG). Use if you prefer Google.',
        },
    ];
}

// ── Small inline form ──────────────────────────────────────────────────────────
function KeyForm({ selectedType, setSelectedType, onSaved, onCancel, models, availableModels }) {
    const [apiKey, setApiKey] = useState('');
    const [selectedModel, setSelectedModel] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const providers = buildProviders(models);
    const provider = providers.find((p) => p.id === selectedType) || providers[0];
    const modelOptions = availableModels?.[selectedType] ?? [];

    // Switching provider resets the model choice back to "recommended" —
    // a model id from one provider is meaningless for the other.
    const handleSelectType = (id) => {
        setSelectedType(id);
        setSelectedModel('');
    };

    const handleSave = async () => {
        if (!apiKey.trim() || loading) return;
        setLoading(true);
        setError('');
        try {
            await saveApiKey(apiKey.trim(), selectedType, selectedModel || null);
            onSaved?.(selectedType);
        } catch (err) {
            setError(err.message || 'Invalid key — please check and try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-3 mt-3">
            {/* Provider picker — compact stacked rows, not competing feature cards
                (UPDATED_design.md §9.8) */}
            <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                {providers.map((p) => {
                    const active = selectedType === p.id;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            data-active={active}
                            onClick={() => handleSelectType(p.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${active ? 'bg-brand-500/8' : 'bg-surface hover:bg-surface-hover'
                                }`}
                        >
                            <span className={`flex-shrink-0 w-2 h-2 rounded-full border-2 ${active ? 'bg-brand-500 border-brand-500' : 'border-border-strong'}`} />
                            <p.icon className={`w-4 h-4 flex-shrink-0 ${p.color}`} />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                                    {p.name}
                                    {p.recommended && <span className="text-[10px] font-medium text-muted">Recommended</span>}
                                </p>
                                <p className="text-[11px] text-muted truncate">{p.badge}</p>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Model choice — defaults to the recommended model if left alone */}
            {modelOptions.length > 0 && (
                <div>
                    <label className="text-[11px] text-muted mb-1 block">Model</label>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="input-field text-sm py-2"
                    >
                        <option value="">Recommended default ({provider.badge.split(' · ')[0]})</option>
                        {modelOptions.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Key input */}
            <div className="relative">
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder={provider.placeholder}
                    className="input-field text-sm pr-32"
                    autoFocus
                />
                <button
                    onClick={handleSave}
                    disabled={loading || !apiKey.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary text-xs py-1.5 px-3"
                >
                    {loading ? (
                        <span className="flex items-center gap-1.5">
                            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Verifying...
                        </span>
                    ) : 'Save & Verify'}
                </button>
            </div>

            {error && (
                <p className="text-xs text-danger px-0.5">{error}</p>
            )}

            <div className="flex items-center justify-between">
                <a
                    href={provider.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted hover:text-secondary underline underline-offset-2"
                >
                    {provider.linkLabel}
                </a>
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-[11px] text-muted"><Lock className="w-3 h-3" /> Stored privately</span>
                    {onCancel && (
                        <button onClick={onCancel} className="text-xs text-muted hover:text-secondary">
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ApiKeySetup({ hasKey, keyType: savedKeyType, savedModel, defaultProvider, models, availableModels, quotaExceeded, onKeyUpdated }) {
    const [showForm, setShowForm] = useState(false);
    const [selectedType, setSelectedType] = useState('groq'); // Default to Groq
    const PROVIDERS = buildProviders(models);

    const handleSaved = (type) => { setShowForm(false); onKeyUpdated?.(true, type); };
    const handleRemove = async () => {
        if (!window.confirm('Remove your personal API key? The shared quota will be used instead.')) return;
        await deleteApiKey();
        onKeyUpdated?.(false, null);
    };

    // ── State 1: Personal key connected ────────────────────────────────────────
    if (hasKey && !showForm) {
        const p = PROVIDERS.find((x) => x.id === savedKeyType) || PROVIDERS[0];
        // If the user picked a specific model, show that instead of the tier
        // default baked into p.badge.
        const chosenLabel = savedModel && availableModels?.[savedKeyType]?.find((m) => m.id === savedModel)?.label;
        const modelBadge = chosenLabel ? `${chosenLabel} · Your choice` : p.badge;
        return (
            <div className={`card p-3 border ${p.border} ${p.bg}`}>
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <p.icon className={`w-4 h-4 flex-shrink-0 ${p.color}`} />
                        <div>
                            <p className="text-xs font-medium text-primary">
                                {p.name} key active
                                {p.recommended && <span className="ml-1.5 text-[10px] text-violet-400 inline-flex items-center gap-0.5"><Check className="w-2.5 h-2.5" /> Recommended</span>}
                            </p>
                            <p className={`text-[11px] ${p.badgeColor}`}>{modelBadge} · Private quota</p>
                        </div>
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => { setSelectedType(savedKeyType || 'groq'); setShowForm(true); }}
                            className="btn-ghost text-xs py-1 px-2"
                        >
                            Change
                        </button>
                        <button
                            onClick={handleRemove}
                            className="btn-ghost text-xs py-1 px-2 text-muted hover:text-danger"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── State 2: Quota exceeded — specifically recommend Groq ──────────────────
    if (quotaExceeded && !hasKey && !showForm) {
        return (
            <div className="card border border-danger/40 bg-danger/5 overflow-hidden">
                <div className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0 text-danger" />
                        <div className="flex-1">
                            <p className="text-sm font-bold text-danger">Shared quota reached</p>
                            <p className="text-xs text-secondary mt-0.5">
                                The free shared limit is used up for now.
                            </p>
                        </div>
                    </div>

                    {/* Groq recommendation highlight */}
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-violet-500/10 border border-violet-500/25">
                        <Zap className="w-4 h-4 flex-shrink-0 text-violet-400" />
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-violet-300">
                                We recommend adding a <strong>Groq key</strong>
                            </p>
                            <p className="text-xs text-muted mt-0.5">
                                Free, ultra-fast, takes 30 seconds to set up.
                                No credit card required.
                            </p>
                            <a
                                href="https://console.groq.com/keys"
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-violet-400 underline underline-offset-2 mt-1 inline-block"
                            >
                                Get your free Groq key at console.groq.com →
                            </a>
                        </div>
                    </div>

                    {/* Inline form — defaults to Groq */}
                    <KeyForm
                        selectedType={selectedType}
                        setSelectedType={setSelectedType}
                        onSaved={handleSaved}
                        models={models}
                        availableModels={availableModels}
                    />
                </div>
            </div>
        );
    }

    // ── State 3: No personal key — using shared Groq quota ────────────────────
    if (!hasKey && !showForm) {
        return (
            <div className="card p-3 border border-border bg-surface">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <Zap className="w-4 h-4 text-violet-400" />
                        <div>
                            <p className="text-xs font-medium text-secondary">
                                Using shared {defaultProvider?.keyType === 'gemini' ? 'Gemini' : 'Groq'} quota
                            </p>
                            <p className="text-[11px] text-muted">
                                Free{defaultProvider?.modelLabel ? ` · ${defaultProvider.modelLabel}` : ''} · No setup needed
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => { setSelectedType('groq'); setShowForm(true); }}
                        className="text-xs text-muted hover:text-violet-400 transition-colors border border-border hover:border-violet-500/40 px-2.5 py-1 rounded-lg"
                    >
                        Use own key
                    </button>
                </div>
            </div>
        );
    }

    // ── State 4: Add / change key form ────────────────────────────────────────
    return (
        <div className="card border border-violet-500/20 bg-violet-500/3 overflow-hidden">
            <div className="p-4">
                <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-violet-400" />
                    <p className="text-sm font-semibold text-primary">
                        {hasKey ? 'Change your API key' : 'Add your own API key'}
                    </p>
                    <p className="text-xs text-muted ml-1">— unlimited personal quota</p>
                    <button
                        onClick={() => setShowForm(false)}
                        className="ml-auto text-xs text-muted hover:text-secondary"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
                <p className="flex items-center gap-1 text-xs text-muted mb-1">
                    <Zap className="w-3 h-3 flex-shrink-0" /> Groq is recommended — faster and more generous free tier.
                </p>

                <KeyForm
                    selectedType={selectedType}
                    setSelectedType={setSelectedType}
                    onSaved={handleSaved}
                    models={models}
                    availableModels={availableModels}
                    onCancel={() => setShowForm(false)}
                />
            </div>
        </div>
    );
}