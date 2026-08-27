import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { signInWithGoogle, signInWithDifferentAccount } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
      navigate('/');
    } catch (err) {
      setError('Sign-in failed. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    setSwitchLoading(true);
    setError('');
    try {
      await signInWithDifferentAccount();
      navigate('/');
    } catch (err) {
      // User cancelled the picker — not a real error
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        setError('Could not switch account. Please try again.');
        console.error(err);
      }
    } finally {
      setSwitchLoading(false);
    }
  };

  const anyLoading = loading || switchLoading;

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col items-center justify-center px-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-brand-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/30 mb-4">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Cascade</h1>
          <p className="mt-2 text-white/50 text-sm">AI-powered deadline companion</p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {['15 AI Agents', 'RAG Personalization', 'Auto-Scheduler', 'Calendar Sync'].map((f) => (
            <span key={f} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
              {f}
            </span>
          ))}
        </div>

        {/* Card */}
        <div className="card p-8">
          <h2 className="text-xl font-semibold text-white mb-1">Get started</h2>
          <p className="text-white/40 text-sm mb-6">
            Sign in to let AI agents plan, prioritize, and schedule your tasks before deadlines hit.
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
              {error}
            </div>
          )}

          {/* Primary sign-in button */}
          <button
            onClick={handleSignIn}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-semibold
                       px-4 py-3 rounded-lg hover:bg-gray-100 transition-all duration-150
                       active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <svg className="animate-spin w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-5 h-5">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            {loading ? 'Signing in...' : 'Continue with Google'}
          </button>

          {/* Switch account link */}
          <button
            onClick={handleSwitchAccount}
            disabled={anyLoading}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                       border border-white/10 text-white/50 text-sm
                       hover:text-white/80 hover:border-white/25 hover:bg-white/5
                       transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {switchLoading ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            )}
            {switchLoading ? 'Opening account picker...' : 'Use a different Google account'}
          </button>

          <p className="mt-4 text-center text-xs text-white/25">
            By signing in you agree to let Cascade manage your tasks.
          </p>
        </div>
      </div>
    </div>
  );
}
