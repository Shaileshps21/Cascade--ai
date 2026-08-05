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
export const initiateTask = (rawInput, deadline = null) =>
  apiFetch('/api/tasks/initiate', {
    method: 'POST',
    body: JSON.stringify({ rawInput, deadline }),
  });

export const getTasks = () => apiFetch('/api/tasks');
export const getTask = (id) => apiFetch(`/api/tasks/${id}`);

export const completeSubtask = (taskId, subtaskId) =>
  apiFetch(`/api/tasks/${taskId}/subtask/${subtaskId}/complete`, { method: 'PATCH' });

export const completeTask = (taskId, data) =>
  apiFetch(`/api/tasks/${taskId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteTask = (id) =>
  apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });

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
 * @param {{status?: string, progress?: number, notes?: string, completionEvidence?: string, blockedReason?: string}} patch
 */
export const updateExecutionStep = (projectId, taskId, stepId, patch) =>
  apiFetch(`/api/projects/${projectId}/tasks/${taskId}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

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
