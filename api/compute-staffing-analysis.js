/**
 * /api/compute-staffing-analysis
 *
 * Server-side replication of the Ratio Dashboard Float Pool calculation.
 * Called by the cron every 15 min so surplus/deficit figures are always
 * current without directors needing to open the dashboard.
 *
 * Uses the exact same data sources and logic as the dashboard:
 *   - /api/attendance          → children (all-day + present)
 *   - /api/deputy-rosters      → rostered staff per unit
 *   - /api/z-casuals           → external casuals
 *   - ratioEngine cascade      → required staff per room
 *   - Float Pool formula       → surplus/deficit
 *
 * Writes both all-day and present_* columns to staffing_analysis.
 * All-day is only written if not already locked today (allday_locked_at set).
 * present_* is always updated.
 *
 * Query params:
 *   date       - YYYY-MM-DD (default: today Sydney)
 *   centreId   - single centre (default: all)
 *   forcelock  - "1" to overwrite even if already locked today (admin only)
 */

import { CENTRES } from './_centres.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = *** || 'eyJhbG…6f1c';
const CRON_SECRET  = *** || '';

// ─── helpers ────────────────────────────────────────────────────────────────

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
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

// ─── ratio engine (mirrors ratioEngine.ts exactly) ──────────────────────────

function parseAgeMonths(ageStr) {
  if (!ageStr) return -1;
  const yearMatch  = String(ageStr).match(/(\d+)y/);
  const monthMatch = String(ageStr).match(/(\d+)m/);
  const years  = yearMatch  ? parseInt(yearMatch[1])  : 0;
  const months = monthMatch ? parseInt(monthMatch[1]) : 0;
  if (!yearMatch && !monthMatch) {
    // Legacy format e.g. "2 yr 3 m"
    const m2 = String(ageStr).match(/(\d+)\s*yr.*?(\d+)?\s*m/i);
    if (m2) return parseInt(m2[1]) * 12 + (parseInt(m2[2]) || 0);
    const yr = String(ageStr).match(/^(\d+)/);
    if (yr) return parseInt(yr[1]) * 12;
    return -1;
  }
  return years * 12 + months;
}

const AGE_BRACKETS = [
  { minMonths: 0,  maxMonths: 24,  ratio: 4  },
  { minMonths: 24, maxMonths: 36,  ratio: 5  },
  { minMonths: 36, maxMonths: 999, ratio: 10 },
];

function calcRequiredStaff(ageMonthsArr) {
  const valid = ageMonthsArr.filter(a => a >= 0);
  let totalStaff = 0;
  let carryover  = 0;
  for (const bracket of AGE_BRACKETS) {
    const count = valid.filter(a => a >= bracket.minMonths && a < bracket.maxMonths).length;
    if (count === 0) continue;
    const coveredByCarryover = Math.min(count, carryover);
    const stillNeeded        = count - coveredByCarryover;
    const newStaff           = Math.ceil(stillNeeded / bracket.ratio);
    totalStaff += newStaff;
    carryover = (newStaff * bracket.ratio - stillNeeded) + (carryover - coveredByCarryover);
  }
  return totalStaff;
}

function roomNameMatches(childRoom, room) {
  const child = (childRoom ?? '').toLowerCase();
  if (!child) return false;
  const aliases = [room.ownaRoomName, room.name, ...(room.roomAliases ?? [])]
    .filter(Boolean).map(a => a.toLowerCase());
  return aliases.some(alias => child.includes(alias) || alias.includes(child));
}

function rosterTimeToMins(t) {
  if (!t) return null;
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const s = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return s.getHours() * 60 + s.getMinutes();
  }
  const parts = String(t).split(':').map(Number);
  if (parts.length >= 2 && !isNaN(parts[0])) return parts[0] * 60 + (parts[1] || 0);
  return null;
}

function isEffectiveFloat(startTime, endTime) {
  const s = rosterTimeToMins(startTime);
  const e = rosterTimeToMins(endTime);
  if (s === null || e === null) return true;
  return e > (10 * 60) && s < (13 * 60 + 30);
}

// ─── Float Pool calculation (mirrors FloatPoolSection in RatioDashboardPage) ─

function calcFloatPool({ roomStatuses, floatCount, adCount, childrenCount }) {
  const shortageRooms = roomStatuses.filter(r => r.shortage > 0);
  const surplusRooms  = roomStatuses.filter(r => r.shortage < 0);

  const totalRatioShortage      = shortageRooms.reduce((s, r) => s + r.shortage, 0);
  const totalSurplus            = surplusRooms.reduce((s, r)  => s + Math.abs(r.shortage), 0);
  const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
  const totalFloorStaff         = roomStatuses.reduce((s, r) => s + r.staffCount, 0);
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
    floorStaff: totalFloorStaff,
    requiredStaff: roomStatuses.reduce((s, r) => s + r.requiredStaff, 0),
    floatCount, childrenCount,
    shortageRooms: shortageRooms.map(r => ({ name: r.name, shortage: r.shortage })),
    surplusRooms:  surplusRooms.map(r => ({ name: r.name, surplus: Math.abs(r.shortage) })),
  };
}

// Build per-room status for a given attendance set — mirrors buildRoomStatus
function buildRoomStatuses(centre, attendanceSet, centreRosters) {
  return centre.rooms.map(room => {
    const roomKids = attendanceSet
      .filter(a => roomNameMatches(a.room, room))
      .map(a => parseAgeMonths(a.age));
    const requiredStaff = calcRequiredStaff(roomKids);
    const staffCount    = centreRosters.filter(r => r.OperationalUnit === room.deputyUnitId).length;
    const shortage      = requiredStaff - staffCount; // positive = short, negative = surplus
    return { name: room.name, requiredStaff, staffCount, shortage };
  });
}

// ─── main handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date       = req.query.date || todaySydney();
  const centreFilter = req.query.centreId ? req.query.centreId.split(',') : null;
  const forcelock  = req.query.forcelock === '1';
  const host       = req.headers.host || 'plan.tga.edu.au';
  const proto      = req.headers['x-forwarded-proto'] || 'https';
  const currentHHMM = nowHHMM();

  const centres = centreFilter
    ? CENTRES.filter(c => centreFilter.includes(c.id))
    : CENTRES;

  const results = { date, success: [], failed: [], skipped: [] };

  try {
    // ── 1. Fetch all attendance (paginated) ──────────────────────────────────
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

    // Split into all-day and present by campus
    const allDayByCampus    = {};
    const presentByCampus   = {};
    for (const a of allAttendance) {
      if (!a.sign_in) continue;
      (allDayByCampus[a.campus] ??= []).push(a);
      const departed = a.sign_out || (a.predicted_sign_out && a.predicted_sign_out <= currentHHMM);
      if (!departed) (presentByCampus[a.campus] ??= []).push(a);
    }

    // ── 2. Fetch all rosters in one call ─────────────────────────────────────
    const allUnitIds = [...new Set(centres.flatMap(c => [
      ...c.rooms.map(r => r.deputyUnitId),
      ...(c.floatUnitIds    || []),
      ...(c.leaveUnitIds    || []),
      ...(c.nonRatioUnitIds || []),
      ...(c.issUnitIds      || []),
    ]))];

    const rosterRes = await fetch(`${proto}://${host}/api/deputy-rosters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, unitIds: allUnitIds }),
    });
    const allRosters = rosterRes.ok ? await rosterRes.json() : [];

    // ── 3. Fetch Z Staffing external casuals ─────────────────────────────────
    const zRes = await fetch(`${proto}://${host}/api/z-casuals?centre=all&date=${date}`)
      .catch(() => null);
    const zCasualRows = zRes?.ok ? await zRes.json() : [];
    const zByCentre = {};
    for (const r of zCasualRows) {
      if (r.centre) (zByCentre[r.centre] ??= []).push(r);
    }

    // ── 4. Check existing locks ───────────────────────────────────────────────
    const existingLocks = {};
    const lockRows = await sbGet(
      `staffing_analysis?date=eq.${date}&select=centre_id,allday_locked_at`
    );
    for (const r of lockRows) existingLocks[r.centre_id] = r.allday_locked_at;

    // ── 5. Process each centre ────────────────────────────────────────────────
    for (const centre of centres) {
      try {
        const campus     = centre.ownaName ?? centre.name;
        const allDayAtt  = allDayByCampus[campus]  ?? [];
        const presentAtt = presentByCampus[campus] ?? [];

        if (allDayAtt.length === 0 && presentAtt.length === 0) {
          results.skipped.push({ centreId: centre.id, reason: 'no attendance data' });
          continue;
        }

        // ── Roster breakdown for this centre ──────────────────────────────────
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

        // Effective floats — match dashboard filter (core window, no split-shift)
        const zCasuals = zByCentre[centre.name] || [];
        const floatCount =
          centreRosters.filter(r =>
            floatSet.has(r.OperationalUnit) &&
            !r.isSplitShift &&
            isEffectiveFloat(r.StartTime, r.EndTime)
          ).length +
          zCasuals.filter(z => isEffectiveFloat(z.start_time, z.end_time)).length;

        // AD staff (assistant directors — count toward float pool for <100 child centres)
        const adCount = centreRosters.filter(r => {
          if (!nonRatioSet.has(r.OperationalUnit)) return false;
          const un = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '').toLowerCase();
          return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
        }).length;

        // ── Per-room status ───────────────────────────────────────────────────
        const allDayRoomStatuses  = buildRoomStatuses(centre, allDayAtt,  centreRosters);
        const presentRoomStatuses = buildRoomStatuses(centre, presentAtt, centreRosters);

        // ── Float pool calculation ────────────────────────────────────────────
        const allDayCalc  = calcFloatPool({ roomStatuses: allDayRoomStatuses,  floatCount, adCount, childrenCount: allDayAtt.length });
        const presentCalc = calcFloatPool({ roomStatuses: presentRoomStatuses, floatCount, adCount, childrenCount: presentAtt.length });

        // ── Decide what to write ──────────────────────────────────────────────
        const alreadyLocked = !!existingLocks[centre.id];
        const writeAllDay   = !alreadyLocked || forcelock;
        const now           = new Date().toISOString();

        const row = {
          centre_id: centre.id,
          campus,
          date,
          computed_at: now,
          // Present — always updated
          present_surplus_val:           presentCalc.surplusVal,
          present_casuals_needed:        presentCalc.casualsNeeded,
          present_float_surplus:         presentCalc.floatSurplus,
          present_total_floaters_needed: presentCalc.totalFloatersNeeded,
          present_effective_float_count: presentCalc.effectiveFloatCount,
          present_room_net_surplus:      presentCalc.roomNetSurplus,
          present_children_count:        presentCalc.childrenCount,
          present_required_staff:        presentCalc.requiredStaff,
          present_computed_at:           now,
        };

        // All-day — only written if not locked (or forcelock)
        if (writeAllDay) {
          Object.assign(row, {
            surplus_val:                allDayCalc.surplusVal,
            casuals_needed:             allDayCalc.casualsNeeded,
            float_surplus:              allDayCalc.floatSurplus,
            total_floaters_needed:      allDayCalc.totalFloatersNeeded,
            effective_float_count:      allDayCalc.effectiveFloatCount,
            room_net_surplus:           allDayCalc.roomNetSurplus,
            ad_available:               allDayCalc.adAvailable,
            total_ratio_shortage:       allDayCalc.totalRatioShortage,
            total_surplus:              allDayCalc.totalSurplus,
            net_shortage_after_realloc: allDayCalc.netShortageAfterRealloc,
            buffer_required:            allDayCalc.bufferRequired,
            floor_staff:                allDayCalc.floorStaff,
            required_staff:             allDayCalc.requiredStaff,
            float_count:                floatCount,
            children_count:             allDayCalc.childrenCount,
            data: JSON.stringify({
              shortageRooms: allDayCalc.shortageRooms,
              surplusRooms:  allDayCalc.surplusRooms,
            }),
          });
        }

        await sbUpsert('staffing_analysis', row);

        results.success.push({
          centreId:       centre.id,
          allDaySurplus:  writeAllDay ? Math.round(allDayCalc.surplusVal * 100) / 100 : '(locked)',
          presentSurplus: Math.round(presentCalc.surplusVal * 100) / 100,
          presentKids:    presentCalc.childrenCount,
          allDayKids:     allDayCalc.childrenCount,
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
