/**
 * syncQueue.ts
 *
 * Offline-resilient save queue for Plan of Day.
 *
 * When a Supabase API call fails (network down, server error), the payload is
 * stored in localStorage under the key `pod_sync_queue`. A background retry
 * loop checks every 30 seconds and flushes any pending items once the
 * connection is restored.
 *
 * Usage:
 *   import { enqueueSave } from '../utils/syncQueue';
 *   await enqueueSave('/api/float-schedules', payload);
 *
 * The queue is also flushed on page focus (when the user returns to the tab).
 */

export interface QueueItem {
  id: string;
  endpoint: string;
  payload: unknown;
  queuedAt: string;   // ISO timestamp
  attempts: number;
  lastError?: string;
}

const QUEUE_KEY = 'pod_sync_queue';
const MAX_ATTEMPTS = 20;          // give up after ~10 minutes of retries
const RETRY_INTERVAL_MS = 30_000; // 30 seconds

// ── Queue helpers ─────────────────────────────────────────────────────────────

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(items: QueueItem[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    // Dispatch event so any listening UI can update
    window.dispatchEvent(new CustomEvent('pod-queue-changed', { detail: { count: items.length } }));
  } catch { /* storage full? ignore */ }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Flush a single item ───────────────────────────────────────────────────────

async function flushItem(item: QueueItem): Promise<boolean> {
  try {
    const r = await fetch(item.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ── Main flush loop ───────────────────────────────────────────────────────────

let flushInProgress = false;

export async function flushQueue(): Promise<void> {
  if (flushInProgress) return;
  flushInProgress = true;

  try {
    const queue = loadQueue();
    if (queue.length === 0) return;

    const remaining: QueueItem[] = [];

    for (const item of queue) {
      if (item.attempts >= MAX_ATTEMPTS) {
        // Drop it — too many failures, log to console
        console.warn('[syncQueue] Dropping item after max attempts:', item);
        continue;
      }

      const ok = await flushItem(item);
      if (ok) {
        console.log(`[syncQueue] ✅ Flushed queued save: ${item.endpoint} (queued ${item.queuedAt})`);
      } else {
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }

    saveQueue(remaining);
  } finally {
    flushInProgress = false;
  }
}

// ── Public: enqueue a save ────────────────────────────────────────────────────

/**
 * Try to POST payload to endpoint immediately.
 * If it fails (network or server error), queue it for automatic retry.
 * Returns 'saved' | 'queued' | 'failed'
 */
export async function enqueueSave(
  endpoint: string,
  payload: unknown
): Promise<'saved' | 'queued' | 'failed'> {
  // Try immediately first
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (r.ok) return 'saved';

    // Server error (4xx/5xx) — queue it
    const errText = await r.text().catch(() => `HTTP ${r.status}`);
    console.warn(`[syncQueue] Save failed (${r.status}), queuing for retry:`, errText);
  } catch (err) {
    // Network error — queue it
    console.warn('[syncQueue] Network error, queuing for retry:', err);
  }

  // Add to queue
  const item: QueueItem = {
    id: generateId(),
    endpoint,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 1,
  };

  const queue = loadQueue();
  // De-duplicate: remove any older pending item for the same endpoint+key fields
  // (e.g. same centre/date/session — latest save wins)
  const dedupeKey = deduplicationKey(endpoint, payload);
  const filtered = dedupeKey
    ? queue.filter(q => deduplicationKey(q.endpoint, q.payload) !== dedupeKey)
    : queue;

  saveQueue([...filtered, item]);
  return 'queued';
}

/** Returns a string key used to deduplicate queue items — latest save wins */
function deduplicationKey(endpoint: string, payload: unknown): string | null {
  if (typeof payload !== 'object' || !payload) return null;
  const p = payload as Record<string, unknown>;

  // float-schedules: one per centre+date+employee
  if (endpoint.includes('float-schedules') && p.centre_id && p.date && p.employee_id) {
    return `float:${p.centre_id}:${p.date}:${p.employee_id}`;
  }
  // ratio-check: one per centre+date+session
  if (endpoint.includes('ratio-check') && p.centre_id && p.date && p.session) {
    return `ratio:${p.centre_id}:${p.date}:${p.session}`;
  }
  // staff-allocations: one per centre+date
  if (endpoint.includes('staff-allocations') && p.centre_id && p.date) {
    return `alloc:${p.centre_id}:${p.date}`;
  }
  // lunch-schedules: one per centre+date
  if (endpoint.includes('lunch-schedules') && p.centre_id && p.date) {
    return `lunch:${p.centre_id}:${p.date}`;
  }
  return null;
}

/** How many items are currently pending in the queue */
export function getPendingCount(): number {
  return loadQueue().length;
}

// ── Background retry + page-focus flush ──────────────────────────────────────

let retryTimer: ReturnType<typeof setInterval> | null = null;

export function startSyncQueue(): void {
  if (typeof window === 'undefined') return;

  // Flush on page focus
  window.addEventListener('focus', () => flushQueue());
  window.addEventListener('online', () => flushQueue());

  // Periodic retry every 30 seconds
  if (!retryTimer) {
    retryTimer = setInterval(flushQueue, RETRY_INTERVAL_MS);
  }

  // Flush immediately on start (catch anything from a previous session)
  flushQueue();
}
