import { USERS, PASSWORDS, CENTRES } from './config';
import type { User } from './types';
import type { Centre } from './types';

const AUTH_KEY    = 'tga_pod_user';
const ACCESS_KEY  = 'tga_pod_access'; // cache of user_settings from Supabase

export async function loginAsync(email: string, password: string): Promise<User | null> {
  // Try Supabase users first, fall back to config
  try {
    const em = email.toLowerCase().trim();
    const r = await fetch('/api/user-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: em, password }),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.user) {
        localStorage.setItem(AUTH_KEY, JSON.stringify(data.user));
        return data.user as User;
      }
    }
  } catch { /* offline or table not set up — fall through */ }
  // Config fallback
  return login(email, password);
}

export function login(email: string, password: string): User | null {
  const user = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return null;
  if (PASSWORDS[user.email] !== password) return null;
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  return user;
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}

export function getUser(): User | null {
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as User;
  } catch {
    return null;
  }
}

/** Fetch user settings — localStorage primary, Supabase backup. */
export async function refreshAccessCache(): Promise<void> {
  try {
    const r = await fetch('/api/user-settings');
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        const map: Record<string, string[]> = {};
        for (const row of data as { email: string; allowed_centre_ids: string[] }[]) {
          map[row.email.toLowerCase()] = row.allowed_centre_ids;
        }
        // Merge remote into local (remote wins per key)
        const local: Record<string, string[]> = (() => {
          try { return JSON.parse(localStorage.getItem(ACCESS_KEY) ?? '{}'); } catch { return {}; }
        })();
        localStorage.setItem(ACCESS_KEY, JSON.stringify({ ...local, ...map }));
      }
    }
  } catch { /* offline or table not yet created — local cache is fine */ }
}

/** Returns the list of Centre objects the current user is allowed to see. */
export function getAllowedCentres(user: User): Centre[] {
  try {
    const cached = localStorage.getItem(ACCESS_KEY);
    const map: Record<string, string[]> = cached ? JSON.parse(cached) : {};
    const overrides = map[user.email.toLowerCase()];
    // Explicit overrides take priority
    if (overrides && overrides.length > 0) {
      if (overrides.includes('*')) return CENTRES;
      return CENTRES.filter(c => overrides.includes(c.id));
    }
  } catch { /* ignore */ }
  // Fallback: admin/ceo sees all, area_manager sees all (until centres assigned), directors see their own
  if (user.role === 'admin' || user.role === 'ceo') return CENTRES;
  if (user.role === 'area_manager') return CENTRES; // will be restricted by access map once assigned
  return CENTRES.filter(c => c.id === user.centreId);
}

/** Save user settings — always writes to localStorage, tries Supabase too. */
export async function saveUserAccess(email: string, centreIds: string[]): Promise<void> {
  // Always persist locally first (works offline / before table exists)
  const map: Record<string, string[]> = (() => {
    try { return JSON.parse(localStorage.getItem(ACCESS_KEY) ?? '{}'); } catch { return {}; }
  })();
  map[email.toLowerCase()] = centreIds;
  localStorage.setItem(ACCESS_KEY, JSON.stringify(map));

  // Try Supabase async (fire-and-forget)
  fetch('/api/user-settings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, allowed_centre_ids: centreIds }),
  }).catch(() => {/* table may not exist yet */});
}
