/**
 * /api/compute-staffing-analysis
 *
 * Runs every 15 min. Uses the canonical calculateStaffingAnalysis() from
 * _staffing-analysis.js — the exact same function used by the forecast email
 * and the dashboard — to compute and save staffing_analysis for all centres.
 *
 * Writes both all-day and present_* columns. All-day is only written if not
 * already locked today (allday_locked_at set). present_* always updated.
 *
 * Query params:
 *   date      - YYYY-MM-DD (default: today Sydney)
 *   forcelock - "1" to overwrite locked all-day (admin only)
 */

import { CENTRES } from './_centres.js';
import { calculateStaffingAnalysis } from './_staffing-analysis.js';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = proces…_KEY || 'eyJhbG…6f1c';
const CRON_SECRET  = proces…CRET || '';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}

function nowSydneyMins() {
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
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${t}`);
  return JSON.parse(t);
}

async function sbUpsert(table, row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
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
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date          = req.query.date || todaySydney();
  const forcelock     = req.query.forcelock === '1';
  const host          = req.headers.host || 'plan.tga.edu.au';
  const proto         = req.headers['x-forwarded-proto'] || 'https';
  const currentHHMM   = nowHHMM();
  const currentMins   = nowSydneyMins();
  const results       = { date, success: [], failed: [], skipped: [] };

  try {
    // ── 1. Fetch all rosters + attendance + z-casuals in parallel ─────────────
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

    // ── 2. Fetch all attendance paginated ─────────────────────────────────────
    const allAttendance = [];
    {
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const page = await sbGet(
          `attendance_daily?date=eq.${date}` +
          `&select=campus,room,age,sign_in,sign_out,predicted_sign_out` +
          `&order=campus,room&limit=${PAGE}&offset=${offset}`
        );
        if (!Array.isArray(page) || page.length === 0) break;
        allAttendance.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }
    }

    // Group attendance by campus
    const attByCampus = {};
    for (const a of allAttendance) {
      if (!a.sign_in) continue;
      (attByCampus[a.campus] ??= []).push({
        room:               a.room,
        age:                a.age,
        ageMonths:          null, // calculateStaffingAnalysis will call parseAgeMonths internally
        sign_in:            a.sign_in,
        sign_out:           a.sign_out,
        predicted_sign_out: a.predicted_sign_out,
      });
    }

    // ── 3. Check existing locks ───────────────────────────────────────────────
    const existingLocks = {};
    const lockRows = await sbGet(`staffing_analysis?date=eq.${date}&select=centre_id,allday_locked_at`);
    for (const r of lockRows) existingLocks[r.centre_id] = r.allday_locked_at;

    // ── 4. Process each centre ────────────────────────────────────────────────
    for (const centre of CENTRES) {
      try {
        const campus    = centre.ownaName ?? centre.name;
        const children  = attByCampus[campus] ?? [];

        if (children.length === 0) {
          results.skipped.push({ centreId: centre.id, reason: 'no attendance data' });
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

        const zCasuals        = zByCentre[centre.name] || [];
        const zCasualFloatCount = zCasuals.length;

        // ── All-day calculation (showCurrentOnly=false) ───────────────────────
        const allDay = calculateStaffingAnalysis({
          centre,
          date,
          children,
          rosters:          centreRosters,
          zCasualFloatCount,
          showCurrentOnly:  false,
        });

        // ── Present calculation (showCurrentOnly=true) ────────────────────────
        const present = calculateStaffingAnalysis({
          centre,
          date,
          children,
          rosters:          centreRosters,
          zCasualFloatCount,
          showCurrentOnly:  true,
          currentTimeMins:  currentMins,
        });

        // ── Write to Supabase ─────────────────────────────────────────────────
        const alreadyLocked = !!existingLocks[centre.id];
        const writeAllDay   = !alreadyLocked || forcelock;
        const now           = new Date().toISOString();

        const row = {
          centre_id:                      centre.id,
          campus,
          date,
          computed_at:                    now,
          // Present — always updated
          present_surplus_val:            present.surplusVal,
          present_casuals_needed:         present.casualsNeeded,
          present_float_surplus:          present.floatSurplus,
          present_total_floaters_needed:  present.totalFloatersNeeded,
          present_effective_float_count:  present.effectiveFloatCount ?? (present.floatCount + present.roomNetSurplus),
          present_room_net_surplus:       present.roomNetSurplus,
          present_children_count:         present.expectedChildren,
          present_required_staff:         present.requiredStaff,
          present_computed_at:            now,
        };

        // All-day — only written if not yet locked
        if (writeAllDay) {
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
            data: JSON.stringify({
              shortageRooms: allDay.shortageRooms,
              surplusRooms:  allDay.surplusRooms,
            }),
          });
        }

        await sbUpsert('staffing_analysis', row);

        results.success.push({
          centreId:       centre.id,
          allDaySurplus:  writeAllDay ? Math.round(allDay.surplusVal * 100) / 100 : '(locked)',
          presentSurplus: Math.round(present.surplusVal * 100) / 100,
          allDayKids:     allDay.expectedChildren,
          presentKids:    present.expectedChildren,
          locked:         alreadyLocked && !forcelock,
        });
      } catch (err) {
        console.error(`[compute-staffing-analysis] ${centre.id}:`, err.message);
        results.failed.push({ centreId: centre.id, error: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      date,
      currentTime: currentHHMM,
      summary: { success: results.success.length, failed: results.failed.length, skipped: results.skipped.length },
      ...results,
    });
  } catch (err) {
    console.error('[compute-staffing-analysis] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
