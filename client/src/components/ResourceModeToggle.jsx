import { useState, useEffect, useCallback } from 'react';
import { getPreferences, saveResourcePreference } from '../api/index.js';

/**
 * ResourceModeToggle
 *
 * Lets the user choose whether the Knowledge Acquisition Agent should:
 *   - "urls"      → verify and include clickable resource links (default, slower)
 *   - "info_only" → skip URL verification, resources appear as descriptive text
 *                   only (faster — no HEAD/GET network calls per resource)
 *
 * The chosen value is stored in Firestore under preferences.resourceMode and
 * read by the knowledge_acquisition_agent on every pipeline run.
 */
export default function ResourceModeToggle() {
  const [mode, setMode] = useState('urls');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        setMode(prefs.resourceMode ?? 'urls');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const toggle = useCallback(async (next) => {
    if (saving || next === mode) return;
    setSaving(true);
    const prev = mode;
    setMode(next); // optimistic
    try {
      await saveResourcePreference(next);
    } catch {
      setMode(prev); // rollback
    } finally {
      setSaving(false);
    }
  }, [mode, saving]);

  if (!loaded) return null;

  const isInfoOnly = mode === 'info_only';

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        {/* Label side */}
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 transition-colors duration-300
            ${isInfoOnly ? 'bg-sky-500/10' : 'bg-teal-500/10'}`}>
            {isInfoOnly ? '📄' : '🔗'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">Resource Mode</p>
            <p className="text-xs text-white/40 mt-0.5 leading-snug">
              {isInfoOnly
                ? 'Info only — resources shown as text, no URL verification (faster)'
                : 'With links — resource URLs verified before showing (thorough but slower)'}
            </p>
          </div>
        </div>

        {/* Toggle pill */}
        <div className="flex-shrink-0 flex items-center gap-1 bg-white/5 rounded-full p-0.5 border border-white/10">
          <button
            id="resource-mode-urls"
            onClick={() => toggle('urls')}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200
              ${!isInfoOnly
                ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40 shadow-sm'
                : 'text-white/30 hover:text-white/60 border border-transparent'}`}
          >
            🔗 <span>With Links</span>
          </button>
          <button
            id="resource-mode-info"
            onClick={() => toggle('info_only')}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200
              ${isInfoOnly
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-sm'
                : 'text-white/30 hover:text-white/60 border border-transparent'}`}
          >
            📄 <span>Info Only</span>
          </button>
        </div>
      </div>

      {/* Hint line */}
      {isInfoOnly && (
        <p className="mt-3 text-[11px] text-sky-400/70 leading-relaxed border-t border-white/5 pt-3">
          ⚡ Agents will skip network calls for resources — planning will be significantly faster. Switch back to "With Links" any time.
        </p>
      )}
      {!isInfoOnly && (
        <p className="mt-3 text-[11px] text-white/25 leading-relaxed border-t border-white/5 pt-3">
          Each resource URL is checked live (HEAD + GET) to confirm it resolves before being shown. Use "Info Only" for faster runs.
        </p>
      )}
    </div>
  );
}
