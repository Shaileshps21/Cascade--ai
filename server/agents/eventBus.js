/**
 * eventBus.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight in-process event emitter for the 15-agent pipeline.
 * Each agent fires events that the orchestrator translates into SSE messages.
 *
 * Events emitted:
 *   'agent:start'        — agent begins execution
 *   'agent:complete'     — agent finished successfully
 *   'agent:error'        — agent encountered a non-recoverable error
 *   'agent:retry'        — agent retrying after failure
 *   'review:triggered'   — review agent detected quality < 80, revision queued
 *   'benchmark:complete' — evaluation benchmark appended new metrics snapshot
 *   'pipeline:complete'  — full orchestration pipeline finished
 */

import { EventEmitter } from 'events';

class AgentEventBus extends EventEmitter {
  constructor() {
    super();
    // Prevent Node.js warnings for many listeners (15 agents + orchestrator)
    this.setMaxListeners(50);
  }

  /**
   * Emit an agent lifecycle event with a structured payload.
   * @param {'agent:start'|'agent:complete'|'agent:error'|'agent:retry'|'review:triggered'|'benchmark:complete'|'pipeline:complete'} eventName
   * @param {object} payload
   * @param {string} payload.agentName   - e.g. 'planning', 'scheduler'
   * @param {string} [payload.message]   - human-readable description
   * @param {any}    [payload.data]      - optional structured data
   * @param {Error}  [payload.error]     - error instance (for error events)
   * @param {number} [payload.attempt]   - retry attempt number (for retry events)
   */
  emit(eventName, payload = {}) {
    return super.emit(eventName, {
      ...payload,
      ts: Date.now(),
    });
  }

  /** Convenience: fire agent:start */
  agentStart(agentName, message = '') {
    this.emit('agent:start', { agentName, message });
  }

  /** Convenience: fire agent:complete */
  agentComplete(agentName, message = '', data = null) {
    this.emit('agent:complete', { agentName, message, data });
  }

  /** Convenience: fire agent:error */
  agentError(agentName, error, message = '') {
    this.emit('agent:error', { agentName, error, message });
  }

  /** Convenience: fire agent:retry */
  agentRetry(agentName, attempt, message = '') {
    this.emit('agent:retry', { agentName, attempt, message });
  }
}

// Singleton exported for use by orchestrator and agents
export const eventBus = new AgentEventBus();
