/**
 * /api/compute-staffing-analysis
 *
 * Vercel cron — runs every 15 min during Sydney centre hours.
 * Uses calculateStaffingAnalysis() from _staffing-analysis.js (the same
 * function that mirrors the dashboard Float Pool panel exactly).
 *
 * Every run:  saves present_* columns (currently-signed-in children)
 * At 11am:    also saves all-day columns as the locked daily snapshot
 */

import { CENTRES } from './_centres.js';
import { calculateStaffingAnalysis } from './_staffing-analysis.js';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = *** || 'eyJhbG…6f1c';
const CRON_SECRET  = *** || '';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}
function sydneyHour() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return d.getHours() + d.getMinutes() / 60;
}
function sydneyMins() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return d.getHours() * 60 + d.getMinutes();
}
function nowHHMM() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${t}`);
  return JSON.parse(t);
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const date       = req.query.date || todaySydney();
  const forcelock  = req.query.forcelock === '1';
  const host       = req.headers.host || 'plan.tga.edu.au';
  const proto      = req.headers['x-forwarded-proto'] || 'https';
  const hour       = sydneyHour();
  const currentMins = sydneyMins();
  const isLockRun  = forcelock || (hour >= 11 && hour < 11.25);

  const results = { date, isLockRun, success: [], failed: [], skipped: [] };

  try {
    // 1. All rosters in one call
    const allUnitIds = [...new Set(CENTRES.flatMap(c => [
      ...c.rooms.map(r => r.deputyUnitId),
      ...(c.floatUnitIds    || []),
      ...(c.leaveUnitIds    || []),
      ...(c.nonRatioUnitIds || []),
      ...(c.issUnitIds      || []),
    ]))];

    const [rosterRes, zRes] = await Promise.all([
      fetch(`${proto}://${host}/api/deputy-rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, unitIds: allUnitIds }),
      }),
      fetch(`${proto}://${host}/api/z-casuals?centre=all&date=${date}`).catch(() => null),
    ]);

    const allRosters  = rosterRes.ok ? await rosterRes.json() : [];
    const zCasualRows = zRes?.ok ? await zRes.json() : [];
    const zByCentre   = {};
    for (const r of zCasualRows) {
      if (r.centre) (zByCentre[r.centre] ??= []).push(r);
    }

    // 2. All attendance paginated
    const allAttendance = [];
    let offset = 0;
    while (true) {
      const page = await sbGet(
        `attendance_daily?date=eq.${date}&select=campus,room,age,sign_in,sign_out,predicted_sign_out&order=campus,room&limit=1000&offset=${offset}`
      );
      if (!Array.isArray(page) || page.length === 0) break;
      allAttendance.push(...page.filter(a => a.sign_in));
      if (page.length < 1000) break;
      offset += 1000;
    }
    const byCampus = {};
    for (const a of allAttendance) (byCampus[a.campus] ??= []).push(a);

    // 3. Check existing locks
    const lockRows = await sbGet(`staffing_analysis?date=eq.${date}&select=centre_id,allday_locked_at`);
    const locks = {};
    for (const r of lockRows) locks[r.centre_id] = r.allday_locked_at;

    // 4. Process each centre
    for (const centre of CENTRES) {
      try {
        const campus   = centre.ownaName ?? centre.name;
        const children = byCampus[campus] ?? [];
        if (children.length === 0) {
          results.skipped.push({ centreId: centre.id, reason: 'no attendance' });
          continue;
        }

        const centreRosters = allRosters.filter(r => {
          const uid = r.OperationalUnit;
          return centre.rooms.some(rm => rm.deputyUnitId === uid)
            || (centre.floatUnitIds    || []).includes(uid)
            || (centre.leaveUnitIds    || []).includes(uid)
            || (centre.nonRatioUnitIds || []).includes(uid)
            || (centre.issUnitIds      || []).includes(uid);
        });

        const zCasualFloatCount = (zByCentre[centre.name] || []).length;

        // Present: only currently signed-in children
        const present = calculateStaffingAnalysis({
          centre, date, children, rosters: centreRosters,
          zCasualFloatCount, showCurrentOnly: true, currentTimeMins: currentMins,
        });

        const now = new Date().toISOString();
        const alreadyLocked = !!locks[centre.id];
        const writeAllDay   = isLockRun && !alreadyLocked;

        const row = {
          centre_id: centre.id, campus, date, computed_at: now,
          // Present — always updated
          present_surplus_val:           present.surplusVal,
          present_casuals_needed:        present.casualsNeeded,
          present_float_surplus:         present.floatSurplus,
          present_total_floaters_needed: present.totalFloatersNeeded,
          present_effective_float_count: present.floatCount + present.roomNetSurplus,
          present_room_net_surplus:      present.roomNetSurplus,
          present_children_count:        present.expectedChildren,
          present_required_staff:        present.requiredStaff,
          present_computed_at:           now,
        };

        // All-day lock — only at 11am, only if not already locked
        if (writeAllDay) {
          const allDay = calculateStaffingAnalysis({
            centre, date, children, rosters: centreRosters,
            zCasualFloatCount, showCurrentOnly: false,
          });
          Object.assign(row, {
            surplus_val:                allDay.surplusVal,
            casuals_needed:             allDay.casualsNeeded,
            float_surplus:              allDay.floatSurplus,
            total_floaters_needed:      allDay.totalFloatersNeeded,
            effective_float_count:      allDay.floatCount + allDay.roomNetSurplus,
            room_net_surplus:           allDay.roomNetSurplus,
            ad_available:               allDay.adAvailable,
            total_ratio_shortage:       allDay.totalRatioShortage,
            total_surplus:              allDay.totalSurplus,
            net_shortage_after_realloc: allDay.netShortageAfterRealloc,
            buffer_required:            allDay.bufferRequired,
            floor_staff:                allDay.floorStaff,
            required_staff:             allDay.requiredStaff,
            float_count:                allDay.floatCount,
            children_count:             allDay.expectedChildren,
            allday_locked_at:           now,
            data: JSON.stringify({ shortageRooms: allDay.shortageRooms, surplusRooms: allDay.surplusRooms }),
          });
        }

        await sbUpsert(row);

        results.success.push({
          centreId:       centre.id,
          presentSurplus: Math.round(present.surplusVal * 100) / 100,
          presentKids:    present.expectedChildren,
          allDayLocked:   writeAllDay ? 'yes — locked now' : alreadyLocked ? 'already locked' : 'not yet',
        });
      } catch (err) {
        results.failed.push({ centreId: centre.id, error: err.message });
      }
    }

    return res.status(200).json({
      ok: true, date, isLockRun, currentTime: nowHHMM(),
      summary: { success: results.success.length, failed: results.failed.length, skipped: results.skipped.length },
      ...results,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
