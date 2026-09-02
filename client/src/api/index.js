import { auth } from '../firebase.js';

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function getToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const verifyToken = (idToken) =>
  fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  }).then((r) => r.json());

export const getProfile = () => apiFetch('/api/auth/profile');

// ── Tasks (pipeline kickoff + legacy flat access) ────────────────────────────
export const initiateTask = (rawInput, deadline = null, calendarSync = true) =>
  apiFetch('/api/tasks/initiate', {
    method: 'POST',
    body: JSON.stringify({ rawInput, deadline, calendarSync }),
  });

export const getTasks = () => apiFetch('/api/tasks');
export const getTask = (id) => apiFetch(`/api/tasks/${id}`);

// ── Manual Todo Mode (AI-optional fallback — suggestions.md #26) ────────────
// Creates a project by hand — no LLM calls, works even when the API quota is
// exhausted. Writes into the same schema the AI pipeline uses.
export const createManualProject = (payload) =>
  apiFetch('/api/tasks/manual', { method: 'POST', body: JSON.stringify(payload) });

export const completeSubtask = (taskId, subtaskId) =>
  apiFetch(`/api/tasks/${taskId}/subtask/${subtaskId}/complete`, { method: 'PATCH' });

export const completeTask = (taskId, data) =>
  apiFetch(`/api/tasks/${taskId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteTask = (id) =>
  apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });

// Toggle Google Calendar sync on/off for a single project.
// enabled=false: deletes calendar events + marks calendarSync=false in Firestore.
// enabled=true:  re-syncs scheduled tasks to Google Calendar.
export const setTaskCalendarSync = (taskId, enabled) =>
  apiFetch(`/api/tasks/${taskId}/calendar-sync`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });

// ── Projects (Dashboard → Project Workspace → Task Workspace) ───────────────
export const getProjects = () => apiFetch('/api/projects');
export const getProject = (projectId) => apiFetch(`/api/projects/${projectId}`);
export const getProjectMilestones = (projectId) => apiFetch(`/api/projects/${projectId}/milestones`);
export const getProjectModule = (projectId, moduleId) =>
  apiFetch(`/api/projects/${projectId}/modules/${moduleId}`);
export const getProjectTask = (projectId, taskId) =>
  apiFetch(`/api/projects/${projectId}/tasks/${taskId}`);

/**
 * Update one execution step (start/pause/complete/skip/notes/evidence).
 * @param {string} projectId
 * @param {string} taskId
 * @param {string} stepId
 * @param {{status?: string, progress?: number, notes?: string, completionEvidence?: string, blockedReason?: string, actualMinutes?: number}} patch
 *   `actualMinutes` is only honored alongside `status: 'completed'` — a client-measured
 *   duration (e.g. the Focus Mode timer) that takes precedence over the server's own
 *   timestamp-derived measurement.
 */
export const updateExecutionStep = (projectId, taskId, stepId, patch) =>
  apiFetch(`/api/projects/${projectId}/tasks/${taskId}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// Set (replace) a task's single free-text markdown note.
export const setTaskNote = (projectId, taskId, text) =>
  apiFetch(`/api/projects/${projectId}/tasks/${taskId}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });

// Persist a new task order within one module (drag-to-reorder).
export const reorderModuleTasks = (projectId, moduleId, taskIds) =>
  apiFetch(`/api/projects/${projectId}/modules/${moduleId}/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ taskIds }),
  });

// Quick-Add Subtask: append one subtask to a module with no AI pipeline run.
// Works the same for manually-built and AI-generated projects.
export const addModuleTask = (projectId, moduleId, { title, estimatedMinutes, priority, deadline, startTime } = {}) =>
  apiFetch(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ moduleId, title, estimatedMinutes, priority, deadline, startTime }),
  });

// Add Module: append a new, empty module to a milestone. Works on both
// AI-generated and manually-built projects.
export const addProjectModule = (projectId, { milestoneId, title } = {}) =>
  apiFetch(`/api/projects/${projectId}/modules`, {
    method: 'POST',
    body: JSON.stringify({ milestoneId, title }),
  });

// Delete a subtask — only allowed by the server when its module was
// manually added (Add Module, or an original Manual Project Builder module).
export const deleteModuleTask = (projectId, taskId) =>
  apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' });

// Delete a module — only allowed by the server when it's manually added AND
// currently empty (no subtasks).
export const deleteProjectModule = (projectId, moduleId) =>
  apiFetch(`/api/projects/${projectId}/modules/${moduleId}`, { method: 'DELETE' });

// ── Calendar ──────────────────────────────────────────────────────────────────
export const getCalendarStatus = () => apiFetch('/api/calendar/status');
export const getCalendarEvents = () => apiFetch('/api/calendar/events');
export const getCalendarAuthUrl = (uid) => `${BASE_URL}/api/calendar/auth?userId=${uid}`;
export const disconnectCalendar = () => apiFetch('/api/calendar/disconnect', { method: 'DELETE' });

// ── Settings / API Key ────────────────────────────────────────────────────────
export const getApiKeyStatus = () => apiFetch('/api/settings/apikey');

export const saveApiKey = (apiKey, keyType = 'groq', model = null) =>
  apiFetch('/api/settings/apikey', {
    method: 'POST',
    body: JSON.stringify({ apiKey, keyType, model }),
  });

export const deleteApiKey = () =>
  apiFetch('/api/settings/apikey', { method: 'DELETE' });

export const getPreferences = () => apiFetch('/api/settings/preferences');

export const savePreferences = (workStyle) =>
  apiFetch('/api/settings/preferences', {
    method: 'PUT',
    body: JSON.stringify({ workStyle }),
  });

export const saveResourcePreference = (resourceMode) =>
  apiFetch('/api/settings/preferences', {
    method: 'PUT',
    body: JSON.stringify({ resourceMode }),
  });

// Save the weekend scheduling mode ('skip' | 'light' | 'normal').
export const saveWeekendMode = (weekendMode) =>
  apiFetch('/api/settings/preferences', {
    method: 'PUT',
    body: JSON.stringify({ weekendMode }),
  });

// Save the user's daily working capacity (hours, e.g. 2.5).
export const saveDailyCapacity = (availableHoursPerDay) =>
  apiFetch('/api/settings/preferences', {
    method: 'PUT',
    body: JSON.stringify({ availableHoursPerDay }),
  });

// ── Replanning (missed-task reassignment) ────────────────────────────────────
export const replanTask = (taskId) =>
  apiFetch(`/api/tasks/${taskId}/replan`, { method: 'POST' });

// ── Resume (continue an interrupted pipeline from its checkpoint) ─────────────
export const resumeTask = (taskId) =>
  apiFetch(`/api/tasks/${taskId}/resume`, { method: 'POST' });

// ── Failed / interrupted tasks ────────────────────────────────────────────────
export const getFailedTasks = () => apiFetch('/api/tasks/failed');

// ── Daily Briefings ───────────────────────────────────────────────────────────
export const getTodaysBriefing = () => apiFetch('/api/briefings/today');

export const generateBriefing = () =>
  apiFetch('/api/briefings/generate', { method: 'POST' });

export const markBriefingSeen = () =>
  apiFetch('/api/briefings/seen', { method: 'PATCH' });

export const dismissBriefing = () =>
  apiFetch('/api/briefings/dismiss', { method: 'PATCH' });

// ── SSE stream ────────────────────────────────────────────────────────────────
export function openAgentStream(processId) {
  return new EventSource(`${BASE_URL}/api/tasks/stream/${processId}`);
}

// ── Onboarding ────────────────────────────────────────────────────────────────
// Returns { completed: boolean } — false means the user hasn't seen the tour.
export const getOnboardingStatus = () => apiFetch('/api/settings/onboarding');
// Mark the onboarding as complete (called on skip or "Get Started").
export const completeOnboarding = () =>
  apiFetch('/api/settings/onboarding/complete', { method: 'POST' });
