/**
 * google_calendar_agent/schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates the shape of a single "synced scheduledTask" entry — i.e. one
 * entry of the array returned by syncScheduleToCalendar(). This agent has no
 * LLM output of its own (purely deterministic), so this schema is a light
 * documentation/validation aid rather than something run through
 * shared/agentRunner.js.
 *
 * Shape:
 * {
 *   taskId: "T1",
 *   taskName: "string",
 *   startTime: "ISO 8601",
 *   endTime: "ISO 8601",
 *   calendarEventId: "string" | null,   // populated once synced
 *   calendarLabel: "first" | "last" | null,
 * }
 */

import { registerSchema, isNonEmptyString, isIsoDate, isEnum } from '../shared/validator.js';

const CALENDAR_LABELS = ['first', 'last'];

/**
 * Validate a single synced scheduledTask entry.
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateSyncedScheduledTask(data) {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['entry must be an object'], warnings };
    }

    if (!isNonEmptyString(data.taskId)) errors.push('taskId must be a non-empty string');
    if (!isNonEmptyString(data.taskName)) warnings.push('taskName should be a non-empty string');
    if (data.startTime !== undefined && !isIsoDate(data.startTime)) errors.push('startTime must be a valid ISO 8601 date string');
    if (data.endTime !== undefined && !isIsoDate(data.endTime)) errors.push('endTime must be a valid ISO 8601 date string');

    if (data.calendarEventId !== null && data.calendarEventId !== undefined && !isNonEmptyString(data.calendarEventId)) {
        errors.push('calendarEventId must be a non-empty string when present (or null when not yet synced)');
    }

    if (data.calendarLabel !== null && data.calendarLabel !== undefined && !isEnum(data.calendarLabel, CALENDAR_LABELS)) {
        errors.push(`calendarLabel must be one of: ${CALENDAR_LABELS.join(', ')}, or null`);
    }

    return { valid: errors.length === 0, errors, warnings };
}

registerSchema('google_calendar_agent', '1.0.0', validateSyncedScheduledTask);

export { validateSyncedScheduledTask, CALENDAR_LABELS };
