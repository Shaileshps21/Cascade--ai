import { auth } from '../firebase.js';

const BASE_URL = import.meta.env.VITE_API_URL || '';

/**
 * Get the current user's Firebase ID token.
 * Throws if user is not signed in.
 */
async function getToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

/**
 * Generic authenticated fetch wrapper.
 */
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

// ── Auth ──────────────────────────────────────────────────────────────────
export const verifyToken = (idToken) =>
  fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  }).then((r) => r.json());

export const getProfile = () => apiFetch('/api/auth/profile');

// ── Tasks ──────────────────────────────────────────────────────────────────
export const initiateTask = (rawInput) =>
  apiFetch('/api/tasks/initiate', {
    method: 'POST',
    body: JSON.stringify({ rawInput }),
  });

export const getTasks = () => apiFetch('/api/tasks');

export const getTask = (taskId) => apiFetch(`/api/tasks/${taskId}`);

export const completeSubtask = (taskId, subtaskId) =>
  apiFetch(`/api/tasks/${taskId}/subtask/${subtaskId}/complete`, { method: 'PATCH' });

export const completeTask = (taskId, data) =>
  apiFetch(`/api/tasks/${taskId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteTask = (taskId) =>
  apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });

// ── Calendar ──────────────────────────────────────────────────────────────
export const getCalendarStatus = () => apiFetch('/api/calendar/status');

export const getCalendarEvents = () => apiFetch('/api/calendar/events');

export const getCalendarAuthUrl = (userId) =>
  `${BASE_URL}/api/calendar/auth?userId=${userId}`;

export const disconnectCalendar = () =>
  apiFetch('/api/calendar/disconnect', { method: 'DELETE' });

// ── SSE stream helper ──────────────────────────────────────────────────────
/**
 * Open an SSE stream for a process. No auth header needed (GET request).
 * @returns {EventSource}
 */
export function openAgentStream(processId) {
  return new EventSource(`${BASE_URL}/api/tasks/stream/${processId}`);
}
