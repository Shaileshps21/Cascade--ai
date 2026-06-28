import { useEffect, useRef, useState, useCallback } from 'react';
import { openAgentStream } from '../api/index.js';

/**
 * useSSE — subscribes to an agent trace SSE stream.
 *
 * @param {string|null} processId – null means no active stream
 * @returns {{ events, isStreaming, finalData, reset }}
 */
export function useSSE(processId) {
  const [events, setEvents] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [finalData, setFinalData] = useState(null);
  const esRef = useRef(null);

  const reset = useCallback(() => {
    setEvents([]);
    setIsStreaming(false);
    setFinalData(null);
  }, []);

  useEffect(() => {
    if (!processId) return;

    // Clean up any existing connection
    if (esRef.current) {
      esRef.current.close();
    }

    setIsStreaming(true);
    setEvents([]);
    setFinalData(null);

    const es = openAgentStream(processId);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        if (event.agent === 'system' && event.status === 'complete') {
          setFinalData(event.data);
          setIsStreaming(false);
          es.close();
          return;
        }

        if (event.agent === 'system' && event.status === 'error') {
          setIsStreaming(false);
          es.close();
        }

        setEvents((prev) => [...prev, event]);
      } catch {
        // Ignore malformed events (heartbeats, etc.)
      }
    };

    es.onerror = () => {
      setIsStreaming(false);
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [processId]);

  return { events, isStreaming, finalData, reset };
}
