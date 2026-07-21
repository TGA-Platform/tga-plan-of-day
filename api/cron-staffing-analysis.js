/**
 * /api/cron-staffing-analysis
 *
 * Runs every 15 min during Sydney centre hours (UTC 20:00-09:59).
 *
 * Two writes per run:
 *   1. PRESENT (always) — recalculates surplus/deficit from children currently
 *      signed in right now. Stored in present_* columns. Used by "Currently
 *      Present" view on dashboard cards and morning briefing.
 *
 *   2. ALL-DAY LOCK (11am Sydney only, once per day) — snapshot of all-day
 *      attendance at 11am. Stored in surplus_val / casuals_needed etc. (the
 *      primary columns). This is the stable figure used for the all-day view
 *      and the staffing forecast email. Once locked it is NOT overwritten for
 *      the rest of the day (unless a director saves from the Ratio Dashboard,
 *      which always takes priority).
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

import { CENTRES } from './_centres.js';

const SUPABASE_URL = process.env.SUPABASE_URL      || 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const CRON_SECRET  = process.env.CRON_SECRET || '';

// ------- helpers -------------------------------------------------------

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}

function nowSydneyHour() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return d.getHours() + d.getMinutes() / 60; // e.g. 11.25 = 11:15am
}

function nowHHMM() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function parseAgeMonths(ageStr) {
  if (!ageStr) return -1;
  const m = String(ageStr).match(/(\d+)\s*yr.*?(\d+)?\s*m/i);
  if (m) return parseInt(m[1]) * 12 + (parseInt(m[2]) || 0);
  const yr = String(ageStr).match(/^(\d+)/);
  if (yr) return parseInt(yr[1]) * 12;
  return -1;
}

// Mirror calcRequiredStaff from ratioEngine.ts (with cascade)
function calcRequired(ageMonths) {
  const valid = ageMonths.filter(a => a >= 0);
  if (valid.length === 0) return 0;
  const groups = [
    { min: 0,  max: 24,       ratio: 4  },
    { min: 24, max: 36,       ratio: 5  },
    { min: 36, max: Infinity, ratio: 10 },
  ];
  let staff = 0;
  let carryover = 0;
  for (const group of groups) {
    const count = valid.filter(a => a >= group.min && a < group.max).length;
    if (count === 0) continue;
    const covered = Math.min(count, carryover);
    const stillNeeded = count - covered;
    const newStaff = Math.ceil(stillNeeded / group.ratio);
    staff += newStaff;
    carryover = newStaff * group.ratio - stillNeeded + (carryover - covered);
  }
  return Math.max(staff, 0);
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

// Only count floats whose shift overlaps 10am-1:30pm core window
function isEffectiveFloat(startTime, endTime) {
  const s = rosterTimeToMins(startTime);
  const e = rosterTimeToMins(endTime);
  if (s === null || e === null) return true;
  return e > (10 * 60) && s < (13 * 60 + 30);
}

/**
 * Core calculation: given an attendance set (all-day or present-only),
 * compute the float pool surplus/deficit for a centre.
 */
function calcFloatPool(centre, attendanceSet, centreRosters, floatCount, adCount) {
  const campus = centre.ownaName ?? centre.name;
  const childrenCount = attendanceSet.length;

  const shortageRooms = [];
  const surplusRooms  = [];
  let totalRequired        = 0;
  let totalFloorStaff      = 0;
  let totalRatioShortage   = 0;
  let totalSurplus         = 0;

  for (const room of centre.rooms) {
    const owna = (room.ownaRoomName ?? '').toLowerCase();
    const roomKids = attendanceSet
      .filter(a => owna && a.room && a.room.toLowerCase().includes(owna))
      .map(a => parseAgeMonths(a.age));
    const required   = calcRequired(roomKids);
    const staffCount = centreRosters.filter(r => r.OperationalUnit === room.deputyUnitId).length;

    totalRequired   += required;
    totalFloorStaff += staffCount;

    const shortage = required - staffCount;
    if (shortage > 0) {
      totalRatioShortage += shortage;
      shortageRooms.push({ name: room.name, shortage });
    } else if (shortage < 0) {
      totalSurplus += Math.abs(shortage);
      surplusRooms.push({ name: room.name, surplus: Math.abs(shortage) });
    }
  }

  const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
  const bufferRequired          = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;
  const roomNetSurplus          = Math.max(0, totalSurplus - totalRatioShortage);
  const effectiveFloatCount     = floatCount + roomNetSurplus;
  const adAvailable             = (childrenCount > 0 && childrenCount < 100) ? adCount : 0;
  const totalFloatersNeeded     = Math.max(0, netShortageAfterRealloc + bufferRequired);
  const casualsNeeded           = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);
  const floatSurplus            = casualsNeeded <= 0
    ? (effectiveFloatCount + adAvailable - totalFloatersNeeded) : 0;
  const surplusVal              = casualsNeeded > 0 ? -casualsNeeded : floatSurplus;

  return {
    surplusVal, casualsNeeded, floatSurplus,
    totalFloatersNeeded, effectiveFloatCount, roomNetSurplus,
    adAvailable, totalRatioShortage, totalSurplus,
    netShortageAfterRealloc, bufferRequired,
    floorStaff: totalFloorStaff, requiredStaff: totalRequired,
    floatCount, childrenCount,
    shortageRooms, surplusRooms,
  };
}

// ------- main handler --------------------------------------------------

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const date       = req.query.date || todaySydney();
  const host       = req.headers.host || 'plan.tga.edu.au';
  const proto      = req.headers['x-forwarded-proto'] || 'https';
  const sydHour    = nowSydneyHour();
  const currentHHMM = nowHHMM();

  // Is this the 11am lock run? Lock fires between 11:00 and 11:14 Sydney time.
  const isLockRun  = sydHour >= 11 && sydHour < 11.25;

  // Fetch existing rows to check if all-day is already locked today
  let existingLocks = {};
  try {
    const rows = await sb(`staffing_analysis?date=eq.${date}&select=centre_id,allday_locked_at`);
    for (const r of (rows || [])) {
      existingLocks[r.centre_id] = r.allday_locked_at;
    }
  } catch (e) {
    console.warn('[cron-staffing-analysis] Could not fetch existing locks:', e.message);
  }

  const results = { date, isLockRun, success: [], failed: [], skipped: [] };

  try {
    // Fetch rosters for all centres in one call
    const allUnitIds = [...new Set(CENTRES.flatMap(c => [
      ...c.rooms.map(r => r.deputyUnitId),
      ...(c.floatUnitIds    || []),
      ...(c.leaveUnitIds    || []),
      ...(c.nonRatioUnitIds || []),
      ...(c.issUnitIds      || []),
    ]))];

    const [rosterRes, zCasualRes] = await Promise.all([
      fetch(`${proto}://${host}/api/deputy-rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, unitIds: allUnitIds }),
      }),
      fetch(`${proto}://${host}/api/z-casuals?centre=all&date=${date}`).catch(() => null),
    ]);

    const allRosters   = rosterRes.ok ? await rosterRes.json() : [];
    const zCasualRows  = zCasualRes?.ok ? await zCasualRes.json() : [];

    const zCasualByCentre = {};
    for (const row of zCasualRows) {
      const key = row.centre || row.name;
      if (key) (zCasualByCentre[key] ??= []).push(row);
    }

    // Fetch ALL attendance for today in one paginated sweep
    const allAttendance = [];
    {
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const page = await sb(
          `attendance_daily?date=eq.${date}&select=campus,room,age,sign_in,sign_out,predicted_sign_out` +
          `&order=campus,room&limit=${PAGE}&offset=${offset}`
        );
        if (!Array.isArray(page) || page.length === 0) break;
        allAttendance.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }
    }

    // Split into all-day (signed in at any point) vs present (currently signed in)
    const allDayByCampus    = {};
    const presentByCampus   = {};

    for (const a of allAttendance) {
      if (!a.sign_in) continue;
      (allDayByCampus[a.campus] ??= []).push(a);

      // Present = signed in AND not yet signed out AND predicted departure hasn't passed
      const departed = a.sign_out || (a.predicted_sign_out && a.predicted_sign_out <= currentHHMM);
      if (!departed) (presentByCampus[a.campus] ??= []).push(a);
    }

    // Process each centre
    for (const centre of CENTRES) {
      try {
        const campus = centre.ownaName ?? centre.name;

        const floatSet    = new Set(centre.floatUnitIds    || []);
        const leaveSet    = new Set(centre.leaveUnitIds    || []);
        const nonRatioSet = new Set(centre.nonRatioUnitIds || []);
        const issSet      = new Set(centre.issUnitIds      || []);

        const centreRosters = allRosters.filter(r => {
          const uid = r.OperationalUnit;
          return centre.rooms.some(rm => rm.deputyUnitId === uid)
            || floatSet.has(uid) || leaveSet.has(uid)
            || nonRatioSet.has(uid) || issSet.has(uid);
        });

        // Float count (effective — overlaps core window, not split-shift)
        const zCasuals = zCasualByCentre[centre.name] || [];
        const internalFloatCount = centreRosters.filter(r =>
          floatSet.has(r.OperationalUnit) &&
          !r.isSplitShift &&
          isEffectiveFloat(r.StartTime, r.EndTime)
        ).length;
        const zCasualFloatCount = zCasuals.filter(z =>
          isEffectiveFloat(z.start_time, z.end_time)
        ).length;
        const floatCount = internalFloatCount + zCasualFloatCount;

        // AD staff count
        const adCount = centreRosters.filter(r => {
          if (!nonRatioSet.has(r.OperationalUnit)) return false;
          const un = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '').toLowerCase();
          return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
        }).length;

        const presentAtt = presentByCampus[campus] ?? [];
        const allDayAtt  = allDayByCampus[campus]  ?? [];

        // Always skip if no data at all
        if (allDayAtt.length === 0 && presentAtt.length === 0) {
          results.skipped.push({ centreId: centre.id, reason: 'no attendance data' });
          continue;
        }

        // --- 1. PRESENT calculation (always run) ---
        const presentCalc = calcFloatPool(centre, presentAtt, centreRosters, floatCount, adCount);

        // --- 2. ALL-DAY LOCK calculation (only at 11am if not yet locked today) ---
        const alreadyLocked = !!existingLocks[centre.id];
        const shouldLock    = isLockRun && !alreadyLocked;
        let allDayCalc      = null;
        if (shouldLock) {
          allDayCalc = calcFloatPool(centre, allDayAtt, centreRosters, floatCount, adCount);
        }

        const now = new Date().toISOString();

        // Build upsert row — always update present_* columns
        const row = {
          centre_id:              centre.id,
          campus,
          date,
          // present_* columns — updated every run
          present_surplus_val:            presentCalc.surplusVal,
          present_casuals_needed:         presentCalc.casualsNeeded,
          present_float_surplus:          presentCalc.floatSurplus,
          present_total_floaters_needed:  presentCalc.totalFloatersNeeded,
          present_effective_float_count:  presentCalc.effectiveFloatCount,
          present_room_net_surplus:       presentCalc.roomNetSurplus,
          present_children_count:         presentCalc.childrenCount,
          present_required_staff:         presentCalc.requiredStaff,
          present_computed_at:            now,
          computed_at:                    now,
        };

        // all-day lock columns — only written at 11am and not yet locked
        if (shouldLock && allDayCalc) {
          row.surplus_val               = allDayCalc.surplusVal;
          row.casuals_needed            = allDayCalc.casualsNeeded;
          row.float_surplus             = allDayCalc.floatSurplus;
          row.total_floaters_needed     = allDayCalc.totalFloatersNeeded;
          row.effective_float_count     = allDayCalc.effectiveFloatCount;
          row.room_net_surplus          = allDayCalc.roomNetSurplus;
          row.ad_available              = allDayCalc.adAvailable;
          row.total_ratio_shortage      = allDayCalc.totalRatioShortage;
          row.total_surplus             = allDayCalc.totalSurplus;
          row.net_shortage_after_realloc= allDayCalc.netShortageAfterRealloc;
          row.buffer_required           = allDayCalc.bufferRequired;
          row.floor_staff               = allDayCalc.floorStaff;
          row.required_staff            = allDayCalc.requiredStaff;
          row.float_count               = allDayCalc.floatCount;
          row.children_count            = allDayCalc.childrenCount;
          row.allday_locked_at          = now;
          row.data = JSON.stringify({
            shortageRooms: allDayCalc.shortageRooms,
            surplusRooms:  allDayCalc.surplusRooms,
          });
        } else if (!alreadyLocked) {
          // Before 11am: pre-populate all-day columns with all-day calc
          // (so email/consumers have something before the lock fires)
          // but don't set allday_locked_at yet.
          const preLock = calcFloatPool(centre, allDayAtt, centreRosters, floatCount, adCount);
          row.surplus_val               = preLock.surplusVal;
          row.casuals_needed            = preLock.casualsNeeded;
          row.float_surplus             = preLock.floatSurplus;
          row.total_floaters_needed     = preLock.totalFloatersNeeded;
          row.effective_float_count     = preLock.effectiveFloatCount;
          row.room_net_surplus          = preLock.roomNetSurplus;
          row.ad_available              = preLock.adAvailable;
          row.total_ratio_shortage      = preLock.totalRatioShortage;
          row.total_surplus             = preLock.totalSurplus;
          row.net_shortage_after_realloc= preLock.netShortageAfterRealloc;
          row.buffer_required           = preLock.bufferRequired;
          row.floor_staff               = preLock.floorStaff;
          row.required_staff            = preLock.requiredStaff;
          row.float_count               = preLock.floatCount;
          row.children_count            = preLock.childrenCount;
          row.data = JSON.stringify({
            shortageRooms: preLock.shortageRooms,
            surplusRooms:  preLock.surplusRooms,
          });
        }
        // If already locked (allday_locked_at is set): do NOT touch surplus_val etc.
        // The Prefer header merge-duplicates will only update columns we include in the row.

        await sb('staffing_analysis', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(row),
        });

        results.success.push({
          centreId:       centre.id,
          presentSurplus: Math.round(presentCalc.surplusVal * 100) / 100,
          presentCasuals: Math.round(presentCalc.casualsNeeded * 100) / 100,
          presentKids:    presentCalc.childrenCount,
          locked:         shouldLock,
          alreadyLocked,
        });
      } catch (err) {
        console.error(`[cron-staffing-analysis] ${centre.id}:`, err.message);
        results.failed.push({ centreId: centre.id, error: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      date,
      isLockRun,
      sydHour: Math.round(sydHour * 100) / 100,
      summary: {
        success: results.success.length,
        failed:  results.failed.length,
        skipped: results.skipped.length,
      },
      ...results,
    });
  } catch (err) {
    console.error('[cron-staffing-analysis] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
