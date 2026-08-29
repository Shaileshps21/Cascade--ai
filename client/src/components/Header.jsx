import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import CalendarConnect from './CalendarConnect.jsx';

// Inline sun/moon icons — kept dependency-free for now. UPDATED_design.md §9.4
// calls for swapping these (and every other UI-chrome emoji) for Lucide
// stroke icons in a later pass; these are already stroke-based so that swap
// will be a drop-in replacement, not a rework.
function SunIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

export default function Header() {
  const { user, profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <span className="text-xl">⚡</span>
          <span className="font-bold text-primary tracking-tight">Cascade</span>
          <span className="hidden sm:inline text-[10px] font-mono text-muted border border-border px-1.5 py-0.5 rounded">
            BETA
          </span>
        </div>

        {/* Center — calendar status (compact) */}
        <div className="hidden sm:flex">
          <CalendarConnect compact />
        </div>

        {/* Right — user */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-7 h-7 flex items-center justify-center rounded-md text-secondary hover:text-primary hover:bg-surface-hover transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {theme === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
          </button>
          {user?.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName || 'User'}
              className="w-7 h-7 rounded-full border border-border"
            />
          )}
          <span className="hidden sm:inline text-sm text-secondary max-w-[120px] truncate">
            {user?.displayName || user?.email}
          </span>
          <button onClick={logout} className="btn-ghost text-xs py-1 px-2 text-muted">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
