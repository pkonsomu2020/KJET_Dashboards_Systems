import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:4000';

const VALID_USERNAME = 'LeadedgeConsults';
const VALID_PASSWORD = 'Leadedge@2026';
const AUTH_EMAIL     = 'leadedgeconsults@kjet.local';
const STORAGE_KEY    = 'kjet-auth-user';

// ── Types ─────────────────────────────────────────────────────
export interface AuthUser {
  id:            string;
  name:          string;
  email:         string;
  emailVerified: boolean;
  image:         string | null;
  createdAt:     string;
}

interface SessionResponse {
  user:    AuthUser;
  session: { id: string; expiresAt: string; token: string };
}

interface AuthResponseBody {
  error?:   string;
  message?: string;
  user?:    AuthUser;
}

function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function setStoredUser(user: AuthUser | null) {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

// ── Fetch helpers ─────────────────────────────────────────────
async function fetchSession(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/get-session`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as SessionResponse | null;
      if (body?.user) {
        setStoredUser(body.user);
        return body.user;
      }
    }
  } catch {
    // Fall back to local session if backend auth endpoint is unreachable
  }
  return getStoredUser();
}

async function signIn(username: string, password: string): Promise<AuthUser> {
  if (username !== VALID_USERNAME || password !== VALID_PASSWORD) {
    throw new Error('Invalid username or password');
  }

  const fallbackUser: AuthUser = {
    id:            'leadedge-consults',
    name:          VALID_USERNAME,
    email:         AUTH_EMAIL,
    emailVerified: true,
    image:         null,
    createdAt:     new Date().toISOString(),
  };

  try {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ email: AUTH_EMAIL, password }),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as AuthResponseBody;
      if (body.user) {
        setStoredUser(body.user);
        return body.user;
      }
    }
  } catch {
    // Backend unavailable; proceed with verified local session
  }

  setStoredUser(fallbackUser);
  return fallbackUser;
}

async function signOut(): Promise<void> {
  setStoredUser(null);
  try {
    await fetch(`${BASE}/api/auth/sign-out`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
    });
  } catch {
    // Ignore network error on sign-out
  }
}

// ── Hooks ──────────────────────────────────────────────────────

/** Returns the current authenticated user, or null if not signed in. */
export function useSession() {
  return useQuery({
    queryKey:  ['auth', 'session'],
    queryFn:   fetchSession,
    staleTime: 5 * 60 * 1000,   // re-check every 5 min
    retry:     false,
  });
}

/** Sign in with username + password. */
export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      signIn(username, password),
    onSuccess: (user) => {
      queryClient.setQueryData(['auth', 'session'], user);
      queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });
}

/** Sign out and clear session. */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'session'], null);
      queryClient.clear();
    },
  });
}


