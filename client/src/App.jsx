import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { FocusTimerProvider } from './context/FocusTimerContext.jsx';
import Header from './components/Header.jsx';
import FocusTimerBar from './components/FocusTimerBar.jsx';
import Dashboard from './components/Dashboard.jsx';
import ProjectWorkspace from './pages/ProjectWorkspace.jsx';
import TaskWorkspace from './pages/TaskWorkspace.jsx';
import ManualProjectBuilder from './pages/ManualProjectBuilder.jsx';
import Login from './pages/Login.jsx';

// ── Loading screen ─────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <span className="text-4xl animate-pulse">⚡</span>
        <p className="text-muted text-sm">Initialising...</p>
      </div>
    </div>
  );
}

// ── Guards ─────────────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

// ── App shell (only rendered when logged in) ───────────────────────────────
function AppLayout() {
  return (
    <FocusTimerProvider>
      <div className="min-h-screen bg-base">
        {/* Header and the focus timer bar are stacked inside one sticky
            wrapper — each was independently `sticky top-0`, so on scroll
            both stuck to the exact same viewport offset and the timer bar
            (higher z-index) rendered on top of the header, hiding it. */}
        <div className="sticky top-0 z-40">
          <Header />
          <FocusTimerBar />
        </div>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects/new/manual" element={<ManualProjectBuilder />} />
            <Route path="/projects/:projectId" element={<ProjectWorkspace />} />
            <Route path="/projects/:projectId/tasks/:taskId" element={<TaskWorkspace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </FocusTimerProvider>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              }
            />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}