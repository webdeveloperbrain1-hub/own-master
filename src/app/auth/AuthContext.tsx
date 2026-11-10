import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { accountRequest, currentAccount } from './accountClient';
import { authErrorMessage } from './authFlows';
import type { AppUser } from '../types';

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  sessionError: string;
  retrySession: () => void;
  signUp: (input: {
    name: string;
    email: string;
    password: string;
    returnTo?: string;
  }) => Promise<{ emailSent: boolean }>;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resendConfirmation: (email: string, returnTo?: string) => Promise<void>;
  confirmEmail: (token: string) => Promise<{ returnTo: string }>;
  updatePassword: (password: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_CHANGED = 'own_masters_auth_changed';
function remember(key: string, value?: string) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Cookies keep accounts working when browser storage is blocked. */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionCheck, setSessionCheck] = useState(0);
  const generation = useRef(0);
  const announce = () =>
    remember(AUTH_CHANGED, `${Date.now()}-${Math.random()}`);
  function acceptUser(value: AppUser | null) {
    generation.current++;
    setUser(value);
    setLoading(false);
    setSessionError('');
    announce();
  }
  useEffect(() => {
    let active = true;
    async function sync() {
      const version = ++generation.current;
      try {
        const result = await currentAccount();
        if (!active || version !== generation.current) return;
        setUser(result.user ?? null);
        setSessionError('');
      } catch (error) {
        if (active && version === generation.current) {
          // An unavailable service does not prove that an existing session expired.
          // Keep mounted editors and their unsaved work until the server confirms it.
          setSessionError(authErrorMessage(error));
        }
      } finally {
        if (active && version === generation.current) setLoading(false);
      }
    }
    const expired = () => {
      generation.current++;
      setUser(null);
      setSessionError('');
      announce();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === AUTH_CHANGED) void sync();
    };
    void sync();
    window.addEventListener('focus', sync);
    window.addEventListener('storage', storage);
    window.addEventListener('own-masters-session-expired', expired);
    return () => {
      active = false;
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', storage);
      window.removeEventListener('own-masters-session-expired', expired);
    };
  }, [sessionCheck]);
  const value: AuthContextValue = {
    user,
    loading,
    sessionError,
    retrySession: () => setSessionCheck((value) => value + 1),
    async signUp(input) {
      generation.current++;
      const result = await accountRequest<{
        needsEmailConfirmation: boolean;
        emailSent: boolean;
      }>('signup', {
        name: input.name.trim(),
        email: input.email.trim(),
        password: input.password,
        returnTo: input.returnTo,
      });
      return { emailSent: result.emailSent };
    },
    async signIn(input) {
      generation.current++;
      const result = await accountRequest<{ user: AppUser }>('login', {
        email: input.email.trim(),
        password: input.password,
      });
      acceptUser(result.user);
    },
    async signOut() {
      await accountRequest('logout', {});
      acceptUser(null);
    },
    async requestPasswordReset(email) {
      await accountRequest('forgot-password', { email: email.trim() });
    },
    async resendConfirmation(email, returnTo) {
      await accountRequest('resend-confirmation', {
        email: email.trim(),
        returnTo,
      });
    },
    async confirmEmail(token) {
      const result = await accountRequest<{ returnTo: string }>(
        'confirm-email',
        { token },
      );
      acceptUser(null);
      return result;
    },
    async updatePassword(password, token) {
      await accountRequest('reset-password', { password, token });
      acceptUser(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
