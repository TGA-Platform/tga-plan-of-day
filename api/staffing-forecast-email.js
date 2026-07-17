/**
 * /api/staffing-forecast-email
 *
 * Generates a next-day staffing summary using EXPECTED attendance (from
 * room-forecast based on last week's same weekday + booked numbers) and
 * tomorrow's rosters.
 *
 * Query params:
 *   date - optional YYYY-MM-DD, defaults to tomorrow Sydney time
 *
 * Response: JSON summary per centre + HTML email body
 */

import { CENTRES } from './_centres.js';

const CRON_SECRET = process.env.CRON_SECRET || '';

const SLOTS_30 = [];
for (let m = 7 * 60; m < 18 * 60; m += 30) {
  SLOTS_30.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

function tomorrowSydney() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hhmmToMins(t) {
  if (!t) return null;
  const parts = String(t).split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0])) return null;
  return parts[0] * 60 + (parts[1] || 0);
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

function shiftCoversSlot(r, slotMinutes) {
  if (!r.StartTime || !r.EndTime) return false;
  const startM = rosterTimeToMins(r.StartTime);
  const endM = rosterTimeToMins(r.EndTime);
  if (startM === null || endM === null) return false;
  return startM <= slotMinutes && endM > slotMinutes;
}

function ratioForRoom(roomName) {
  const lower = (roomName ?? '').toLowerCase();
  if (lower.includes('0-1') || lower.includes('0-2') || lower.includes('1-2')) return 4;
  if (lower.includes('2-3') || lower.includes('2.5-3.5') || lower.includes('2.5-3')) return 5;
  if (lower.includes('3-4') || lower.includes('3-5') || lower.includes('3.5-5') || lower.includes('4-5')) return 10;
  if (lower.includes('0-2')) return 4;
  return 5; // default conservative
}

function unitType(r, centre) {
  const uid = r.OperationalUnit;
  if ((centre.leaveUnitIds || []).includes(uid)) return 'leave';
  if ((centre.floatUnitIds || []).includes(uid)) return 'float';
  if ((centre.nonRatioUnitIds || []).includes(uid)) return 'support';
  if (centre.rooms.some(rm => rm.deputyUnitId === uid)) return 'room';
  return 'other';
}

function normName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function calcCentreForecast(centre, date, forecasts, rosters, internalCasualSet, zCasualCountByCentre) {
  const campus = centre.ownaName ?? centre.name;
  const fc = forecasts[campus];
  if (!fc) return null;

  const centreRosters = rosters.filter(r => {
    const uid = r.OperationalUnit;
    return centre.rooms.some(rm => rm.deputyUnitId === uid)
      || centre.floatUnitIds.includes(uid)
      || centre.leaveUnitIds.includes(uid)
      || centre.nonRatioUnitIds.includes(uid)
      || (centre.issUnitIds || []).includes(uid);
  });

  const internalCasualCount = centreRosters.filter(r => {
    const name = r._DPMetaData?.EmployeeInfo?.DisplayName || '';
    return internalCasualSet.has(normName(name));
  }).length;

  const zCasualFloatCount = zCasualCountByCentre[centre.name] || 0;

  const roomData = centre.rooms.map(room => {
    const owna = (room.ownaRoomName ?? '').toLowerCase();
    const displayName = (room.name ?? '').toLowerCase();
    let expected = 0;
    for (const [roomName, data] of Object.entries(fc.rooms || {})) {
      const rn = roomName.toLowerCase();
      if (rn.includes(owna) || owna.includes(rn) || rn.includes(displayName) || displayName.includes(rn)) {
        expected += (data.expected ?? 0);
      }
    }
    const ratio = ratioForRoom(room.ownaRoomName ?? room.name);
    const required = expected > 0 ? Math.ceil(expected / ratio) : 0;
    const roomStaff = rosters.filter(r => r.OperationalUnit === room.deputyUnitId && r.Employee && r.Employee !== 0).length;
    return { room: room.name, expected, required, staffCount: roomStaff };
  });

  const totalExpected = roomData.reduce((s, r) => s + r.expected, 0);
  const totalRequired = roomData.reduce((s, r) => s + r.required, 0);
  const totalFloorStaff = roomData.reduce((s, r) => s + r.staffCount, 0);

  const floatIds = new Set(centre.floatUnitIds || []);
  const internalFloatCount = rosters.filter(r => floatIds.has(r.OperationalUnit)).length;
  const floatCount = internalFloatCount + zCasualFloatCount;

  const nonRatioIds = new Set([...(centre.nonRatioUnitIds || []), ...(centre.leaveUnitIds || [])]);
  const adCount = rosters.filter(r => {
    if (!nonRatioIds.has(r.OperationalUnit)) return false;
    const un = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '').toLowerCase();
    return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
  }).length;
  const adAvailable = (totalExpected > 0 && totalExpected < 100) ? adCount : 0;

  const totalRatioShortage = roomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
  const totalSurplus = roomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
  const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
  const bufferRequired = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;
  const roomNetSurplus = Math.max(0, totalSurplus - totalRatioShortage);
  // Match the Plan of Day Float Pool panel: surplus = (floats + AD) - total floaters needed.
  // Room surplus is displayed separately but not included in the final surplus number.
  const effectiveFloatCount = floatCount + roomNetSurplus;
  const totalFloatersNeeded = Math.max(0, netShortageAfterRealloc + bufferRequired);
  const casualsNeeded = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);
  const floatSurplus = casualsNeeded <= 0 ? (floatCount + adAvailable - totalFloatersNeeded) : 0;

  return {
    centreId: centre.id,
    name: centre.name,
    campus,
    date,
    expectedChildren: totalExpected,
    booked: fc.booked ?? null,
    capacity: fc.capacity ?? null,
    requiredStaff: totalRequired,
    floorStaff: totalFloorStaff,
    floatCount,
    internalFloatCount,
    zCasualFloatCount,
    internalCasualCount,
    adAvailable,
    casualsNeeded,
    floatSurplus,
    surplusVal: casualsNeeded > 0 ? -casualsNeeded : floatSurplus,
    roomData,
  };
}

function buildHtml(summary) {
  const rows = summary
    .filter(s => s !== null)
    .map(s => {
      const short = s.surplusVal < 0;
      const color = short ? '#dc2626' : s.surplusVal > 0 ? '#16a34a' : '#b45309';
      const label = short ? 'Deficit' : s.surplusVal > 0 ? 'Surplus' : 'Exact';
      const valStr = s.surplusVal === 0 ? '0' : `${s.surplusVal > 0 ? '+' : ''}${Number.isInteger(s.surplusVal) ? s.surplusVal : s.surplusVal.toFixed(1)}`;
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${s.name}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.expectedChildren}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.booked ?? '-'}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.requiredStaff}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.floorStaff}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.internalFloatCount}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.zCasualFloatCount}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.internalCasualCount}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.adAvailable}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;color:${color};font-weight:700;">${valStr} ${label}</td>
        </tr>
      `;
    }).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;max-width:800px;">
      <h2 style="margin:0 0 12px 0;">TGA Staffing Forecast — ${summary[0]?.date ?? ''}</h2>
      <p style="margin:0 0 16px 0;color:#596570;">Expected children and required staffing based on booked numbers and last week's attendance.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;text-align:left;">Centre</th>
            <th style="padding:8px;text-align:center;">Expected</th>
            <th style="padding:8px;text-align:center;">Booked</th>
            <th style="padding:8px;text-align:center;">Required</th>
            <th style="padding:8px;text-align:center;">Floor</th>
            <th style="padding:8px;text-align:center;">Float</th>
            <th style="padding:8px;text-align:center;">External Casuals</th>
            <th style="padding:8px;text-align:center;">Internal Casuals</th>
            <th style="padding:8px;text-align:center;">AD</th>
            <th style="padding:8px;text-align:center;">Surplus / Deficit</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p style="margin-top:16px;font-size:12px;color:#9ca3af;">Generated by TGA Plan of Day</p>
    </div>
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date = req.query.date || tomorrowSydney();

  try {
    const host = req.headers.host || 'plan.tga.edu.au';
    const proto = req.headers['x-forwarded-proto'] || 'https';

    const [forecastRes, rosterRes, wwccRes, zCasualRes] = await Promise.all([
      fetch(`${proto}://${host}/api/room-forecast?campus=all&date=${date}`),
      fetch(`${proto}://${host}/api/deputy-rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      }),
      fetch(`${proto}://${host}/api/staff-wwcc`),
      fetch(`${proto}://${host}/api/z-casuals?centre=all&date=${date}`),
    ]);

    const forecasts = forecastRes.ok ? await forecastRes.json() : {};
    const rosters = rosterRes.ok ? await rosterRes.json() : [];

    const wwccRows = wwccRes.ok ? await wwccRes.json() : [];
    const internalCasualSet = new Set(
      wwccRows.filter(r => r.is_internal_casual).map(r => normName(r.full_name))
    );

    const zCasualRows = zCasualRes.ok ? await zCasualRes.json() : [];
    const zCasualCountByCentre = {};
    for (const row of zCasualRows) {
      zCasualCountByCentre[row.centre] = (zCasualCountByCentre[row.centre] || 0) + 1;
    }

    const summary = CENTRES.map(centre => calcCentreForecast(centre, date, forecasts, rosters, internalCasualSet, zCasualCountByCentre));
    const html = buildHtml(summary);

    return res.status(200).json({
      ok: true,
      date,
      summary: summary.filter(s => s !== null),
      html,
    });
  } catch (err) {
    console.error('[staffing-forecast-email] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
