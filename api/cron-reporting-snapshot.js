/**
 * /api/cron-reporting-snapshot
 *
 * Vercel cron job. Computes report snapshot tables from source data and writes
 * them to Supabase. Reports will continue reading live data for now; once the
 * tables are populated and validated, ReportingPage.tsx will be switched to
 * read from these snapshots.
 *
 * Schedule: hourly, plus a nightly backfill window for past dates.
 */

import { CENTRES } from './_centres.js';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const CRON_SECRET = process.env.CRON_SECRET || '';

const SLOTS_30 = [];
for (let m = 7 * 60; m < 18 * 60; m += 30) {
  SLOTS_30.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

const FUTURE_DAYS = 14;
const BACKFILL_DAYS = 90;

// ─── Time helpers ────────────────────────────────────────────────────────────

function getTodaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}

function getSydneyNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
}

function addDaysSydney(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function getDayOfWeekSydney(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parseAgeMonths(ageStr) {
  if (!ageStr) return -1;
  const yearMatch = String(ageStr).match(/(\d+)y/);
  const monthMatch = String(ageStr).match(/(\d+)m/);
  const years = yearMatch ? parseInt(yearMatch[1], 10) : 0;
  const months = monthMatch ? parseInt(monthMatch[1], 10) : 0;
  return years * 12 + months;
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

function hhmmToMins(t) {
  if (!t) return null;
  const parts = String(t).split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0])) return null;
  return parts[0] * 60 + (parts[1] || 0);
}

function shiftCoversSlot(r, slotMinutes) {
  if (!r.StartTime || !r.EndTime) return false;
  const startM = rosterTimeToMins(r.StartTime);
  const endM = rosterTimeToMins(r.EndTime);
  if (startM === null || endM === null) return false;
  return startM <= slotMinutes && endM > slotMinutes;
}

// ─── Ratio engine ────────────────────────────────────────────────────────────

const AGE_BRACKETS = [
  { minMonths: 0, maxMonths: 24, ratio: 4 },
  { minMonths: 24, maxMonths: 36, ratio: 5 },
  { minMonths: 36, maxMonths: 999, ratio: 10 },
];

function calcRequiredStaff(children) {
  const groups = AGE_BRACKETS.map(b => ({
    ...b,
    count: children.filter(c => c.ageMonths >= b.minMonths && c.ageMonths < b.maxMonths && c.ageMonths >= 0).length,
  }));

  let totalStaff = 0;
  let carryover = 0;

  for (const group of groups) {
    if (group.count === 0) continue;
    const coveredByCarryover = Math.min(group.count, carryover);
    const stillNeeded = group.count - coveredByCarryover;
    const newStaff = Math.ceil(stillNeeded / group.ratio);
    totalStaff += newStaff;
    const unusedFromNew = newStaff * group.ratio - stillNeeded;
    const unusedFromCarryover = carryover - coveredByCarryover;
    carryover = unusedFromNew + unusedFromCarryover;
  }

  return { required: totalStaff };
}

// ─── Supabase fetch helpers ──────────────────────────────────────────────────

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase GET ${path}: ${r.status} ${txt}`);
  }
  return r.json();
}

async function sbPost(path, rows, onConflict) {
  if (!rows.length) return { count: 0 };
  let url = `${SUPABASE_URL}/rest/v1/${path}`;
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
    throw new Error(`Supabase POST ${path}: ${r.status} ${txt.slice(0, 200)}`);
  }
  return { count: rows.length };
}

async function fetchRosterCache(date) {
  const rows = await sbGet(`deputy_roster_cache?date=eq.${date}&select=rosters`);
  return rows?.[0]?.rosters || [];
}

async function fetchAttendance(campus, date) {
  const rows = await sbGet(
    `attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=room,age,sign_in,sign_out,predicted_sign_out&limit=500`
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchZCasuals(centreName, date) {
  const rows = await sbGet(
    `z_casuals?centre=eq.${encodeURIComponent(centreName)}&date=eq.${date}&select=name,start_time,end_time`
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchStaffWwcc() {
  const rows = await sbGet('staff_wwcc?select=*');
  return Array.isArray(rows) ? rows : [];
}

// ─── Compute functions ───────────────────────────────────────────────────────

function mergeRostersWithZCasuals(rosters, zCasuals) {
  const all = [...rosters];
  for (const z of zCasuals) {
    all.push({
      Employee: 0 - Math.abs(hashCode(z.name + z.start_time + z.end_time)),
      OperationalUnit: 0,
      StartTime: z.start_time,
      EndTime: z.end_time,
      _DPMetaData: {
        EmployeeInfo: { DisplayName: z.name },
        OperationalUnitInfo: { OperationalUnitName: 'Z Casual' },
      },
    });
  }
  return all;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function computeSlotMetrics(centre, date, attendance, rosters, zCasuals) {
  const campus = centre.ownaName ?? centre.name;
  const allRosters = mergeRostersWithZCasuals(rosters, zCasuals);

  const roomUnitIds = new Set(centre.rooms.map(r => r.deputyUnitId));
  const floatUnitIds = new Set(centre.floatUnitIds || []);
  const issUnitIds = new Set(centre.issUnitIds || []);
  const nonRatioIds = new Set([...(centre.nonRatioUnitIds || []), ...(centre.leaveUnitIds || [])]);
  const leaveIds = new Set(centre.leaveUnitIds || []);

  const rows = [];
  for (const slot of SLOTS_30) {
    const [h, m] = slot.split(':').map(Number);
    const slotMinutes = h * 60 + m;

    const childrenAtSlot = attendance.filter(c => {
      const siM = hhmmToMins(c.sign_in);
      if (siM === null || siM > slotMinutes) return false;
      const soM = hhmmToMins(c.sign_out);
      if (soM !== null && soM <= slotMinutes) return false;
      const psoM = hhmmToMins(c.predicted_sign_out);
      if (soM === null && psoM !== null && psoM <= slotMinutes) return false;
      return true;
    });

    const childrenByRoom = {};
    for (const child of childrenAtSlot) {
      const rk = child.room || 'unassigned';
      if (!childrenByRoom[rk]) childrenByRoom[rk] = [];
      childrenByRoom[rk].push({ ageMonths: parseAgeMonths(child.age) });
    }

    let required = 0;
    for (const roomKids of Object.values(childrenByRoom)) {
      required += calcRequiredStaff(roomKids).required;
    }

    const shiftCheck = r => shiftCoversSlot(r, slotMinutes);

    const roomStaff = new Set(allRosters.filter(r => r.Employee && r.Employee !== 0 && roomUnitIds.has(r.OperationalUnit) && shiftCheck(r)).map(r => r.Employee)).size;
    const floatStaff = new Set(allRosters.filter(r => r.Employee && r.Employee !== 0 && floatUnitIds.has(r.OperationalUnit) && shiftCheck(r)).map(r => r.Employee)).size;
    const floorStaff = roomStaff + floatStaff;

    const offFloor = new Set(allRosters.filter(r => r.Employee && r.Employee !== 0 && nonRatioIds.has(r.OperationalUnit) && !leaveIds.has(r.OperationalUnit) && shiftCheck(r)).map(r => r.Employee)).size;
    const iss = new Set(allRosters.filter(r => r.Employee && r.Employee !== 0 && issUnitIds.has(r.OperationalUnit) && shiftCheck(r)).map(r => r.Employee)).size;

    rows.push({
      centre_id: centre.id,
      campus,
      date,
      time_slot: slot,
      children: childrenAtSlot.length,
      floor_staff: floorStaff,
      required_staff: required,
      off_floor_staff: offFloor,
      iss_staff: iss,
      surplus: floorStaff - required,
    });
  }

  return rows;
}

function computeDailyMetrics(centre, date, attendance, rosters, zCasuals) {
  const campus = centre.ownaName ?? centre.name;
  const children = attendance.filter(c => c.sign_in).length;

  const allRosters = mergeRostersWithZCasuals(rosters, zCasuals);

  const roomData = centre.rooms.map(room => {
    const owna = (room.ownaRoomName ?? room.name).toLowerCase();
    const roomKids = attendance.filter(c => c.sign_in && c.room?.toLowerCase().includes(owna));
    const required = calcRequiredStaff(roomKids.map(c => ({ ageMonths: parseAgeMonths(c.age) }))).required;
    const roomStaff = allRosters.filter(r => r.OperationalUnit === room.deputyUnitId && r.Employee && r.Employee !== 0);
    const staffCount = new Set(roomStaff.map(r => r.Employee)).size;
    return { required, staffCount };
  });

  const required = roomData.reduce((s, r) => s + r.required, 0);
  const totalFloorStaff = roomData.reduce((s, r) => s + r.staffCount, 0);

  const totalRatioShortage = roomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
  const totalRoomSurplus = roomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
  const roomSurplus = totalRoomSurplus - totalRatioShortage;
  const netShortage = Math.max(0, totalRatioShortage - totalRoomSurplus);

  const bufferRequired = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;

  const floatUnitIds = new Set(centre.floatUnitIds || []);
  const nonRatioUnitIds = new Set(centre.nonRatioUnitIds || []);
  const floatCount = allRosters.filter(r => floatUnitIds.has(r.OperationalUnit)).length;

  const adCount = allRosters.filter(r => {
    if (!nonRatioUnitIds.has(r.OperationalUnit)) return false;
    const un = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '').toLowerCase();
    return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
  }).length;
  const adAvailable = (children > 0 && children < 100) ? adCount : 0;

  const totalFloatersNeeded = netShortage + bufferRequired;
  const roomSurplusAsFloat = Math.max(0, roomSurplus);
  const effectiveAvailable = floatCount + adAvailable + roomSurplusAsFloat;
  const floatSurplus = effectiveAvailable - totalFloatersNeeded;

  let status = 'unknown';
  if (children === 0) status = 'unknown';
  else if (floatSurplus < 0) status = 'red';
  else if (floatSurplus === 0) status = 'amber';
  else status = 'green';

  const nonRatioLeaveIds = new Set([...(centre.nonRatioUnitIds || []), ...(centre.leaveUnitIds || [])]);
  const issIds = new Set(centre.issUnitIds || []);
  const floatIds = new Set(centre.floatUnitIds || []);

  const floorSet = new Set();
  const offFloorSet = new Set();
  const issSet = new Set();
  const floatSet = new Set();

  for (const r of allRosters) {
    if (!r.Employee || r.Employee === 0) continue;
    const unitId = r.OperationalUnit;
    const covered = SLOTS_30.some(slot => {
      const [h, mm] = slot.split(':').map(Number);
      return shiftCoversSlot(r, h * 60 + mm);
    });
    if (!covered) continue;
    if (centre.rooms.some(room => room.deputyUnitId === unitId)) floorSet.add(r.Employee);
    else if (floatIds.has(unitId)) { floorSet.add(r.Employee); floatSet.add(r.Employee); }
    else if (issIds.has(unitId)) issSet.add(r.Employee);
    else if (nonRatioLeaveIds.has(unitId)) offFloorSet.add(r.Employee);
  }

  return {
    centre_id: centre.id,
    campus,
    date,
    children_attended: children,
    floor_staff: floorSet.size,
    float_staff: floatSet.size,
    iss_staff: issSet.size,
    off_floor_staff: offFloorSet.size,
    required_staff: required,
    room_surplus: roomSurplus,
    buffer_required: bufferRequired,
    float_count: floatCount,
    ad_available: adAvailable,
    float_surplus: floatSurplus,
    staffing_status: status,
  };
}

function computeWwccSnapshot(centre, wwccAll, activeStaffNames) {
  const normN = n => n.replace(/\s*[\(\[{][^\)\]{}]*[\)\]{}]\s*/g, ' ').replace(/[-']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wwccByNorm = {};
  for (const rec of wwccAll) wwccByNorm[normN(rec.full_name)] = rec;

  const rows = [];
  const today = new Date();
  const snapshotDate = getTodaySydney();

  for (const name of activeStaffNames) {
    const nn = normN(name);
    let rec = wwccByNorm[nn];
    if (!rec) {
      const bare = nn.replace(/\s/g, '');
      rec = Object.values(wwccByNorm).find(r => normN(r.full_name).replace(/\s/g, '') === bare);
    }

    const expiry = rec?.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;
    const daysRemaining = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / 86400000) : null;
    let exemptReason = null;
    if (rec?.under_18) exemptReason = 'under_18';
    else if (rec?.exempt_reason === 'kitchen') exemptReason = 'kitchen';

    rows.push({
      centre_id: centre.id,
      name,
      wwcc_number: rec?.wwcc_number || null,
      wwcc_expiry: rec?.wwcc_expiry || null,
      days_remaining: daysRemaining,
      exempt_reason: exemptReason,
      active_in_period: true,
      snapshot_date: snapshotDate,
    });
  }

  return rows;
}

// ─── Main snapshot run ───────────────────────────────────────────────────────

async function snapshotCentreDate(centre, date, wwccAll, skipWwcc) {
  const campus = centre.ownaName ?? centre.name;

  const [rosters, attendance, zCasuals] = await Promise.all([
    fetchRosterCache(date),
    fetchAttendance(campus, date),
    fetchZCasuals(centre.name, date),
  ]);

  const slotRows = computeSlotMetrics(centre, date, attendance, rosters, zCasuals);
  const dailyRow = computeDailyMetrics(centre, date, attendance, rosters, zCasuals);

  await sbPost('report_slot_30', slotRows, 'centre_id,date,time_slot');
  await sbPost('report_daily', [dailyRow], 'centre_id,date');

  if (skipWwcc) {
    return { slotRows: slotRows.length, dailyRows: 1, wwccRows: 0 };
  }

  // WWCC snapshot uses active staff names from this centre's roster cache for recent dates
  const activeNames = new Set();
  for (const r of rosters) {
    const name = r._DPMetaData?.EmployeeInfo?.DisplayName;
    if (name) activeNames.add(name);
  }
  const wwccRows = computeWwccSnapshot(centre, wwccAll, [...activeNames]);
  await sbPost('report_wwcc', wwccRows, 'centre_id,name,snapshot_date');

  return { slotRows: slotRows.length, dailyRows: 1, wwccRows: wwccRows.length };
}

function getDatesToSnapshot() {
  const today = getTodaySydney();
  const dates = new Set();

  // Always process today and tomorrow to keep the report current and allow
  // next-day planning. Keep the batch small so the function finishes well
  // within Vercel's serverless timeout.
  for (let i = 0; i <= 1; i++) {
    const d = addDaysSydney(today, i);
    if (getDayOfWeekSydney(d) !== 0 && getDayOfWeekSydney(d) !== 6) dates.add(d);
  }

  // Nightly backfill: cycle through the last 7 weekdays, one per day.
  const now = getSydneyNow();
  if (now.getHours() >= 2 && now.getHours() < 3) {
    const dayIndex = now.getDate() % 7; // 0-6
    const d = addDaysSydney(today, -(dayIndex + 1));
    if (getDayOfWeekSydney(d) !== 0 && getDayOfWeekSydney(d) !== 6) dates.add(d);
  }

  return [...dates].sort();
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const t0 = Date.now();
  const dates = getDatesToSnapshot();
  const now = getSydneyNow();
  const isNightlyWindow = now.getHours() >= 2 && now.getHours() < 3;
  // WWCC snapshots are large; only refresh them during the nightly window.
  const skipWwcc = !isNightlyWindow;

  try {
    const wwccAll = skipWwcc ? [] : await fetchStaffWwcc();
    let totalSlotRows = 0;
    let totalDailyRows = 0;
    let totalWwccRows = 0;

    // Process all centres for each date in parallel to fit inside the function timeout.
    for (const date of dates) {
      const results = await Promise.all(
        CENTRES.map(centre =>
          snapshotCentreDate(centre, date, wwccAll, skipWwcc)
            .then(counts => ({ ok: true, counts }))
            .catch(err => {
              console.error(`[cron-reporting-snapshot] ${centre.id} ${date} failed:`, err.message);
              return { ok: false, counts: { slotRows: 0, dailyRows: 0, wwccRows: 0 } };
            })
        )
      );
      for (const r of results) {
        if (r.ok) {
          totalSlotRows += r.counts.slotRows;
          totalDailyRows += r.counts.dailyRows;
          totalWwccRows += r.counts.wwccRows;
        }
      }
    }

    const ms = Date.now() - t0;
    console.log(`[cron-reporting-snapshot] ${dates.length} dates, ${CENTRES.length} centres, ${totalSlotRows} slots, ${totalDailyRows} daily, ${totalWwccRows} wwcc, ${ms}ms`);
    return res.status(200).json({
      ok: true,
      dates,
      centres: CENTRES.length,
      slotRows: totalSlotRows,
      dailyRows: totalDailyRows,
      wwccRows: totalWwccRows,
      ms,
    });
  } catch (err) {
    console.error('[cron-reporting-snapshot] FATAL:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
