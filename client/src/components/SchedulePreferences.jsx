import { useState, useEffect, useCallback } from 'react';
import { getPreferences, savePreferences } from '../api/index.js';

const OPTIONS = [
  { id: 'day', label: '☀️ Day person', hint: '7:00–19:00' },
  { id: 'flexible', label: '🌤️ Flexible', hint: '9:00–21:00' },
  { id: 'night', label: '🌙 Night person', hint: '12:00–24:00' },
];

/**
 * Lets the user pick whether the scheduler should prefer an early, balanced,
 * or late/night working-hours window when placing tasks on the calendar.
 * Read by scheduler_agent via resolveWorkingHours(context.preferences).
 */
export default function SchedulePreferences() {
  const [workStyle, setWorkStyle] = useState('flexible');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchPreferences = useCallback(() => {
    getPreferences()
      .then((r) => setWorkStyle(r.workStyle || 'flexible'))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { fetchPreferences(); }, [fetchPreferences]);

  const handleSelect = async (id) => {
    if (id === workStyle || saving) return;
    const previous = workStyle;
    setWorkStyle(id); // optimistic
    setSaving(true);
    try {
      await savePreferences(id);
    } catch (err) {
      console.error('[SchedulePreferences]', err);
      setWorkStyle(previous);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="card p-4 border border-white/5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-white">Scheduling style</p>
          <p className="text-xs text-white/40 mt-0.5">Controls the working-hours window new tasks get scheduled into.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              disabled={saving}
              title={opt.hint}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                workStyle === opt.id
                  ? 'border-brand-500 bg-brand-500/20 text-brand-400'
                  : 'border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
