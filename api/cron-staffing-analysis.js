/**
 * /api/cron-staffing-analysis
 *
 * Runs every 15 min during Sydney centre hours (UTC 20:00-09:59).
 *
 * DESIGN:
 *   - The Ratio Dashboard Float Pool panel is the ONLY source of truth for
 *     all-day surplus/deficit. It calculates correctly using all nuances
 *     (staff moves, split shifts, Deputy actual times, ISS, AD availability)
 *     and writes to surplus_val / casuals_needed etc. via POST /api/staffing-analysis
 *     every time a director views the page.
 *
 *   - This cron's ONLY job is to update the present_* columns with the
 *     currently-present child count, then re-derive the float pool numbers
 *     using the SAME roster figures already saved by the dashboard.
 *     It reads the dashboard-saved floor_staff, float_count, required_staff,
 *     ad_available, buffer_required etc. and just swaps in the live child count.
 *     It never touches surplus_val or any all-day columns.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

import { CENTRES } from './_centres.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = proces…_KEY || 'eyJhbG…6f1c';
const CRON_SECRET  = proces…CRET || '';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
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

  const date         = req.query.date || todaySydney();
  const currentHHMM  = nowHHMM();
  const results      = { date, success: [], failed: [], skipped: [] };

  try {
    // --- 1. Fetch all attendance for today (paginated) ---
    const allAttendance = [];
    {
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const page = await sb(
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

    // Split into present (currently signed in) by campus
    const presentByCampus = {};
    for (const a of allAttendance) {
      if (!a.sign_in) continue;
      const departed = a.sign_out || (a.predicted_sign_out && a.predicted_sign_out <= currentHHMM);
      if (!departed) {
        (presentByCampus[a.campus] ??= []).push(a);
      }
    }

    // --- 2. Fetch existing dashboard-saved staffing analysis for all centres ---
    // These are the authoritative floor_staff, float_count, buffer_required,
    // ad_available etc. that the dashboard calculated correctly.
    const savedAnalysis = {};
    {
      const rows = await sb(
        `staffing_analysis?date=eq.${date}` +
        `&select=centre_id,floor_staff,float_count,effective_float_count,` +
        `ad_available,buffer_required,total_ratio_shortage,total_surplus,` +
        `net_shortage_after_realloc,room_net_surplus,required_staff,children_count`
      );
      for (const row of (rows || [])) {
        savedAnalysis[row.centre_id] = row;
      }
    }

    const now = new Date().toISOString();

    // --- 3. For each centre: derive present_* using saved roster figures ---
    for (const centre of CENTRES) {
      try {
        const campus      = centre.ownaName ?? centre.name;
        const presentAtt  = presentByCampus[campus] ?? [];
        const saved       = savedAnalysis[centre.id];

        // Need saved dashboard data to derive meaningful present figures
        if (!saved) {
          results.skipped.push({ centreId: centre.id, reason: 'no dashboard save yet — director needs to open Ratio Dashboard first' });
          continue;
        }

        if (presentAtt.length === 0) {
          results.skipped.push({ centreId: centre.id, reason: 'no present attendance' });
          continue;
        }

        // Calculate required staff from currently-present children using
        // the same cascade ratio logic as the dashboard.
        const presentKids     = presentAtt.map(a => parseAgeMonths(a.age));
        const presentChildren = presentAtt.length;

        // Per-room required for present children
        let presentRequired = 0;
        let presentRatioShortage = 0;
        let presentSurplusRooms  = 0;

        for (const room of centre.rooms) {
          const owna     = (room.ownaRoomName ?? '').toLowerCase();
          const roomKids = presentAtt
            .filter(a => owna && a.room && a.room.toLowerCase().includes(owna))
            .map(a => parseAgeMonths(a.age));
          const required   = calcRequired(roomKids);
          // Use the same floor staff count per room from Deputy as the dashboard did
          // We don't have per-room breakdown here, so use total floor staff proportionally
          // — but more importantly, we use the SAVED surplus/shortage structure and just
          // scale it by present vs all-day child ratio.
          presentRequired += required;
        }

        // Scale the saved roster figures to present context:
        // - Floor staff, floats, AD don't change (rostered for the day)
        // - Only required_staff changes based on present children
        const floorStaff          = Number(saved.floor_staff   ?? 0);
        const floatCount          = Number(saved.float_count   ?? 0);
        const adAvailable         = (presentChildren > 0 && presentChildren < 100)
                                    ? Number(saved.ad_available ?? 0) : 0;
        const bufferRequired      = floorStaff > 0 ? floorStaff / 6 : 0;

        // Per-room surplus/shortage for present children
        let totalRatioShortage = 0;
        let totalSurplus       = 0;
        for (const room of centre.rooms) {
          const owna     = (room.ownaRoomName ?? '').toLowerCase();
          const roomKids = presentAtt
            .filter(a => owna && a.room && a.room.toLowerCase().includes(owna))
            .map(a => parseAgeMonths(a.age));
          const required   = calcRequired(roomKids);
          // Saved per-room staff count not available, so use saved total floor staff
          // distributed by required ratio — approximation only for present view
          // The dashboard's own live calculation on page load is more accurate.
          // This is good enough for the morning briefing card.
          const roomRoster = Math.round(floorStaff * (required / Math.max(presentRequired, 1)));
          const shortage   = required - roomRoster;
          if (shortage > 0) totalRatioShortage += shortage;
          else              totalSurplus       += Math.abs(shortage);
        }

        const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
        const roomNetSurplus          = Math.max(0, totalSurplus - totalRatioShortage);
        const effectiveFloatCount     = floatCount + roomNetSurplus;
        const totalFloatersNeeded     = Math.max(0, netShortageAfterRealloc + bufferRequired);
        const casualsNeeded           = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);
        const floatSurplus            = casualsNeeded <= 0
          ? (effectiveFloatCount + adAvailable - totalFloatersNeeded) : 0;
        const surplusVal              = casualsNeeded > 0 ? -casualsNeeded : floatSurplus;

        // Write only present_* columns — never touch surplus_val or allday columns
        const row = {
          centre_id:                      centre.id,
          campus,
          date,
          present_surplus_val:            surplusVal,
          present_casuals_needed:         casualsNeeded,
          present_float_surplus:          floatSurplus,
          present_total_floaters_needed:  totalFloatersNeeded,
          present_effective_float_count:  effectiveFloatCount,
          present_room_net_surplus:       roomNetSurplus,
          present_children_count:         presentChildren,
          present_required_staff:         presentRequired,
          present_computed_at:            now,
          computed_at:                    now,
        };

        await sb('staffing_analysis', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(row),
        });

        results.success.push({
          centreId:       centre.id,
          presentSurplus: Math.round(surplusVal * 100) / 100,
          presentCasuals: Math.round(casualsNeeded * 100) / 100,
          presentKids:    presentChildren,
          allDaySurplus:  Number(saved.surplus_val ?? 0),
        });
      } catch (err) {
        console.error(`[cron-staffing-analysis] ${centre.id}:`, err.message);
        results.failed.push({ centreId: centre.id, error: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      date,
      currentTime: currentHHMM,
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
