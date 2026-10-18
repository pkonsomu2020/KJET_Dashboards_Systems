import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:4000';

const EMAIL_DOMAIN = '@kjet.local';

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

// ── Fetch helpers ─────────────────────────────────────────────
async function fetchSession(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/get-session`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as SessionResponse | null;
      if (body?.user) return body.user;
    }
  } catch {
    // Backend unreachable: treated as signed out. The server is the only source of truth.
  }
  return null;
}

async function signIn(username: string, password: string): Promise<AuthUser> {
  const email = username.includes('@') ? username : `${username.toLowerCase()}${EMAIL_DOMAIN}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('Cannot reach the server. Please try again.');
  }
  const body = (await res.json().catch(() => ({}))) as AuthResponseBody;
  if (!res.ok || !body.user) throw new Error('Invalid username or password');
  return body.user;
}

async function signOut(): Promise<void> {
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


