/**
 * SSE Manager
 * ────────────────────────────────────────────────────────────────────────────
 * Manages Server-Sent Events connections.
 * Orchestrator writes events here; the /stream route reads them.
 *
 * Flow:
 *   1. Client POSTs task → receives processId
 *   2. Client opens GET /api/tasks/stream/:processId
 *   3. registerClient() attaches the response object
 *   4. emit() sends agent trace events in real-time
 *   5. close() sends a final "done" event and flushes
 */

// processId → Express res object
const clients = new Map();

// processId → buffered events (for race condition where events arrive before client connects)
const eventBuffers = new Map();

/**
 * Register an SSE client for a given processId.
 * Flushes any buffered events immediately.
 */
export function registerClient(processId, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Send a heartbeat immediately so browser knows connection is live
  res.write(': heartbeat\n\n');

  clients.set(processId, res);

  // Flush any events that arrived before the client connected
  const buffered = eventBuffers.get(processId) || [];
  buffered.forEach((event) => sendEvent(res, event));
  eventBuffers.delete(processId);

  // Clean up when client disconnects
  res.on('close', () => {
    clients.delete(processId);
    eventBuffers.delete(processId);
  });
}

/**
 * Emit an agent trace event to the connected client.
 * Buffers the event if client hasn't connected yet.
 *
 * @param {string} processId
 * @param {object} event – { agent, status, message, data? }
 */
export function emit(processId, event) {
  const res = clients.get(processId);
  if (res) {
    sendEvent(res, event);
  } else {
    // Buffer for up to 30 seconds while client connects
    if (!eventBuffers.has(processId)) {
      eventBuffers.set(processId, []);
      setTimeout(() => eventBuffers.delete(processId), 30_000);
    }
    eventBuffers.get(processId).push(event);
  }
}

/**
 * Send a "done" event and close the SSE stream.
 */
export function close(processId, finalData = null) {
  const res = clients.get(processId);
  if (res) {
    sendEvent(res, { agent: 'system', status: 'complete', message: '🎉 All agents done!', data: finalData });
    res.end();
    clients.delete(processId);
  }
}

/**
 * Send a "fatal" event and close the SSE stream.
 */
export function closeWithError(processId, errorMessage) {
  const res = clients.get(processId);
  if (res) {
    sendEvent(res, { agent: 'system', status: 'error', message: `❌ ${errorMessage}` });
    res.end();
    clients.delete(processId);
  }
}

function sendEvent(res, event) {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch (_) {
    // Client disconnected mid-stream, ignore
  }
}
