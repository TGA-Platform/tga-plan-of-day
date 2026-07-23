/**
 * /api/cron-surplus-snapshot
 *
 * Vercel cron job. Calls /api/morning-briefing for all centres and saves
 * the surplusVal to Supabase every 15 minutes.
 *
 * - Every 15 min: saves to present_surplus_val (live snapshot)
 * - At 11am: also saves to surplus_val (all-day lock)
 *
 * Schedule: every 15 minutes
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const CRON_SECRET = process.env.CRON_SECRET || '';

function getTodaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}

function getHourSydney() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' })).getHours();
}

async function sbPost(table, rows, onConflict) {
  if (!rows.length) return { count: 0 };
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (onConflict) url += `?on_conflict=${encodeURIComponent(onConflict)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase POST ${table}: ${r.status} ${txt.slice(0, 200)}`);
  }
  return { count: rows.length };
}

export default async function handler(req, res) {
  // Security: verify cron secret
  if (CRON_SECRET && req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const date = getTodaySydney();
    const hour = getHourSydney();
    const isLockTime = hour === 11; // 11am lock

    console.log(`[cron-surplus-snapshot] Running at ${hour}:00 Sydney time, date=${date}, lock=${isLockTime}`);

    // Call /api/morning-briefing to get surplusVal for all centres
    const host = req.headers.host || 'plan.tga.edu.au';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const briefingRes = await fetch(`${proto}://${host}/api/morning-briefing?date=${date}`, {
      headers: { 'User-Agent': 'Vercel Cron' },
    });

    if (!briefingRes.ok) {
      throw new Error(`/api/morning-briefing failed: ${briefingRes.status}`);
    }

    const briefingData = await briefingRes.json();
    if (!Array.isArray(briefingData)) {
      throw new Error(`/api/morning-briefing returned non-array: ${typeof briefingData}`);
    }

    // Convert to Supabase rows
    const rows = briefingData.map(centre => ({
      date,
      centre_id: centre.centreId,
      centre_name: centre.name,
      present_surplus_val: centre.surplusVal,
      // At 11am, also lock the all-day surplus
      ...(isLockTime && { surplus_val: centre.surplusVal }),
      fetched_at: new Date().toISOString(),
    }));

    console.log(`[cron-surplus-snapshot] Saving ${rows.length} rows`);

    // Upsert to surplus_snapshots table (on_conflict: date,centre_id)
    await sbPost('surplus_snapshots', rows, 'date,centre_id');

    console.log(`[cron-surplus-snapshot] Saved ${rows.length} rows, lock=${isLockTime}`);

    return res.status(200).json({
      ok: true,
      date,
      centres: rows.length,
      locked: isLockTime,
    });
  } catch (err) {
    console.error('[cron-surplus-snapshot] FATAL:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
