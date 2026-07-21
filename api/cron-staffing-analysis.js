/**
 * /api/cron-staffing-analysis
 *
 * Server-side computation and Supabase write of the staffing_analysis table
 * for all centres. This ensures the surplus/deficit figures are always
 * populated for the morning briefing email and morning-briefing API,
 * regardless of whether any director opened the Ratio Dashboard that day.
 *
 * Called by: Vercel cron or OpenClaw cron job (Mon–Fri, 7:30am Sydney)
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

import { CENTRES } from './_centres.js';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const CRON_SECRET  = process.env.CRON_SECRET || '';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
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

// Only count floats whose shift overlaps the 10am-1:30pm core window
// (matches the RatioDashboardPage effectiveFloats filter)
function isEffectiveFloat(startTime, endTime) {
  const s = rosterTimeToMins(startTime);
  const e = rosterTimeToMins(endTime);
  if (s === null || e === null) return true;
  const WINDOW_START        = 10 * 60; // 10:00
  const USEFUL_START_CUTOFF = 13 * 60 + 30; // 13:30
  return e > WINDOW_START && s < USEFUL_START_CUTOFF;
}

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

  const date = req.query.date || todaySydney();
  const host  = req.headers.host || 'plan.tga.edu.au';
  const proto = req.headers['x-forwarded-proto'] || 'https';

  const results = { date, success: [], failed: [], skipped: [] };

  try {
    // Fetch all rosters and all-day attendance in parallel
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

    const allRosters = rosterRes.ok ? await rosterRes.json() : [];

    const zCasualRows = zCasualRes?.ok ? await zCasualRes.json() : [];
    const zCasualByCentre = {};
    for (const row of zCasualRows) {
      if (row.start_time && row.end_time && row.centre) {
        (zCasualByCentre[row.centre] ??= []).push(row);
      }
    }

    // Fetch all-day attendance (all centres, paginated)
    const allAttendance = [];
    {
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const page = await sb(
          `attendance_daily?date=eq.${date}&select=campus,room,age,sign_in&order=campus,room&limit=${PAGE}&offset=${offset}`
        );
        if (!Array.isArray(page) || page.length === 0) break;
        allAttendance.push(...page.filter(r => r.sign_in));
        if (page.length < PAGE) break;
        offset += PAGE;
      }
    }

    // Process each centre
    for (const centre of CENTRES) {
      try {
        const campus = centre.ownaName ?? centre.name;

        // Rosters for this centre
        const leaveSet    = new Set(centre.leaveUnitIds    || []);
        const floatSet    = new Set(centre.floatUnitIds    || []);
        const nonRatioSet = new Set(centre.nonRatioUnitIds || []);
        const issSet      = new Set(centre.issUnitIds      || []);

        const centreRosters = allRosters.filter(r => {
          const uid = r.OperationalUnit;
          return centre.rooms.some(rm => rm.deputyUnitId === uid)
            || floatSet.has(uid)
            || leaveSet.has(uid)
            || nonRatioSet.has(uid)
            || issSet.has(uid);
        });

        function unitType(uid) {
          if (leaveSet.has(uid))    return 'leave';
          if (floatSet.has(uid))    return 'float';
          if (nonRatioSet.has(uid)) return 'support';
          if (issSet.has(uid))      return 'iss';
          if (centre.rooms.some(rm => rm.deputyUnitId === uid)) return 'room';
          return 'other';
        }

        // Floor staff (room units)
        const roomStaffByRoom = {};
        for (const room of centre.rooms) {
          roomStaffByRoom[room.deputyUnitId] = centreRosters.filter(r => r.OperationalUnit === room.deputyUnitId).length;
        }
        const totalFloorStaff = Object.values(roomStaffByRoom).reduce((s, n) => s + n, 0);

        // Floats (effective only — shift overlaps core window, not split-shift)
        const zCasuals = zCasualByCentre[centre.name] || [];
        const internalFloatCount = centreRosters.filter(r =>
          unitType(r.OperationalUnit) === 'float' &&
          !r.isSplitShift &&
          isEffectiveFloat(r.StartTime, r.EndTime)
        ).length;
        const zCasualFloatCount = zCasuals.filter(z => isEffectiveFloat(z.start_time, z.end_time)).length;
        const floatCount = internalFloatCount + zCasualFloatCount;

        // AD staff (for centres <100 children)
        const adCount = centreRosters.filter(r => {
          if (unitType(r.OperationalUnit) !== 'support') return false;
          const un = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '').toLowerCase();
          return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
        }).length;

        // All-day attendance for this campus
        const campusAtt = allAttendance.filter(a => a.campus === campus);
        const childrenCount = campusAtt.length;
        if (childrenCount === 0) {
          results.skipped.push({ centreId: centre.id, reason: 'no attendance data' });
          continue;
        }

        // Per-room required staff (all-day, age-cascade)
        const shortageRooms = [];
        const surplusRooms  = [];
        let totalRequired   = 0;
        let totalRatioShortage = 0;
        let totalSurplus       = 0;

        for (const room of centre.rooms) {
          const owna = (room.ownaRoomName ?? '').toLowerCase();
          const roomKids = campusAtt
            .filter(a => owna && a.room && a.room.toLowerCase().includes(owna))
            .map(a => parseAgeMonths(a.age));
          const required  = calcRequired(roomKids);
          const staffCount = roomStaffByRoom[room.deputyUnitId] ?? 0;
          const shortage   = required - staffCount; // positive = short, negative = surplus

          totalRequired += required;
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
        const floatSurplus            = casualsNeeded <= 0 ? (effectiveFloatCount + adAvailable - totalFloatersNeeded) : 0;
        const surplusVal              = casualsNeeded > 0 ? -casualsNeeded : floatSurplus;

        const row = {
          centre_id:                  centre.id,
          campus,
          date,
          surplus_val:                surplusVal,
          casuals_needed:             casualsNeeded,
          float_surplus:              floatSurplus,
          total_floaters_needed:      totalFloatersNeeded,
          effective_float_count:      effectiveFloatCount,
          room_net_surplus:           roomNetSurplus,
          ad_available:               adAvailable,
          total_ratio_shortage:       totalRatioShortage,
          total_surplus:              totalSurplus,
          net_shortage_after_realloc: netShortageAfterRealloc,
          buffer_required:            bufferRequired,
          floor_staff:                totalFloorStaff,
          required_staff:             totalRequired,
          float_count:                floatCount,
          children_count:             childrenCount,
          computed_at:                new Date().toISOString(),
          data: JSON.stringify({ shortageRooms, surplusRooms }),
        };

        await sb('staffing_analysis', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(row),
        });

        results.success.push({
          centreId: centre.id,
          surplusVal: Math.round(surplusVal * 100) / 100,
          casualsNeeded: Math.round(casualsNeeded * 100) / 100,
          children: childrenCount,
          floor: totalFloorStaff,
          floats: floatCount,
        });
      } catch (err) {
        console.error(`[cron-staffing-analysis] ${centre.id}:`, err.message);
        results.failed.push({ centreId: centre.id, error: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      date,
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
