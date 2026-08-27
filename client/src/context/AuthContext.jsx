import { createContext, useContext, useEffect, useState } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth, googleProvider } from '../firebase.js';
import { verifyToken } from '../api/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);         // Firebase user
  const [profile, setProfile] = useState(null);   // Firestore profile (calendarConnected, etc.)
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        // Verify with backend and get profile
        try {
          const idToken = await firebaseUser.getIdToken();
          const data = await verifyToken(idToken);
          setProfile(data);
        } catch (err) {
          console.error('[Auth] Profile fetch failed:', err);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Check for calendar connection from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendarConnected') === 'true') {
      setProfile((prev) => prev ? { ...prev, calendarConnected: true } : prev);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  };

  /**
   * Force the Google account-picker popup so the user can switch to a
   * different Google account. Signs out first to clear any cached
   * credential, then opens the picker with prompt:'select_account'.
   */
  const signInWithDifferentAccount = async () => {
    // Sign out first to clear Firebase's cached credential for the current
    // account — otherwise the popup may silently re-use the same account.
    await signOut(auth);
    const provider = Object.assign(Object.create(Object.getPrototypeOf(googleProvider)), googleProvider);
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    return result.user;
  };

  const logout = async () => {
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      const data = await verifyToken(idToken);
      setProfile(data);
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signInWithDifferentAccount, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
