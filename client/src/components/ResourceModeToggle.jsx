import { useState, useEffect, useCallback } from 'react';
import { Link2, FileText, Zap } from 'lucide-react';
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <label className="text-xs font-medium text-muted uppercase tracking-wide">
          How should resources be provided?
        </label>
        <div className="flex items-center gap-1.5 flex-wrap">
        <button
          id="resource-mode-urls"
          type="button"
          onClick={() => toggle('urls')}
          disabled={saving}
          data-active={!isInfoOnly}
          className="segmented-btn flex items-center gap-1.5 disabled:opacity-50"
        >
          <Link2 className="w-3.5 h-3.5" /> With Links
        </button>
        <button
          id="resource-mode-info"
          type="button"
          onClick={() => toggle('info_only')}
          disabled={saving}
          data-active={isInfoOnly}
          className="segmented-btn flex items-center gap-1.5 disabled:opacity-50"
        >
          <FileText className="w-3.5 h-3.5" /> Info Only
        </button>
        </div>
      </div>

      {/* Hint line */}
      {isInfoOnly && (
        <p className="flex items-center gap-1.5 text-[11px] text-sky-500 leading-relaxed">
          <Zap className="w-3 h-3 flex-shrink-0" /> Agents will skip network calls for resources — planning will be significantly faster.
        </p>
      )}
      {!isInfoOnly && (
        <p className="text-[11px] text-muted leading-relaxed">
          Each resource URL is checked live before being shown. Use "Info Only" for faster runs.
        </p>
      )}
    </div>
  );
}
