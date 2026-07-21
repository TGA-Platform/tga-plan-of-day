/**
 * /api/compute-staffing-analysis
 *
 * Vercel cron — runs every 15 min during Sydney centre hours.
 *
 * 1. Calls /api/morning-briefing (already proven to match the dashboard)
 * 2. Saves surplusVal to present_surplus_val in staffing_analysis
 * 3. At 11am, also saves to surplus_val + allday_locked_at (locked for the day)
 */

import { CENTRES } from './_centres.js';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = proces…_KEY || 'eyJhbG…6f1c';
const CRON_SECRET  = proces…CRET || '';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}
function sydneyHour() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return d.getHours() + d.getMinutes() / 60;
}

async function sbUpsert(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/staffing_analysis`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`Supabase upsert ${r.status}: ${await r.text()}`);
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${t}`);
  return JSON.parse(t);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const date      = req.query.date || todaySydney();
  const forcelock = req.query.forcelock === '1';
  const host      = req.headers.host || 'plan.tga.edu.au';
  const proto     = req.headers['x-forwarded-proto'] || 'https';
  const hour      = sydneyHour();
  const isLockRun = forcelock || (hour >= 11 && hour < 11.25);

  const results = { date, isLockRun, success: [], failed: [], skipped: [] };

  try {
    // 1. Get surplus/deficit for all centres from morning-briefing
    // Always use the canonical production host so internal fetch works on preview deployments too
    const mbHost = host.includes('vercel.app') ? 'plan.tga.edu.au' : host;
    const mbRes = await fetch(`https://${mbHost}/api/morning-briefing?date=${date}`);
    if (!mbRes.ok) throw new Error(`morning-briefing failed: ${mbRes.status}`);
    const centres = await mbRes.json();

    // 2. Check existing locks
    const lockRows = await sbGet(`staffing_analysis?date=eq.${date}&select=centre_id,allday_locked_at`);
    const locks = {};
    for (const r of lockRows) locks[r.centre_id] = r.allday_locked_at;

    // 3. Save to Supabase
    const now = new Date().toISOString();
    for (const centre of centres) {
      try {
        const alreadyLocked = !!locks[centre.centreId];
        const writeAllDay   = isLockRun && !alreadyLocked;

        const row = {
          centre_id:           centre.centreId,
          campus:              centre.campus ?? centre.name,
          date,
          computed_at:         now,
          present_surplus_val: centre.surplusVal,
          present_computed_at: now,
        };

        if (writeAllDay) {
          row.surplus_val      = centre.surplusVal;
          row.allday_locked_at = now;
        }

        await sbUpsert(row);

        results.success.push({
          centreId:      centre.centreId,
          presentSurplus: Math.round(centre.surplusVal * 100) / 100,
          allDayLocked:  writeAllDay ? 'locked now' : alreadyLocked ? 'already locked' : 'not yet',
        });
      } catch (err) {
        results.failed.push({ centreId: centre.centreId, error: err.message });
      }
    }

    return res.status(200).json({
      ok: true, date, isLockRun,
      summary: { success: results.success.length, failed: results.failed.length, skipped: results.skipped.length },
      ...results,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
