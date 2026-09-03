// SubtaskFields.jsx — the labeled subtask field group (Subtask / Priority /
// Est. minutes / Start Date / Start Time / End Date) shared by the Manual
// Project Builder and RoadmapTree's Quick-Add Subtask, so a subtask looks
// and behaves identically whether it's on an AI-generated or a manually
// built module — one field set, one place to change it.

export const SUBTASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];

export const PRIORITY_FIELD_STYLES = {
  low: 'text-muted border-border',
  medium: 'text-warning border-warning/30',
  high: 'text-orange-400 border-orange-500/30',
  critical: 'text-danger border-danger/30',
};

/** A blank subtask value in the shape every consumer of SubtaskFieldsRow shares. */
export function emptySubtaskValue() {
  return {
    title: '',
    estimatedMinutes: '',
    priority: 'medium',
    // Start date/time are two separate native inputs (rather than one
    // datetime-local) so each can carry its own visible label — combined into
    // one ISO startTime only when a caller actually submits the subtask.
    startDate: '',
    startTimeOfDay: '',
    deadline: '', // "End Date (optional)" — a calendar-day cap, not a precise end time.
  };
}

/** Small labeled-field wrapper so every subtask input gets a real visible label. */
export function Field({ label, width = '', children }) {
  return (
    <div className={`flex flex-col gap-1 ${width}`}>
      <label className="text-[10px] text-muted uppercase tracking-wide font-semibold">{label}</label>
      {children}
    </div>
  );
}

/**
 * The full labeled subtask row: Subtask / Priority / Est. minutes /
 * Start Date / Start Time / End Date (optional). Fully controlled —
 * `value` is `emptySubtaskValue()`'s shape, `onChange(patch)` merges a patch.
 */
export function SubtaskFieldsRow({ value, onChange, disabled = false }) {
  const set = (patch) => onChange(patch);

  return (
    <div className="flex-1 flex flex-wrap items-end gap-x-3 gap-y-2">
      <Field label="Subtask" width="flex-1 min-w-[160px]">
        <input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Subtask title"
          disabled={disabled}
          className="input-field text-sm py-1.5"
        />
      </Field>
      <Field label="Priority" width="w-28">
        <select
          value={value.priority}
          onChange={(e) => set({ priority: e.target.value })}
          disabled={disabled}
          className={`input-field text-xs py-1.5 capitalize border ${PRIORITY_FIELD_STYLES[value.priority] || ''}`}
        >
          {SUBTASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Est. minutes" width="w-24">
        <input
          type="number"
          min="0"
          step="5"
          value={value.estimatedMinutes}
          onChange={(e) => set({ estimatedMinutes: e.target.value })}
          placeholder="30"
          disabled={disabled}
          className="input-field text-sm py-1.5"
        />
      </Field>
      <Field label="Start Date" width="w-36">
        <input
          type="date"
          value={value.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
          disabled={disabled}
          className="input-field text-xs py-1.5"
        />
      </Field>
      <Field label="Start Time" width="w-28">
        <input
          type="time"
          value={value.startTimeOfDay}
          onChange={(e) => set({ startTimeOfDay: e.target.value })}
          disabled={disabled}
          className="input-field text-xs py-1.5"
        />
      </Field>
      <Field label="End Date (optional)" width="w-36">
        <input
          type="date"
          value={value.deadline}
          onChange={(e) => set({ deadline: e.target.value })}
          disabled={disabled}
          className="input-field text-xs py-1.5"
        />
      </Field>
    </div>
  );
}

/**
 * Combine a SubtaskFieldsRow value into the wire shape POST /manual and
 * POST /:projectId/tasks (Quick-Add) both accept: ISO `startTime` only once
 * both date+time halves are filled, ISO `deadline` date, numeric
 * `estimatedMinutes`, trimmed `title`.
 */
export function serializeSubtaskValue(value) {
  return {
    title: value.title.trim(),
    estimatedMinutes: value.estimatedMinutes ? Number(value.estimatedMinutes) : undefined,
    priority: value.priority,
    deadline: value.deadline ? new Date(value.deadline).toISOString() : undefined,
    startTime: (value.startDate && value.startTimeOfDay)
      ? new Date(`${value.startDate}T${value.startTimeOfDay}`).toISOString()
      : undefined,
  };
}

/**
 * True when a subtask's End Date falls strictly before its Start Date.
 * Mirrors the server-side check (quickAddTask.js's isEndDateBeforeStartDate)
 * so the builder can reject this before the round trip — compared by
 * calendar day, since "End Date" is a plain date while "Start Time" carries
 * a precise time (a same-day End Date must not be rejected just because
 * midnight precedes the start time).
 * @param {string|undefined} startTime - ISO datetime, from serializeSubtaskValue()
 * @param {string|undefined} deadline - ISO date, from serializeSubtaskValue()
 * @returns {boolean}
 */
export function isEndDateBeforeStartDate(startTime, deadline) {
  if (!startTime || !deadline) return false;
  const start = new Date(startTime);
  const end = new Date(deadline);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return endDay < startDay;
}
