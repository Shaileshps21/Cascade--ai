import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getProjectTask } from '../api/index.js';

// sessionStorage, not localStorage: survives switching to another Chrome tab,
// backgrounding this tab, and an in-tab page reload — but is natively wiped
// the instant this tab (or the whole browser) closes, with no reliance on
// unload events (which don't fire reliably on a real close/crash). That's
// exactly "keeps running across tabs, dies with the browser."
const STORAGE_KEY = 'cascade-focus-timer';

const FocusTimerContext = createContext(null);

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(session) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private-browsing/storage-disabled: the timer still works for this
    // render, it just won't survive a reload — not fatal.
  }
}

export function FocusTimerProvider({ children }) {
  const [session, setSession] = useState(readStored);
  const [, forceTick] = useState(0);
  const didValidateRef = useRef(false);

  useEffect(() => { writeStored(session); }, [session]);

  // A 1s tick purely to re-render the visible mm:ss — elapsed time itself is
  // always computed from Date.now(), so a throttled/missed tick (background
  // tab) never loses time, it just redraws a beat late. `visibilitychange`
  // forces an immediate redraw on refocus so switching back from another
  // Chrome tab shows the correct time with no catch-up lag.
  useEffect(() => {
    if (!session?.running) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    const onVisible = () => { if (!document.hidden) forceTick((n) => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.running]);

  // Validate a session rehydrated from sessionStorage exactly once, on
  // mount — not a freshly-started one, which the caller just confirmed is
  // valid. Drops the session if its step no longer exists, is already
  // completed, or the project is no longer reachable.
  useEffect(() => {
    if (didValidateRef.current) return;
    didValidateRef.current = true;
    if (!session) return;
    (async () => {
      try {
        const { task } = await getProjectTask(session.projectId, session.taskId);
        const step = task.executionSteps.find((s) => (s.id ?? s.stepId) === session.stepId);
        if (!step || step.status === 'completed') setSession(null);
      } catch {
        setSession(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elapsedMs = session
    ? session.accumulatedMs + (session.running ? Date.now() - session.startedAt : 0)
    : 0;

  // Only one active session at a time. Returns false (and changes nothing)
  // if a different session is already running — the caller (FocusMode)
  // surfaces that as a conflict instead of silently abandoning it.
  const startSession = (projectId, task, step) => {
    if (session) return false;
    const stepId = step.id ?? step.stepId;
    setSession({
      projectId,
      taskId: task.id,
      taskTitle: task.title,
      stepId,
      stepTitle: step.title,
      estimatedMinutes: step.estimatedMinutes ?? null,
      startedAt: Date.now(),
      accumulatedMs: 0,
      running: true,
    });
    return true;
  };

  const pause = () => {
    setSession((prev) => {
      if (!prev || !prev.running) return prev;
      return { ...prev, running: false, accumulatedMs: prev.accumulatedMs + (Date.now() - prev.startedAt) };
    });
  };

  const resume = () => {
    setSession((prev) => {
      if (!prev || prev.running) return prev;
      return { ...prev, running: true, startedAt: Date.now() };
    });
  };

  // Ends the session and returns its final elapsed milliseconds, for the
  // caller to report as actualMinutes on step completion.
  const completeSession = () => {
    if (!session) return 0;
    const finalMs = session.accumulatedMs + (session.running ? Date.now() - session.startedAt : 0);
    setSession(null);
    return finalMs;
  };

  const discardSession = () => setSession(null);

  return (
    <FocusTimerContext.Provider value={{ session, elapsedMs, startSession, pause, resume, completeSession, discardSession }}>
      {children}
    </FocusTimerContext.Provider>
  );
}

export const useFocusTimer = () => {
  const ctx = useContext(FocusTimerContext);
  if (!ctx) throw new Error('useFocusTimer must be used within FocusTimerProvider');
  return ctx;
};
