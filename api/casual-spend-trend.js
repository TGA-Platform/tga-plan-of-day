/**
 * /api/casual-spend-trend
 *
 * Returns weekly external (Z) casual spend for the last ~3 months.
 * Default aggregation is across all centres for the trend chart.
 * Pass ?groupBy=centre to also get totals broken down by centre.
 *
 * Query params:
 *   weeks   - number of weeks to return (default 13, ~3 months)
 *   groupBy - 'centre' to return per-centre totals instead of weekly buckets
 *
 * Response (default):
 * [
 *   { weekStart: '2026-04-21', weekStartLabel: '21 Apr', totalCents: 123450, totalDollars: 1234.50 },
 *   ...
 * ]
 *
 * Response (?groupBy=centre):
 * [
 *   { centre: 'Edgeworth', totalCents: 123450, totalDollars: 1234.50 },
 *   ...
 * ]
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

function getSydneyDateString(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday = 1, Sunday = 0 -> go back 6
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const weeks = Math.min(52, Math.max(4, parseInt(req.query.weeks || '13', 10)));
  const groupBy = req.query.groupBy === 'centre' ? 'centre' : null;

  const now = new Date();
  const nowMonday = getMonday(now);
  const endDate = getSydneyDateString(nowMonday);
  const start = new Date(nowMonday);
  start.setDate(start.getDate() - ((weeks - 1) * 7));
  const startDate = getSydneyDateString(start);

  try {
    const select = groupBy === 'centre' ? 'centre,cost_cents' : 'date,cost_cents';
    const url = `${SUPABASE_URL}/rest/v1/z_casuals?date=gte.${startDate}&date=lte.${endDate}&select=${select}`;
    const r = await fetch(url, {
      headers: {
        apikey:        SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: txt });
    }
    const rows = await r.json();
    if (!Array.isArray(rows)) return res.status(200).json([]);

    if (groupBy === 'centre') {
      const byCentre = new Map();
      for (const row of rows) {
        const centre = row.centre;
        const cents = row.cost_cents || 0;
        if (!centre) continue;
        byCentre.set(centre, (byCentre.get(centre) || 0) + cents);
      }
      const result = [];
      for (const [centre, totalCents] of byCentre) {
        result.push({
          centre,
          totalCents,
          totalDollars: Math.round(totalCents) / 100,
        });
      }
      result.sort((a, b) => b.totalCents - a.totalCents);
      return res.status(200).json(result);
    }

    // Build empty week buckets
    const buckets = new Map();
    const labels = new Map();
    for (let i = 0; i < weeks; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + (i * 7));
      const mon = getMonday(d);
      const key = getSydneyDateString(mon);
      buckets.set(key, 0);
      labels.set(key, mon.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }));
    }

    for (const row of rows) {
      if (!row.date || !row.cost_cents) continue;
      const d = new Date(row.date + 'T00:00:00+10:00');
      const mon = getMonday(d);
      const key = getSydneyDateString(mon);
      if (buckets.has(key)) {
        buckets.set(key, buckets.get(key) + row.cost_cents);
      }
    }

    const result = [];
    for (const [key, totalCents] of buckets) {
      result.push({
        weekStart:       key,
        weekStartLabel:  labels.get(key),
        totalCents,
        totalDollars:    Math.round(totalCents) / 100,
      });
    }

    result.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
