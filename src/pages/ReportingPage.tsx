/**
 * Reporting - Regulation 151 compliance records + ratio analysis.
 *
 * NSW Regulation 151 (updated 24 April 2026) requires:
 *  - Educator name + WWCC number
 *  - Which room/group they were working with + when
 *  - Deviations from roster recorded
 *
 * Scope: individual centre | cluster | all centres
 * Reports: Educator Daily Record | Ratio Report | Trends
 */
import { useState, useCallback, useRef } from 'react';
import { format } from 'date-fns';
function safeFormat(d: Date | string | null | undefined, fmt: string): string {
  try {
    if (!d) return '--';
    const dt = d instanceof Date ? d : new Date(String(d));
    if (isNaN(dt.getTime())) return '--';
    return format(dt, fmt);
  } catch { return '--'; }
}
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { getUser, getAllowedCentres } from '../auth';
import { calcRequiredStaff, parseAgeMonths } from '../utils/ratioEngine';
// ─── Clusters ─────────────────────────────────────────────────────────────────
const CLUSTERS: Record<string, string[]> = {
  'South West':   ['mount-annan','spring-farm','denham-court','ed-park-1','ed-park-2','wilton'],
  'South Coast':  ['wollongong','dapto-1','dapto-2','north-wollongong','shell-cove','south-nowra','bomaderry'],
  'South Sydney': ['bexley','oatley','belfield','bankstown'],
  'North Coast':  ['glendale','edgeworth','aberglasslyn','charlestown','moorebank','tuggerah'],
};

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';
function todayStr() {
  const n = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single time block: one staff member in one room for one time period */
interface EducatorEntry {
  employeeId:  number;
  name:        string;
  room:        string;   // room name for this block
  inTime:      string;   // HH:MM — when they entered/started
  outTime:     string;   // HH:MM — when they left/finished
  lunchStart?: string;   // HH:MM — their own lunch break start (shown as dedicated columns)
  lunchEnd?:   string;   // HH:MM — their own lunch break end
  blockType:   'shift' | 'lunch_break' | 'float_move' | 'lunch_cover' | 'leave' | 'support' | 'grouping';
  staffType:   'room' | 'float' | 'iss' | 'support' | 'leave';
  note?:       string;
}

interface RatioSnap {
  date:       string;
  campus:     string;
  children:   number;
  required:   number;
  compliant:  boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtTime(t: string | number | null): string {
  if (!t) return '-';
  const n = typeof t === 'number' ? t : parseInt(String(t));
  if (!isNaN(n) && n > 100000) {
    const d = new Date(new Date(n * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return String(t).slice(0,5);
}

async function fetchAttendance(campus: string, date: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=room,age,sign_in,sign_out&limit=500`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );
  return r.ok ? r.json() : [];
}

/**
 * Auto-generate staggered lunch breaks for a group of room staff.
 * Used as fallback when Deputy Slots and saved lunch schedule both missing.
 */

async function fetchRostersForDate(unitIds: number[], date: string) {
  const r = await fetch('/api/deputy-rosters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, unitIds }),
  });
  return r.ok ? r.json() : [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ReportingPage() {
  const navigate = useNavigate();
  const user     = getUser();
  const allowed  = user ? getAllowedCentres(user) : CENTRES;

  // Scope
  const [scopeType, setScopeType]  = useState<'centre'|'cluster'|'all'>('centre');
  const [centreId, setCentreId]    = useState(allowed[0]?.id ?? 'oatley');
  const [cluster, setCluster]      = useState(Object.keys(CLUSTERS)[0]);

  // Date range
  const [fromDate, setFromDate] = useState(() => {
    const today = todayStr();
    const [y, m, dy] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dy - 6)).toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(todayStr());

  // Report type
  const [activeReport, setActiveReport] = useState<'educator'|'ratio'|'trends'>('educator');

  // Results
  const [loading, setLoading]          = useState(false);
  const [educatorRows, setEducatorRows] = useState<{ date: string; campus: string; entries: EducatorEntry[]; allRooms: string[] }[]>([]);
  const [ratioSnaps, setRatioSnaps]    = useState<RatioSnap[]>([]);
  const [groupingTrends, setGroupingTrends] = useState<{ date: string; campus: string; sessions: any[] }[]>([]);
  const [generated, setGenerated]      = useState(false);
  const [roomFilter, setRoomFilter]    = useState<string>('all');
  type WwccRec = { wwcc_number: string | null; wwcc_expiry: string | null; under_18: boolean };
  // WWCC lookup function — tries multiple strategies to handle name mismatches
  const [wwccLookup, setWwccLookup] = useState<(name: string) => WwccRec | null>(() => () => null);
  // Keep a plain map too for the print view template string context
  const [wwccMap, setWwccMap] = useState<Record<string, WwccRec>>({});
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { window.print(); return; }

    const dateLabel = fromDate === toDate ? safeFormat(new Date(fromDate), 'd MMMM yyyy')
      : `${safeFormat(new Date(fromDate), 'd MMM')} - ${safeFormat(new Date(toDate), 'd MMM yyyy')}`;
    const scopeLabel = scopeType === 'all' ? 'All Centres'
      : scopeType === 'cluster' ? `${cluster} Cluster`
      : selectedCentres[0]?.name ?? '';

    // ── Build educator table rows ─────────────────────────────────────────
    const educatorHtml = activeReport === 'educator'
      ? educatorRows.map(({ date, campus, entries }) => {
          const filtered = roomFilter === 'all' ? entries
            : entries.filter(e => e.room === roomFilter ||
                (e.blockType === 'lunch_break' && entries.some(o => o.employeeId === e.employeeId && o.room === roomFilter)));
          if (filtered.length === 0) return '';

          const rows = filtered.map((e, i) => {
            const prevSame   = i > 0 && filtered[i-1].employeeId === e.employeeId;
            const isLunch    = e.blockType === 'lunch_break';
            const isGrouping = e.blockType === 'grouping';
            const isCover    = e.blockType === 'lunch_cover' || e.blockType === 'float_move';
            const isLeave    = e.staffType === 'leave';
            const isFloat    = e.staffType === 'float' || e.staffType === 'iss';
            const isMorningFG  = isGrouping && parseInt(e.inTime) < 12;
            const isAfternoonFG = isGrouping && parseInt(e.inTime) >= 12;
            const bg = isLunch ? '#fffbeb'
              : isMorningFG  ? '#f0fdf4'
              : isAfternoonFG ? '#faf5ff'
              : isLeave ? '#fef2f2' : isFloat ? '#eff6ff' : isCover ? '#f0fdf4' : 'white';
            const fgBadge = isMorningFG ? 'Morning FG' : isAfternoonFG ? 'Afternoon FG' : '';
            const nameCell = prevSame
              ? `&nbsp;&nbsp;└ ${e.name}`
              : `${e.name}${isFloat ? ` <span class="badge ${e.staffType}">${e.staffType === 'iss' ? 'ISS' : 'Float'}</span>` : isLeave ? ' <span class="badge leave">Leave</span>' : isGrouping ? ` <span class="badge grouping">${fgBadge}</span>` : ''}`;
            const typeLabel = isLunch ? 'Lunch' : isMorningFG ? 'Morning FG' : isAfternoonFG ? 'Afternoon FG' : e.blockType === 'lunch_cover' ? 'Lunch cover' : e.blockType === 'float_move' ? 'Float' : isLeave ? 'Leave' : 'Shift';
            return `<tr style="background:${bg}">
              <td>${nameCell}</td>
              <td>${isLunch ? '🍽 ' : isCover ? '↳ ' : isMorningFG ? '🌅 ' : isAfternoonFG ? '🌆 ' : ''}${e.room}</td>
              <td><strong>${e.inTime}</strong></td>
              <td>${e.outTime}</td>
              <td><span style="font-size:9px">${typeLabel}</span></td>
              <td>${(() => { const r2 = wwccLookup(e.name); const noData = !r2||(!r2.wwcc_number&&!r2.under_18); const rl = e.room.toLowerCase(); if (noData && ['chef','kitchen','cook'].some(kw => rl.includes(kw))) return '<span style="color:#854d0e;font-size:10px">Kitchen Staff</span>'; if (noData) return '<em>—</em>'; if (r2&&r2.under_18) return '<span style="color:#1d4ed8;font-size:10px">Under 18</span>'; return r2&&r2.wwcc_number ? r2.wwcc_number + (r2.wwcc_expiry ? '<br><small>Exp: ' + new Date(r2.wwcc_expiry).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) + '</small>' : '') : '<em>—</em>'; })()}</td>
              <td>${e.note ?? '—'}</td>
            </tr>`;
          }).join('');

          const uniqueNames = new Set(filtered.map(e => e.name));
          return `
            <div class="day-block">
              <div class="day-header">
                <span class="campus">${campus}${roomFilter !== 'all' ? ` - ${roomFilter}` : ''}</span>
                <span class="date">${safeFormat(new Date(date), 'EEEE, d MMMM yyyy')}</span>
                <span class="count">${uniqueNames.size} staff · ${filtered.length} blocks</span>
              </div>
              <table>
                <thead><tr><th>Educator</th><th>Room / Location</th><th>In</th><th>Out</th><th>Type</th><th>WWCC No.</th><th>Notes</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;
        }).join('')
      : '';

    // ── Build ratio table rows ────────────────────────────────────────────
    const ratioHtml = activeReport === 'ratio'
      ? `<table>
          <thead><tr><th>Date</th><th>Campus</th><th>Children</th><th>Required</th><th>Compliant</th></tr></thead>
          <tbody>
            ${ratioSnaps.map(s => `
              <tr style="background:${s.compliant ? '#f0fdf4' : '#fef2f2'}">
                <td>${safeFormat(new Date(s.date), 'd MMM yyyy')}</td>
                <td>${s.campus}</td>
                <td>${s.children}</td>
                <td>${s.required}</td>
                <td style="font-weight:700;color:${s.compliant ? '#16a34a' : '#dc2626'}">${s.compliant ? '✅ Yes' : '❌ No'}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
      : '';

    const reportTitle = activeReport === 'educator' ? 'Regulation 151 - Daily Educator Record'
      : activeReport === 'ratio' ? 'Ratio Compliance Report'
      : 'Trends Report';

    win.document.write(`<!DOCTYPE html>
<html><head>
  <title>TGA - ${reportTitle}</title>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; background: white; padding: 20px; }
    .report-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; border-bottom: 2px solid #2d5c18; padding-bottom: 12px; }
    .report-header .left h1 { font-size: 15px; color: #2d5c18; margin-bottom: 2px; }
    .report-header .left p  { font-size: 11px; color: #555; }
    .report-header .right   { text-align: right; font-size: 10px; color: #777; }
    .reg-notice { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; font-size: 10px; color: #166534; }
    .day-block  { margin-bottom: 24px; page-break-inside: avoid; }
    .day-header { display: flex; align-items: center; gap: 16px; background: #2d5c18; color: white; padding: 8px 12px; border-radius: 6px 6px 0 0; font-size: 11px; }
    .day-header .campus { font-weight: 700; font-size: 12px; }
    .day-header .date   { opacity: 0.85; }
    .day-header .count  { margin-left: auto; opacity: 0.7; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    thead tr { background: #f0fdf4; }
    th { padding: 6px 8px; text-align: left; font-weight: 600; color: #2d5c18; border-bottom: 1px solid #bbf7d0; white-space: nowrap; }
    td { padding: 5px 8px; border-bottom: 1px solid #e5f0e5; vertical-align: middle; }
    td.break { color: #b45309; font-weight: 600; }
    tr:nth-child(even) td { background: #fafffe; }
    .section-divider td { background: #f1f5f9 !important; color: #64748b; font-weight: 600; font-size: 10px; padding: 4px 8px; text-transform: uppercase; letter-spacing: 0.05em; border-top: 1px solid #e2e8f0; }
    .badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 999px; vertical-align: middle; margin-left: 3px; }
    .badge.float    { background: #dbeafe; color: #1d4ed8; }
    .badge.iss     { background: #ede9fe; color: #6d28d9; }
    .badge.leave   { background: #fee2e2; color: #dc2626; }
    .badge.grouping{ background: #d1fae5; color: #065f46; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e5f0e5; font-size: 9px; color: #aaa; text-align: center; }
    @media print {
      body { padding: 10px; font-size: 10px; }
      .day-block { page-break-inside: avoid; }
      .no-print { display: none; }
      @page { margin: 15mm; size: A4 landscape; }
    }
  </style>
</head><body>
  <div class="report-header">
    <div class="left">
      <h1>The Grove Academy - ${reportTitle}</h1>
      <p>${scopeLabel} &nbsp;·&nbsp; ${dateLabel}</p>
    </div>
    <div class="right">
      Generated: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' })}<br/>
      <button class="no-print" onclick="window.print()" style="margin-top:6px;padding:4px 12px;background:#2d5c18;color:white;border:none;border-radius:4px;cursor:pointer;font-size:10px">⎙ Print / Save PDF</button>
    </div>
  </div>
  ${activeReport === 'educator' ? '<div class="reg-notice"><strong>Regulation 151 Record</strong> - Documents which educators were working directly with children, which room/group they were allocated to, and the times of allocation including scheduled meal breaks. WWCC numbers are held in the staff compliance register.</div>' : ''}
  ${educatorHtml}${ratioHtml}
  <div class="footer">The Grove Academy Plan of Day System - Confidential - For regulatory compliance purposes only</div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  };

  // Get selected centre objects
  const selectedCentres = scopeType === 'all'
    ? allowed
    : scopeType === 'cluster'
    ? allowed.filter(c => CLUSTERS[cluster]?.includes(c.id))
    : allowed.filter(c => c.id === centreId);

  const generate = useCallback(async () => {
    setLoading(true);
    setGenerated(false);
    const rows: typeof educatorRows = [];
    const snaps: RatioSnap[] = [];
    const groupingTrendRows: { date: string; campus: string; sessions: any[] }[] = [];

    // Generate dates in range - use UTC noon to avoid timezone-induced off-by-one
    const dates: string[] = [];
    let cur = fromDate;
    while (cur <= toDate) {
      const [y, m, dy] = cur.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, dy)).getUTCDay();
      if (dow !== 0 && dow !== 6) dates.push(cur); // weekdays only
      cur = new Date(Date.UTC(y, m - 1, dy + 1)).toISOString().slice(0, 10);
    }

    for (const centre of selectedCentres) {
      const campus = centre.ownaName ?? centre.name;
      const allUnitIds = [
        ...centre.rooms.map(r => r.deputyUnitId),
        ...(centre.floatUnitIds ?? []),
        ...(centre.issUnitIds ?? []),
        ...(centre.leaveUnitIds ?? []),
        ...(centre.nonRatioUnitIds ?? []),
      ];

      for (const date of dates) {
        // Fetch in parallel
        const [att, rosters, allocations, floatScheds, groupingSessionRows, ratioCheckRows] = await Promise.all([
          fetchAttendance(campus, date),
          fetchRostersForDate(allUnitIds, date),
          fetch(`/api/staff-allocations?centre=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`/api/float-schedules?centre=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`/api/grouping-sessions?centre=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`/api/ratio-check?centre_id=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []),
        ]);
        groupingTrendRows.push({ date, campus, sessions: groupingSessionRows as any[] });

        // Build combined staffMoves + FG configs from all ratio-check sessions
        const ratioStaffMoves: Record<string, string> = {};
        const ratioFGConfigs: Array<{ id: string; label: string; roomIds: string[]; slots: string[]; heldInRoom?: string }> = [];
        for (const row of (ratioCheckRows as any[])) {
          const moves = (row.data?.staffMoves ?? {}) as Record<string, string>;
          Object.assign(ratioStaffMoves, moves);
          for (const fg of (row.data?.familyGroupings ?? [])) {
            if (!ratioFGConfigs.find(f => f.id === fg.id)) ratioFGConfigs.push(fg);
          }
        }

        // ── Educator record — built from Ratio Check state ─────────────────────────
        // Priority chain mirrors RatioCheckPanel exactly:
        //   1. Per-slot ratioStaffMoves (explicit drag)
        //   2. Float schedule off-floor (programming / cleaning / lunch)
        //   3. Float schedule covering a room
        //   4. Day-level staff-allocation override
        //   5. Natural Deputy room
        // Then confirmed family groupings are overlaid on top.

        const ALL_SLOTS_151: string[] = [];
        for (let m = 7 * 60; m <= 18 * 60; m += 15) {
          ALL_SLOTS_151.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
        }
        function sm151(slot: string): number {
          const [h, mm] = slot.split(':').map(Number); return h * 60 + mm;
        }

        // Build off-floor and float-covering maps from float schedules
        const offFloor151: Record<string, Set<number>> = {};
        const floatCovers151: Record<string, Record<string, number[]>> = {};
        for (const slot of ALL_SLOTS_151) {
          const slotM = sm151(slot);
          const off = new Set<number>();
          const cover: Record<string, number[]> = {};
          for (const fsRow of (floatScheds as any[])) {
            const floatId = fsRow.employee_id as number;
            for (const block of (fsRow.schedule ?? [])) {
              const bS = sm151(String(block.startTime ?? '00:00'));
              const bE = sm151(String(block.endTime   ?? '00:00'));
              if (slotM < bS || slotM >= bE) continue;
              const covId = block.coveringEmployeeId as number | undefined;
              if (covId) {
                const ct = String(block.coverType ?? '').toLowerCase();
                if (ct === 'programming' || ct === 'cleaning') off.add(covId);
                if (block.type === 'break' && ct !== 'ratio') off.add(covId);
              }
              if (block.roomId && floatId) {
                if (!cover[block.roomId]) cover[block.roomId] = [];
                if (!cover[block.roomId].includes(floatId)) cover[block.roomId].push(floatId);
              }
            }
          }
          offFloor151[slot] = off;
          floatCovers151[slot] = cover;
        }

        // Day-level allocations from staff-allocations
        const dayAlloc151: Record<number, string> = (allocations as any[])[0]?.moves ?? {};

        // Helper: get a staff member's room/activity at a given slot
        function posAt(empId: number, slot: string): { room: string; blockType: EducatorEntry['blockType']; note?: string } {
          const key = `${empId}:${slot}`;
          const move = ratioStaffMoves[key];
          if (move !== undefined) {
            if (move === '__programming__') return { room: 'Programming', blockType: 'shift', note: 'Programming' };
            if (move === '__cleaning__')    return { room: 'Cleaning',    blockType: 'shift', note: 'Cleaning' };
            if (move === '__lunch__')       return { room: 'Lunch Break', blockType: 'lunch_break' };
            if (move === '__additional__')  return { room: 'Additional Duties', blockType: 'shift' };
            if (move === '__removed__')     return { room: 'Off Roster', blockType: 'shift' };
            const r = centre.rooms.find(r => r.id === move);
            if (r) return { room: r.name, blockType: 'shift' };
          }
          // Float schedule off-floor
          const off = offFloor151[slot] ?? new Set<number>();
          if (off.has(empId)) {
            for (const fsRow of (floatScheds as any[])) {
              for (const block of (fsRow.schedule ?? [])) {
                if (block.coveringEmployeeId !== empId) continue;
                const bS = sm151(String(block.startTime ?? '00:00'));
                const bE = sm151(String(block.endTime   ?? '00:00'));
                if (sm151(slot) < bS || sm151(slot) >= bE) continue;
                const ct = String(block.coverType ?? '').toLowerCase();
                const floatName: string = fsRow.employee_name ?? '';
                if (ct === 'programming') return { room: 'Programming', blockType: 'shift', note: floatName ? `Programming — covered by ${floatName}` : 'Programming — covered by float' };
                if (ct === 'cleaning')    return { room: 'Cleaning',    blockType: 'shift', note: floatName ? `Cleaning — covered by ${floatName}` : 'Cleaning — covered by float' };
                return { room: 'Lunch Break', blockType: 'lunch_break', note: floatName ? `Meal break — covered by ${floatName}` : 'Meal break' };
              }
            }
            return { room: 'Lunch Break', blockType: 'lunch_break' };
          }
          // Float covering a room
          const covers = floatCovers151[slot] ?? {};
          for (const [roomId, empIds] of Object.entries(covers)) {
            if ((empIds as number[]).includes(empId)) {
              const r = centre.rooms.find(r => r.id === roomId);
              if (r) {
                // Find covering context from float schedule block
                let coverNote: string | undefined;
                for (const fsRow of (floatScheds as any[])) {
                  if (fsRow.employee_id !== empId) continue;
                  for (const block of (fsRow.schedule ?? [])) {
                    const bS = sm151(String(block.startTime ?? '00:00'));
                    const bE = sm151(String(block.endTime   ?? '00:00'));
                    if (sm151(slot) < bS || sm151(slot) >= bE) continue;
                    const ct = String(block.coverType ?? '').toLowerCase();
                    if (ct === 'lunch' && block.coveringEmployeeName) {
                      coverNote = `Covering lunch break for ${block.coveringEmployeeName}`;
                    } else if (ct === 'programming' && block.coveringEmployeeName) {
                      coverNote = `Covering programming for ${block.coveringEmployeeName}`;
                    } else if (ct === 'ratio') {
                      coverNote = 'Ratio cover';
                    }
                    break;
                  }
                  if (coverNote !== undefined) break;
                }
                return { room: r.name, blockType: 'shift', note: coverNote };
              }
            }
          }
          // Day-level allocation
          const dayRoom = dayAlloc151[empId];
          if (dayRoom) {
            const r = centre.rooms.find(r => r.id === dayRoom);
            if (r) return { room: r.name, blockType: 'shift' };
          }
          return { room: '', blockType: 'shift' }; // natural room — set by caller
        }

        const floatSet2 = new Set(centre.floatUnitIds ?? []);
        const issSet2   = new Set(centre.issUnitIds ?? []);
        const leaveSet2 = new Set(centre.leaveUnitIds ?? []);
        const roomSet2  = new Set(centre.rooms.map(r => r.deputyUnitId));

        const entries: EducatorEntry[] = [];

        for (const r of (rosters as any[])) {
          const unitId = r.OperationalUnit as number;
          const empId  = r.Employee as number;
          const name   = r._DPMetaData?.EmployeeInfo?.DisplayName ?? `Staff #${empId}`;
          if (name.startsWith('Staff #')) continue;
          const rawUnit = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '').toLowerCase();
          if (rawUnit.includes('staff meeting')) continue;

          const shiftIn  = fmtTime(r.StartTime);
          const shiftOut = fmtTime(r.EndTime);
          if (shiftIn === '-' || shiftOut === '-') continue;

          const staffType: EducatorEntry['staffType'] =
            leaveSet2.has(unitId) ? 'leave'
            : floatSet2.has(unitId) ? 'float'
            : issSet2.has(unitId)   ? 'iss'
            : roomSet2.has(unitId)  ? 'room'
            : 'support';

          if (staffType === 'leave') {
            const unitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? 'Leave';
            entries.push({ employeeId: empId, name, room: unitName, inTime: shiftIn, outTime: shiftOut, blockType: 'leave', staffType: 'leave', note: unitName });
            continue;
          }

          // Natural room name — for non-ratio support staff use the actual Deputy unit name
          // so kitchen/chef staff can be identified by keyword in the WWCC column
          const naturalRoom = centre.rooms.find(rm => rm.deputyUnitId === unitId);
          const deputyUnitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '';
          const naturalRoomName = naturalRoom?.name ?? (
            staffType === 'float' ? 'Float Pool'
            : staffType === 'iss' ? 'ISS'
            : deputyUnitName || 'Support'
          );

          // Build slot-by-slot position, then merge consecutive same-position slots
          const shiftInM  = sm151(shiftIn);
          const shiftOutM = sm151(shiftOut);
          const shiftSlots = ALL_SLOTS_151.filter(s => {
            const m = sm151(s);
            return m >= shiftInM && m < shiftOutM;
          });
          if (shiftSlots.length === 0) continue;

          // Position at each slot (including FG override)
          const positions: Array<{ slot: string; room: string; blockType: EducatorEntry['blockType']; note?: string }> = [];
          for (const slot of shiftSlots) {
            // Check if a confirmed FG covers this employee at this slot
            let fgPos: { room: string; blockType: EducatorEntry['blockType']; note?: string } | null = null;
            if (naturalRoom && !ratioStaffMoves[`${empId}:${slot}`]) {
              for (const fg of ratioFGConfigs) {
                if (!fg.slots.includes(slot)) continue;
                const fgRoomIds = fg.roomIds.length === 0 ? centre.rooms.map(r => r.id) : fg.roomIds;
                if (fgRoomIds.includes(naturalRoom.id)) {
                  const heldIn = fg.heldInRoom ? (centre.rooms.find(r => r.id === fg.heldInRoom)?.name ?? fg.label) : fg.label;
                  fgPos = { room: heldIn, blockType: 'grouping' as EducatorEntry['blockType'], note: `${fg.label} — held in ${heldIn}` };
                  break;
                }
              }
            }
            if (fgPos) {
              positions.push({ slot, ...fgPos });
            } else {
              const pos = posAt(empId, slot);
              const room = pos.room || naturalRoomName;
              positions.push({ slot, room, blockType: pos.blockType, note: pos.note });
            }
          }

          // Merge consecutive same-room/blockType slots
          let i = 0;
          while (i < positions.length) {
            const start = positions[i];
            let j = i + 1;
            while (j < positions.length && positions[j].room === start.room && positions[j].blockType === start.blockType) j++;
            const lastSlot = positions[j - 1].slot;
            const endMins = sm151(lastSlot) + 15;
            const endTime = `${String(Math.floor(endMins/60)).padStart(2,'0')}:${String(endMins%60).padStart(2,'0')}`;
            if (start.room && start.room !== 'Off Roster') {
              entries.push({
                employeeId: empId,
                name,
                room: start.room,
                inTime: start.slot,
                outTime: endTime,
                blockType: start.blockType,
                staffType,
                note: start.note,
              });
            }
            i = j;
          }
        }

        // Overlay confirmed family groupings (same logic as before)
        const confirmedGroupings = (groupingSessionRows as any[]).filter(gs =>
          ['confirmed', 'auto-confirmed', 'modified'].includes(gs.confirmation_status)
        );
        if (confirmedGroupings.length > 0) {
          for (const gs of confirmedGroupings) {
            const gStart = gs.session_start as string;
            const gEnd   = gs.session_end   as string;
            const gLabel = gs.group_label   as string;
            const heldInId   = gs.held_in_room as string | undefined;
            const heldInRoom = centre.rooms.find(r => r.id === heldInId)?.name ?? gLabel;
            const staffIds: number[] = gs.staff_ids ?? [];
            const staffNames: string[] = gs.staff_names ?? [];
            const staffRoomIds: string[] = gs.staff_rooms ?? [];
            const isAdditional = (empId: number) =>
              ratioStaffMoves[`${empId}:${gStart}`] === '__additional__';

            for (const entry of [...entries]) {
              if (!staffIds.includes(entry.employeeId)) continue;
              if (entry.outTime <= gStart || entry.inTime >= gEnd) continue;
              if (entry.blockType === 'leave') continue;
              const si = staffIds.indexOf(entry.employeeId);
              const subRoomId = staffRoomIds[si];
              const subRoom = centre.rooms.find(r => r.id === subRoomId)?.name ?? heldInRoom;
              const roomLabel = isAdditional(entry.employeeId)
                ? 'Additional Duties'
                : gLabel + (subRoom && subRoom !== gLabel ? ` - ${subRoom}` : '');
              const bType = isAdditional(entry.employeeId) ? 'shift' : 'grouping';
              // Split entry around grouping window
              const origIn = entry.inTime, origOut = entry.outTime;
              entry.inTime = 'REMOVE';
              if (origIn < gStart) {
                entries.push({ ...entry, inTime: origIn, outTime: gStart, blockType: 'shift', room: entry.room });
              }
              const gEffIn  = origIn  < gStart ? gStart : origIn;
              const gEffOut = origOut > gEnd   ? gEnd   : origOut;
              entries.push({ ...entry, inTime: gEffIn, outTime: gEffOut, room: roomLabel, blockType: bType, note: `Held in ${heldInRoom}` });
              if (origOut > gEnd) {
                entries.push({ ...entry, inTime: gEnd, outTime: origOut, blockType: 'shift', room: entry.room });
              }
            }
            // Remove entries marked for removal
            for (let i = entries.length - 1; i >= 0; i--) {
              if (entries[i].inTime === 'REMOVE') entries.splice(i, 1);
            }
            // Synthetic entries for grouping staff not in roster
            const addedIds = new Set(entries.filter(e => staffIds.includes(e.employeeId) && e.blockType === 'grouping').map(e => e.employeeId));
            for (let si = 0; si < staffIds.length; si++) {
              const empId = staffIds[si];
              if (addedIds.has(empId)) continue;
              const empName = staffNames[si];
              if (!empName) continue;
              const subRoomId = staffRoomIds[si];
              const subRoom = centre.rooms.find(r => r.id === subRoomId)?.name ?? heldInRoom;
              const roomLabel = isAdditional(empId) ? 'Additional Duties' : gLabel + (subRoom && subRoom !== gLabel ? ` - ${subRoom}` : '');
              entries.push({ employeeId: empId, name: empName, room: roomLabel, inTime: gStart, outTime: gEnd, blockType: isAdditional(empId) ? 'shift' : 'grouping', staffType: 'room', note: `Held in ${heldInRoom}` });
            }
          }
        }

        if (entries.length > 0) {
          // Sort by staff name, then by inTime within each person
          entries.sort((a, b) => {
            const nameDiff = a.name.localeCompare(b.name);
            return nameDiff !== 0 ? nameDiff : a.inTime.localeCompare(b.inTime);
          });
          // Collect all unique rooms for the filter dropdown
          const allRooms = [...new Set(entries.map(e => e.room).filter(r => r !== 'Lunch Break'))].sort();
          rows.push({ date, campus, entries, allRooms });
        }

        // ── Ratio snapshot ───────────────────────────────────────────────────
        let required = 0;
        for (const room of centre.rooms) {
          const owna = (room.ownaRoomName ?? room.name).toLowerCase();
          const rk = (att as any[]).filter((c: any) => c.room?.toLowerCase().includes(owna));
          const { required: rq } = calcRequiredStaff(rk.map((c: any) => ({ ageMonths: parseAgeMonths(c.age) } as any)));
          required += rq;
        }
        const roomUnitIds = new Set(centre.rooms.map(r => r.deputyUnitId));
        const staffCount = new Set((rosters as any[]).filter(r => roomUnitIds.has(r.OperationalUnit)).map(r => r.Employee)).size;
        const floatCount = new Set((rosters as any[]).filter(r => (centre.floatUnitIds??[]).includes(r.OperationalUnit)).map(r => r.Employee)).size;

        snaps.push({
          date, campus,
          children:  (att as any[]).filter((c: any) => c.sign_in).length,
          required,
          compliant: staffCount + floatCount >= required,
        });
      }
    }

    setEducatorRows(rows);
    setRatioSnaps(snaps);
    setGroupingTrends(groupingTrendRows);
    setGenerated(true);

    // Fetch WWCC data for all unique educators in this report
    const uniqueNames = [...new Set(rows.flatMap(r => r.entries.map(e => e.name)))];
    if (uniqueNames.length > 0) {
      fetch('/api/staff-wwcc')
        .then(r => r.ok ? r.json() : [])
        .then((records: { full_name: string; full_name_norm: string; wwcc_number: string | null; wwcc_expiry: string | null; under_18: boolean }[]) => {
          // Strip hyphens/apostrophes/spaces for fuzzy comparison
          const bare = (s: string) => s.replace(/[-'\s]/g, '').toLowerCase();

          // Build indexes
          const exactMap: Record<string, WwccRec>   = {}; // full_name_norm → rec
          const strippedMap: Record<string, WwccRec> = {}; // bare(norm) → rec (first wins)
          const lastNameMap: Record<string, typeof records> = {}; // bare(lastName) → [recs]

          for (const rec of records) {
            const entry: WwccRec = { wwcc_number: rec.wwcc_number, wwcc_expiry: rec.wwcc_expiry, under_18: rec.under_18 ?? false };
            exactMap[rec.full_name_norm] = entry;

            const b = bare(rec.full_name_norm);
            if (!strippedMap[b]) strippedMap[b] = entry;

            const parts = rec.full_name_norm.replace(/[-']/g, ' ').trim().split(/\s+/);
            const lastName = bare(parts[parts.length - 1]);
            if (lastName) {
              if (!lastNameMap[lastName]) lastNameMap[lastName] = [];
              lastNameMap[lastName].push(rec);
            }
          }

          /**
           * Multi-strategy lookup:
           * 1. Exact normalised match
           * 2. Bare match (strip hyphens/apostrophes/spaces) — catches Al-Maarrawie vs Almaarrawie
           * 3. Unique last-name match — catches any first-name mismatch when surname is unique
           * 4. Same last-name + matching first initial — narrows when multiple share a surname
           */
          const lookup = (name: string): WwccRec | null => {
            const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();

            // 1. Exact
            if (exactMap[norm]) return exactMap[norm];

            // 2. Bare (hyphens/apostrophes stripped)
            const b = bare(norm);
            if (strippedMap[b]) return strippedMap[b];

            // Build last name from lookup name
            const parts = norm.replace(/[-']/g, ' ').trim().split(/\s+/);
            const lastName = bare(parts[parts.length - 1]);
            const candidates = lastNameMap[lastName] ?? [];

            // 3. Unique last name — any first name mismatch is fine
            if (candidates.length === 1) {
              const c = candidates[0];
              return { wwcc_number: c.wwcc_number, wwcc_expiry: c.wwcc_expiry, under_18: c.under_18 ?? false };
            }

            // 4. Multiple with same last name — narrow by first initial
            if (candidates.length > 1 && parts.length > 1) {
              const firstInitial = bare(parts[0])[0];
              const initialMatches = candidates.filter(c => {
                const cParts = c.full_name_norm.replace(/[-']/g, ' ').trim().split(/\s+/);
                return bare(cParts[0])[0] === firstInitial;
              });
              if (initialMatches.length === 1) {
                const m = initialMatches[0];
                return { wwcc_number: m.wwcc_number, wwcc_expiry: m.wwcc_expiry, under_18: m.under_18 ?? false };
              }
            }

            return null;
          };

          setWwccLookup(() => lookup);
          setWwccMap(exactMap); // keep for print view
        })
        .catch(() => {});
    }

    setLoading(false);
  }, [selectedCentres, fromDate, toDate]); // eslint-disable-line

  // Group ratio snaps by campus for trends
  const centreSnaps: Record<string, RatioSnap[]> = {};
  for (const s of ratioSnaps) {
    (centreSnaps[s.campus] ??= []).push(s);
  }

  const btn = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all';
  const inputCls = 'border rounded-xl px-3 py-2 text-sm';
  const inputStyle = { borderColor: '#D0E8B8', color: '#050505' };

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#050505' }}>Reporting</h1>
          <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
            Regulation 151 compliance records · Ratio analysis · Educator placement history
          </p>
        </div>
        <div className="flex gap-2">
          {generated && (
            <button onClick={handlePrint}
              className={btn + ' border'} style={{ borderColor: '#D0E8B8', color: '#5a9228' }}>
              🖨️ Print / PDF
            </button>
          )}
          <button onClick={() => navigate('/')}
            className={btn + ' border'} style={{ borderColor: '#D0E8B8', color: '#5a9228' }}>
            ← Back
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border p-5 mb-6" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Scope type */}
          <div>
            <label className="text-xs mb-1.5 block font-semibold" style={{ color: '#596570' }}>Scope</label>
            <div className="flex gap-1">
              {(['centre','cluster','all'] as const).map(s => (
                <button key={s} onClick={() => setScopeType(s)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold"
                  style={scopeType === s
                    ? { backgroundColor: '#2d5c18', color: 'white' }
                    : { backgroundColor: 'white', color: '#5a9228', border: '1px solid #D0E8B8' }}>
                  {s === 'centre' ? 'Centre' : s === 'cluster' ? 'Cluster' : 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Centre / cluster selector */}
          <div>
            <label className="text-xs mb-1.5 block font-semibold" style={{ color: '#596570' }}>
              {scopeType === 'cluster' ? 'Cluster' : 'Centre'}
            </label>
            {scopeType === 'centre' ? (
              <select className={inputCls + ' w-full'} style={inputStyle}
                value={centreId} onChange={e => setCentreId(e.target.value)}>
                {allowed.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : scopeType === 'cluster' ? (
              <select className={inputCls + ' w-full'} style={inputStyle}
                value={cluster} onChange={e => setCluster(e.target.value)}>
                {Object.keys(CLUSTERS).map(cl => <option key={cl} value={cl}>{cl}</option>)}
              </select>
            ) : (
              <div className="py-2 text-sm" style={{ color: '#5a9228' }}>
                {allowed.length} centres
              </div>
            )}
          </div>

          {/* Date range */}
          <div>
            <label className="text-xs mb-1.5 block font-semibold" style={{ color: '#596570' }}>From</label>
            <input type="date" className={inputCls + ' w-full'} style={inputStyle}
              value={fromDate} max={toDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs mb-1.5 block font-semibold" style={{ color: '#596570' }}>To</label>
            <input type="date" className={inputCls + ' w-full'} style={inputStyle}
              value={toDate} min={fromDate} max={todayStr()} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>

        {/* Quick date presets */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {[
            { label: 'Today',      days: 0 },
            { label: 'This week',  days: 6 },
            { label: 'Last week',  days: 13, offset: 7 },
            { label: 'This month', days: 29 },
          ].map(({ label, days, offset = 0 }) => (
            <button key={label} onClick={() => {
              const todayVal = todayStr();
              const [ty, tm, tdy] = todayVal.split('-').map(Number);
              const endStr   = new Date(Date.UTC(ty, tm - 1, tdy - offset)).toISOString().slice(0, 10);
              const [ey, em, edy] = endStr.split('-').map(Number);
              const startStr = new Date(Date.UTC(ey, em - 1, edy - days)).toISOString().slice(0, 10);
              setToDate(endStr);
              setFromDate(startStr);
            }}
              className="text-xs px-3 py-1.5 rounded-lg border"
              style={{ borderColor: '#D0E8B8', color: '#5a9228', backgroundColor: 'white' }}>
              {label}
            </button>
          ))}
        </div>

        <button onClick={generate} disabled={loading}
          className={btn + ' mt-4 text-white disabled:opacity-50'}
          style={{ backgroundColor: '#5a9228' }}>
          {loading ? '⟳ Generating...' : '📊 Generate Report'}
        </button>
      </div>

      {/* Report tabs */}
      {generated && (
        <>
          <div className="flex gap-2 mb-5">
            {(['educator','ratio','trends'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveReport(tab)}
                className={btn}
                style={activeReport === tab
                  ? { backgroundColor: '#2d5c18', color: 'white' }
                  : { backgroundColor: 'white', color: '#2d5c18', border: '1px solid #D0E8B8' }}>
                {tab === 'educator' ? '📋 Educator Record (Reg 151)' : tab === 'ratio' ? '📐 Ratio Report' : '📈 Trends'}
              </button>
            ))}
          </div>

          <div ref={printRef}>

            {/* ── EDUCATOR RECORD ── */}
            {activeReport === 'educator' && (
              <div className="space-y-6">
                {/* Reg 151 banner */}
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                  <strong>Regulation 151 Record</strong> - Each row is a single time block: one educator, one room, one period. Float movements are broken into individual blocks. Linked to the Plan of Day float schedule and lunch planner.
                </div>

                {/* Room filter */}
                {educatorRows.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium" style={{ color: '#2d5c18' }}>Filter by room:</span>
                    <select
                      value={roomFilter}
                      onChange={e => setRoomFilter(e.target.value)}
                      className="border rounded-xl px-3 py-1.5 text-sm"
                      style={{ borderColor: '#D0E8B8', color: '#2d5c18' }}
                    >
                      <option value="all">All rooms</option>
                      {[...new Set(educatorRows.flatMap(r => r.allRooms))].sort().map(room => (
                        <option key={room} value={room}>{room}</option>
                      ))}
                    </select>
                    {roomFilter !== 'all' && (
                      <button onClick={() => setRoomFilter('all')}
                        className="text-xs px-2 py-1 rounded-lg border"
                        style={{ borderColor: '#D0E8B8', color: '#596570' }}>Clear</button>
                    )}
                  </div>
                )}

                {educatorRows.length === 0 ? (
                  <div className="text-sm italic" style={{ color: '#596570' }}>No educator records found for the selected period.</div>
                ) : (
                  educatorRows.map(({ date, campus, entries, allRooms: _ }) => {
                    const filtered = roomFilter === 'all'
                      ? entries
                      : entries.filter(e => e.room === roomFilter || (e.blockType === 'lunch_break' &&
                          // show lunch breaks for people who work in the filtered room
                          entries.some(other => other.employeeId === e.employeeId && other.room === roomFilter)));

                    if (filtered.length === 0) return null;

                    const uniqueNames = new Set(filtered.map(e => e.name));
                    const roomStaff  = new Set(entries.filter(e => e.staffType === 'room').map(e => e.name));
                    const floatStaff = new Set(entries.filter(e => e.staffType === 'float' || e.staffType === 'iss').map(e => e.name));
                    const leaveStaff = new Set(entries.filter(e => e.staffType === 'leave').map(e => e.name));

                    return (
                    <div key={`${date}-${campus}`} className="rounded-2xl border overflow-hidden"
                      style={{ borderColor: '#E2F1DA' }}>
                      {/* Day header */}
                      <div className="px-5 py-3 flex items-center justify-between"
                        style={{ backgroundColor: '#2d5c18' }}>
                        <div>
                          <div className="font-bold text-sm text-white">{campus}{roomFilter !== 'all' ? ` - ${roomFilter}` : ''}</div>
                          <div className="text-xs" style={{ color: '#A0D083' }}>{safeFormat(new Date(date), 'EEEE d MMMM yyyy')}</div>
                        </div>
                        <div className="text-xs text-white opacity-70">
                          {uniqueNames.size} staff · {roomStaff.size} room
                          {floatStaff.size > 0 && ` · ${floatStaff.size} float/ISS`}
                          {leaveStaff.size > 0 && ` · ${leaveStaff.size} on leave`}
                          {filtered.length} blocks
                        </div>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ backgroundColor: '#F5FAF3' }}>
                              {['Educator','Room / Location','In','Out','Type','WWCC No.','Notes'].map(h => (
                                <th key={h} className="py-2 px-4 text-xs font-semibold text-left" style={{ color: '#5a9228' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((e, i) => {
                              const isLunch       = e.blockType === 'lunch_break';
                              const isGrouping    = e.blockType === 'grouping';
                              const isMorningFG   = isGrouping && parseInt(e.inTime) < 12;
                              const isAfternoonFG = isGrouping && parseInt(e.inTime) >= 12;
                              const isFloat    = e.staffType === 'float' || e.staffType === 'iss';
                              const isLeave    = e.staffType === 'leave';
                              const isCover    = e.blockType === 'lunch_cover' || e.blockType === 'float_move';
                              const prevSame   = i > 0 && filtered[i-1].employeeId === e.employeeId;
                              const bg = isLunch       ? '#fffbeb'
                                : isMorningFG   ? '#f0fdf4'
                                : isAfternoonFG ? '#faf5ff'
                                : isLeave    ? '#fef2f2'
                                : isFloat    ? '#eff6ff'
                                : isCover    ? '#f0fdf4'
                                : i % 2 === 0 ? 'white' : '#fafffe';
                              const fgColor = isMorningFG ? '#166534' : '#6d28d9';

                              return (
                              <tr key={`${e.employeeId}-${e.inTime}-${e.room}-${i}`}
                                className="border-t"
                                style={{ borderColor: prevSame ? '#f3f4f6' : '#E2F1DA', backgroundColor: bg }}>
                                <td className="py-2 px-4 font-medium" style={{ color: '#050505' }}>
                                  {prevSame
                                    ? <span style={{ color: '#9ca3af' }}>└ {e.name}</span>
                                    : <span>{e.name}
                                        {isFloat && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>{e.staffType === 'iss' ? 'ISS' : 'Float'}</span>}
                                        {isLeave && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>Leave</span>}
                                        {isMorningFG && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>Morning FG</span>}
                                        {isAfternoonFG && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }}>Afternoon FG</span>}
                                      </span>
                                  }
                                </td>
                                <td className="py-2 px-4" style={{ color: isLunch ? '#d97706' : isGrouping ? fgColor : '#050505', fontWeight: isLunch || isGrouping ? 600 : 400 }}>
                                  {isLunch ? '🍽 ' : isCover ? '↳ ' : isMorningFG ? '🌅 ' : isAfternoonFG ? '🌆 ' : ''}{e.room}
                                </td>
                                {/* In */}
                                <td className="py-2 px-4 font-medium" style={{ color: '#2d5c18' }}>{e.inTime}</td>
                                {/* Out */}
                                <td className="py-2 px-4 font-medium" style={{ color: '#596570' }}>{e.outTime}</td>
                                {/* Type badge */}
                                <td className="py-2 px-4">
                                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                    style={{
                                      backgroundColor: isLunch ? '#fef3c7' : isGrouping ? '#d1fae5' : isCover ? '#dcfce7' : isLeave ? '#fee2e2' : isFloat ? '#dbeafe' : '#f0fdf4',
                                      color: isLunch ? '#92400e' : isGrouping ? '#065f46' : isCover ? '#166534' : isLeave ? '#dc2626' : isFloat ? '#1d4ed8' : '#166534',
                                    }}>
                                    {isLunch ? 'Lunch' : isGrouping ? 'Grouped' : e.blockType === 'lunch_cover' ? 'Lunch cover' : e.blockType === 'float_move' ? 'Float' : isLeave ? 'Leave' : 'Shift'}
                                  </span>
                                </td>
                                <td className="py-2 px-4">
                                  {(() => {
                                    const rec = wwccLookup(e.name);
                                    // Treat a record with no WWCC number and not under_18 the same as no record
                                    const noUsefulData = !rec || (!rec.wwcc_number && !rec.under_18);
                                    const roomLower = e.room.toLowerCase();
                                    const isKitchen = noUsefulData && ['chef','kitchen','cook'].some(k => roomLower.includes(k));
                                    if (isKitchen) return (
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>Kitchen Staff</span>
                                    );
                                    if (noUsefulData) return <span className="text-xs italic" style={{ color: '#9ca3af' }}>—</span>;
                                    if (rec!.under_18) return (
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>Under 18</span>
                                    );
                                    const expDate = rec.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;
                                    const today   = new Date();
                                    const daysLeft = expDate ? Math.ceil((expDate.getTime() - today.getTime()) / 86400000) : null;
                                    const expColour = daysLeft === null ? '#9ca3af'
                                      : daysLeft < 0    ? '#dc2626'   // expired
                                      : daysLeft < 90   ? '#d97706'   // expiring soon
                                      : '#059669';                     // valid
                                    const expLabel = expDate
                                      ? `Exp: ${expDate.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' })}`
                                      : '';
                                    return (
                                      <div>
                                        <div className="text-xs font-mono font-medium" style={{ color: '#1e3a5f' }}>{rec.wwcc_number}</div>
                                        {expLabel && <div className="text-xs" style={{ color: expColour }}>{expLabel}{daysLeft !== null && daysLeft < 90 && daysLeft >= 0 ? ` (${daysLeft}d)` : daysLeft !== null && daysLeft < 0 ? ' ⚠ EXPIRED' : ''}</div>}
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td className="py-2 px-4 text-xs" style={{ color: e.note ? '#d97706' : '#9ca3af' }}>{e.note ?? '-'}</td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ── RATIO REPORT ── */}
            {activeReport === 'ratio' && (
              <div className="space-y-4">
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                  Summary of ratio compliance based on attendance snapshots. Each row represents one snapshot period.
                </div>
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ backgroundColor: '#F5FAF3' }}>
                        {['Date','Centre','Children','Required Staff','Status'].map(h => (
                          <th key={h} className="py-2 px-4 text-xs font-semibold text-left" style={{ color: '#5a9228' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ratioSnaps.length === 0 ? (
                        <tr><td colSpan={5} className="py-6 text-center text-sm italic" style={{ color: '#596570' }}>No data for selected period</td></tr>
                      ) : ratioSnaps.map((s, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: i%2===0?'white':'#fafffe' }}>
                          <td className="py-2 px-4" style={{ color: '#050505' }}>
                            {safeFormat(new Date(s.date), 'd MMM yyyy')}
                          </td>
                          <td className="py-2 px-4" style={{ color: '#050505' }}>{s.campus}</td>
                          <td className="py-2 px-4" style={{ color: '#596570' }}>{s.children}</td>
                          <td className="py-2 px-4" style={{ color: '#596570' }}>{s.required}</td>
                          <td className="py-2 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={s.compliant
                                ? { backgroundColor: '#bbf7d0', color: '#166534' }
                                : { backgroundColor: '#fecaca', color: '#991b1b' }}>
                              {s.compliant ? '✅ Compliant' : '⚠️ At Risk'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── TRENDS ── */}
            {activeReport === 'trends' && (
              <div className="space-y-6">
                {Object.entries(centreSnaps).map(([campus, snaps]) => {
                  const compliantDays = snaps.filter(s => s.compliant).length;
                  const pct = snaps.length ? Math.round(compliantDays / snaps.length * 100) : 0;
                  return (
                    <div key={campus} className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
                      <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: '#F5FAF3' }}>
                        <div className="font-bold text-sm" style={{ color: '#050505' }}>{campus}</div>
                        <div className="flex items-center gap-3">
                          <div className="text-xs" style={{ color: '#596570' }}>{snaps.length} days sampled</div>
                          <span className="text-sm font-bold" style={{ color: pct === 100 ? '#166534' : pct >= 80 ? '#d97706' : '#dc2626' }}>
                            {pct}% compliant
                          </span>
                        </div>
                      </div>
                      {/* Mini bar chart */}
                      <div className="px-5 py-4">
                        <div className="flex gap-1 h-16 items-end">
                          {snaps.map((s, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <div className="w-full rounded-t"
                                style={{
                                  height: `${Math.max(8, Math.min(52, (s.children / Math.max(...snaps.map(x=>x.children), 1)) * 52))}px`,
                                  backgroundColor: s.compliant ? '#A0D083' : '#fca5a5',
                                }}
                                title={`${s.date}: ${s.children} children, ${s.required} required, ${s.compliant ? 'compliant' : 'at risk'}`}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1 mt-1">
                          {snaps.map((s, i) => (
                            <div key={i} className="flex-1 text-center" style={{ fontSize: '9px', color: '#9ca3af' }}>
                              {safeFormat(new Date(s.date), 'd')}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: '#596570' }}>
                          <span>
                            <span className="inline-block w-3 h-3 rounded mr-1" style={{ backgroundColor: '#A0D083' }}/>
                            Compliant
                          </span>
                          <span>
                            <span className="inline-block w-3 h-3 rounded mr-1" style={{ backgroundColor: '#fca5a5' }}/>
                            At risk
                          </span>
                          <span className="ml-auto">
                            Avg attendance: {Math.round(snaps.reduce((s,x) => s+x.children,0)/snaps.length)} children/day
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

              {/* ─── Grouping Activity ─────────────────────────────────── */}
              {groupingTrends.length > 0 && (() => {
                const byCampus: Record<string, { date: string; sessions: any[] }[]> = {};
                for (const row of groupingTrends) {
                  if (row.sessions.length > 0) (byCampus[row.campus] ??= []).push(row);
                }
                const campuses = Object.keys(byCampus);
                if (!campuses.length) return null;
                return (
                  <div className="mt-6 space-y-4">
                    <div className="text-sm font-bold pb-1 border-b" style={{ color: '#050505', borderColor: '#E2F1DA' }}>
                      🏫 Room Grouping Activity
                    </div>
                    {campuses.map(campus => {
                      const days = byCampus[campus];
                      const familyDays = days.filter(d => d.sessions.some((s: any) => s.group_label === 'Family Grouping')).length;
                      const mixedDays  = days.filter(d => d.sessions.some((s: any) => s.group_label?.startsWith('Mixed'))).length;
                      return (
                        <div key={campus} className="rounded-2xl border overflow-hidden" style={{ borderColor: '#d1fae5' }}>
                          <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: '#ecfdf5' }}>
                            <span className="font-bold text-sm" style={{ color: '#065f46' }}>{campus}</span>
                            <div className="flex items-center gap-3 text-xs">
                              <span style={{ color: '#065f46' }}>{days.length} day{days.length !== 1 ? 's' : ''}</span>
                              {familyDays > 0 && <span className="px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>Family: {familyDays}d</span>}
                              {mixedDays > 0  && <span className="px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }}>Mixed: {mixedDays}d</span>}
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr style={{ backgroundColor: '#f0fdf4' }}>
                                {['Date','Group','Time','Staff','Children','Status'].map(h => (
                                  <th key={h} className="py-2 px-4 text-xs font-semibold text-left" style={{ color: '#065f46' }}>{h}</th>
                                ))}
                              </tr></thead>
                              <tbody>
                                {days.flatMap((d: { date: string; sessions: any[] }) =>
                                  d.sessions.map((s: any, si: number) => (
                                    <tr key={`${d.date}-${si}`} className="border-t" style={{ borderColor: '#d1fae5' }}>
                                      <td className="py-2 px-4 text-xs" style={{ color: '#596570' }}>{safeFormat(new Date(d.date), 'd MMM')}</td>
                                      <td className="py-2 px-4 font-medium" style={{ color: '#065f46' }}>{s.group_label}</td>
                                      <td className="py-2 px-4 text-xs" style={{ color: '#596570' }}>{s.session_start}-{s.session_end}</td>
                                      <td className="py-2 px-4 text-xs" style={{ color: '#374151' }}>{(s.staff_names ?? []).join(', ') || '-'}</td>
                                      <td className="py-2 px-4 text-xs" style={{ color: '#374151' }}>{s.children_count ?? 0}</td>
                                      <td className="py-2 px-4">
                                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                          style={{
                                            backgroundColor: s.confirmation_status === 'confirmed' ? '#dcfce7' : s.confirmation_status === 'auto-confirmed' ? '#fef3c7' : s.confirmation_status === 'modified' ? '#dbeafe' : '#f3f4f6',
                                            color: s.confirmation_status === 'confirmed' ? '#166534' : s.confirmation_status === 'auto-confirmed' ? '#92400e' : s.confirmation_status === 'modified' ? '#1d4ed8' : '#6b7280',
                                          }}>{s.confirmation_status}</span>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              </div>
            )}

          </div>
        </>
      )}

      <style>{`
        @media print {
          header, footer, nav, .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </Layout>
  );
}
