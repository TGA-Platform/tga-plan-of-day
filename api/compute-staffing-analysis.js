/**
 * /api/compute-staffing-analysis
 *
 * Vercel cron - runs every 15 min during Sydney centre hours.
 * Calls /api/morning-briefing (matches dashboard exactly) and saves
 * surplusVal to staffing_analysis in Supabase.
 *
 * Every run: saves present_surplus_val
 * At 11am:   also saves surplus_val + allday_locked_at
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';
const CRON_SECRET  = process.env.CRON_SECRET || '';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}
function sydneyHour() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return d.getHours() + d.getMinutes() / 60;
}

async function sbUpsert(row) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/staffing_analysis', {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('Supabase upsert ' + r.status + ': ' + await r.text());
}

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
  });
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase GET ' + r.status + ': ' + t);
  return JSON.parse(t);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const date      = req.query.date || todaySydney();
  const forcelock = req.query.forcelock === '1';
  const hour      = sydneyHour();
  const isLockRun = forcelock || (hour >= 11 && hour < 11.25);
  const results   = { date, isLockRun, success: [], failed: [], skipped: [] };

  try {
    // 1. Get surplus/deficit for all centres from morning-briefing
    const mbRes = await fetch('https://plan.tga.edu.au/api/morning-briefing?date=' + date);
    if (!mbRes.ok) throw new Error('morning-briefing failed: ' + mbRes.status);
    const centres = await mbRes.json();

    // 2. Check existing locks
    const lockRows = await sbGet('staffing_analysis?date=eq.' + date + '&select=centre_id,allday_locked_at');
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
          centreId:       centre.centreId,
          presentSurplus: Math.round(centre.surplusVal * 100) / 100,
          allDayLocked:   writeAllDay ? 'locked now' : alreadyLocked ? 'already locked' : 'not yet',
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