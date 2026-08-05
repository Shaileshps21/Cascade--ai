/**
 * shared/logger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Observability logger that records per-agent execution metrics.
 * Entries are pushed into context.metadata.observabilityLogs and later
 * consumed by the Evaluation Benchmark Agent.
 */

/**
 * Create a new agent log entry (call at agent start).
 * @param {string} agentName    - e.g. 'planning_agent'
 * @param {string} promptVersion - e.g. 'v1.0.0'
 * @returns {object} mutable log entry — complete it later with completeAgentLog()
 */
export function createAgentLog(agentName, promptVersion = 'v1.0.0') {
  return {
    agentName,
    promptVersion,
    startedAt: new Date().toISOString(),
    completedAt: null,
    elapsedMs: null,
    tokens: { prompt: 0, completion: 0, total: 0 },
    estimatedCost: 0,
    confidence: null,
    retries: 0,
    status: 'running',   // 'running' | 'success' | 'failed' | 'retried'
    errors: [],
    provider: null,
    model: null,
  };
}

/**
 * Complete a log entry with results from the agent run.
 * Mutates the log in-place.
 * @param {object} log            - log entry from createAgentLog()
 * @param {object} opts
 * @param {object} [opts.usage]   - { promptTokens, completionTokens, totalTokens }
 * @param {number} [opts.cost]    - estimated USD cost
 * @param {number} [opts.confidence] - 0–1
 * @param {number} [opts.retries] - number of retries performed
 * @param {'success'|'failed'|'retried'} [opts.status]
 * @param {string[]} [opts.errors]
 * @param {string}  [opts.provider]
 * @param {string}  [opts.model]
 */
export function completeAgentLog(log, {
  usage = null,
  cost = 0,
  confidence = null,
  retries = 0,
  status = 'success',
  errors = [],
  provider = null,
  model = null,
} = {}) {
  const now = new Date();
  log.completedAt = now.toISOString();
  log.elapsedMs = now.getTime() - new Date(log.startedAt).getTime();

  if (usage) {
    log.tokens = {
      prompt: usage.promptTokens ?? 0,
      completion: usage.completionTokens ?? 0,
      total: usage.totalTokens ?? 0,
    };
  }

  log.estimatedCost = cost;
  log.confidence = confidence;
  log.retries = retries;
  log.status = status;
  log.errors = errors;
  log.provider = provider;
  log.model = model;
}

/**
 * Attach a completed log entry to the PlanningContext observability store.
 * Writes into context.metadata.observabilityLogs (appends).
 * @param {object} context
 * @param {object} log
 */
export function attachToContext(context, log) {
  if (!context?.metadata) return;
  if (!Array.isArray(context.metadata.observabilityLogs)) {
    context.metadata.observabilityLogs = [];
  }
  context.metadata.observabilityLogs.push({ ...log });
}

/**
 * Get a human-readable summary of all observability logs in a context.
 * @param {object} context
 * @returns {object} summary stats
 */
export function getObservabilitySummary(context) {
  const logs = context?.metadata?.observabilityLogs ?? [];
  const successful = logs.filter(l => l.status === 'success' || l.status === 'retried');
  const failed = logs.filter(l => l.status === 'failed');
  const totalTokens = logs.reduce((acc, l) => acc + (l.tokens?.total ?? 0), 0);
  const totalCost = logs.reduce((acc, l) => acc + (l.estimatedCost ?? 0), 0);
  const totalMs = logs.reduce((acc, l) => acc + (l.elapsedMs ?? 0), 0);
  const totalRetries = logs.reduce((acc, l) => acc + (l.retries ?? 0), 0);

  return {
    totalAgents: logs.length,
    successful: successful.length,
    failed: failed.length,
    totalTokens,
    totalCostUsd: parseFloat(totalCost.toFixed(6)),
    totalElapsedMs: totalMs,
    totalRetries,
    avgConfidence: logs.length
      ? parseFloat((logs.reduce((acc, l) => acc + (l.confidence ?? 0), 0) / logs.length).toFixed(3))
      : null,
  };
}
