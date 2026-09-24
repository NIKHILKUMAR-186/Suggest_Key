import { isSupabaseConfigured, supabase } from './supabase';

const DEMO_AUTH_STORAGE_KEY = 'suggestkey_demo_auth';

export async function getApiAuthorization(): Promise<string | null> {
  try {
    const demoAuth = localStorage.getItem(DEMO_AUTH_STORAGE_KEY);
    if (demoAuth) {
      const parsed = JSON.parse(demoAuth) as { token?: unknown };
      if (typeof parsed.token === 'string' && parsed.token.trim()) {
        return parsed.token.trim();
      }
    }
  } catch {
  }

  if (!isSupabaseConfigured()) return null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) {
    const authorization = await getApiAuthorization();
    if (authorization) headers.set('Authorization', `Bearer ${authorization}`);
  }

  return fetch(input, { ...init, headers });
}
