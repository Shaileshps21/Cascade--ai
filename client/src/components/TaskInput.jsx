import { useState } from 'react';
import { initiateTask } from '../api/index.js';

const PLACEHOLDERS = [
  'Submit ML assignment before Friday — it\'s complex...',
  'Prepare investor pitch deck by tomorrow noon...',
  'Fix production bug before client demo at 3 PM...',
  'Write research paper intro by end of week...',
];

export default function TaskInput({ onProcessStart }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [placeholder] = useState(() => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    if (trimmed.length < 10) {
      setError('Please describe your task in a bit more detail.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const { processId } = await initiateTask(trimmed);
      onProcessStart?.(processId);
      setInput('');
    } catch (err) {
      setError(err.message || 'Failed to start. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">⚡</span>
        <h2 className="font-semibold text-white">Add a Task</h2>
        <span className="text-xs text-white/30 ml-auto font-mono">⌘↵ to submit</span>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        disabled={loading}
        className="input-field input-glow resize-none font-sans text-sm leading-relaxed disabled:opacity-50"
      />

      {error && (
        <p className="mt-2 text-xs text-rose-400">{error}</p>
      )}

      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-white/25">
          AI agents will parse, prioritize, plan and schedule this automatically.
        </p>
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Launching agents...
            </>
          ) : (
            <>
              <span>Activate</span>
              <span>→</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
