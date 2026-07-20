/**
 * /api/staffing-analysis
 *
 * Single source of truth for the Plan of Day Staffing Analysis surplus/deficit.
 *
 * GET  ?centre=<centreId>&date=YYYY-MM-DD
 *      Returns the stored analysis. 404 if not yet computed.
 *
 * POST { centreId, date, surplusVal, casualsNeeded, floatSurplus, ... }
 *      Upserts the analysis written by the Ratio Dashboard Float Pool panel.
 *      This is the authoritative value; all consumers read it from here.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : def;
}

async function sb(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const centreId = req.query.centre;
      const date = req.query.date;
      if (!centreId || !date) {
        return res.status(400).json({ error: 'Missing centre or date' });
      }

      const rows = await sb(
        `staffing_analysis?centre_id=eq.${encodeURIComponent(centreId)}&date=eq.${encodeURIComponent(date)}&limit=1`
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(404).json({ error: 'Not computed yet' });
      }
      return res.status(200).json({ ok: true, analysis: rows[0] });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const {
        centreId,
        campus,
        date,
        surplusVal,
        casualsNeeded,
        floatSurplus,
        totalFloatersNeeded,
        effectiveFloatCount,
        roomNetSurplus,
        adAvailable,
        totalRatioShortage,
        totalSurplus,
        netShortageAfterRealloc,
        bufferRequired,
        floorStaff,
        requiredStaff,
        floatCount,
        childrenCount,
        data = {},
      } = body;

      if (!centreId || !date) {
        return res.status(400).json({ error: 'Missing centreId or date' });
      }

      const row = {
        centre_id: centreId,
        campus: campus ?? centreId,
        date,
        surplus_val: toNum(surplusVal),
        casuals_needed: toNum(casualsNeeded),
        float_surplus: toNum(floatSurplus),
        total_floaters_needed: toNum(totalFloatersNeeded),
        effective_float_count: toNum(effectiveFloatCount),
        room_net_surplus: toNum(roomNetSurplus),
        ad_available: toInt(adAvailable),
        total_ratio_shortage: toNum(totalRatioShortage),
        total_surplus: toNum(totalSurplus),
        net_shortage_after_realloc: toNum(netShortageAfterRealloc),
        buffer_required: toNum(bufferRequired),
        floor_staff: toInt(floorStaff),
        required_staff: toInt(requiredStaff),
        float_count: toInt(floatCount),
        children_count: toInt(childrenCount),
        computed_at: new Date().toISOString(),
        data: typeof data === 'string' ? data : JSON.stringify(data),
      };

      const rows = await sb('staffing_analysis', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      });

      return res.status(200).json({ ok: true, analysis: rows?.[0] ?? row });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[staffing-analysis] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
