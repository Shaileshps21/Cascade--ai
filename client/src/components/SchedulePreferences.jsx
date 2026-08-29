import { useState, useEffect, useCallback, useRef } from 'react';
import { Sun, Sunset, Moon, Ban, Sunrise, CalendarDays, Dumbbell, Timer } from 'lucide-react';
import { getPreferences, savePreferences, saveWeekendMode, saveDailyCapacity } from '../api/index.js';

const WORK_STYLE_OPTIONS = [
  { id: 'day',      label: 'Day',      icon: Sun,    hint: '7:00–19:00' },
  { id: 'flexible', label: 'Flexible', icon: Sunset, hint: '9:00–21:00' },
  { id: 'night',    label: 'Night',    icon: Moon,   hint: '12:00–24:00' },
];

const WEEKEND_OPTIONS = [
  {
    id: 'skip',
    label: 'Skip weekends',
    icon: Ban,
    hint: 'No tasks on Sat/Sun',
    recommended: true,
  },
  {
    id: 'light',
    label: 'Light weekends',
    icon: Sunrise,
    hint: '50% capacity on Sat/Sun',
    recommended: false,
  },
  {
    id: 'normal',
    label: 'Full weekends',
    icon: CalendarDays,
    hint: 'Same capacity as weekdays',
    recommended: false,
  },
  {
    id: 'heavy',
    label: 'Weekend heavy',
    icon: Dumbbell,
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
    <div className="space-y-4">

      {/* ── Work style ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <label className="text-xs font-medium text-muted uppercase tracking-wide">
          How should Cascade schedule this?
        </label>
        <div className="flex items-center gap-1.5 flex-wrap">
          {WORK_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleWorkStyleSelect(opt.id)}
              disabled={saving}
              title={opt.hint}
              data-active={workStyle === opt.id}
              className="segmented-btn flex items-center gap-1.5 disabled:opacity-50"
            >
              <opt.icon className="w-3.5 h-3.5" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Weekend mode ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap border-t border-border pt-4">
        <label className="text-xs font-medium text-muted uppercase tracking-wide">
          Weekend availability
        </label>
        <div className="flex items-center gap-1.5 flex-wrap">
          {WEEKEND_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleWeekendSelect(opt.id)}
              disabled={savingWeekend}
              title={opt.hint}
              data-active={weekendMode === opt.id}
              className="segmented-btn relative flex items-center gap-1.5 disabled:opacity-50"
            >
              <opt.icon className="w-3.5 h-3.5" />
              {opt.label}
              {opt.recommended && (
                <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-success" title="Recommended default" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Daily capacity ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap border-t border-border pt-4">
        <div className="space-y-0.5">
          <label className="text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5" />
            How much time can you spend daily?
            {savingHours && (
              <svg className="animate-spin w-3 h-3 text-muted" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </label>
          <p className="text-xs text-muted max-w-[220px]">{hoursHint(hoursPerDay)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeHours(-STEP)}
            disabled={hoursPerDay <= MIN_HOURS}
            className="w-7 h-7 rounded-lg border border-border text-secondary hover:text-primary hover:border-border-strong disabled:opacity-30 transition-colors flex items-center justify-center font-bold text-sm"
          >
            −
          </button>
          <span className="text-sm font-semibold text-primary font-mono tabular-nums w-12 text-center">
            {hoursPerDay} h
          </span>
          <button
            type="button"
            onClick={() => changeHours(STEP)}
            disabled={hoursPerDay >= MAX_HOURS}
            className="w-7 h-7 rounded-lg border border-border text-secondary hover:text-primary hover:border-border-strong disabled:opacity-30 transition-colors flex items-center justify-center font-bold text-sm"
          >
            +
          </button>
        </div>
      </div>

    </div>
  );
}
