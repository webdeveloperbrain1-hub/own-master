import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { AppUser } from '../types';

interface AuthContextValue {
  user: AppUser | null;
  session: Session | null;
  loading: boolean;
  isDemo: boolean;
  signInDemo: () => void;
  signUp: (input: { name: string; email: string; password: string }) => Promise<{ needsEmailConfirmation: boolean }>;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const DEMO_USER_KEY = 'own_masters_demo_user';

function createDemoUser(): AppUser {
  return {
    id: 'demo-admin',
    app_metadata: {},
    user_metadata: { name: 'Admin Demo' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    email: 'admin@ownmasters.local',
  } as AppUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [demoUser, setDemoUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (import.meta.env.DEV && window.localStorage.getItem(DEMO_USER_KEY) === 'true') {
      setDemoUser(createDemoUser());
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }

      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: demoUser ?? session?.user ?? null,
      session,
      loading,
      isDemo: Boolean(demoUser),
      signInDemo() {
        if (!import.meta.env.DEV) {
          return;
        }

        window.localStorage.setItem(DEMO_USER_KEY, 'true');
        setDemoUser(createDemoUser());
      },
      async signUp({ name, email, password }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
          },
        });

        if (error) {
          throw error;
        }

        return { needsEmailConfirmation: !data.session };
      },
      async signIn({ email, password }) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
          throw error;
        }
      },
      async signOut() {
        if (demoUser) {
          window.localStorage.removeItem(DEMO_USER_KEY);
          setDemoUser(null);
          return;
        }

        const { error } = await supabase.auth.signOut();

        if (error) {
          throw error;
        }
      },
    }),
    [demoUser, loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
