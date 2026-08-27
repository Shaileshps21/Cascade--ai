import { useState, useEffect, useCallback, useRef } from 'react';
import { getPreferences, savePreferences, saveWeekendMode, saveDailyCapacity } from '../api/index.js';

const WORK_STYLE_OPTIONS = [
  { id: 'day',      label: '☀️ Day',      hint: '7:00–19:00' },
  { id: 'flexible', label: '🌤️ Flexible', hint: '9:00–21:00' },
  { id: 'night',    label: '🌙 Night',    hint: '12:00–24:00' },
];

const WEEKEND_OPTIONS = [
  {
    id: 'skip',
    label: '⛔ Skip weekends',
    hint: 'No tasks on Sat/Sun',
    recommended: true,
  },
  {
    id: 'light',
    label: '🌅 Light weekends',
    hint: '50% capacity on Sat/Sun',
    recommended: false,
  },
  {
    id: 'normal',
    label: '📅 Full weekends',
    hint: 'Same capacity as weekdays',
    recommended: false,
  },
  {
    id: 'heavy',
    label: '🏋️ Weekend heavy',
    hint: '150% capacity on Sat/Sun — great if weekends are your main work time',
    recommended: false,
  },
];

const MIN_HOURS = 0.5;
const MAX_HOURS = 12;
const STEP = 0.5;
const DEBOUNCE_MS = 600;

function hoursHint(h) {
  if (h <= 1) return 'Very light — great for side projects';
  if (h <= 2) return 'Default — most users doing side tasks';
  if (h <= 4) return 'Moderate — dedicated part-time focus';
  if (h <= 6) return 'Heavy — close to full-time focus';
  return '⚠️ Full-time — only if this is your main commitment';
}

/**
 * SchedulePreferences — lets the user set:
 *  1. Work style (day / flexible / night person)
 *  2. Weekend mode (skip / light / normal)
 *  3. Daily working capacity (0.5–12 h, debounced)
 *
 * All three map to context.preferences fields read by resolveWorkingHours()
 * in scheduler_agent/agent.js at schedule-build time.
 */
export default function SchedulePreferences() {
  const [workStyle, setWorkStyle]                 = useState('flexible');
  const [weekendMode, setWeekendMode]             = useState('skip');
  const [hoursPerDay, setHoursPerDay]             = useState(2);
  const [saving, setSaving]                       = useState(false);
  const [savingWeekend, setSavingWeekend]         = useState(false);
  const [savingHours, setSavingHours]             = useState(false);
  const [loaded, setLoaded]                       = useState(false);
  const debounceRef                               = useRef(null);

  const fetchPreferences = useCallback(() => {
    getPreferences()
      .then((r) => {
        setWorkStyle(r.workStyle || 'flexible');
        setWeekendMode(r.weekendMode || 'skip');
        setHoursPerDay(typeof r.availableHoursPerDay === 'number' ? r.availableHoursPerDay : 2);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { fetchPreferences(); }, [fetchPreferences]);

  // ── Work style ──────────────────────────────────────────────────────────
  const handleWorkStyleSelect = async (id) => {
    if (id === workStyle || saving) return;
    const previous = workStyle;
    setWorkStyle(id);
    setSaving(true);
    try { await savePreferences(id); }
    catch { setWorkStyle(previous); }
    finally { setSaving(false); }
  };

  // ── Weekend mode ────────────────────────────────────────────────────────
  const handleWeekendSelect = async (id) => {
    if (id === weekendMode || savingWeekend) return;
    const previous = weekendMode;
    setWeekendMode(id);
    setSavingWeekend(true);
    try { await saveWeekendMode(id); }
    catch { setWeekendMode(previous); }
    finally { setSavingWeekend(false); }
  };

  // ── Daily capacity (debounced) ──────────────────────────────────────────
  const commitHours = useCallback((h) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSavingHours(true);
      try { await saveDailyCapacity(h); }
      catch { /* non-fatal — value stays in UI */ }
      finally { setSavingHours(false); }
    }, DEBOUNCE_MS);
  }, []);

  const changeHours = (delta) => {
    setHoursPerDay((prev) => {
      const next = Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round((prev + delta) / STEP) * STEP));
      commitHours(next);
      return next;
    });
  };

  if (!loaded) return null;

  return (
    <div className="card p-4 border border-white/5 space-y-5">

      {/* ── Work style ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-white">Scheduling style</p>
          <p className="text-xs text-white/40 mt-0.5">Working-hours window tasks get scheduled into.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {WORK_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleWorkStyleSelect(opt.id)}
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

      <div className="border-t border-white/5" />

      {/* ── Weekend mode ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-white">Weekend scheduling</p>
          <p className="text-xs text-white/40 mt-0.5">How much work to place on Saturdays & Sundays.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {WEEKEND_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleWeekendSelect(opt.id)}
              disabled={savingWeekend}
              title={opt.hint}
              className={`relative px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                weekendMode === opt.id
                  ? 'border-brand-500 bg-brand-500/20 text-brand-400'
                  : 'border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
              }`}
            >
              {opt.label}
              {opt.recommended && (
                <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-emerald-400" title="Recommended default" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/5" />

      {/* ── Daily capacity ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-2">
            ⏱ Daily capacity
            {savingHours && (
              <svg className="animate-spin w-3 h-3 text-white/30" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </p>
          <p className="text-xs text-white/40 mt-0.5 max-w-[200px]">{hoursHint(hoursPerDay)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeHours(-STEP)}
            disabled={hoursPerDay <= MIN_HOURS}
            className="w-7 h-7 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/30 disabled:opacity-30 transition-all flex items-center justify-center font-bold text-sm"
          >
            −
          </button>
          <span className="text-sm font-semibold text-white tabular-nums w-12 text-center">
            {hoursPerDay % 1 === 0 ? `${hoursPerDay} h` : `${hoursPerDay} h`}
          </span>
          <button
            type="button"
            onClick={() => changeHours(STEP)}
            disabled={hoursPerDay >= MAX_HOURS}
            className="w-7 h-7 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/30 disabled:opacity-30 transition-all flex items-center justify-center font-bold text-sm"
          >
            +
          </button>
        </div>
      </div>

    </div>
  );
}
