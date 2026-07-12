/**
 * Compare external (Z) casual spend by centre for a selected period vs the
 * immediately preceding period of the same length.
 *
 * Query params:
 *   from     - start date (YYYY-MM-DD) of the current period
 *   to       - end date (YYYY-MM-DD) of the current period
 *   centres  - comma-separated centre names to filter (optional)
 *
 * Response:
 * {
 *   current:  [{ centre: 'Edgeworth', totalCents: 123450, totalDollars: 1234.50 }, ...],
 *   previous: [{ centre: 'Edgeworth', totalCents: 100000, totalDollars: 1000.00 }, ...]
 * }
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSydneyDateString(d) {
  return d.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00+10:00');
  d.setDate(d.getDate() + days);
  return getSydneyDateString(d);
}

function durationDays(from, to) {
  const a = new Date(from + 'T00:00:00+10:00');
  const b = new Date(to + 'T00:00:00+10:00');
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

function aggregate(rows) {
  const byCentre = new Map();
  for (const row of rows) {
    const centre = row.centre;
    const cents = row.cost_cents || 0;
    if (!centre) continue;
    byCentre.set(centre, (byCentre.get(centre) || 0) + cents);
  }
  const result = [];
  for (const [centre, totalCents] of byCentre) {
    result.push({ centre, totalCents, totalDollars: Math.round(totalCents) / 100 });
  }
  result.sort((a, b) => b.totalCents - a.totalCents);
  return result;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' });

  const from = req.query.from;
  const to = req.query.to;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });

  const days = durationDays(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -days - 1);

  const centreFilter = Array.isArray(req.query.centres)
    ? req.query.centres.join(',')
    : (req.query.centres || '');

  try {
    let url = `${SUPABASE_URL}/rest/v1/z_casuals?date=gte.${prevFrom}&date=lte.${to}&select=date,centre,cost_cents`;
    if (centreFilter) {
      const list = centreFilter.split(',').map(s => s.trim()).filter(Boolean).map(encodeURIComponent).join(',');
      if (list) url += `&centre=in.(${list})`;
    }

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
    if (!Array.isArray(rows)) return res.status(200).json({ current: [], previous: [] });

    const currentRows = [];
    const previousRows = [];
    for (const row of rows) {
      if (!row.date || !row.centre) continue;
      if (row.date >= from && row.date <= to) currentRows.push(row);
      else if (row.date >= prevFrom && row.date <= prevTo) previousRows.push(row);
    }

    return res.status(200).json({
      current:  aggregate(currentRows),
      previous: aggregate(previousRows),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
