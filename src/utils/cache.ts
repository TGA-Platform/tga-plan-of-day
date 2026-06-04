/**
 * Simple module-level in-memory cache.
 * Survives React component unmount/remount within the same tab session.
 * Cleared on hard refresh or tab close.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.data as T;
}

export function setCached<T>(key: string, data: T, ttlMs = 5 * 60 * 1000): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function bustCache(prefix?: string): void {
  if (!prefix) { store.clear(); return; }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Wrap an async fetch with cache-aside. */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 5 * 60 * 1000,
): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== null) return hit;
  const data = await fetcher();
  setCached(key, data, ttlMs);
  return data;
}
