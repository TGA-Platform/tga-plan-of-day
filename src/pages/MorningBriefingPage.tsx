/**
 * Morning Briefing - landing page after login.
 * CEO: all centres grid.
 * Director: their centre(s) in detail.
 */
import { useState, useEffect, useCallback } from 'react';
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

import { getUser, getAllowedCentres } from '../auth';
import { calcRequiredStaff, parseAgeMonths } from '../utils/ratioEngine';
import { withCache, bustCache } from '../utils/cache';
import { fetchRosters } from '../deputy';

type ViewMode = 'present' | 'allday' | 'day';

interface CentreCard {
  centreId:         string;
  campus:           string;
  centreName:       string;
  childrenToday:    number;   // all who attended
  childrenPresent:  number;   // currently signed in (no sign_out)
  childrenExpected: number | null; // last week same day
  staffRostered:    number;
  staffAbsent:      number;
  staffAvailable:   number;   // room + float staff, minus any who are also on leave
  staffRosteredPresent:  number; // room + float staff currently on shift
  staffAbsentPresent:    number; // on-leave staff whose shift is right now
  staffAvailablePresent: number; // room + float on-shift staff, minus leave conflicts
  roomStaffAvailable:    number; // room staff only (no floats) - matches staffing analysis surplus
  roomStaffAvailablePresent: number; // room staff on shift now
  floatsRostered:   number;
  floatsRosteredPresent: number; // floats on shift now
  requiredStaff:    number;    // based on all-day
  requiredPresent:  number;    // based on currently present
  requiredExpected: number;    // based on expected (Day view)
  shortage:         number;   // positive = short, 0 = exact, negative = surplus (based on room+float)
  shortagePresent:  number;   // same, for present view
  roomShortage:     number;   // positive = short, negative = surplus (room staff only)
  roomShortagePresent: number; // same, for present view
  floatSurplus:        number;   // floats+AD available minus floaters needed (all-day view)
  casualsNeeded:       number;    // all-day view
  floatSurplusPresent: number;    // floats+AD available minus floaters needed (present view)
  casualsNeededPresent: number;   // present view
  floatSurplusExpected: number;   // floats+AD available minus floaters needed (expected/day view)
  casualsNeededExpected: number;  // expected/day view
  effectiveFloatCount: number;   // floats + room net surplus (surplus room staff act as floats)
  roomNetSurplus:      number;   // net room surplus carried into float pool
  status:           'green' | 'amber' | 'red' | 'unknown';
  statusPresent:    'green' | 'amber' | 'red' | 'unknown';
  statusExpected:   'green' | 'amber' | 'red' | 'unknown';
}

function fmtFTE(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Same effective-float filter used by the Ratio Dashboard Float Pool panel.
const CORE_WINDOW_START = 10 * 60;
const CORE_WINDOW_LATEST_START = 13 * 60 + 30;

function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

function isEffectiveFloat(start: string | null | undefined, end: string | null | undefined): boolean {
  const s = toMins(start);
  const e = toMins(end);
  if (s === null || e === null) return true; // no time info, keep
  return e > CORE_WINDOW_START && s < CORE_WINDOW_LATEST_START;
}

function isOnShiftNow(start: string | null | undefined, end: string | null | undefined, currentMins: number): boolean {
  const s = toMins(start);
  const e = toMins(end);
  if (s === null || e === null) return true; // no time info, include
  return s <= currentMins && e > currentMins;
}

function todayStr() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
function lastWeekStr(today: string) {
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0,10);
}
function greetingTime() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' })).getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function StatusPill({ status, text }: { status: CentreCard['status']; text?: string }) {
  const cfg: Record<string, { bg: string; color: string; label: string }> = {
    green:   { bg: '#dcfce7', color: '#15803d', label: '✅ Compliant' },
    amber:   { bg: '#fef9c3', color: '#b45309', label: '⚠️ Monitor' },
    red:     { bg: '#fee2e2', color: '#dc2626', label: '🚨 At Risk' },
    unknown: { bg: '#f3f4f6', color: '#6b7280', label: '- No data' },
  };
  const c = cfg[status];
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={{ backgroundColor: c.bg, color: c.color }}>
      {text ?? c.label}
    </span>
  );
}

function StatBlock({ icon, label, value, sub }: { icon: string; label: string; value: string | number; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-lg mb-0.5">{icon}</div>
      <div className="text-2xl font-bold" style={{ color: '#ffffff' }}>{value}</div>
      <div className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>{label}</div>
      {sub && <div className="text-xs font-semibold" style={{ color: '#fde68a' }}>{sub}</div>}
    </div>
  );
}

export default function MorningBriefingPage() {
  const navigate    = useNavigate();
  const user        = getUser();
  const allowed     = user ? getAllowedCentres(user) : [];
  const isExec      = user?.role === 'admin' || user?.role === 'ceo';
  const [date, setDate] = useState(todayStr());
  const lastWeek        = lastWeekStr(date);
  const isToday         = date === todayStr();

  function shiftDate(days: number) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next <= todayStr()) setDate(next);
  }

  const [cards, setCards]     = useState<CentreCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setUpdated]                 = useState<Date | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<Date | null>(null);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [viewMode, setViewMode]         = useState<ViewMode>('allday');
  const [totalBooked, setTotalBooked]   = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch today + last week attendance + last-snapshot time + all forecasts in parallel
      const [todayAtt, lastWeekAtt, unitsRes, lastSnapshotRes, allForecasts, staffingAnalysisRows] = await Promise.all([
        withCache(`briefing-today:${date}`, () =>
          fetch(`/api/attendance?date=${date}`).then(r => r.json()), 3 * 60 * 1000),
        withCache(`briefing-lw:${lastWeek}`, () =>
          fetch(`/api/attendance?date=${lastWeek}`).then(r => r.json()), 60 * 60 * 1000),
        withCache('deputy-units', () =>
          fetch('/api/deputy-units').then(r => r.json()), 10 * 60 * 1000),
        // Most recent updated_at from today's attendance - tells us when the last snapshot ran
        fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?date=eq.${date}&select=updated_at&order=updated_at.desc&limit=1`, {
          headers: { apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY' }
        }).then(r => r.json()).catch(() => []),
        withCache(`briefing-forecast-all:${date}`, () =>
          fetch(`/api/room-forecast?campus=all&date=${date}`)
            .then(r => r.json())
            .catch(() => null), 5 * 60 * 1000),
        // Fetch saved Plan of Day Staffing Analysis so the all-day surplus/deficit
        // matches the Ratio Dashboard Float Pool panel exactly.
        fetch(`/api/staffing-analysis?date=${date}`)
          .then(r => r.ok ? r.json() : { analyses: [] })
          .then(j => j?.analyses ?? [])
          .catch(() => [] as any[]),
      ]);

      // Current Sydney time as HH:MM for predicted_sign_out comparison
      const nowSyd = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
      const nowHHMM = `${String(nowSyd.getHours()).padStart(2,'0')}:${String(nowSyd.getMinutes()).padStart(2,'0')}`;
      const nowMins = toMins(nowHHMM) ?? 0;

      // Index saved staffing analysis by centre id for fast lookup.
      const staffingAnalysisByCentre: Record<string, any> = {};
      for (const row of (staffingAnalysisRows || []) as { centre_id?: string; surplus_val?: number; casuals_needed?: number; float_surplus?: number; total_floaters_needed?: number; effective_float_count?: number; room_net_surplus?: number }[]) {
        if (row?.centre_id) staffingAnalysisByCentre[row.centre_id] = row;
      }

      // Index attendance: all-day AND currently-present
      const todayByCampus: Record<string,{room:string;age:string|null}[]> = {};
      const presentByCampus: Record<string,{room:string;age:string|null}[]> = {};
      for (const r of todayAtt as {campus:string;room:string;age:string|null;sign_in:string|null;sign_out:string|null;predicted_sign_out:string|null}[]) {
        if (!r.sign_in) continue;
        (todayByCampus[r.campus] ??= []).push({ room: r.room, age: r.age });
        // Child is present if: signed in AND not signed out AND predicted departure hasn't passed
        const departed = r.sign_out ||
          (r.predicted_sign_out && r.predicted_sign_out <= nowHHMM);
        if (!departed) (presentByCampus[r.campus] ??= []).push({ room: r.room, age: r.age });
      }
      const lwByCampus: Record<string,number> = {};
      for (const r of lastWeekAtt as {campus:string;sign_in:string|null}[]) {
        if (r.sign_in) lwByCampus[r.campus] = (lwByCampus[r.campus]??0) + 1;
      }

      // Index deputy units by centre (for leave detection)
      const unitMap = new Map<string, {type:string;id:number}[]>();
      for (const u of unitsRes as {id:number;centre:string;type:string}[]) {
        (unitMap.get(u.centre) ?? unitMap.set(u.centre,[]).get(u.centre)!).push(u);
      }

      // ONE bulk fetchRosters call for all centres combined-avoids rate-limiting 16+ parallel calls
      // Then filter per-centre from the result
      const allCentreUnitIds = [...new Set(allowed.flatMap(c => [
        ...c.rooms.map(r => r.deputyUnitId),
        ...(c.floatUnitIds  ?? []),
        ...(c.leaveUnitIds  ?? []),
        ...(c.nonRatioUnitIds ?? []),
      ]))];
      const allRosters = await withCache(`briefing-rosters-bulk:${date}`, () =>
        fetchRosters(date, allCentreUnitIds), 5 * 60 * 1000
      );
      // Index by unitId for fast per-centre lookup
      const rosterByUnit = new Map<number, Awaited<ReturnType<typeof fetchRosters>>>();
      for (const r of allRosters) {
        const list = rosterByUnit.get(r.unitId) ?? [];
        list.push(r);
        rosterByUnit.set(r.unitId, list);
      }
      // Build per-centre roster array from the bulk result
      const centreRosterMap = new Map<string, Awaited<ReturnType<typeof fetchRosters>>>();
      for (const centre of allowed) {
        const unitIds = [
          ...centre.rooms.map(r => r.deputyUnitId),
          ...(centre.floatUnitIds  ?? []),
          ...(centre.leaveUnitIds  ?? []),
          ...(centre.nonRatioUnitIds ?? []),
        ];
        const centreRosters = unitIds.flatMap(uid => rosterByUnit.get(uid) ?? []);
        centreRosterMap.set(centre.id, centreRosters);
      }

      // Fetch Z Staffing external casuals for ALL centres in one call.
      // This is best-effort: if Z Staffing is slow, timeout and continue without it.
      const allZCasuals = await withCache('briefing-zcasuals-all:' + date, () =>
        Promise.race([
          fetch('/api/z-casuals?centre=all&date=' + date)
            .then(r => r.json())
            .then((rows) => (rows || []).filter((r: { start?: string; end?: string }) => r.start && r.end)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('z-casuals timeout')), 5000)
          ),
        ]).catch(() => [] as Array<{ start?: string; end?: string; centre?: string }>), 5 * 60 * 1000);
      const zCasualMap = new Map(allowed.map(c => [c.id, (allZCasuals || []).filter((r: { centre?: string }) => r.centre === c.name)]));

      // Fetch saved staff allocations for ALL centres in one call
      // This is the same source the Ratio Dashboard panel uses; it stores
      // per-employee moves keyed by employeeId (values are room.id or 'float'/'support').
      const result: CentreCard[] = [];
      for (const centre of allowed) {
        const campus = centre.ownaName ?? centre.name;
        const kids = todayByCampus[campus] ?? [];

        // Use the same rosters as the ratio dashboard (identical cache key)
        const centreRosters = centreRosterMap.get(centre.id) ?? [];
        const zCasuals = zCasualMap.get(centre.id) ?? [];
        // staffMoves intentionally not used for card stats so they match Ratio Dashboard staffing analysis
        const leaveSet  = new Set((centre.leaveUnitIds  ?? []));
        const floatSet  = new Set((centre.floatUnitIds  ?? []));
        const nonRatioSet = new Set(centre.nonRatioUnitIds ?? []);

        // Raw unit type from roster (ignoring manual moves) — used for card stats
        // so they match the Ratio Dashboard staffing analysis.
        function rawUnitType(r: typeof centreRosters[number]): 'room' | 'float' | 'support' | 'leave' | 'other' {
          if (leaveSet.has(r.unitId)) return 'leave';
          if (floatSet.has(r.unitId)) return 'float';
          if (nonRatioSet.has(r.unitId)) return 'support';
          if (centre.rooms.some(rm => rm.deputyUnitId === r.unitId)) return 'room';
          return 'other';
        }


        const presentKids  = presentByCampus[campus] ?? [];
        // Per-room required for all three modes
        function calcRoomRequired(childSet: {room:string;age:string|null}[]) {
          return centre.rooms.reduce((total, room) => {
            const owna = (room.ownaRoomName ?? room.name).toLowerCase();
            const rk = childSet.filter(c => c.room.toLowerCase().includes(owna));
            const { required: rq } = calcRequiredStaff(rk.map(c => ({ ageMonths: parseAgeMonths(c.age) } as any)));
            const roomStaff = centreRosters.filter(r => r.unitId === room.deputyUnitId);
            return { total: total.total + rq, staffSum: total.staffSum + roomStaff.length };
          }, { total: 0, staffSum: 0 });
        }

        const allDayCalc   = calcRoomRequired(kids);
        const presentCalc  = calcRoomRequired(presentKids);

        // In "Currently Present" view we must compare present children with
        // staff who are actually on shift right now — not the full-day roster.
        const presentRosters = centreRosters.filter(r => isOnShiftNow(r.startTime, r.endTime, nowMins));

        // Per-room breakdown for each view mode so surplus/deficit matches the
        // displayed children/required numbers.
        function makeRoomData(childSet: typeof kids, rosterSet: typeof centreRosters) {
          return centre.rooms.map(room => {
            const owna = (room.ownaRoomName ?? room.name).toLowerCase();
            const rk = childSet.filter(c => c.room.toLowerCase().includes(owna));
            const { required: roomRequired } = calcRequiredStaff(rk.map(c => ({ ageMonths: parseAgeMonths(c.age) } as any)));
            // Count staff whose RAW location is this room (ignore moves so card matches staffing analysis)
            const roomStaff = rosterSet.filter(r => r.unitId === room.deputyUnitId);
            return { required: roomRequired, staffCount: roomStaff.length };
          });
        }
        const roomDataAllDay = makeRoomData(kids, centreRosters);
        const roomDataPresent = makeRoomData(presentKids, presentRosters);
        const required         = allDayCalc.total;
        const requiredPresent  = presentCalc.total;
        // For Day view use expected (last week) if available, else all-day
        const expectedCount    = lwByCampus[campus] ?? kids.length;
        const requiredExpected = Math.round(expectedCount / Math.max(kids.length, 1) * required);

        // Staff counts from a roster set using RAW unit type (ignore moves so card matches staffing analysis)
        function calcStaffStats(rosterSet: typeof centreRosters, isPresent: boolean) {
          const staffIds = new Set(rosterSet
            .filter(r => rawUnitType(r) === 'room')
            .map(r => r.employeeId));
          const absentIds = new Set(rosterSet
            .filter(r => rawUnitType(r) === 'leave')
            .map(r => r.employeeId));
          // Use raw entry counts (not unique sets) to exactly match staffing analysis Float Pool:
          // floats.length and adStaff.length are array lengths, not deduped employee counts.
          // Split-shift staff have multiple entries and each counts.
          const floatEntries = rosterSet.filter(r => rawUnitType(r) === 'float');
          const floatIds = new Set(floatEntries.map(r => r.employeeId)); // still need set for absence calc
          // Effective float count: all-day uses core-window overlap; present view uses
          // staff who are on shift right now.
          const effectiveFloatEntries = isPresent
            ? floatEntries.filter(r => !r.isSplitShift && isOnShiftNow(r.startTime, r.endTime, nowMins))
            : floatEntries.filter(r => !r.isSplitShift && isEffectiveFloat(r.startTime, r.endTime));
          const effectiveZCasualCount = isPresent
            ? zCasuals.filter((z: { start?: string; end?: string }) => isOnShiftNow(z.start, z.end, nowMins)).length
            : zCasuals.filter((z: { start?: string; end?: string }) => isEffectiveFloat(z.start, z.end)).length;
          const floatCount = effectiveFloatEntries.length + effectiveZCasualCount;
          // AD = only 'Assistant Director' unitName entries (matches staffing analysis adStaff filter)
          const adCount = rosterSet.filter(r =>
            rawUnitType(r) === 'support' &&
            (r.unitName?.toLowerCase().includes('assistant director') ||
             r.unitName?.toLowerCase().includes('asst director') ||
             r.unitName?.toLowerCase().includes('ass. director'))
          ).length;
          const totalStaff = new Set([...staffIds, ...floatIds]).size;
          const absent = absentIds.size;
          // Only subtract absent staff who were ALSO rostered to a room or float
          // (they called in sick from their scheduled shift).
          const roomAndFloatAbsent = [...absentIds].filter(id => staffIds.has(id) || floatIds.has(id)).length;
          const totalAvailable = totalStaff - roomAndFloatAbsent;
          const roomAbsent = [...absentIds].filter(id => staffIds.has(id)).length;
          const roomStaffAvailable = staffIds.size - roomAbsent;
          return { staffIds, floatIds, floatCount, adCount, totalStaff, absent, totalAvailable, roomStaffAvailable };
        }

        const allDayStats  = calcStaffStats(centreRosters, false);
        const presentStats = calcStaffStats(presentRosters, true);

        // All-day stats (default view)
        const totalStaff = allDayStats.totalStaff;
        const absent = allDayStats.absent;
        const totalAvailable = allDayStats.totalAvailable;
        const statusShortage = required - totalAvailable;
        const roomStaffAvailable = allDayStats.roomStaffAvailable;
        const roomShortage = required - roomStaffAvailable;

        // Present stats (currently signed-in view)
        const totalStaffPresent = presentStats.totalStaff;
        const absentPresent = presentStats.absent;
        const totalAvailablePresent = presentStats.totalAvailable;
        const statusShortagePresent = requiredPresent - totalAvailablePresent;
        const roomStaffAvailablePresent = presentStats.roomStaffAvailable;
        const roomShortagePresent = requiredPresent - roomStaffAvailablePresent;

        // Exact same logic as ratio dashboard Float Pool section:
        // Compute separately for all-day and currently-present so each view mode is internally consistent.
        function calcFloatPool(roomData: { required: number; staffCount: number }[], childCount: number, floatCount: number, adCount: number) {
          // 1. Per-room surplus reallocation
          const totalRatioShortage = roomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
          const totalSurplus       = roomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
          const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
          // 2. Buffer: 1 per 6 floor staff
          const totalFloorStaff = roomData.reduce((s, r) => s + r.staffCount, 0);
          const bufferRequired  = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;
          // 3. Room net surplus (after covering all shortages) counts as effective floats
          const roomNetSurplus      = Math.max(0, totalSurplus - totalRatioShortage);
          const effectiveFloatCount = floatCount + roomNetSurplus;
          // 4. AD availability depends on child count
          const adAvail = (childCount > 0 && childCount < 100) ? adCount : 0;
          // 5. Total floaters needed → casuals = what effective floats+AD can't cover
          const totalFloatersNeeded = Math.max(0, netShortageAfterRealloc + bufferRequired);
          const casualsNeeded       = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvail);
          const floatSurplus        = casualsNeeded <= 0 ? (effectiveFloatCount + adAvail - totalFloatersNeeded) : 0;
          return { totalFloatersNeeded, casualsNeeded, floatSurplus, effectiveFloatCount, roomNetSurplus, bufferRequired };
        }

        const allDayPool  = calcFloatPool(roomDataAllDay, kids.length, allDayStats.floatCount, allDayStats.adCount);
        const presentPool = calcFloatPool(roomDataPresent, presentKids.length, presentStats.floatCount, presentStats.adCount);

        // Expected/day view: scale the all-day per-room required by the expected/all-day ratio
        // so surplus/deficit reflects expected children vs today's full roster.
        const expectedRatio = required > 0 ? requiredExpected / required : 1;
        const roomDataExpected = roomDataAllDay.map(r => ({
          required: Math.max(0, Math.round(r.required * expectedRatio)),
          staffCount: r.staffCount,
        }));
        const expectedPool = calcFloatPool(roomDataExpected, expectedCount, allDayStats.floatCount, allDayStats.adCount);

        // Override all-day values with the saved Plan of Day Staffing Analysis
        // when available. The dashboard is the source of truth for this figure.
        const sa = staffingAnalysisByCentre[centre.id];
        if (sa) {
          allDayPool.casualsNeeded = Number(sa.casuals_needed ?? allDayPool.casualsNeeded);
          allDayPool.floatSurplus = Number(sa.float_surplus ?? allDayPool.floatSurplus);
          allDayPool.totalFloatersNeeded = Number(sa.total_floaters_needed ?? allDayPool.totalFloatersNeeded);
          allDayPool.effectiveFloatCount = Number(sa.effective_float_count ?? allDayPool.effectiveFloatCount);
          allDayPool.roomNetSurplus = Number(sa.room_net_surplus ?? allDayPool.roomNetSurplus);
        }

        const poolToUse   = viewMode === 'present' ? presentPool
          : viewMode === 'day' ? expectedPool
          : allDayPool;

        if (centre.id === 'spring-farm') {
          console.log('[briefing-debug] Spring Farm', {
            required, requiredPresent,
            allDayStats, presentStats,
            allDayPool, presentPool,
          });
        }


        // Status = ratio compliance only (not buffer/casuals)
        // Green = more staff than required, Amber = exact match, Red = short
        const status: CentreCard['status'] = kids.length === 0 ? 'unknown'
          : statusShortage > 0   ? 'red'    // short on ratio
          : statusShortage === 0 ? 'amber'  // exactly meeting ratio
          : 'green';                        // surplus staff - compliant
        const statusPresent: CentreCard['statusPresent'] = presentKids.length === 0 ? 'unknown'
          : statusShortagePresent > 0   ? 'red'
          : statusShortagePresent === 0 ? 'amber'
          : 'green';
        const statusExpected: CentreCard['statusExpected'] = expectedCount <= 0 ? 'unknown'
          : (requiredExpected - totalAvailable) > 0   ? 'red'
          : (requiredExpected - totalAvailable) === 0 ? 'amber'
          : 'green';

        result.push({
          centreId:         centre.id,
          campus,
          centreName:       centre.name,
          childrenToday:    kids.length,
          childrenPresent:  presentKids.length,
          childrenExpected: lwByCampus[campus] ?? null,
          staffRostered:    totalStaff,
          staffAbsent:      absent,
          staffAvailable:   totalAvailable,
          staffRosteredPresent:  totalStaffPresent,
          staffAbsentPresent:    absentPresent,
          staffAvailablePresent: totalAvailablePresent,
          roomStaffAvailable,
          roomStaffAvailablePresent,
          floatsRostered:   allDayStats.floatIds.size,
          floatsRosteredPresent: presentStats.floatIds.size,
          requiredStaff:    required,
          requiredPresent,
          requiredExpected,
          shortage:         statusShortage,
          shortagePresent:  statusShortagePresent,
          roomShortage,
          roomShortagePresent,
          floatSurplus:       allDayPool.floatSurplus,
          casualsNeeded:      allDayPool.casualsNeeded,
          floatSurplusPresent:  presentPool.floatSurplus,
          casualsNeededPresent: presentPool.casualsNeeded,
          floatSurplusExpected:  expectedPool.floatSurplus,
          casualsNeededExpected: expectedPool.casualsNeeded,
          effectiveFloatCount:  poolToUse.effectiveFloatCount,
          roomNetSurplus:       poolToUse.roomNetSurplus,
          status,
          statusPresent,
          statusExpected,
        });
      }

      // Sum booked children across all centres (from room-forecast)
      const bookedValues = Object.values(allForecasts as Record<string, { booked?: number | null } | null>)
        .map(f => f?.booked)
        .filter((b): b is number => b != null);
      setTotalBooked(bookedValues.length > 0 ? bookedValues.reduce((a, b) => a + b, 0) : null);

      // Sort: at-risk first, then by children desc
      result.sort((a,b) => {
        const order = { red:0, amber:1, green:2, unknown:3 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return b.childrenToday - a.childrenToday;
      });

      setCards(result);
      setUpdated(new Date());
      // Parse last snapshot time from Supabase updated_at
      const snapRows = lastSnapshotRes as { updated_at?: string }[];
      if (snapRows?.length > 0 && snapRows[0].updated_at) {
        const dt = new Date(snapRows[0].updated_at);
        if (!isNaN(dt.getTime())) setLastSnapshot(dt);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Briefing load error', msg);
      setLoadError(msg);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [date, lastWeek, allowed]);

  useEffect(() => { load(); }, [load]);

  const totalKids      = viewMode === 'present'
    ? cards.reduce((s,c) => s+c.childrenPresent, 0)
    : viewMode === 'day'
    ? cards.reduce((s,c) => s+(c.childrenExpected ?? c.childrenToday), 0)
    : cards.reduce((s,c) => s+c.childrenToday, 0);
  const totalStaff     = viewMode === 'present'
    ? cards.reduce((s,c) => s+c.staffAvailablePresent, 0)
    : cards.reduce((s,c) => s+c.staffRostered, 0);
  const totalAbsent    = viewMode === 'present'
    ? cards.reduce((s,c) => s+c.staffAbsentPresent, 0)
    : cards.reduce((s,c) => s+c.staffAbsent, 0);
  const totalRequired  = viewMode === 'present'
    ? cards.reduce((s,c) => s+c.requiredPresent, 0)
    : cards.reduce((s,c) => s+c.requiredStaff, 0);
  const totalCasuals   = viewMode === 'present'
    ? cards.reduce((s,c) => s+c.casualsNeededPresent, 0)
    : viewMode === 'day'
    ? cards.reduce((s,c) => s+c.casualsNeededExpected, 0)
    : cards.reduce((s,c) => s+c.casualsNeeded, 0);
  void totalRequired; // used in per-card calculations

  return (
    <Layout>
      {/* ── Greeting ── */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2d5c18' }}>
            {isToday ? `${greetingTime()}${user ? `, ${user.name.split(' ')[0]}` : ''}` : 'Daily Briefing'}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
            {safeFormat(new Date(date + 'T00:00:00'), 'EEEE, d MMMM yyyy')}
            {lastSnapshot && !isNaN(lastSnapshot.getTime()) && (
              <span style={{ color: '#A0D083' }}>
                {' · Data as of '}{lastSnapshot.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            {!isToday && <span style={{ color: '#A0D083' }}> · Historical view</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Date navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => shiftDate(-1)}
              className="border rounded-xl px-3 py-2 text-sm font-bold transition-colors hover:bg-gray-50"
              style={{ borderColor: '#D0E8B8', color: '#5a9228' }}
              title="Previous day">
              ‹
            </button>
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={e => e.target.value <= todayStr() && setDate(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm font-medium"
              style={{ borderColor: '#D0E8B8', color: '#2d5c18' }}
            />
            <button onClick={() => shiftDate(1)}
              disabled={isToday}
              className="border rounded-xl px-3 py-2 text-sm font-bold transition-colors hover:bg-gray-50 disabled:opacity-30"
              style={{ borderColor: '#D0E8B8', color: '#5a9228' }}
              title="Next day">
              ›
            </button>
          </div>
          {isExec && (
            <button onClick={() => navigate('/summary')}
              className="border rounded-xl px-4 py-2 text-sm font-semibold"
              style={{ borderColor: '#D0E8B8', color: '#5a9228' }}>
              All Centres
            </button>
          )}
          <button onClick={() => { bustCache('briefing-'); bustCache('rosters:'); load(); }} disabled={loading}
            className="border rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ borderColor: '#D0E8B8', color: '#5a9228' }}>
            {loading ? '⟳ Loading...' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* View mode toggle */}
      <div className="flex gap-2 mb-5">
        {([
          { key: 'present', label: '🟢 Currently Present', desc: 'Signed in now' },
          { key: 'allday',  label: '📅 All Day',           desc: 'Full day attendance' },
          { key: 'day',     label: '🗓 Day View',           desc: 'Planned / expected' },
        ] as { key: ViewMode; label: string; desc: string }[]).map(({ key, label, desc }) => (
          <button key={key} onClick={() => setViewMode(key)}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all text-left"
            style={viewMode === key
              ? { backgroundColor: '#2d5c18', color: 'white' }
              : { backgroundColor: 'white', color: '#2d5c18', border: '1px solid #D0E8B8' }}>
            <div>{label}</div>
            <div className="text-xs font-normal mt-0.5" style={{ color: viewMode===key ? 'rgba(255,255,255,0.7)' : '#596570' }}>{desc}</div>
          </button>
        ))}
      </div>

      {/* Error display */}
      {loadError && (
        <div className="rounded-xl p-4 mb-5 text-sm font-mono" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
          <strong>Load error:</strong> {loadError}
          <button onClick={() => { setLoadError(null); load(); }} className="ml-3 underline">Retry</button>
        </div>
      )}

      {/* ── Executive top stats (admin + CEO) ── */}
      {isExec && (
        <div className="rounded-2xl p-5 mb-6 grid grid-cols-2 sm:grid-cols-5 gap-4"
          style={{ backgroundColor: '#2d5c18' }}>
          <StatBlock icon="🧒" label={viewMode === 'present' ? 'Children present' : viewMode === 'day' ? 'Children expected' : 'Children today'} value={loading ? '...' : totalKids} />
          <StatBlock icon="📖" label="Booked" value={loading ? '...' : totalBooked ?? '—'}
            sub={(() => {
              const totalApproved = allowed.reduce((sum, c) => sum + (c.approvedPlaces ?? 0), 0);
              return totalBooked != null && totalApproved > 0
                ? `${Math.round((totalBooked / totalApproved) * 100)}% of ${totalApproved} capacity`
                : `${totalApproved} capacity`;
            })()} />
          <StatBlock icon="👥" label={viewMode === 'present' ? 'Staff signed in' : 'Staff rostered'} value={loading ? '...' : totalStaff} />
          <StatBlock icon="🚫" label="Staff absent" value={loading ? '...' : totalAbsent} />
          <StatBlock icon="👷" label="Casuals recommended" value={loading ? '...' : totalCasuals > 0 ? `${fmtFTE(totalCasuals)} FTE` : '✅ None'}
            sub={totalCasuals > 0 ? `across ${cards.filter(c=>c.casualsNeeded>0).length} centre${cards.filter(c=>c.casualsNeeded>0).length!==1?'s':''}` : 'all centres compliant'} />
        </div>
      )}

      {/* ── Centre cards ── */}
      {loading ? (
        <div style={isExec ? { display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', width: '100%' } : { display: 'grid', gap: '16px', maxWidth: '672px' }}>
          {Array.from({ length: isExec ? 6 : 1 }).map((_, i) => (
            <div key={i} className="rounded-2xl border p-5 animate-pulse"
              style={{ borderColor: '#E2F1DA', backgroundColor: 'white' }}>
              <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
              <div className="grid grid-cols-4 gap-3">
                {[...Array(4)].map((_,j) => <div key={j} className="h-12 bg-gray-100 rounded" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={isExec ? { display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', width: '100%' } : { display: 'grid', gap: '16px', maxWidth: '672px' }}>
          {cards.map(card => (
            <div
              key={card.centreId}
              onClick={() => navigate(`/ratio?centre=${card.centreId}`)}
              className="rounded-2xl border shadow-sm overflow-hidden cursor-pointer transition-all hover:shadow-md"
              style={{
                borderColor: (viewMode === 'present' ? card.statusPresent : viewMode === 'day' ? card.statusExpected : card.status) === 'red' ? '#fca5a5'
                  : (viewMode === 'present' ? card.statusPresent : viewMode === 'day' ? card.statusExpected : card.status) === 'amber' ? '#fcd34d'
                  : '#E2F1DA',
                backgroundColor: 'white',
              }}
            >
              {/* Card header */}
              <div className="px-5 py-3 flex items-center justify-between"
                style={{
                  backgroundColor: (viewMode === 'present' ? card.statusPresent : viewMode === 'day' ? card.statusExpected : card.status) === 'red' ? '#fef2f2'
                    : (viewMode === 'present' ? card.statusPresent : viewMode === 'day' ? card.statusExpected : card.status) === 'amber' ? '#fffbeb'
                    : '#F5FAF3',
                }}>
                <div>
                  <div className="font-bold text-sm" style={{ color: '#2d5c18' }}>{card.centreName}</div>
                  {(viewMode === 'present' ? card.statusPresent : viewMode === 'day' ? card.statusExpected : card.status) !== 'unknown' && (
                    <div className="text-xs mt-0.5" style={{ color: '#596570' }}>
                      {viewMode === 'present' ? card.requiredPresent : viewMode === 'day' ? card.requiredExpected : card.requiredStaff} staff required
                    </div>
                  )}
                </div>
                <StatusPill status={viewMode === 'present' ? card.statusPresent : viewMode === 'day' ? card.statusExpected : card.status} />
              </div>

              {/* Stats */}
              {(() => {
                // Pick children count + required based on view mode
                const viewChildren = viewMode === 'present' ? card.childrenPresent
                  : viewMode === 'day'     ? (card.childrenExpected ?? card.childrenToday)
                  : card.childrenToday;
                const viewRequired = viewMode === 'present' ? card.requiredPresent
                  : viewMode === 'day'     ? card.requiredExpected
                  : card.requiredStaff;
                // Surplus = float pool surplus from staffing analysis (floats+AD minus floaters needed)
                // Match the view mode: present view uses present-based surplus, day view uses expected-based surplus, all-day uses all-day surplus.
                const viewCasualsNeeded = viewMode === 'present' ? card.casualsNeededPresent
                  : viewMode === 'day' ? card.casualsNeededExpected
                  : card.casualsNeeded;
                const viewFloatSurplus  = viewMode === 'present' ? card.floatSurplusPresent
                  : viewMode === 'day' ? card.floatSurplusExpected
                  : card.floatSurplus;
                const hasCasuals = viewCasualsNeeded > 0;
                const surplusVal = hasCasuals ? -viewCasualsNeeded : viewFloatSurplus;
                const shortfall  = surplusVal < 0;
                const surplus    = surplusVal > 0;
                const surplusStr = surplusVal === 0 ? '0'
                  : surplusVal > 0 ? `+${fmtFTE(surplusVal)}`
                  : fmtFTE(surplusVal);
                return (
                  <div className="px-5 py-4 grid grid-cols-4 gap-2">
                    {/* 1. Attended */}
                    <div className="text-center">
                      <div className="text-xl font-bold" style={{ color: '#050505' }}>{viewChildren}</div>
                      <div className="text-xs" style={{ color: '#596570' }}>
                        {viewMode === 'present' ? 'Present' : viewMode === 'day' ? 'Expected' : 'Attended'}
                      </div>
                    </div>
                    {/* 2. Required */}
                    <div className="text-center">
                      <div className="text-xl font-bold" style={{ color: '#050505' }}>{viewRequired}</div>
                      <div className="text-xs" style={{ color: '#596570' }}>Required</div>
                    </div>
                    {/* 3. Rostered / Signed in */}
                    <div className="text-center">
                      <div className="text-xl font-bold" style={{ color: '#050505' }}>
                        {viewMode === 'present' ? card.staffRosteredPresent : card.staffRostered}
                      </div>
                      <div className="text-xs" style={{ color: '#596570' }}>
                        {viewMode === 'present' ? 'Signed in' : 'Rostered'}
                      </div>
                      {(viewMode === 'present' ? card.staffAbsentPresent : card.staffAbsent) > 0 && (
                        <div className="text-xs" style={{ color: '#dc2626' }}>
                          {viewMode === 'present' ? card.staffAbsentPresent : card.staffAbsent} absent
                        </div>
                      )}
                    </div>
                    {/* 4. Surplus / Deficit - matches staffing analysis float pool */}
                    <div className="text-center rounded-xl px-1 py-1"
                      style={{ backgroundColor: shortfall ? '#fee2e2' : surplus ? '#dcfce7' : '#fef9c3' }}>
                      <div className="text-xl font-bold"
                        style={{ color: shortfall ? '#dc2626' : surplus ? '#16a34a' : '#b45309' }}>
                        {viewChildren === 0 ? '-' : surplusStr}
                      </div>
                      <div className="text-xs font-semibold"
                        style={{ color: shortfall ? '#dc2626' : surplus ? '#16a34a' : '#b45309' }}>
                        {shortfall ? 'Deficit' : surplus ? 'Surplus' : 'Exact'}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Footer - casual recommendation */}
              <div
                className="px-5 py-2.5 border-t flex items-center justify-between"
                style={{
                  borderColor: (viewMode === 'present' ? card.casualsNeededPresent : viewMode === 'day' ? card.casualsNeededExpected : card.casualsNeeded) > 0 ? '#fca5a5' : '#D0E8B8',
                  backgroundColor: (viewMode === 'present' ? card.casualsNeededPresent : viewMode === 'day' ? card.casualsNeededExpected : card.casualsNeeded) > 0 ? '#fef2f2' : '#f2f9e8',
                }}
              >
                {(viewMode === 'present' ? card.statusPresent : viewMode === 'day' ? card.statusExpected : card.status) === 'unknown' ? (
                  <span className="text-xs" style={{ color: '#596570' }}>No data yet</span>
                ) : (viewMode === 'present' ? card.casualsNeededPresent : viewMode === 'day' ? card.casualsNeededExpected : card.casualsNeeded) > 0 ? (
                  <span className="text-xs font-semibold" style={{ color: '#dc2626' }}>
                    ⚠️ {fmtFTE(viewMode === 'present' ? card.casualsNeededPresent : viewMode === 'day' ? card.casualsNeededExpected : card.casualsNeeded)} casual FTE recommended
                  </span>
                ) : (
                  <span className="text-xs font-semibold" style={{ color: '#5a9228' }}>
                    ✅ Compliant
                  </span>
                )}
                <span className="text-sm" style={{ color: '#5a9228' }}>→</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && cards.length === 0 && (
        <div className="text-center py-16 text-sm italic" style={{ color: '#596570' }}>
          No centres configured for your account
        </div>
      )}
    </Layout>
  );
}
