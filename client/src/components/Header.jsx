import { useAuth } from '../context/AuthContext.jsx';
import CalendarConnect from './CalendarConnect.jsx';

export default function Header() {
  const { user, profile, logout } = useAuth();

  return (
    <header className="border-b border-white/5 bg-surface-900/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <span className="text-xl">⚡</span>
          <span className="font-bold text-white tracking-tight">Cascade</span>
          <span className="hidden sm:inline text-[10px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5 rounded">
            BETA
          </span>
        </div>

        {/* Center — calendar status (compact) */}
        <div className="hidden sm:flex">
          <CalendarConnect compact />
        </div>

        {/* Right — user */}
        <div className="flex items-center gap-3">
          {user?.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName || 'User'}
              className="w-7 h-7 rounded-full border border-white/10"
            />
          )}
          <span className="hidden sm:inline text-sm text-white/60 max-w-[120px] truncate">
            {user?.displayName || user?.email}
          </span>
          <button onClick={logout} className="btn-ghost text-xs py-1 px-2 text-white/30">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
