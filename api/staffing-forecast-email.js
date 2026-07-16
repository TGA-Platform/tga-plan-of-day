/**
 * /api/staffing-forecast-email
 *
 * Generates a next-day staffing summary using EXPECTED attendance (from
 * room-forecast based on last week's same weekday + booked numbers) and
 * tomorrow's rosters.
 *
 * Query params:
 *   date  - optional YYYY-MM-DD, defaults to forecast date (tomorrow, or Monday if called on Friday)
 *   send  - optional "1" to trigger email sends (also auto-triggers when invoked by Vercel cron)
 *
 * Response: JSON summary per centre + HTML email body
 */

import nodemailer from 'nodemailer';
import { CENTRES } from './_centres.js';

const CRON_SECRET = process.env.CRON_SECRET || '';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || 'claude@tga.edu.au';
const SMTP_PASS = process.env.SMTP_PASS || '';

const DEFAULT_RECIPIENTS = Array.from(new Set([
  ...(process.env.FORECAST_EMAIL_TO || SMTP_USER)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  'paige@tga.edu.au',
]));

const CLUSTERS = {
  'South West':   ['mount-annan','spring-farm','denham-court','ed-park-1','ed-park-2','wilton'],
  'South Coast':  ['wollongong','dapto-1','dapto-2','north-wollongong','shell-cove','south-nowra','bomaderry'],
  'South Sydney': ['bexley','oatley','belfield','bankstown','moorebank'],
  'North Coast':  ['glendale','edgeworth','charlestown','aberglasslyn','tuggerah'],
};

const AM_EMAILS = {
  'South West':   process.env.FORECAST_EMAIL_AM_SOUTH_WEST   || 'lilian@tga.edu.au',
  'South Coast':  process.env.FORECAST_EMAIL_AM_SOUTH_COAST  || 'rebeccasapienza@tga.edu.au',
  'South Sydney': process.env.FORECAST_EMAIL_AM_SOUTH_SYDNEY || 'olivia@tga.edu.au',
  'North Coast':  process.env.FORECAST_EMAIL_AM_NORTH_COAST  || 'kandas@tga.edu.au',
};

function sydneyNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
}

function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00+10:00`);
  return d.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Sydney',
  });
}

function forecastDate(baseDate) {
  if (baseDate) return baseDate;
  const now = sydneyNow();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const addDays = day === 5 ? 3 : 1; // Friday -> Monday, otherwise tomorrow
  const d = new Date(now);
  d.setDate(d.getDate() + addDays);
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

function ratioForAge(ageMonths) {
  if (ageMonths === null || ageMonths === undefined) return 5; // conservative default
  if (ageMonths < 24) return 4;
  if (ageMonths < 36) return 5;
  return 10;
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

function calcCentreForecast(centre, date, forecasts, childrenExpected, rosters, internalCasualSet, zCasualCountByCentre) {
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

  const totalExpected = Array.isArray(childrenExpected) && childrenExpected.length > 0
    ? childrenExpected.length
    : null;

  // Compute required per room from children-expected ages (matches dashboard ratio engine).
  // Fall back to room-forecast required values when children-expected is unavailable.
  const roomData = centre.rooms.map(room => {
    const owna = (room.ownaRoomName ?? room.name).toLowerCase();
    let expected = 0;
    let required = 0;
    for (const [roomName, data] of Object.entries(fc.rooms || {})) {
      if (roomName.toLowerCase().includes(owna) || owna.includes(roomName.toLowerCase())) {
        expected += (data.expected ?? 0);
        if (!Array.isArray(childrenExpected) || childrenExpected.length === 0) {
          if ((data.required ?? null) !== null) {
            required += data.required;
          } else {
            const ratio = ratioForRoom(room.ownaRoomName ?? room.name);
            required += data.expected > 0 ? Math.ceil(data.expected / ratio) : 0;
          }
        }
      }
    }

    if (Array.isArray(childrenExpected) && childrenExpected.length > 0) {
      // Sum 1/ratio for each child in this room, then ceiling (matches NSW ratio rules)
      const roomChildren = childrenExpected.filter(c => {
        const childRoom = (c.room ?? '').toLowerCase();
        return childRoom === owna || childRoom.includes(owna) || owna.includes(childRoom);
      });
      if (roomChildren.length > 0) {
        const rawRequired = roomChildren.reduce((s, c) => s + 1 / ratioForAge(c.ageMonths), 0);
        required = Math.ceil(rawRequired);
      }
    }

    if (required === 0 && expected > 0 && !Array.isArray(childrenExpected)) {
      const ratio = ratioForRoom(room.ownaRoomName ?? room.name);
      required = Math.ceil(expected / ratio);
    }

    const roomStaff = rosters.filter(r => r.OperationalUnit === room.deputyUnitId && r.Employee && r.Employee !== 0).length;
    return { room: room.name, expected, required, staffCount: roomStaff };
  });

  const totalExpectedFromRooms = roomData.reduce((s, r) => s + r.expected, 0);
  let totalRequired = roomData.reduce((s, r) => s + r.required, 0);

  // If room name matching failed to produce a required total, fall back to the
  // sum of required values returned by room-forecast regardless of room mapping.
  if (totalRequired === 0 && Object.keys(fc.rooms || {}).length > 0) {
    totalRequired = Object.values(fc.rooms).reduce((s, data) => s + (data.required ?? 0), 0);
  }

  // Last resort: estimate from total expected children using an average ratio.
  if (totalRequired === 0 && totalExpected > 0) {
    totalRequired = centre.rooms.reduce((s, room) => {
      const ratio = ratioForRoom(room.ownaRoomName ?? room.name);
      return s + Math.ceil((totalExpected / centre.rooms.length) / ratio);
    }, 0);
  }
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
  // Match the Plan of Day Float Pool panel: available = floats + AD (+ room surplus already used to cover shortages).
  // Internal casuals are rostered into rooms/float already and shown as a column, but not double-counted here.
  const effectiveFloatCount = floatCount;
  const totalFloatersNeeded = Math.max(0, netShortageAfterRealloc + bufferRequired);
  const casualsNeeded = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);
  const floatSurplus = casualsNeeded <= 0 ? (effectiveFloatCount + adAvailable - totalFloatersNeeded) : 0;

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

function buildHtml(summary, opts = {}) {
  const { title, subtitle, showFooter = true } = opts;
  const totalExternal = summary.reduce((s, x) => s + (x?.zCasualFloatCount || 0), 0);
  const totalInternal = summary.reduce((s, x) => s + (x?.internalCasualCount || 0), 0);
  const casualBanner = (totalExternal > 0 || totalInternal > 0)
    ? `<div style="margin:0 0 16px 0;padding:10px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;color:#9a3412;font-size:14px;">
        <strong>Casuals scheduled across network:</strong>
        ${totalExternal > 0 ? `<span style="margin-left:12px;background:#fed7aa;padding:2px 8px;border-radius:4px;font-weight:700;">${totalExternal} External</span>` : ''}
        ${totalInternal > 0 ? `<span style="margin-left:12px;background:#fef3c7;padding:2px 8px;border-radius:4px;font-weight:700;">${totalInternal} Internal</span>` : ''}
       </div>`
    : '';
  const rows = summary
    .filter(s => s !== null)
    .map(s => {
      const short = s.surplusVal < 0;
      const color = short ? '#dc2626' : s.surplusVal > 0 ? '#16a34a' : '#b45309';
      const label = short ? 'Deficit' : s.surplusVal > 0 ? 'Surplus' : 'Exact';
      const valStr = s.surplusVal === 0 ? '0' : `${s.surplusVal > 0 ? '+' : ''}${Number.isInteger(s.surplusVal) ? s.surplusVal : s.surplusVal.toFixed(1)}`;
      const extCellStyle = s.zCasualFloatCount > 0
        ? 'padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;background:#fed7aa;color:#c2410c;font-weight:700;'
        : 'padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;';
      const intCellStyle = s.internalCasualCount > 0
        ? 'padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;background:#fef3c7;color:#92400e;font-weight:700;'
        : 'padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;';
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${s.name}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.expectedChildren}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.booked ?? '-'}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.requiredStaff}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.floorStaff}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.internalFloatCount}</td>
          <td style="${extCellStyle}">${s.zCasualFloatCount}</td>
          <td style="${intCellStyle}">${s.internalCasualCount}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${s.adAvailable}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;color:${color};font-weight:700;">${valStr} ${label}</td>
        </tr>
      `;
    }).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;max-width:800px;">
      <h2 style="margin:0 0 12px 0;">${title || `TGA Staffing Forecast — ${summary[0]?.date ?? ''}`}</h2>
      <p style="margin:0 0 16px 0;color:#596570;">${subtitle || 'Expected children and required staffing based on booked numbers and last week\'s attendance.'}</p>
      ${casualBanner}
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
      ${showFooter ? '<p style="margin-top:16px;font-size:12px;color:#9ca3af;">Generated by TGA Plan of Day</p>' : ''}
    </div>
  `;
}

async function sendEmails(summary, date, includeClusters = true) {
  if (!SMTP_PASS) {
    throw new Error('SMTP_PASS not configured');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      ciphers: 'SSLv3',
    },
  });

  const dateLabel = formatDateLabel(date);
  const results = [];

  // Full network email to default recipients
  if (DEFAULT_RECIPIENTS.length > 0) {
    const html = buildHtml(summary, {
      title: `TGA Staffing Forecast — ${dateLabel}`,
      subtitle: 'Expected children and required staffing across all centres.',
    });
    const info = await transporter.sendMail({
      from: `"TGA Plan of Day" <${SMTP_USER}>`,
      to: DEFAULT_RECIPIENTS.join(', '),
      subject: `TGA Staffing Forecast — ${dateLabel}`,
      html,
    });
    results.push({ to: DEFAULT_RECIPIENTS, messageId: info.messageId });
  }

  if (!includeClusters) return results;

  // Cluster emails to area managers
  for (const [clusterName, centreIds] of Object.entries(CLUSTERS)) {
    const amEmail = AM_EMAILS[clusterName];
    if (!amEmail) continue;

    const clusterSummary = summary.filter(s => centreIds.includes(s.centreId));
    if (clusterSummary.length === 0) continue;

    const html = buildHtml(clusterSummary, {
      title: `TGA Staffing Forecast — ${clusterName} Cluster — ${dateLabel}`,
      subtitle: `Expected children and required staffing for the ${clusterName} cluster.`,
    });

    const info = await transporter.sendMail({
      from: `"TGA Plan of Day" <${SMTP_USER}>`,
      to: amEmail,
      subject: `TGA Staffing Forecast — ${clusterName} Cluster — ${dateLabel}`,
      html,
    });
    results.push({ to: [amEmail], cluster: clusterName, messageId: info.messageId });
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  const isCron = CRON_SECRET && auth === CRON_SECRET;
  const shouldSend = isCron || req.query.send === '1';

  // When invoked by cron, ensure we only send on weekdays at 3pm Sydney.
  // Vercel cron is UTC, so we schedule two UTC times (4am and 5am) and guard here.
  if (isCron) {
    const now = sydneyNow();
    const day = now.getDay();
    const hour = now.getHours();
    if (day === 0 || day === 6 || hour !== 15) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Outside weekday 3pm Sydney window' });
    }
  }

  const requestedDate = req.query.date || null;
  const date = forecastDate(requestedDate);

  try {
    const host = req.headers.host || 'plan.tga.edu.au';
    const proto = req.headers['x-forwarded-proto'] || 'https';

    const [rosterRes, wwccRes, zCasualRes] = await Promise.all([
      fetch(`${proto}://${host}/api/deputy-rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      }),
      fetch(`${proto}://${host}/api/staff-wwcc`),
      fetch(`${proto}://${host}/api/z-casuals?centre=all&date=${date}`),
    ]);

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

    // Fetch room-forecast per centre (single-campus) to avoid the bulk campus=all bug
    // that inflates expected/required child counts.
    const forecasts = {};
    const childrenExpectedByCentre = {};
    await Promise.all(CENTRES.map(async (centre) => {
      const campus = centre.ownaName ?? centre.name;
      try {
        const [fcRes, ceRes] = await Promise.all([
          fetch(`${proto}://${host}/api/room-forecast?campus=${encodeURIComponent(campus)}&date=${date}`),
          fetch(`${proto}://${host}/api/children-expected?campus=${encodeURIComponent(campus)}&date=${date}`),
        ]);
        if (fcRes.ok) forecasts[campus] = await fcRes.json();
        if (ceRes.ok) {
          const json = await ceRes.json();
          childrenExpectedByCentre[centre.id] = Array.isArray(json) ? json : (json.children || []);
        }
      } catch (e) {
        console.warn(`[staffing-forecast-email] forecast fetch failed for ${campus}:`, e.message);
      }
    }));

    const summary = CENTRES.map(centre => calcCentreForecast(centre, date, forecasts, childrenExpectedByCentre[centre.id], rosters, internalCasualSet, zCasualCountByCentre));
    const html = buildHtml(summary, { title: `TGA Staffing Forecast — ${formatDateLabel(date)}` });

    const includeClusters = req.query.clusters !== '0' && req.query.includeClusters !== 'false';
    let sent = null;
    if (shouldSend) {
      sent = await sendEmails(summary, date, includeClusters);
    }

    return res.status(200).json({
      ok: true,
      date,
      sent,
      summary: summary.filter(s => s !== null),
      html,
    });
  } catch (err) {
    console.error('[staffing-forecast-email] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
