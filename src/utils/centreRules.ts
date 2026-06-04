/**
 * Centre Rules — configurable rules that apply to one or more centres.
 * Currently supports: break_window (morning_tea / lunch / afternoon_tea / custom)
 */

export type RuleType    = 'break_window';
export type BreakSubtype = 'morning_tea' | 'lunch' | 'afternoon_tea' | 'custom';

export interface CentreRule {
  id:            string;
  type:          RuleType;
  subtype:       BreakSubtype | null;
  label:         string;
  start_time:    string;   // HH:MM
  end_time:      string;   // HH:MM
  duration_mins: number;
  centre_ids:    string[]; // ['*'] = all centres
}

const LS_KEY = 'tga_pod_centre_rules';

/** Load rules: Supabase primary, localStorage fallback. */
export async function loadCentreRules(): Promise<CentreRule[]> {
  try {
    const r = await fetch('/api/centre-rules');
    if (r.ok) {
      const data: CentreRule[] = await r.json();
      if (data.length > 0) {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
        return data;
      }
    }
  } catch { /* offline */ }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as CentreRule[];
  } catch { /* ignore */ }
  return [];
}

/** Get rules that apply to a specific centre. */
export function rulesForCentre(rules: CentreRule[], centreId: string): CentreRule[] {
  return rules.filter(r => r.centre_ids.includes('*') || r.centre_ids.includes(centreId));
}

/**
 * Given a time (HH:MM), find the best matching break label from centre rules.
 * Falls back to time-based defaults if no rule matches.
 */
export function breakLabelForTime(
  startTime: string,
  centreId:  string,
  rules:     CentreRule[],
): string {
  const applicable = rulesForCentre(rules, centreId).filter(r => r.type === 'break_window');
  const [sh, sm] = startTime.split(':').map(Number);
  const startMins = sh * 60 + sm;

  for (const rule of applicable) {
    const [rsh, rsm] = rule.start_time.split(':').map(Number);
    const [reh, rem] = rule.end_time.split(':').map(Number);
    const rStart = rsh * 60 + rsm;
    const rEnd   = reh * 60 + rem;
    if (startMins >= rStart && startMins < rEnd) {
      return `${rule.label} break cover`;
    }
  }

  // Default fallback by time of day
  if (startMins < 10 * 60) return 'Morning tea break cover';
  if (startMins < 14 * 60) return 'Lunch break cover';
  return 'Afternoon tea break cover';
}

/**
 * Get the break window for a given subtype that applies to this centre.
 * Returns { start, end } in HH:MM or null if not configured.
 */
export function getBreakWindow(
  subtype:  BreakSubtype,
  centreId: string,
  rules:    CentreRule[],
): { start: string; end: string; durationMins: number } | null {
  const rule = rulesForCentre(rules, centreId)
    .filter(r => r.type === 'break_window' && r.subtype === subtype)[0];
  if (!rule) return null;
  return { start: rule.start_time, end: rule.end_time, durationMins: rule.duration_mins };
}

/** Save a rule to Supabase and update localStorage. */
export async function saveCentreRule(rule: Omit<CentreRule, 'id'> & { id?: string }): Promise<CentreRule | null> {
  try {
    const r = await fetch('/api/centre-rules', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(rule),
    });
    if (r.ok) {
      const saved: CentreRule = await r.json();
      const existing = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as CentreRule[];
      const updated  = rule.id
        ? existing.map(e => e.id === rule.id ? saved : e)
        : [...existing, saved];
      localStorage.setItem(LS_KEY, JSON.stringify(updated));
      return saved;
    }
  } catch { /* offline */ }
  return null;
}

/** Delete a rule from Supabase and localStorage. */
export async function deleteCentreRule(id: string): Promise<void> {
  await fetch(`/api/centre-rules?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  const existing = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as CentreRule[];
  localStorage.setItem(LS_KEY, JSON.stringify(existing.filter(r => r.id !== id)));
}
