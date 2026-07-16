/**
 * /api/cron-ratio-check-freeze
 *
 * Nightly freeze job. After the day is done and Deputy timesheets are confirmed,
 * this copies the final actual start/end/lunch times into ratio_check_data
 * so the Educator Daily Report (and any future reports) read from Supabase
 * instead of live Deputy.
 *
 * Schedule: 0 10 * * * UTC -> 8pm AEST / 9pm AEDT
 *
 * Auth: Vercel sends Authorization: Bearer <CRON_SECRET>.
 */

import { CENTRES } from './_centres.js';
import { fetchActualTimesheets } from './_actual-timesheets.js';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const CRON_SECRET  = process.env.CRON_SECRET || '';

const SESSIONS = ['morning', 'midday', 'afternoon'];

const SB_HEADERS = {
  apikey:        SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

function getTodaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}

function addDaysSydney(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function getDayOfWeekSydney(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function getLastWeekday(dateStr) {
  let d = addDaysSydney(dateStr, -1);
  while (getDayOfWeekSydney(d) === 0 || getDayOfWeekSydney(d) === 6) {
    d = addDaysSydney(d, -1);
  }
  return d;
}

function rosterTimeToMins(t) {
  if (!t) return null;
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const sydney = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return sydney.getHours() * 60 + sydney.getMinutes();
  }
  const parts = String(t).split(':').map(Number);
  if (parts.length >= 2 && !isNaN(parts[0])) return parts[0] * 60 + (parts[1] || 0);
  return null;
}

function minsToHhmm(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return '';
  const h = Math.floor(mins / 60) % 24;
  const m = Math.max(0, Math.floor(mins % 60));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtRosterTime(t) {
  const m = rosterTimeToMins(t);
  return m === null ? '' : minsToHhmm(m);
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB_HEADERS });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase GET ${path}: ${r.status} ${txt}`);
  }
  return r.json();
}

async function sbPost(path, rows, onConflict) {
  if (!rows.length) return { count: 0 };
  let url = `${SUPABASE_URL}/rest/v1/${path}`;
  if (onConflict) url += `?on_conflict=${encodeURIComponent(onConflict)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase POST ${path}: ${r.status} ${txt.slice(0, 200)}`);
  }
  return { count: rows.length };
}

function findRosterCacheEnd(rosters, employeeId, unitId) {
  if (!Array.isArray(rosters)) return '';
  const match = rosters.find(r => r.Employee === employeeId && r.OperationalUnit === unitId);
  return fmtRosterTime(match?.EndTime);
}

function buildOverridesFromActuals(actuals, rosters) {
  const byEmp = new Map();
  for (const a of actuals) {
    if (!a.actual_start && !a.rostered_start) continue;
    const list = byEmp.get(a.employee_id) ?? [];
    list.push(a);
    byEmp.set(a.employee_id, list);
  }

  const overrides = {};
  for (const [employeeId, tss] of byEmp) {
    const sorted = [...tss].sort((a, b) =>
      String(a.actual_start || a.rostered_start || '').localeCompare(
        String(b.actual_start || b.rostered_start || '')
      )
    );

    const segments = [];
    for (const ts of sorted) {
      let start = ts.actual_start || ts.rostered_start || '';
      let end = ts.actual_end || ts.rostered_end || '';
      if (!end) {
        end = findRosterCacheEnd(rosters, employeeId, ts.unit_id);
      }
      if (!end) end = start;
      if (start) segments.push({ start, end });
    }
    if (segments.length === 0) continue;

    const allBreaks = tss.flatMap(ts => ts.breaks || []);
    const meal = allBreaks.find(
      b => b.type === 'meal' && (b.status === 'finished' || b.status === 'in_progress')
    );

    const lastTs = sorted[sorted.length - 1];
    const hasActualEnd = !!lastTs && !lastTs.is_in_progress && !!lastTs.actual_end;

    overrides[employeeId] = {
      start:      segments[0].start,
      end:        segments[segments.length - 1].end,
      segments:   segments.length > 1 ? segments : undefined,
      lunchStart: meal?.breakStart || undefined,
      lunchEnd:   meal?.breakEnd   || undefined,
      source:     'deputy',
      hasActualEnd,
    };
  }
  return overrides;
}

async function fetchPersistedActuals(centre, date) {
  const unitIds = [
    ...centre.rooms.map(r => r.deputyUnitId),
    ...(centre.floatUnitIds || []),
    ...(centre.issUnitIds || []),
    ...(centre.leaveUnitIds || []),
    ...(centre.nonRatioUnitIds || []),
  ].filter(Boolean);
  if (unitIds.length === 0) return [];

  const inClause = unitIds.map(id => encodeURIComponent(id)).join(',');
  const url = `${SUPABASE_URL}/rest/v1/deputy_actual_timesheets?date=eq.${date}&unit_id=in.(${inClause})&select=*`;
  const r = await fetch(url, { headers: SB_HEADERS });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`actuals read failed: ${r.status} ${txt}`);
  }
  const rows = await r.json();
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({
    employee_id:    row.employee_id,
    employee_name:  row.employee_name,
    unit_id:        row.unit_id,
    actual_start:   row.actual_start,
    actual_end:     row.actual_end,
    rostered_start: row.rostered_start,
    rostered_end:   row.rostered_end,
    breaks:         row.breaks || [],
    is_in_progress: row.is_in_progress,
  }));
}

async function fetchRosterCache(date) {
  const rows = await sbGet(`deputy_roster_cache?date=eq.${date}&select=rosters`);
  return rows?.[0]?.rosters || [];
}

async function freezeCentreDate(centre, date) {
  const [actuals, rosters, existingRows] = await Promise.all([
    fetchPersistedActuals(centre, date),
    fetchRosterCache(date),
    sbGet(`ratio_check_data?centre_id=eq.${encodeURIComponent(centre.id)}&date=eq.${date}&select=session,data`),
  ]);

  if (actuals.length === 0) {
    return { overrides: 0, reason: 'no actuals' };
  }

  const newOverrides = buildOverridesFromActuals(actuals, rosters);
  const existingBySession = Object.fromEntries((existingRows || []).map(r => [r.session, r.data || {}]));

  let overridesWritten = 0;
  for (const session of SESSIONS) {
    const data = { ...(existingBySession[session] || {}) };
    const existingOverrides = data.staffTimeOverrides || {};
    const merged = { ...existingOverrides };

    for (const [empId, ov] of Object.entries(newOverrides)) {
      // Manual overrides are protected unless Deputy has a real sign-out time to apply.
      if (existingOverrides[empId]?.source === 'manual' && !ov.hasActualEnd) continue;
      merged[empId] = ov;
      overridesWritten += 1;
    }

    data.staffTimeOverrides = merged;
    await sbPost('ratio_check_data', [{
      centre_id:  centre.id,
      date,
      session,
      data,
      updated_at: new Date().toISOString(),
    }], 'centre_id,date,session');
  }

  return { overrides: overridesWritten };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const t0 = Date.now();
  const today = getTodaySydney();
  const targetDate = req.query.date || getLastWeekday(today);

  try {
    // Ensure the latest confirmed actuals are persisted before freezing.
    const allUnitIds = new Set();
    for (const centre of CENTRES) {
      for (const id of centre.rooms.map(r => r.deputyUnitId)) allUnitIds.add(id);
      for (const id of centre.floatUnitIds || []) allUnitIds.add(id);
      for (const id of centre.issUnitIds || []) allUnitIds.add(id);
      for (const id of centre.leaveUnitIds || []) allUnitIds.add(id);
      for (const id of centre.nonRatioUnitIds || []) allUnitIds.add(id);
    }
    await fetchActualTimesheets([...allUnitIds], targetDate, { persist: true });

    const results = await Promise.all(
      CENTRES.map(centre =>
        freezeCentreDate(centre, targetDate)
          .then(counts => ({ centre: centre.id, ok: true, ...counts }))
          .catch(err => {
            console.error(`[ratio-check-freeze] ${centre.id} ${targetDate} failed:`, err.message);
            return { centre: centre.id, ok: false, error: err.message };
          })
      )
    );

    const okCount = results.filter(r => r.ok).length;
    const totalOverrides = results.reduce((s, r) => s + (r.overrides || 0), 0);
    const ms = Date.now() - t0;
    console.log(`[ratio-check-freeze] ${targetDate} ${okCount}/${CENTRES.length} centres, ${totalOverrides} overrides, ${ms}ms`);

    return res.status(200).json({
      ok: true,
      date: targetDate,
      centres: results,
      totalOverrides,
      ms,
    });
  } catch (err) {
    console.error('[ratio-check-freeze] FATAL:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
