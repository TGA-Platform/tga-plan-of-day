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
import { format, parseISO, startOfWeek, isAfter, isBefore, add } from 'date-fns';
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
import type { ExternalCasualMeta } from '../types';
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
  inTime:      string;   // HH:MM - when they entered/started
  outTime:     string;   // HH:MM - when they left/finished
  lunchStart?: string;   // HH:MM - their own lunch break start (shown as dedicated columns)
  lunchEnd?:   string;   // HH:MM - their own lunch break end
  blockType:   'shift' | 'lunch_break' | 'float_move' | 'lunch_cover' | 'leave' | 'support' | 'grouping';
  staffType:   'room' | 'float' | 'iss' | 'support' | 'leave' | 'external';
  note?:       string;
}

interface RatioSnap {
  date:       string;
  campus:     string;
  children:   number;
  required:   number;
  compliant:  boolean;
}

interface WwccExpiryRow {
  full_name:     string;
  centre:        string;
  wwcc_number:   string | null;
  wwcc_expiry:   string | null;
  under_18:      boolean;
  daysRemaining: number | null;
  exemptReason?: 'under_18' | 'kitchen'; // why they have no WWCC (exempt)
}

interface CasualDayRow {
  date: string;
  campus: string;
  centreId: string;
  internalCount: number;      // number of internal casual shifts
  internalHours: number;      // total internal casual hours
  externalCount: number;      // number of external (Z) casual shifts
  externalHours: number;      // total external casual hours
  externalCostCents: number;  // total external casual cost for the day
}

interface OccupancyRow {
  date:           string;
  campus:         string;
  expected:       number;
  actual:         number;
  booked:         number;   // from daily_occupancy (Owna bookings)
  capacity:       number;   // total licensed places for this centre
  lastWeek:       number;
  change:         number;   // actual - lastWeek (positive = more children than last week)
}

interface RosterSlotData {
  time:                    string;
  totalDays:               number;
  sumChildren:             number;
  sumStaff:                number;    // floor staff = room + floats (used for surplus)
  sumOffFloor:             number;    // non-ratio staff (directors, chefs, admin) on shift
  sumOffFloorExclDirector: number;    // off-floor staff excluding centre director
  sumISS:                  number;    // ISS staff on shift (shown separately, not in ratio count)
  sumRequired:             number;
}

interface RosterOptResult {
  campus: string;
  slots:  RosterSlotData[];
}

interface RosterRec {
  campus: string;
  text:   string;
  type:   'overstaffed' | 'understaffed';
}

interface RosterSuggestion {
  type: 'shift-start' | 'shift-end' | 'add-staff';
  staffName: string;
  fromTime: string;
  toTime: string;
  coversStart: string;
  coversEnd: string;
  shortfallFte: number;
  text: string;
}

interface RosterSlotAfter {
  slot: string;
  beforeAvailable: number;
  afterAvailable: number;
  beforeSurplus: number;
  afterSurplus: number;
  totalDays: number;
}

interface RosterSuggestionResult {
  centre: string;
  date: string;
  optimal: boolean;
  suggestions: RosterSuggestion[];
  beforeShortfallSlots: string[];
  afterShortfallSlots: string[];
  slotBySlot: RosterSlotAfter[];
}

interface StaffingAnalysisRow {
  date:                string;
  campus:              string;
  children:            number;
  required:            number;       // total required staff (per-room sum)
  totalFloorStaff:     number;       // room staff count
  roomSurplus:         number;       // net room surplus after internal reallocation (negative = rooms short)
  bufferRequired:      number;       // floor / 6
  floatCount:          number;       // float entries (not unique)
  adAvailable:         number;       // AD entries (0 if children >= 100)
  totalFloatersNeeded: number;       // buffer + net shortage
  floatSurplus:        number;       // floatCount + adAvailable - totalFloatersNeeded
  status:              'green' | 'amber' | 'red' | 'unknown';
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
    // sign_in/sign_out stored as HH:MM strings; predicted_sign_in does NOT exist
    `${SUPABASE_URL}/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=room,age,sign_in,sign_out,predicted_sign_out&limit=500`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );
  return r.ok ? r.json() : [];
}
/** Convert HH:MM string to minutes since midnight. Returns null if invalid. */
function hhmm(t: string | null | undefined): number | null {
  if (!t) return null;
  const p = String(t).split(':').map(Number);
  if (p.length < 2 || isNaN(p[0])) return null;
  return p[0] * 60 + (p[1] || 0);
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

function slotToMinutes(slot: string) {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m;
}

function minsToHhmm(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getLatestWeekdayInRange(fromDate: string, toDate: string): string {
  let cur = toDate;
  while (cur >= fromDate) {
    const [y, m, d] = cur.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) return cur;
    cur = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  }
  return toDate;
}

async function buildRosterSuggestionsForCentre(centre: any, avgSlots: RosterSlotData[], fromDate: string, toDate: string): Promise<RosterSuggestionResult> {
  const campus = centre.ownaName ?? centre.name;
  const SLOT_MINS = 30;
  const MIN_OPEN_CLOSE_STAFF = 2;

  const slotCoverage = avgSlots.map(s => {
    const available = s.sumStaff + s.sumOffFloorExclDirector;
    const required = s.sumRequired;
    return {
      slot: s.time,
      sm: slotToMinutes(s.time),
      available,
      required,
      totalDays: s.totalDays,
      surplus: s.totalDays > 0 ? (available - required) / s.totalDays : 0,
    };
  });

  const shortfallSlots = slotCoverage.filter(s => s.surplus < 0);
  if (shortfallSlots.length === 0) {
    return {
      centre: campus,
      date: 'selected period',
      optimal: true,
      suggestions: [],
      beforeShortfallSlots: [],
      afterShortfallSlots: [],
      slotBySlot: [],
    };
  }

  // Use the latest weekday in the selected range as the representative roster
  // so suggestions are based on actual staff names and real shift times.
  const repDate = getLatestWeekdayInRange(fromDate, toDate);
  const roomUnitIds: number[] = centre.rooms.map((r: any) => r.deputyUnitId);
  const floatUnitIds: number[] = centre.floatUnitIds ?? [];
  const coverUnitIds = new Set<number>([...roomUnitIds, ...floatUnitIds]);
  const rosters = await fetchRostersForDate([...coverUnitIds], repDate);

  // Build a unique list of ratio-covering staff from the representative roster.
  // If someone has multiple entries, keep the earliest start.
  const staffMap = new Map<number, { employeeId: number; name: string; startM: number; endM: number }>();
  for (const r of rosters) {
    if (!r.Employee || r.Employee === 0) continue;
    if (!coverUnitIds.has(r.OperationalUnit)) continue;
    const startM = hhmm(fmtTime(r.StartTime));
    const endM = hhmm(fmtTime(r.EndTime));
    if (startM === null || endM === null || startM >= endM) continue;
    const name = r._DPMetaData?.EmployeeInfo?.DisplayName || `Staff ${r.Employee}`;
    const existing = staffMap.get(r.Employee);
    if (!existing || startM < existing.startM) {
      staffMap.set(r.Employee, { employeeId: r.Employee, name, startM, endM });
    }
  }
  let staffList = Array.from(staffMap.values()).sort((a, b) => a.startM - b.startM);

  // Group consecutive shortfall slots into windows
  const windows: { startIdx: number; endIdx: number; startSlot: string; endSlot: string; peakShortfall: number; durationSlots: number }[] = [];
  let current: typeof windows[0] | null = null;
  for (let i = 0; i < slotCoverage.length; i++) {
    const s = slotCoverage[i];
    if (s.surplus < 0) {
      if (!current) {
        current = { startIdx: i, endIdx: i, startSlot: s.slot, endSlot: s.slot, peakShortfall: Math.abs(s.surplus), durationSlots: 1 };
      } else {
        current.endIdx = i;
        current.endSlot = s.slot;
        current.peakShortfall = Math.max(current.peakShortfall, Math.abs(s.surplus));
        current.durationSlots++;
      }
    } else {
      if (current) { windows.push(current); current = null; }
    }
  }
  if (current) windows.push(current);

  const suggestions: RosterSuggestion[] = [];
  const simulatedCoverage = slotCoverage.map(s => ({ ...s }));
  const middayMins = 12 * 60;

  const staffMeetsMin = (slot: typeof simulatedCoverage[0]) => {
    if (slot.totalDays <= 0) return true;
    return slot.available >= MIN_OPEN_CLOSE_STAFF * slot.totalDays;
  };

  const recomputeSurplus = () => {
    for (const s of simulatedCoverage) {
      s.surplus = (s.available - s.required) / Math.max(s.totalDays, 1);
    }
  };

  const findCandidate = (w: typeof windows[0], shiftEarlier: boolean, skipIds: Set<number>) => {
    const windowStartM = slotToMinutes(w.startSlot);
    const windowEndM = slotToMinutes(w.endSlot) + SLOT_MINS;
    if (shiftEarlier) {
      // Need someone who starts at or after the window ends so they can be moved earlier.
      // Prefer the closest start time to the end of the window (smallest move).
      const candidates = staffList.filter(s => !skipIds.has(s.employeeId) && s.startM >= windowEndM && s.startM < windowEndM + 60);
      candidates.sort((a, b) => a.startM - b.startM);
      return candidates[0] ?? null;
    } else {
      // Need someone who starts after opening and whose shift ends at or before the
      // window end (but close enough that moving later reaches the window).
      const candidates = staffList.filter(s => !skipIds.has(s.employeeId) && s.startM > 7 * 60 && s.endM <= windowEndM && s.endM > windowStartM - 60);
      // Prefer morning starters first (their loss falls in the morning surplus),
      // then the candidate whose end time is closest to the end of the window.
      candidates.sort((a, b) => a.startM - b.startM || b.endM - a.endM);
      return candidates[0] ?? null;
    }
  };

  const applyMove = (candidate: typeof staffList[0], shiftEarlier: boolean, moveMins: number, revert = false) => {
    const newStartM = shiftEarlier ? candidate.startM - moveMins : candidate.startM + moveMins;
    const newEndM = shiftEarlier ? candidate.endM - moveMins : candidate.endM + moveMins;
    const sign = revert ? -1 : 1;
    for (let i = 0; i < simulatedCoverage.length; i++) {
      const slot = simulatedCoverage[i];
      const slotStart = slot.sm;
      const slotEnd = slot.sm + SLOT_MINS;
      let delta = 0;
      if (shiftEarlier) {
        // Gains coverage between new start and old start
        const gain = Math.min(slotEnd, candidate.startM) - Math.max(slotStart, newStartM);
        if (gain > 0) delta += gain / SLOT_MINS;
        // Loses coverage between new end and old end
        const loss = Math.min(slotEnd, candidate.endM) - Math.max(slotStart, newEndM);
        if (loss > 0) delta -= loss / SLOT_MINS;
      } else {
        // Loses coverage between old start and new start
        const loss = Math.min(slotEnd, newStartM) - Math.max(slotStart, candidate.startM);
        if (loss > 0) delta -= loss / SLOT_MINS;
        // Gains coverage between old end and new end
        const gain = Math.min(slotEnd, newEndM) - Math.max(slotStart, candidate.endM);
        if (gain > 0) delta += gain / SLOT_MINS;
      }
      slot.available += sign * delta * Math.max(slot.totalDays, 1);
    }
  };

  for (const w of windows) {
    const windowStartM = slotToMinutes(w.startSlot);
    const windowEndM = slotToMinutes(w.endSlot) + SLOT_MINS;
    const windowMidMins = (windowStartM + windowEndM) / 2;
    const shiftEarlier = windowMidMins <= middayMins;

    let windowResolved = false;
    let attempts = 0;
    const skipIds = new Set<number>();

    while (!windowResolved && attempts < 5) {
      attempts++;
      const candidate = findCandidate(w, shiftEarlier, skipIds);
      if (!candidate) break;
      skipIds.add(candidate.employeeId);

      const windowSurplusBeforeMove = simulatedCoverage.slice(w.startIdx, w.endIdx + 1).map(s => s.surplus);

      // Move just enough to cover the window, capped at 60 min and rounded to 15-min increments
      let moveMins = shiftEarlier
        ? Math.ceil((candidate.startM - windowStartM) / 15) * 15
        : Math.ceil((windowEndM - candidate.endM) / 15) * 15;
      moveMins = Math.min(Math.max(moveMins, 15), 60);

      applyMove(candidate, shiftEarlier, moveMins);
      recomputeSurplus();

      const openOk = staffMeetsMin(simulatedCoverage[0]);
      const closeOk = staffMeetsMin(simulatedCoverage[simulatedCoverage.length - 1]);
      const createdNewShortfall = simulatedCoverage.some((s, i) => s.surplus < -0.001 && slotCoverage[i].surplus >= -0.001);
      const windowSurplusAfterMove = simulatedCoverage.slice(w.startIdx, w.endIdx + 1).map(s => s.surplus);
      const improvesWindow = windowSurplusAfterMove.some((s, i) => s > windowSurplusBeforeMove[i] + 0.001);
      const moveIsValid = openOk && closeOk && !createdNewShortfall && improvesWindow;

      if (moveIsValid) {
        const newStartM = shiftEarlier ? candidate.startM - moveMins : candidate.startM + moveMins;
        const newEndM = shiftEarlier ? candidate.endM - moveMins : candidate.endM + moveMins;
        const text = `Move ${candidate.name}'s shift from ${minsToHhmm(candidate.startM)}–${minsToHhmm(candidate.endM)} to ${minsToHhmm(newStartM)}–${minsToHhmm(newEndM)} to cover the ${w.startSlot}–${minsToHhmm(windowEndM)} shortfall in ${campus}.`;
        suggestions.push({
          type: shiftEarlier ? 'shift-start' : 'shift-end',
          staffName: candidate.name,
          fromTime: minsToHhmm(candidate.startM),
          toTime: minsToHhmm(newStartM),
          coversStart: w.startSlot,
          coversEnd: minsToHhmm(windowEndM),
          shortfallFte: w.peakShortfall,
          text,
        });
        // Remove this candidate from the pool so each staff member is moved at most once
        staffList = staffList.filter(s => s.employeeId !== candidate.employeeId);
        windowResolved = simulatedCoverage.slice(w.startIdx, w.endIdx + 1).every(s => s.surplus >= -0.001);
      } else {
        applyMove(candidate, shiftEarlier, moveMins, true);
        recomputeSurplus();
      }
    }
  }

  recomputeSurplus();

  const slotBySlot: RosterSlotAfter[] = slotCoverage.map((before, i) => ({
    slot: before.slot,
    beforeAvailable: before.totalDays > 0 ? before.available / before.totalDays : 0,
    afterAvailable: simulatedCoverage[i].totalDays > 0 ? simulatedCoverage[i].available / simulatedCoverage[i].totalDays : 0,
    beforeSurplus: before.surplus,
    afterSurplus: simulatedCoverage[i].surplus,
    totalDays: before.totalDays,
  }));

  return {
    centre: campus,
    date: repDate,
    optimal: false,
    suggestions,
    beforeShortfallSlots: shortfallSlots.map(s => s.slot),
    afterShortfallSlots: simulatedCoverage.filter(s => s.surplus < 0).map(s => s.slot),
    slotBySlot,
  };
}

async function fetchZCasualsForDate(centreName: string, date: string) {
  // Strip common prefix so it matches TGA_WORKSPACE_MAP keys in the API
  const normalized = centreName
    .replace(/^The Grove Academy\s*[-–]?\s*/i, '')
    .replace(/^The Grove Academy$/i, 'Wollongong')
    .trim();
  const r = await fetch(`/api/z-casuals?centre=${encodeURIComponent(normalized)}&date=${date}`);
  if (!r.ok) return [];
  const records: {
    zJobId: string; name: string; start: string; end: string;
    status: string; certLevel: string; costCents: number; workspaceId: string;
  }[] = await r.json().catch(() => []);
  const toNegId = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h < 0 ? h : -h;
  };
  return records.map(r => ({
    OperationalUnit: 0,
    Employee: toNegId(r.zJobId),
    _DPMetaData: {
      EmployeeInfo: { DisplayName: r.name },
      OperationalUnitInfo: { OperationalUnitName: 'Z Casual' },
    },
    StartTime: r.start,
    EndTime: r.end,
    isExternalCasual: true,
    externalCasualMeta: {
      zJobId: r.zJobId,
      certLevel: r.certLevel,
      costCents: r.costCents,
      status: r.status,
      workspaceId: r.workspaceId,
    } as ExternalCasualMeta,
  }));
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

  // Report selection
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set(['educator']));
  const [viewingReport, setViewingReport] = useState<string>('educator');

  // Results
  const [loading, setLoading]          = useState(false);
  const [educatorRows, setEducatorRows] = useState<{ date: string; campus: string; entries: EducatorEntry[]; allRooms: string[] }[]>([]);
  const [ratioSnaps, setRatioSnaps]    = useState<RatioSnap[]>([]);
  const [groupingTrends, setGroupingTrends] = useState<{ date: string; campus: string; sessions: any[] }[]>([]);
  const [generated, setGenerated]      = useState(false);
  const [roomFilter, setRoomFilter]    = useState<string>('all');
  const [wwccExpiryFilter, setWwccExpiryFilter] = useState<'all'|'90'|'60'|'30'|'expired'>('all');
  const [wwccExpiryRows, setWwccExpiryRows] = useState<WwccExpiryRow[]>([]);
  const [wwccSyncing, setWwccSyncing]   = useState(false);
  const [wwccSyncMsg, setWwccSyncMsg]   = useState<string | null>(null);
  const [occupancyRows, setOccupancyRows]   = useState<OccupancyRow[]>([]);
  const [rosterOptData, setRosterOptData]   = useState<RosterOptResult[]>([]);
  const [rosterRecs, setRosterRecs]         = useState<RosterRec[]>([]);
  const [rosterSuggestions, setRosterSuggestions] = useState<RosterSuggestionResult[] | null>(null);
  const [rosterSuggestionsLoading, setRosterSuggestionsLoading] = useState(false);
  const [staffingAnalysisRows, setStaffingAnalysisRows] = useState<StaffingAnalysisRow[]>([]);
  const [casualRows, setCasualRows] = useState<CasualDayRow[]>([]);
  type WwccRec = { wwcc_number: string | null; wwcc_expiry: string | null; under_18: boolean; is_internal_casual?: boolean };
  // WWCC lookup function - tries multiple strategies to handle name mismatches
  const [wwccLookup, setWwccLookup] = useState<(name: string) => WwccRec | null>(() => () => null);
  const printRef = useRef<HTMLDivElement>(null);

  const REPORT_DEFS = [
    { id: 'educator',    icon: '📋', label: 'Educator Record (Reg 151)', desc: 'Daily educator log - who was in which room and when. Required for NSW Reg 151 compliance.' },
    { id: 'ratio',       icon: '📐', label: 'Ratio Report',              desc: 'Staff-to-child ratio compliance snapshots across the selected period.' },
    { id: 'trends',      icon: '📈', label: 'Trends',                    desc: 'Family grouping patterns and session trends over time.' },
    { id: 'occupancy',   icon: '🏫', label: 'Attendance Trends',         desc: 'Booked vs attended vs last week - see your absence rate per centre per day.' },
    { id: 'roster-opt',  icon: '🗓️', label: 'Roster Optimisation',       desc: 'Compare child attendance curves against the roster to find over/understaffed windows and get recommendations.' },
    { id: 'wwcc-expiry',        icon: '🛡️', label: 'WWCC Expiries',             desc: 'Working With Children Check expiry dates for all active staff. Sorted by soonest expiring.' },
    { id: 'staffing-analysis', icon: '📊', label: 'Staffing Analysis',          desc: 'Float pool surplus/deficit per centre per day — mirrors the staffing analysis Float Pool panel. Shows buffer required (1:6 floor staff), floats available, AD coverage for small centres (<100 children).' },
    { id: 'casual', icon: '👷', label: 'Casual Report', desc: 'Internal and external casuals used per day, including external casual cost and total hours for the period.' },
  ];

  const handleGenerateRosterSuggestions = async () => {
    setRosterSuggestionsLoading(true);
    setRosterSuggestions(null);
    try {
      const results: RosterSuggestionResult[] = [];
      for (const centre of selectedCentres) {
        const campus = centre.ownaName ?? centre.name;
        const avgSlots = rosterOptData.find(r => r.campus === campus)?.slots ?? [];
        results.push(await buildRosterSuggestionsForCentre(centre, avgSlots, fromDate, toDate));
      }
      setRosterSuggestions(results);
    } catch (err: any) {
      console.error('Failed to generate roster suggestions:', err);
      alert('Failed to generate roster suggestions: ' + (err?.message || 'Unknown error'));
    } finally {
      setRosterSuggestionsLoading(false);
    }
  };

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { window.print(); return; }

    const dateLabel = fromDate === toDate ? safeFormat(new Date(fromDate), 'd MMMM yyyy')
      : `${safeFormat(new Date(fromDate), 'd MMM')} - ${safeFormat(new Date(toDate), 'd MMM yyyy')}`;
    const scopeLabel = scopeType === 'all' ? 'All Centres'
      : scopeType === 'cluster' ? `${cluster} Cluster`
      : selectedCentres[0]?.name ?? '';

    // ── Build educator table rows ─────────────────────────────────────────
    const educatorHtml = viewingReport === 'educator'
      ? educatorRows.map(({ date, campus, entries }) => {
          const filtered = roomFilter === 'all' ? entries
            : entries.filter(e => e.room === roomFilter ||
                (e.blockType === 'lunch_break' && entries.some(o => o.employeeId === e.employeeId && o.room === roomFilter)));
          if (filtered.length === 0) return '';

          // Track by name (not employeeId) — same person can have multiple Deputy
          // roster entries with different employeeIds (float unit + support unit).
          const seenNames = new Set<string>();
          const rows = filtered.map((e) => {
            const isLunch    = e.blockType === 'lunch_break';
            const isGrouping = e.blockType === 'grouping';
            const isCover    = e.blockType === 'lunch_cover' || e.blockType === 'float_move';
            const isLeave    = e.staffType === 'leave';
            const isFloat    = e.staffType === 'float' || e.staffType === 'iss';
            const isExternal = e.staffType === 'external';
            const isInternalCasual = wwccLookup(e.name)?.is_internal_casual === true;
            // Indent as a sub-row when we've already seen this person's name.
            // Leave entries are always top-level (never indent).
            const isFirstRow = isLeave || !seenNames.has(e.name);
            if (!isLeave) seenNames.add(e.name);
            const prevSame = !isFirstRow
              && (isLunch || isGrouping || isCover || e.blockType === 'shift');
            const isMorningFG  = isGrouping && parseInt(e.inTime) < 12;
            const isAfternoonFG = isGrouping && parseInt(e.inTime) >= 12;
            const bg = isLunch ? '#fffbeb'
              : isMorningFG  ? '#f0fdf4'
              : isAfternoonFG ? '#faf5ff'
              : isLeave ? '#fef2f2'
              : isExternal ? '#fff7ed'
              : isInternalCasual ? '#fef3c7'
              : isFloat ? '#eff6ff' : isCover ? '#f0fdf4' : 'white';
            const fgBadge = isMorningFG ? 'Morning FG' : isAfternoonFG ? 'Afternoon FG' : '';
            const badgeParts: string[] = [];
            if (isExternal) badgeParts.push('<span class="badge external" style="background:#fed7aa;color:#c2410c">EC</span>');
            if (isInternalCasual) badgeParts.push('<span class="badge internal" style="background:#fef3c7;color:#92400e">IC</span>');
            if (isFloat) badgeParts.push(`<span class="badge ${e.staffType}">${e.staffType === 'iss' ? 'ISS' : 'Float'}</span>`);
            if (isLeave) badgeParts.push('<span class="badge leave">Leave</span>');
            if (isGrouping) badgeParts.push(`<span class="badge grouping">${fgBadge}</span>`);
            const nameCell = prevSame
              ? `&nbsp;&nbsp;└ ${e.name}`
              : `${e.name}${badgeParts.length ? ' ' + badgeParts.join(' ') : ''}`;
            const isSupport = e.staffType === 'support';
            const typeLabel = isLunch ? 'Lunch' : isMorningFG ? 'Morning FG' : isAfternoonFG ? 'Afternoon FG' : e.blockType === 'lunch_cover' ? 'Lunch cover' : e.blockType === 'float_move' ? 'Float' : isLeave ? 'Leave' : isExternal ? 'External Casual' : isInternalCasual ? 'Internal Casual' : isSupport ? 'Support' : 'Shift';
            return `<tr style="background:${bg}">
              <td>${nameCell}</td>
              <td>${isLunch ? '🍽 ' : isCover ? '↳ ' : isMorningFG ? '🌅 ' : isAfternoonFG ? '🌆 ' : ''}${e.room}</td>
              <td><strong>${e.inTime}</strong></td>
              <td>${e.outTime || (isLunch ? '…' : '-')}</td>
              <td><span style="font-size:9px">${typeLabel}</span></td>
              <td>${(() => { const r2 = wwccLookup(e.name); const noData = !r2||(!r2.wwcc_number&&!r2.under_18); const rl = e.room.toLowerCase(); if (isLunch) return ''; if (noData && ['chef','kitchen','cook'].some(kw => rl.includes(kw))) return '<span style="color:#854d0e;font-size:10px">Kitchen Staff</span>'; if (noData) return '<em>-</em>'; if (r2&&r2.under_18) return '<span style="color:#1d4ed8;font-size:10px">Under 18</span>'; return r2&&r2.wwcc_number ? r2.wwcc_number + (r2.wwcc_expiry ? '<br><small>Exp: ' + new Date(r2.wwcc_expiry).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) + '</small>' : '') : '<em>-</em>'; })()}</td>
              <td>${e.note ?? '-'}</td>
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
    const ratioHtml = viewingReport === 'ratio'
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

    const reportTitle = viewingReport === 'educator' ? 'Regulation 151 - Daily Educator Record'
      : viewingReport === 'ratio'       ? 'Ratio Compliance Report'
      : viewingReport === 'trends'      ? 'Grouping Trends Report'
      : viewingReport === 'occupancy'   ? 'Attendance Trends Report'
      : viewingReport === 'roster-opt'  ? 'Roster Optimisation Report'
      : viewingReport === 'wwcc-expiry' ? 'WWCC Expiry Monitor'
      : viewingReport === 'casual'      ? 'Casual Report'
      : 'Report';

    // ── Build occupancy HTML ──────────────────────────────────────────────────
    const occupancyHtml = viewingReport === 'occupancy' && occupancyRows.length > 0
      ? `<table>
          <thead><tr><th>Date</th><th>Campus</th><th>Booked</th><th>Attended</th><th>Absent</th><th>Last Week</th><th>Change</th></tr></thead>
          <tbody>${occupancyRows.map((r, i) => `
            <tr style="background:${i % 2 === 0 ? 'white' : '#fafffe'}">
              <td>${safeFormat(new Date(r.date), 'd MMM yyyy')}</td>
              <td>${r.campus}</td>
              <td style="color:#1d4ed8">${r.booked > 0 ? r.booked : '\u2014'}</td>
              <td><strong>${r.actual}</strong></td>
              <td style="color:${r.booked > 0 && r.booked - r.actual > 0 ? '#d97706' : '#596570'}">${r.booked > 0 ? r.booked - r.actual : '\u2014'}</td>
              <td>${r.lastWeek > 0 ? r.lastWeek : '\u2014'}</td>
              <td style="color:${r.change > 0 ? '#166534' : r.change < 0 ? '#991b1b' : '#596570'}">${r.change > 0 ? '+' + r.change : r.change < 0 ? String(r.change) : '\u2014'}</td>
            </tr>`).join('')}</tbody>
        </table>`
      : '';

    // ── Build WWCC expiry HTML ────────────────────────────────────────────────
    const wwccHtml = viewingReport === 'wwcc-expiry' && wwccExpiryRows.length > 0
      ? `<table>
          <thead><tr><th>Name</th><th>Centre</th><th>Status</th><th>WWCC Number</th><th>Expiry Date</th><th>Days Remaining</th></tr></thead>
          <tbody>${wwccExpiryRows.map((r, i) => {
            const expDate = r.wwcc_expiry ? new Date(r.wwcc_expiry) : null;
            const days = r.daysRemaining;
            const col = days === null ? '#9ca3af' : days < 0 ? '#dc2626' : days < 30 ? '#d97706' : days < 90 ? '#92400e' : '#166534';
            const dLabel = !expDate ? '\u2014' : days !== null && days < 0 ? 'EXPIRED' : days !== null ? days + 'd' : '\u2014';
            const statusHtml = r.exemptReason === 'under_18' ? '<span style="color:#1d4ed8;font-size:9px;font-weight:700">Under 18</span>'
              : r.exemptReason === 'kitchen' ? '<span style="color:#854d0e;font-size:9px;font-weight:700">Kitchen Staff</span>' : '\u2014';
            return `<tr style="background:${i % 2 === 0 ? 'white' : '#fafffe'}">
              <td><strong>${r.full_name}</strong></td>
              <td>${r.centre || '\u2014'}</td>
              <td>${statusHtml}</td>
              <td style="font-family:monospace">${r.wwcc_number ?? '\u2014'}</td>
              <td>${expDate ? expDate.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014'}</td>
              <td style="font-weight:700;color:${col}">${dLabel}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`
      : '';

    // ── Build casual HTML ─────────────────────────────────────────────────────
    // ── Build casual HTML ─────────────────────────────────────────────────────
    const casualHtml = viewingReport === 'casual' && casualRows.length > 0
      ? (() => {
          const byDate: Record<string, CasualDayRow[]> = {};
          for (const row of casualRows) (byDate[row.date] ??= []).push(row);
          const dates = Object.keys(byDate).sort();
          return dates.map(date => {
            const dateRows = byDate[date].sort((a, b) => a.campus.localeCompare(b.campus));
            const dateInternalHours = dateRows.reduce((s, r) => s + r.internalHours, 0);
            const dateExternalHours = dateRows.reduce((s, r) => s + r.externalHours, 0);
            const dateExternalCostCents = dateRows.reduce((s, r) => s + r.externalCostCents, 0);
            return `
              <div class="day-block">
                <div class="day-header">
                  <span class="campus">${safeFormat(new Date(date), 'EEEE, d MMMM yyyy')}</span>
                  <span class="date">${dateRows.length} centre${dateRows.length !== 1 ? 's' : ''}</span>
                  <span class="count">${dateInternalHours.toFixed(1)}h internal &middot; ${dateExternalHours.toFixed(1)}h external${dateExternalCostCents > 0 ? ' &middot; $' + (dateExternalCostCents / 100).toFixed(2) : ''}</span>
                </div>
                <table>
                  <thead><tr><th>Centre</th><th>Internal Shifts</th><th>Internal Hours</th><th>External Shifts</th><th>External Hours</th><th>External Cost</th></tr></thead>
                  <tbody>
                    ${dateRows.map(day => `
                      <tr>
                        <td>${day.campus}</td>
                        <td>${day.internalCount}</td>
                        <td>${day.internalHours.toFixed(2)}</td>
                        <td>${day.externalCount}</td>
                        <td>${day.externalHours.toFixed(2)}</td>
                        <td>$${(day.externalCostCents / 100).toFixed(2)}</td>
                      </tr>
                    `).join('')}
                    <tr style="background:#fef3c7;font-weight:700">
                      <td>Day total</td>
                      <td>${dateRows.reduce((s, r) => s + r.internalCount, 0)}</td>
                      <td>${dateInternalHours.toFixed(2)}</td>
                      <td>${dateRows.reduce((s, r) => s + r.externalCount, 0)}</td>
                      <td>${dateExternalHours.toFixed(2)}</td>
                      <td>$${(dateExternalCostCents / 100).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            `;
          }).join('');
        })()
      : '';

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
    .badge.external { background: #fed7aa; color: #c2410c; }
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
  ${viewingReport === 'educator' ? '<div class="reg-notice"><strong>Regulation 151 Record</strong> - Documents which educators were working directly with children, which room/group they were allocated to, and the times of allocation including scheduled meal breaks. WWCC numbers are held in the staff compliance register.</div>' : ''}
  ${educatorHtml}${ratioHtml}${occupancyHtml}${wwccHtml}${casualHtml}
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

    // Only fetch data relevant to the selected reports
    const needsEducator        = selectedReports.has('educator') || selectedReports.has('ratio') || selectedReports.has('trends');
    const needsOccupancy       = selectedReports.has('occupancy');
    const needsRosterOpt       = selectedReports.has('roster-opt');
    const needsWwccExpiry      = selectedReports.has('wwcc-expiry');
    const needsStaffingAnalysis = selectedReports.has('staffing-analysis');
    const needsCasual          = selectedReports.has('casual');
    const needsDateLoop        = needsEducator || needsOccupancy || needsRosterOpt || needsStaffingAnalysis || needsCasual;

    const rows: typeof educatorRows = [];
    const snaps: RatioSnap[] = [];
    const groupingTrendRows: { date: string; campus: string; sessions: any[] }[] = [];
    const occRows: OccupancyRow[] = [];
    const staffingRowsAccum: StaffingAnalysisRow[] = [];
    const rosterAccum: Record<string, Record<string, { sumChildren: number; sumStaff: number; sumOffFloor: number; sumOffFloorExclDirector: number; sumISS: number; sumRequired: number; days: number }>> = {};
    const casualAccum: CasualDayRow[] = [];
    const ROSTER_SLOTS_30: string[] = [];
    for (let rmi = 7 * 60; rmi < 18 * 60; rmi += 30) {
      ROSTER_SLOTS_30.push(`${String(Math.floor(rmi/60)).padStart(2,'0')}:${String(rmi%60).padStart(2,'0')}`);
    }

    // Generate dates in range - use UTC noon to avoid timezone-induced off-by-one
    const dates: string[] = [];
    let cur = fromDate;
    while (cur <= toDate) {
      const [y, m, dy] = cur.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, dy)).getUTCDay();
      if (dow !== 0 && dow !== 6) dates.push(cur); // weekdays only
      cur = new Date(Date.UTC(y, m - 1, dy + 1)).toISOString().slice(0, 10);
    }

    // Normalise names the same way the WWCC lookup does.
    function normName(n: string) {
      return n.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // Build a set of internal-casual names once for the report.
    const internalCasualNames = new Set<string>();
    if (needsCasual) {
      try {
        const wwccAll: any[] = await fetch('/api/staff-wwcc').then(r => r.ok ? r.json() : []).catch(() => []);
        for (const rec of wwccAll) {
          if (rec.is_internal_casual === true) {
            internalCasualNames.add(normName(rec.full_name_norm ?? rec.full_name));
          }
        }
      } catch { /* ignore */ }
    }

    // Only fetch the data each selected report actually needs.
    const needAttendance      = needsOccupancy || needsRosterOpt || needsEducator || needsStaffingAnalysis;
    const needZCasuals        = needsCasual || needsEducator;
    const needAllocations     = needsEducator;
    const needFloatScheds     = needsEducator;
    const needGroupingSessions = needsEducator;
    const needRatioCheck      = needsEducator || needsStaffingAnalysis;
    const needDeputyActuals   = needsEducator;


    if (needsDateLoop) for (const centre of selectedCentres) {
      const campus = centre.ownaName ?? centre.name;
      const allUnitIds = [
        ...centre.rooms.map(r => r.deputyUnitId),
        ...(centre.floatUnitIds ?? []),
        ...(centre.issUnitIds ?? []),
        ...(centre.leaveUnitIds ?? []),
        ...(centre.nonRatioUnitIds ?? []),
      ];

      for (const date of dates) {
        // Fetch only the endpoints the selected reports need.
        const [att, rosters, zCasuals, allocations, floatScheds, groupingSessionRows, ratioCheckRows, deputyActuals] = await Promise.all([
          needAttendance ? fetchAttendance(campus, date) : Promise.resolve([]),
          fetchRostersForDate(allUnitIds, date),
          needZCasuals ? fetchZCasualsForDate(centre.name, date) : Promise.resolve([]),
          needAllocations ? fetch(`/api/staff-allocations?centre=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
          needFloatScheds ? fetch(`/api/float-schedules?centre=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
          needGroupingSessions ? fetch(`/api/grouping-sessions?centre=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
          needRatioCheck ? fetch(`/api/ratio-check?centre_id=${encodeURIComponent(centre.id)}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
          needDeputyActuals ? fetch(`/api/deputy-timesheets-actual?unitIds=${allUnitIds.join(',')}&date=${date}`)
            .then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
        ]);

        // Include external casuals in the roster loop so their room allocation
        // follows the same ratio-check logic as every other staff member.
        const rostersWithExternal = needsEducator ? [...(rosters as any[]), ...(zCasuals as any[])] : (rosters as any[]);
        if (needsEducator) groupingTrendRows.push({ date, campus, sessions: groupingSessionRows as any[] });

        // ── Casuals ──────────────────────────────────────────────────────
        if (needsCasual) {
          let internalHours = 0;
          let internalCount = 0;
          for (const r of rosters as any[]) {
            if (!r.Employee || r.Employee === 0) continue;
            const name = r._DPMetaData?.EmployeeInfo?.DisplayName || `Staff ${r.Employee}`;
            if (!internalCasualNames.has(normName(name))) continue;
            const startM = hhmm(fmtTime(r.StartTime));
            const endM = hhmm(fmtTime(r.EndTime));
            if (startM === null || endM === null) continue;
            let durM = endM - startM;
            if (durM < 0) durM += 24 * 60; // overnight shift
            internalHours += durM / 60;
            internalCount += 1;
          }

          let externalHours = 0;
          let externalCostCents = 0;
          let externalCount = 0;
          for (const r of zCasuals as any[]) {
            const startM = hhmm(fmtTime(r.StartTime));
            const endM = hhmm(fmtTime(r.EndTime));
            if (startM === null || endM === null) continue;
            let durM = endM - startM;
            if (durM < 0) durM += 24 * 60;
            externalHours += durM / 60;
            externalCount += 1;
            const meta = (r.externalCasualMeta ?? {}) as ExternalCasualMeta;
            externalCostCents += meta.costCents ?? 0;
          }

          if (internalHours > 0 || externalHours > 0 || externalCostCents > 0) {
            casualAccum.push({ date, campus, centreId: centre.id, internalCount, internalHours, externalCount, externalHours, externalCostCents });
          }
        }

        // ── Occupancy ────────────────────────────────────────────────────
        if (needsOccupancy) {
          // All rows have sign_in (Owna only stores signed-in children).
          // Compare against same weekday last week as the expected baseline.
          const actual = (att as any[]).length;
          const [yy, mo, dday] = date.split('-').map(Number);
          const priorDate = new Date(Date.UTC(yy, mo - 1, dday - 7)).toISOString().slice(0, 10);
          const priorAtt  = await fetchAttendance(campus, priorDate);
          const lastWeek  = (priorAtt as any[]).length;
          // Booked + capacity from daily_occupancy (synced from Owna)
          const bookRes = await fetch(
            `${SUPABASE_URL}/rest/v1/daily_occupancy?campus=eq.${encodeURIComponent(campus)}&date=eq.${date}&select=booked,capacity`,
            { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
          ).catch(() => null);
          const bookRows: any[] = bookRes?.ok ? await bookRes.json() : [];
          const booked   = bookRows[0]?.booked   ?? 0;
          const capacity = bookRows[0]?.capacity ?? 0;
          occRows.push({
            date, campus,
            expected: actual,
            actual,
            booked,
            capacity,
            lastWeek,
            change: actual - lastWeek,
          });
        }

        // ── Roster Optimisation ──────────────────────────────────────────
        if (needsRosterOpt) {
          // Use rosters already fetched via /api/deputy-rosters - raw Deputy API format:
          // r.OperationalUnit (number), r.StartTime / r.EndTime (unix timestamps in seconds)
          const nonRatioIdsSet = new Set([...(centre.nonRatioUnitIds ?? []), ...(centre.leaveUnitIds ?? [])]);
          const issIdsSet       = new Set(centre.issUnitIds ?? []);
          const leaveIdsSet2    = new Set(centre.leaveUnitIds ?? []);
          // Room staff: directly assigned to rooms (these are the ratio-counting staff)
          const roomUnitIds = new Set(centre.rooms.map(rm => rm.deputyUnitId));
          const floatUnitIds2 = new Set(centre.floatUnitIds ?? []);
          const campusRostersFiltered = (rosters as any[]).filter((r: any) =>
            r.Employee && r.Employee !== 0 &&
            roomUnitIds.has(r.OperationalUnit) // room staff only
          );
          // Float staff: buffer/reserve pool
          const floatRostersFiltered = (rosters as any[]).filter((r: any) =>
            r.Employee && r.Employee !== 0 &&
            floatUnitIds2.has(r.OperationalUnit)
          );
          if (!rosterAccum[campus]) {
            rosterAccum[campus] = {};
            for (const rslot of ROSTER_SLOTS_30) {
              rosterAccum[campus][rslot] = { sumChildren: 0, sumStaff: 0, sumOffFloor: 0, sumOffFloorExclDirector: 0, sumISS: 0, sumRequired: 0, days: 0 };
            }
          }
          for (const rslot of ROSTER_SLOTS_30) {
            const [rsh, rsm] = rslot.split(':').map(Number);
            const slotMinutes = rsh * 60 + rsm;
            // sign_in/sign_out are HH:MM strings - use hhmm() helper.
            // Build the full child array (with age) so we can apply real NSW ratios.
            const childrenAtSlot = (att as any[]).filter(r => {
              const siM = hhmm(r.sign_in);
              if (siM === null || siM > slotMinutes) return false;
              const soM  = hhmm(r.sign_out);
              if (soM !== null && soM <= slotMinutes) return false;
              const psoM = hhmm(r.predicted_sign_out);
              if (soM === null && psoM !== null && psoM <= slotMinutes) return false;
              return true;
            }).map((r: any) => ({ ageMonths: r.ageMonths ?? parseAgeMonths(r.age ?? null), child_name: r.child_name ?? '', room: r.room ?? '', sign_in: r.sign_in, sign_out: r.sign_out, predicted_sign_out: r.predicted_sign_out, age: r.age }));
            const childrenPresent = childrenAtSlot.length;
            // Required staff calculated PER ROOM independently — each room must meet its
            // own ratio. Cannot use carryover between rooms (that would undercount).
            const childrenByRoom: Record<string, typeof childrenAtSlot> = {};
            for (const child of childrenAtSlot) {
              const rk = (child as any).room || 'unassigned';
              (childrenByRoom[rk] = childrenByRoom[rk] || []).push(child);
            }
            let reqStaff = 0;
            for (const roomKids of Object.values(childrenByRoom)) {
              // Cascade within the room handles mixed-age rooms correctly
              const { required } = calcRequiredStaff(roomKids as any);
              reqStaff += required;
            }
            // Check if a roster entry covers this slot (unique employees counted via Set).
            // /api/deputy-rosters returns StartTime/EndTime as HH:MM strings; be robust to
            // legacy unix timestamps as well.
            const shiftCheck = (r: any) => {
              if (!r.StartTime || !r.EndTime) return false;
              const startM = hhmm(fmtTime(r.StartTime));
              const endM   = hhmm(fmtTime(r.EndTime));
              if (startM === null || endM === null) return false;
              return startM <= slotMinutes && endM > slotMinutes;
            };
            // Floor staff = room + float combined (both count toward ratio coverage)
            const roomStaffOnShift = new Set(campusRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            const floatOnShift     = new Set(floatRostersFiltered.filter(shiftCheck).map((r: any) => r.Employee)).size;
            const staffOnShift     = roomStaffOnShift + floatOnShift;
            // Off floor = unique non-ratio employees (directors, chefs, admin), not leave
            const offFloorRosters = (rosters as any[]).filter((r: any) =>
              r.Employee && r.Employee !== 0 &&
              nonRatioIdsSet.has(r.OperationalUnit) &&
              !leaveIdsSet2.has(r.OperationalUnit) &&
              shiftCheck(r)
            );
            const offFloorOnShift = new Set(offFloorRosters.map((r: any) => r.Employee)).size;
            // Off-floor staff who can actually step onto the floor as ratio cover.
            // Exclude director, chef/cook, and trainee/study-time units.
            const isOffFloorCover = (r: any) => {
              const uName = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '').toLowerCase();
              if (uName.includes('director') && !uName.includes('assistant') && !uName.includes('asst')) return false;
              if (uName.includes('chef') || uName.includes('cook')) return false;
              if (uName.includes('study') || uName.includes('trainee') || uName.includes('traineeship')) return false;
              return true;
            };
            const offFloorCoverOnShift = new Set(
              offFloorRosters.filter((r: any) => isOffFloorCover(r)).map((r: any) => r.Employee)
            ).size;
            // ISS = unique ISS employees
            const issOnShift = new Set(
              (rosters as any[]).filter((r: any) =>
                r.Employee && r.Employee !== 0 &&
                issIdsSet.has(r.OperationalUnit) &&
                shiftCheck(r)
              ).map((r: any) => r.Employee)
            ).size;
            rosterAccum[campus][rslot].sumChildren             += childrenPresent;
            rosterAccum[campus][rslot].sumStaff                  += staffOnShift;
            rosterAccum[campus][rslot].sumOffFloor               += offFloorOnShift;
            rosterAccum[campus][rslot].sumOffFloorExclDirector   += offFloorCoverOnShift;
            rosterAccum[campus][rslot].sumISS                    += issOnShift;
            rosterAccum[campus][rslot].sumRequired               += reqStaff;
            rosterAccum[campus][rslot].days++;
          }
        }

        // Build combined staffMoves + FG configs + time overrides + notes from all ratio-check sessions
        const ratioStaffMoves: Record<string, string> = {};
        const ratioStaffNotes: Record<string, string> = {};
        const ratioFGConfigs: Array<{ id: string; label: string; roomIds: string[]; slots: string[]; heldInRoom?: string }> = [];
        const ratioTimeOverrides: Record<string, { start: string; end: string; lunchStart?: string; lunchEnd?: string; source?: string }> = {};
        const ratioVisitors: Array<{ id: string; name: string; wwccNumber?: string; roomId: string; enteredAt: string; exitedAt?: string }> = [];

        for (const row of (ratioCheckRows as any[])) {
          const moves = (row.data?.staffMoves ?? {}) as Record<string, string>;
          Object.assign(ratioStaffMoves, moves);
          const notes = (row.data?.staffNotes ?? {}) as Record<string, string>;
          Object.assign(ratioStaffNotes, notes);
          for (const fg of (row.data?.familyGroupings ?? [])) {
            if (!ratioFGConfigs.find(f => f.id === fg.id)) ratioFGConfigs.push(fg);
          }
          // Collect visitor entries from all sessions for the Reg 151 report.
          // Visitors may be stored under any slot bucket, so de-duplicate by id.
          // Key format is `${slot}:${roomId}`; slot itself contains a colon (HH:MM),
          // so the roomId is everything after the final colon.
          const visitors = (row.data?.roomVisitors ?? {}) as Record<string, Array<{ id: string; name: string; wwccNumber?: string; enteredAt: string; exitedAt?: string }>>;
          for (const [key, list] of Object.entries(visitors)) {
            const roomId = key.slice(key.lastIndexOf(':') + 1);
            for (const v of (list ?? [])) {
              if (!ratioVisitors.find(rv => rv.id === v.id)) {
                ratioVisitors.push({ ...v, roomId });
              }
            }
          }
          // Merge Supabase overrides — these come from the Ratio Check browser 5-min Deputy poll
          // and are the most complete/accurate source (contain all staff clocked in that day)
          const overrides = (row.data?.staffTimeOverrides ?? {}) as Record<string, { start: string; end: string; lunchStart?: string; lunchEnd?: string; source?: string }>;
          for (const [empId, ov] of Object.entries(overrides)) {
            // Manual overrides always win; Deputy actuals fill in if no existing entry
            if (!ratioTimeOverrides[empId] || ov.source === 'manual') {
              ratioTimeOverrides[empId] = ov;
            } else if (!ratioTimeOverrides[empId].lunchStart && ov.lunchStart) {
              // Supplement missing lunch from another session's data
              ratioTimeOverrides[empId] = { ...ratioTimeOverrides[empId], lunchStart: ov.lunchStart, lunchEnd: ov.lunchEnd };
            }
          }
        }

        // Supplement with per-centre Deputy timesheets API (fills gaps for staff
        // not yet in Supabase e.g. first load of the day before any Ratio Check opened)
        for (const ts of (deputyActuals as any[])) {
          if (!ts.actualStart) continue;
          const empId = String(ts.employeeId);
          const existing = ratioTimeOverrides[empId];
          if (existing?.source === 'manual') continue; // never overwrite manual
          const brk = (ts.breaks as any[])?.find((b: any) => b.type === 'meal' && (b.status === 'finished' || b.status === 'in_progress'));
          const fromApi = {
            start:      ts.actualStart || existing?.start || '',
            end:        ts.actualEnd   || existing?.end   || '',
            lunchStart: brk?.breakStart ?? existing?.lunchStart,
            lunchEnd:   brk?.breakEnd   ?? existing?.lunchEnd,
            source:     'deputy' as const,
          };
          if (!existing) {
            ratioTimeOverrides[empId] = fromApi;
          } else if (!existing.lunchStart && fromApi.lunchStart) {
            // Fill in missing lunch from direct API
            ratioTimeOverrides[empId] = { ...existing, lunchStart: fromApi.lunchStart, lunchEnd: fromApi.lunchEnd };
          }
        }

        // ── Educator record - built from Ratio Check state ─────────────────────────
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

        // Build a map from employeeId -> natural room id (for covered-person room lookup)
        const empNaturalRoomId: Record<number, string> = {};
        for (const r of (rostersWithExternal as any[])) {
          const unitId = r.OperationalUnit as number;
          const empId2 = r.Employee as number;
          const naturalRm = centre.rooms.find(rm => rm.deputyUnitId === unitId);
          if (naturalRm) empNaturalRoomId[empId2] = naturalRm.id;
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
              // Determine the room the float is physically covering:
              // - explicit roomId on the block (lunch/ratio cover)
              // - OR derive from the covered person's natural room (programming/cleaning cover)
              let effectiveRoomId: string | undefined = block.roomId;
              if (!effectiveRoomId && covId) {
                effectiveRoomId = empNaturalRoomId[covId];
              }
              if (effectiveRoomId && floatId) {
                if (!cover[effectiveRoomId]) cover[effectiveRoomId] = [];
                if (!cover[effectiveRoomId].includes(floatId)) cover[effectiveRoomId].push(floatId);
              }
            }
          }
          offFloor151[slot] = off;
          floatCovers151[slot] = cover;
        }

        // Day-level allocations from staff-allocations
        const dayAlloc151: Record<number, string> = (allocations as any[])[0]?.moves ?? {};

        // Helper: get a staff member's room/activity at a given slot.
        // exactIn/exactOut: if set, the caller should use these instead of slot-boundary times
        function posAt(empId: number, slot: string): { room: string; blockType: EducatorEntry['blockType']; note?: string; exactIn?: string; exactOut?: string } {
          const key = `${empId}:${slot}`;
          const move = ratioStaffMoves[key];
          const staffNote = ratioStaffNotes[key];
          if (move !== undefined) {
            if (move === '__programming__') return { room: 'Programming', blockType: 'shift', note: staffNote || 'Programming' };
            if (move === '__cleaning__')    return { room: 'Cleaning',    blockType: 'shift', note: staffNote || 'Cleaning' };
            if (move === '__lunch__')       return { room: 'Lunch Break', blockType: 'lunch_break', note: staffNote };
            if (move === '__additional__')  return { room: 'Additional Duties', blockType: 'shift', note: staffNote };
            if (move === '__removed__')     return { room: 'Off Roster', blockType: 'shift', note: staffNote };
            const r = centre.rooms.find(r => r.id === move);
            if (r) return { room: r.name, blockType: 'shift', note: staffNote };
            // move is a pool sentinel ('float', 'iss') — not a real room, treat as unassigned
            if (move === 'float' || move === 'iss') return { room: '', blockType: 'shift', note: staffNote };
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
                const exactIn  = String(block.startTime ?? '');
                // Only stamp exactOut on the last slot of this block so consecutive
                // slots within the same block are not split by the merge-stop guard.
                const isLastSlotInBlock = sm151(slot) + 15 >= bE;
                const exactOut = isLastSlotInBlock ? String(block.endTime ?? '') : undefined;
                if (ct === 'programming') return { room: 'Programming', blockType: 'shift', note: floatName ? `Programming - covered by ${floatName}` : 'Programming - covered by float', exactIn, exactOut };
                if (ct === 'cleaning')    return { room: 'Cleaning',    blockType: 'shift', note: floatName ? `Cleaning - covered by ${floatName}` : 'Cleaning - covered by float', exactIn, exactOut };
                return { room: 'Lunch Break', blockType: 'lunch_break', note: floatName ? `Meal break - covered by ${floatName}` : 'Meal break', exactIn, exactOut };
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
                // Find covering context from float schedule block, and grab exact times
                let coverNote: string | undefined;
                let exactIn: string | undefined;
                let exactOut: string | undefined;
                for (const fsRow of (floatScheds as any[])) {
                  if (fsRow.employee_id !== empId) continue;
                  for (const block of (fsRow.schedule ?? [])) {
                    const bS = sm151(String(block.startTime ?? '00:00'));
                    const bE = sm151(String(block.endTime   ?? '00:00'));
                    if (sm151(slot) < bS || sm151(slot) >= bE) continue;
                    const ct = String(block.coverType ?? '').toLowerCase();
                    exactIn  = String(block.startTime ?? '');
                    // Only stamp exactOut on the last slot of this block so consecutive
                    // slots within the same block are not split by the merge-stop guard.
                    exactOut = sm151(slot) + 15 >= bE ? String(block.endTime ?? '') : undefined;
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
                return { room: r.name, blockType: 'shift', note: coverNote, exactIn, exactOut };
              }
            }
          }
          // Day-level allocation
          const dayRoom = dayAlloc151[empId];
          if (dayRoom) {
            if (dayRoom === 'float' || dayRoom === 'iss') return { room: '', blockType: 'shift' };
            const r = centre.rooms.find(r => r.id === dayRoom);
            if (r) return { room: r.name, blockType: 'shift' };
          }
          return { room: '', blockType: 'shift' }; // natural room - set by caller
        }

        const floatSet2 = new Set(centre.floatUnitIds ?? []);
        const issSet2   = new Set(centre.issUnitIds ?? []);
        const leaveSet2 = new Set(centre.leaveUnitIds ?? []);
        const roomSet2  = new Set(centre.rooms.map(r => r.deputyUnitId));

        const entries: EducatorEntry[] = [];

        for (const r of (rostersWithExternal as any[])) {
          const unitId = r.OperationalUnit as number;
          const empId  = r.Employee as number;
          const name   = r._DPMetaData?.EmployeeInfo?.DisplayName ?? `Staff #${empId}`;
          if (name.startsWith('Staff #')) continue;
          const rawUnit = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '').toLowerCase();
          if (rawUnit.includes('staff meeting')) continue;
          const isExternalCasual = r.isExternalCasual === true;

          // Use actual Deputy times from Ratio Check overrides if available, else fall back to rostered
          // Leave entries always use roster times — Deputy clock-in overrides don't apply to leave blocks
          // Support entries (e.g. Trainee Study Time) also use their own roster times — they may have
          // different hours to the main shift and the clock-in override reflects the main shift only.
          const isLeaveUnit   = leaveSet2.has(unitId as number);
          // Study Time units are secondary blocks (not the person's main shift) — skip override
          const isStudyTime = rawUnit.includes('study time');
          const actualOverride = (!isLeaveUnit && !isStudyTime) ? ratioTimeOverrides[String(empId)] : undefined;
          const shiftIn  = actualOverride?.start || fmtTime(r.StartTime);
          // If Deputy hasn't clocked them out yet, fall back to rostered end time
          const shiftOut = (actualOverride?.end || '') || fmtTime(r.EndTime);
          if (shiftIn === '-' || shiftOut === '-') continue;

          const staffType: EducatorEntry['staffType'] =
            isExternalCasual ? 'external'
            : leaveSet2.has(unitId) ? 'leave'
            : floatSet2.has(unitId) ? 'float'
            : issSet2.has(unitId)   ? 'iss'
            : roomSet2.has(unitId)  ? 'room'
            : 'support';

          if (staffType === 'leave') {
            const unitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? 'Leave';
            entries.push({ employeeId: empId, name, room: unitName, inTime: shiftIn, outTime: shiftOut, blockType: 'leave', staffType: 'leave', note: unitName });
            continue;
          }

          // Support staff (AD, Directors, Admin, etc.) — run them through the full
          // slot-position logic just like room/float staff so that ratio check moves
          // (manual drags into rooms) are always reflected in the report.
          // The only difference: their naturalRoomName falls back to their Deputy unit name.
          if (staffType === 'support') {
            // fall through to the slot-position logic below
          }

          const naturalRoom = centre.rooms.find(rm => rm.deputyUnitId === unitId);
          const deputyUnitName = r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '';
          // Room staff: fall back to their natural Deputy room.
          // Float/ISS: no fallback — location comes entirely from ratio check moves.
          // Support (AD, Directors, etc.): fall back to their Deputy unit name so they
          //   always appear in the report; ratio check moves override specific slots.
          const naturalRoomName = naturalRoom?.name ?? (
            staffType === 'float' ? ''
            : staffType === 'external' ? 'Off Floor'
            : staffType === 'iss'   ? ''
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
          const positions: Array<{ slot: string; room: string; blockType: EducatorEntry['blockType']; note?: string; exactIn?: string; exactOut?: string }> = [];
          for (const slot of shiftSlots) {
            const pos = posAt(empId, slot);
            const room = pos.room || naturalRoomName;
            const roomObj = room ? centre.rooms.find(r => r.name === room) : undefined;

            // Check if the resolved room (natural, moved, or float-cover) is part
            // of a family grouping at this slot. If so, report as grouping.
            let fgPos: { room: string; blockType: EducatorEntry['blockType']; note?: string } | null = null;
            if (roomObj) {
              for (const fg of ratioFGConfigs) {
                if (!fg.slots.includes(slot)) continue;
                const fgRoomIds = fg.roomIds.length === 0 ? centre.rooms.map(r => r.id) : fg.roomIds;
                if (fgRoomIds.includes(roomObj.id)) {
                  const heldIn = fg.heldInRoom ? (centre.rooms.find(r => r.id === fg.heldInRoom)?.name ?? fg.heldInRoom) : fg.label;
                  fgPos = { room: heldIn, blockType: 'grouping' as EducatorEntry['blockType'], note: `${fg.label} - held in ${heldIn}` };
                  break;
                }
              }
            }

            if (fgPos) {
              positions.push({ slot, ...fgPos, exactIn: pos.exactIn, exactOut: pos.exactOut });
            } else {
              positions.push({ slot, room, blockType: pos.blockType, note: pos.note, exactIn: pos.exactIn, exactOut: pos.exactOut });
            }
          }

          // Merge consecutive same-room/blockType slots
          const lunchStart = actualOverride?.lunchStart;
          const lunchEnd   = actualOverride?.lunchEnd;
          let i = 0;
          while (i < positions.length) {
            const start = positions[i];
            let j = i + 1;
            // Merge consecutive slots in the same room with the same blockType.
            // Note differences within the same room are ignored — the first slot's
            // note is used for the whole block.
            // IMPORTANT: if any slot in the block has exactOut set (from a float
            // schedule block), stop merging there — the float schedule end time is
            // a hard cap and ratio check propagation must not bleed past it.
            while (j < positions.length &&
              positions[j].room === start.room &&
              positions[j].blockType === start.blockType &&
              !positions[j - 1].exactOut) j++;
            const lastSlot = positions[j - 1].slot;
            const endMins = sm151(lastSlot) + 15;
            const slotEndTime = `${String(Math.floor(endMins/60)).padStart(2,'0')}:${String(endMins%60).padStart(2,'0')}`;
            if (start.room && start.room !== 'Off Roster') {
              const isFirstBlock = i === 0;
              const isLastBlock  = j === positions.length;
              // For float cover blocks, use exact schedule times from the float schedule
              // (e.g. 12:38 not 12:30) rather than slot boundaries.
              // exactIn on the first slot of the block = exact start; exactOut on the last slot = exact end.
              // Use exact float schedule times when available.
              // exactIn: from the first slot of the block (float schedule start time).
              // exactOut: from the last slot of the block IF it has exactOut set
              //   (float schedule end time — hard cap, stops ratio check bleed-over).
              const exactBlockIn  = start.exactIn;
              const exactBlockOut = positions[j - 1].exactOut;
              // Actual in: exact float schedule time > clock-in > slot start
              let entryIn  = exactBlockIn  ? exactBlockIn
                           : isFirstBlock && shiftIn && shiftIn !== '-' ? shiftIn
                           : start.slot;
              // Actual out: exact float schedule time > clock-out > slot end time
              let entryOut = exactBlockOut ? exactBlockOut
                           : isLastBlock && shiftOut && shiftOut !== '-' ? shiftOut
                           : slotEndTime;
              // If lunch break exists, trim shift blocks around the break so there
              // are no gaps: block before lunch ends exactly at lunchStart,
              // block after lunch starts exactly at lunchEnd.
              if (lunchStart && lunchEnd) {
                const blockStartMins = sm151(entryIn);
                const blockEndMins   = sm151(entryOut);
                const lunchStartMins = sm151(lunchStart);
                const lunchEndMins   = sm151(lunchEnd);
                if (blockStartMins >= lunchStartMins && blockEndMins <= lunchEndMins) {
                  // Entirely within lunch — skip
                  i = j; continue;
                }
                if (blockStartMins < lunchStartMins && blockEndMins > lunchEndMins) {
                  // Block spans the entire lunch window — split into pre + post
                  // Pre-lunch block
                  entries.push({ employeeId: empId, name, room: start.room, inTime: entryIn, outTime: lunchStart, blockType: start.blockType, staffType, note: start.note });
                  // Post-lunch block
                  entries.push({ employeeId: empId, name, room: start.room, inTime: lunchEnd, outTime: entryOut, blockType: start.blockType, staffType, note: start.note });
                  i = j; continue;
                }
                if (blockStartMins < lunchStartMins && blockEndMins > lunchStartMins) {
                  // Block runs into lunch start — trim end to exact lunch start time
                  entryOut = lunchStart;
                } else if (blockEndMins > lunchEndMins && blockStartMins <= lunchEndMins) {
                  // Block starts at or during lunch — push start to exact lunch end time
                  entryIn = lunchEnd;
                }
              }
              entries.push({
                employeeId: empId,
                name,
                room: start.room,
                inTime:  entryIn,
                outTime: entryOut,
                blockType: start.blockType,
                staffType,
                note: start.note,
              });
            }
            i = j;
          }
        }

        // Deduplicate entries: when the same person appears in both a float unit
        // and support unit in Deputy, the loop processes them twice producing
        // overlapping entries. Resolve by keeping the ratio-check-sourced entry
        // ('shift') over float-schedule-derived ('float' staffType or 'float_move').
        // Overlap = same employee, same room, time ranges intersect.
        const dedupedEntries: EducatorEntry[] = [];
        for (const entry of entries) {
          const eS = sm151(entry.inTime);
          const eE = sm151(entry.outTime);
          const conflict = dedupedEntries.findIndex(e => {
            if (e.employeeId !== entry.employeeId) return false;
            if (e.room !== entry.room) return false;
            const cS = sm151(e.inTime);
            const cE = sm151(e.outTime);
            return eS < cE && eE > cS; // overlapping time ranges
          });
          if (conflict === -1) {
            dedupedEntries.push(entry);
          } else {
            const existing = dedupedEntries[conflict];
            // Prefer ratio-check-sourced (shift, non-float staffType) over float-derived
            const entryIsRatioCheck = entry.blockType === 'shift' && entry.staffType !== 'float';
            const existingIsRatioCheck = existing.blockType === 'shift' && existing.staffType !== 'float';
            if (entryIsRatioCheck && !existingIsRatioCheck) {
              dedupedEntries[conflict] = entry;
            }
          }
        }
        entries.length = 0;
        entries.push(...dedupedEntries);

        // Add visitor entries from Ratio Check visitor log (with WWCC details)
        for (const v of ratioVisitors) {
          const roomName = centre.rooms.find(r => r.id === v.roomId)?.name ?? v.roomId;
          // Use a stable negative employeeId derived from the visitor id to avoid collisions
          // with real staff and with other visitors on the same day.
          let visitorEmpId = 0;
          for (let i = 0; i < v.id.length; i++) visitorEmpId = (visitorEmpId * 31 + v.id.charCodeAt(i)) | 0;
          visitorEmpId = visitorEmpId < 0 ? visitorEmpId : -visitorEmpId;
          const noteParts = ['Visitor'];
          if (v.wwccNumber) noteParts.push(`WWCC: ${v.wwccNumber}`);
          entries.push({
            employeeId: visitorEmpId,
            name: v.name,
            room: roomName,
            inTime: v.enteredAt,
            outTime: v.exitedAt || '18:00',
            blockType: 'support',
            staffType: 'support',
            note: noteParts.join(' - '),
          });
        }

        // Overlay family groupings. Include suggested sessions as well as
        // confirmed/modified ones, because directors create groupings in the
        // Ratio Check panel and expect them to flow straight through to Reg 151.
        const confirmedGroupings = (groupingSessionRows as any[]).filter(gs =>
          ['confirmed', 'auto-confirmed', 'modified', 'suggested'].includes(gs.confirmation_status)
        );
        if (confirmedGroupings.length > 0) {
          for (const gs of confirmedGroupings) {
            const gStart = gs.session_start as string;
            const gEnd   = gs.session_end   as string;
            const gLabel = gs.group_label   as string;
            const heldInId   = gs.held_in_room as string | undefined;
            // heldInId is either a room ID (look up name) or an outdoor area name string (use directly)
            const heldInRoom = centre.rooms.find(r => r.id === heldInId)?.name ?? heldInId ?? gLabel;
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

        // Build a map of empId → own-lunch float schedule block (planned own break times)
        const ownLunchByEmpId: Record<number, { startTime: string; endTime: string }> = {};
        for (const fsRow of (floatScheds as any[])) {
          const floatEmpId = fsRow.employee_id as number;
          for (const block of (fsRow.schedule ?? [])) {
            if (String(block.coverType ?? '').toLowerCase() === 'own-lunch') {
              ownLunchByEmpId[floatEmpId] = { startTime: String(block.startTime ?? ''), endTime: String(block.endTime ?? '') };
            }
          }
        }

        // Inject actual lunch break rows from Ratio Check overrides (Deputy actuals or manual)
        // Also fall back to planned own-lunch times from the float schedule when Deputy hasn't
        // clocked the break yet. Label clearly as "Own lunch break" for floats.
        const lunchEntriesToAdd: typeof entries = [];
        const seenLunchEmpIds = new Set<number>();
        for (const entry of entries) {
          if (entry.blockType === 'lunch_break') continue;
          if (seenLunchEmpIds.has(entry.employeeId)) continue;
          const override = ratioTimeOverrides[String(entry.employeeId)];
          const plannedOwnLunch = ownLunchByEmpId[entry.employeeId];
          // Use Deputy actual times if available, fall back to planned own-lunch from float schedule
          const lunchStart = override?.lunchStart ?? plannedOwnLunch?.startTime;
          const lunchEnd   = override?.lunchEnd   ?? plannedOwnLunch?.endTime;
          if (!lunchStart) continue;
          seenLunchEmpIds.add(entry.employeeId);
          const isOwnLunchFloat = !!plannedOwnLunch;
          const hasActual = !!override?.lunchStart;
          const noteText = isOwnLunchFloat
            ? (hasActual ? 'Own lunch break' : 'Own lunch break (planned)')
            : (lunchEnd ? 'Deputy actual' : 'In progress');
          // Remove any existing positional lunch_break entry for this employee (will be replaced)
          // Add a clean lunch row with actual or planned times
          lunchEntriesToAdd.push({
            employeeId: entry.employeeId,
            name:       entry.name,
            room:       'Lunch Break',
            inTime:     lunchStart,
            outTime:    lunchEnd ?? '',
            blockType:  'lunch_break',
            staffType:  entry.staffType,
            note:       noteText,
          });
        }
        // Remove old positional lunch entries that will be replaced with actual times
        const filteredEntries = entries.filter(e =>
          e.blockType !== 'lunch_break' || !seenLunchEmpIds.has(e.employeeId)
        );
        entries.length = 0;
        filteredEntries.forEach(e => entries.push(e));
        lunchEntriesToAdd.forEach(e => entries.push(e));


        if (entries.length > 0) {
          // Sort by staff name, then by inTime within each person
          entries.sort((a, b) => {
            const nameDiff = a.name.localeCompare(b.name);
            return nameDiff !== 0 ? nameDiff : a.inTime.localeCompare(b.inTime);
          });
          // Collect all unique rooms for the filter dropdown
          const allRooms = [...new Set(entries.map(e => e.room).filter(r => r !== 'Lunch Break' && r !== 'External Casual'))].sort();
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

        // ── Staffing Analysis ──────────────────────────────────────────────────
        if (needsStaffingAnalysis) {
          const saChildren = (att as any[]).filter((c: any) => c.sign_in).length;
          const saRoomData = centre.rooms.map(room => {
            const owna = (room.ownaRoomName ?? room.name).toLowerCase();
            const rk = (att as any[]).filter((c: any) => c.sign_in && c.room?.toLowerCase().includes(owna));
            const { required: roomRequired } = calcRequiredStaff(rk.map((c: any) => ({ ageMonths: parseAgeMonths(c.age) } as any)));
            // Only count assigned staff (Employee !== 0) — open/unassigned shifts must not inflate the count
            const roomStaff = (rosters as any[]).filter(r =>
              r.OperationalUnit === room.deputyUnitId && r.Employee && r.Employee !== 0
            );
            // Count unique employees to avoid double-counting split shifts
            const roomStaffCount = new Set(roomStaff.map((r: any) => r.Employee)).size;
            return { required: roomRequired, staffCount: roomStaffCount };
          });
          const saRequired = saRoomData.reduce((s, r) => s + r.required, 0);
          const saTotalFloorStaff    = saRoomData.reduce((s, r) => s + r.staffCount, 0);
          // Room shortages/surpluses — after internal reallocation between rooms
          const saTotalRatioShortage = saRoomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
          const saTotalRoomSurplus   = saRoomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
          const saNetShortage        = Math.max(0, saTotalRatioShortage - saTotalRoomSurplus);
          // Room net: positive = rooms have surplus staff, negative = rooms are short
          const saRoomSurplus        = saTotalRoomSurplus - saTotalRatioShortage;
          // Float buffer = floor staff / 6 (how many floats you need as buffer)
          const saBufferRequired     = saTotalFloorStaff > 0 ? saTotalFloorStaff / 6 : 0;
          const saFloatUnitIds    = new Set(centre.floatUnitIds ?? []);
          const saNonRatioUnitIds = new Set(centre.nonRatioUnitIds ?? []);
          const saFloatCount      = (rosters as any[]).filter(r => saFloatUnitIds.has(r.OperationalUnit)).length;
          const saAdCount         = (rosters as any[]).filter(r => {
            if (!saNonRatioUnitIds.has(r.OperationalUnit)) return false;
            const un = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '').toLowerCase();
            return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
          }).length;
          const saAdAvailable  = (saChildren > 0 && saChildren < 100) ? saAdCount : 0;
          // Floats needed = room shortage (after realloc) + buffer
          const saTotalFloatersNeeded = saNetShortage + saBufferRequired;
          // Room net surplus (after covering all shortages) acts as effective floats.
          // e.g. if 4-5 room has 1 extra staff and all rooms are otherwise compliant,
          // that person can be redeployed as a float.
          const saRoomSurplusAsFloat  = Math.max(0, saRoomSurplus);
          const saEffectiveAvailable  = saFloatCount + saAdAvailable + saRoomSurplusAsFloat;
          const saFloatSurplus        = saEffectiveAvailable - saTotalFloatersNeeded;
          const saStatus: StaffingAnalysisRow['status'] = saChildren === 0 ? 'unknown'
            : saFloatSurplus < 0 ? 'red'
            : saFloatSurplus === 0 ? 'amber'
            : 'green';
          staffingRowsAccum.push({
            date, campus,
            children:            saChildren,
            required:            saRequired,
            totalFloorStaff:     saTotalFloorStaff,
            roomSurplus:         saRoomSurplus,
            bufferRequired:      saBufferRequired,
            floatCount:          saFloatCount,
            adAvailable:         saAdAvailable,
            totalFloatersNeeded: saTotalFloatersNeeded,
            floatSurplus:        saFloatSurplus,
            status:              saStatus,
          });
        }
      }
    }

    setEducatorRows(rows);
    setRatioSnaps(snaps);
    setGroupingTrends(groupingTrendRows);
    setOccupancyRows(occRows);
    setStaffingAnalysisRows(staffingRowsAccum);
    setCasualRows(casualAccum);

    // ── Process roster-opt results ─────────────────────────────────────────────────
    {
      const rosterResults: RosterOptResult[] = [];
      const recsList: RosterRec[] = [];
      for (const [campusKey, slotMap] of Object.entries(rosterAccum)) {
        const slots: RosterSlotData[] = ROSTER_SLOTS_30.map(time => ({
          time,
          totalDays:               slotMap[time].days,
          sumChildren:             slotMap[time].sumChildren,
          sumStaff:                slotMap[time].sumStaff,
          sumOffFloor:             slotMap[time].sumOffFloor,
          sumOffFloorExclDirector: slotMap[time].sumOffFloorExclDirector,
          sumISS:                  slotMap[time].sumISS,
          sumRequired:             slotMap[time].sumRequired,
        }));
        rosterResults.push({ campus: campusKey, slots });
        const overSlots  = slots.filter(s => s.totalDays > 0 && (s.sumStaff - s.sumRequired) / s.totalDays > 1);
        const underSlots = slots.filter(s => s.totalDays > 0 && (s.sumStaff - s.sumRequired) / s.totalDays < -0.5);
        if (overSlots.length > 0) {
          const avgOver = overSlots.reduce((s, x) => s + (x.sumStaff - x.sumRequired) / Math.max(x.totalDays, 1), 0) / overSlots.length;
          recsList.push({ campus: campusKey, type: 'overstaffed', text: `Overstaffed ${overSlots[0].time}-${overSlots[overSlots.length-1].time} (avg +${avgOver.toFixed(1)} staff). Consider shifting some starts later in the day.` });
        }
        if (underSlots.length > 0) {
          const avgUnder = underSlots.reduce((s, x) => s + (x.sumStaff - x.sumRequired) / Math.max(x.totalDays, 1), 0) / underSlots.length;
          recsList.push({ campus: campusKey, type: 'understaffed', text: `Ratio risk ${underSlots[0].time}-${underSlots[underSlots.length-1].time} (avg ${Math.abs(avgUnder).toFixed(1)} staff short). Review afternoon coverage.` });
        }
      }
      setRosterOptData(rosterResults);
      setRosterRecs(recsList);
    }

    // ── WWCC Expiry - only staff active in Deputy for the selected period ─────────
    if (needsWwccExpiry) {
      let wwccExpRows: WwccExpiryRow[] = [];
      try {
        const todayNow = Date.now();

        // Get all unit IDs for selected centres (to filter Deputy roster entries)
        const allUnitIds = selectedCentres.flatMap((c: any) => [
          ...c.rooms.map((r: any) => r.deputyUnitId),
          ...(c.floatUnitIds ?? []),
          ...(c.issUnitIds ?? []),
          ...(c.nonRatioUnitIds ?? []),
          ...(c.leaveUnitIds ?? []),
        ]);

        // Use dates in selected range that are past; fall back to last 14 weekdays
        const lookback = dates.filter((d: string) => d <= todayStr()).slice(-14);
        const recentDates: string[] = lookback.length > 0 ? lookback : (() => {
          const out: string[] = [];
          for (let i = 14; i >= 1; i--) {
            const d = new Date(Date.now() - i * 86400000);
            if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d.toISOString().slice(0,10));
          }
          return out;
        })();

        // Fetch active Deputy staff via server-side endpoint (uses service key, bypasses RLS)
        const activeFrom = recentDates[0];
        const activeTo   = recentDates[recentDates.length - 1];
        const activeResp = await fetch(
          `/api/active-staff?from=${activeFrom}&to=${activeTo}&unitIds=${allUnitIds.join(',')}`
        );
        // activeStaff: [{ name, unitName }] - unitName lets us detect kitchen staff
        const activeStaff: { name: string; unitName: string }[] = activeResp.ok ? await activeResp.json() : [];

        if (activeStaff.length === 0) {
          console.warn('WWCC expiry: no active staff found from Deputy roster - showing all for selected centres');
        }

        const KITCHEN_KEYWORDS = ['chef','kitchen','cook'];
        const normN = (n: string) => n
          .replace(/\s*[\(\[{][^\)\]{}]*[\)\]{}]\s*/g, ' ')
          .replace(/[-']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

        const wwccAllResp = await fetch('/api/staff-wwcc');
        const wwccAll: any[] = wwccAllResp.ok ? await wwccAllResp.json() : [];
        const wwccByNorm: Record<string, any> = {};
        for (const rec of wwccAll) { wwccByNorm[rec.full_name_norm] = rec; }

        for (const { name, unitName } of activeStaff) {
          const nn = normN(name);
          let rec = wwccByNorm[nn];
          if (!rec) {
            const bare = nn.replace(/\s/g, '');
            rec = Object.values(wwccByNorm).find((r: any) =>
              (r as any).full_name_norm.replace(/\s/g, '') === bare
            );
          }

          const centre = rec?.centre ?? '';
          const unitLower = unitName.toLowerCase();
          const isKitchen = KITCHEN_KEYWORDS.some(k => unitLower.includes(k));
          const isUnder18 = rec?.under_18 === true;

          // Determine exempt reason if no WWCC
          const hasWwcc = rec?.wwcc_number && !rec?.under_18;
          const exemptReason: 'under_18' | 'kitchen' | undefined =
            isUnder18 ? 'under_18' : isKitchen ? 'kitchen' : undefined;

          // Skip if no WWCC and not an exempt category
          if (!hasWwcc && !exemptReason) continue;

          // Deduplicate
          const dupKey = (rec?.wwcc_number ?? name) + '|' + centre;
          if (wwccExpRows.some(r => (r.wwcc_number ?? r.full_name) + '|' + r.centre === dupKey)) continue;

          const expDate = rec?.wwcc_expiry ? new Date(rec.wwcc_expiry) : null;
          wwccExpRows.push({
            full_name:     rec?.full_name ?? name,
            centre,
            wwcc_number:   hasWwcc ? rec.wwcc_number : null,
            wwcc_expiry:   hasWwcc ? rec.wwcc_expiry : null,
            under_18:      isUnder18,
            daysRemaining: expDate ? Math.ceil((expDate.getTime() - todayNow) / 86400000) : null,
            exemptReason,
          });
        }

        wwccExpRows.sort((a, b) => {
          if (a.daysRemaining === null && b.daysRemaining === null) return 0;
          if (a.daysRemaining === null) return 1;
          if (b.daysRemaining === null) return -1;
          return a.daysRemaining - b.daysRemaining;
        });
      } catch (e) { console.error('WWCC expiry', e); }
      setWwccExpiryRows(wwccExpRows);
    }

    setGenerated(true);
    setViewingReport([...selectedReports][0] ?? 'educator');

    // Fetch WWCC data for all unique educators in this report
    const uniqueNames = [...new Set(rows.flatMap(r => r.entries.map(e => e.name)))];
    if (uniqueNames.length > 0) {
      fetch('/api/staff-wwcc')
        .then(r => r.ok ? r.json() : [])
        .then((records: { full_name: string; full_name_norm: string; wwcc_number: string | null; wwcc_expiry: string | null; under_18: boolean; is_internal_casual?: boolean }[]) => {
          /**
           * Comprehensive name normalisation - same logic as scripts/name-utils.js.
           * Apply to BOTH stored names and lookup names so they always compare alike.
           * Handles: brackets, role abbreviations, hyphens, copy markers, verbose roles.
           */
          const normaliseName = (name: string) => name
            .replace(/^(NIL|N\/A|TBA|TBD):\s*/i, '')             // strip NIL:/TBA: prefixes
            .replace(/\s*[\(\[{][^\)\]{}]*[\)\]{}]\s*/g, ' ')  // strip (brackets)
            .replace(/\s+-\s+.+$/i, '')                          // strip - role descriptor
            .replace(/\s+\b(RL|EL|CD|AD|ECT|2IC|HOD|HOE|RN|DON)\b\s*$/i, '') // role abbrevs
            .replace(/\s+(Room Leader|Educational Leader|Centre Director|Assistant Director|Early Childhood Teacher|Co-ordinator|Coordinator|Director)\s*$/i, '')
            .replace(/\s*[-\u2013]\s*(copy|contracted role|replacement|mat leave|maternity leave|on hold|archived)\s*.*$/i, '')
            .replace(/[-'`\u2018\u2019]/g, '')                   // strip hyphens & apostrophes
            .replace(/\s+/g, ' ').trim().toLowerCase();

          /** Levenshtein distance - last-resort fuzzy fallback for minor typos */
          const lev = (a: string, b: string): number => {
            const m = a.length, n = b.length;
            const dp: number[][] = Array.from({length: m+1}, (_,i) => [i, ...Array(n).fill(0)]);
            for (let j = 0; j <= n; j++) dp[0][j] = j;
            for (let i = 1; i <= m; i++)
              for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
            return dp[m][n];
          };

          // Strip hyphens/apostrophes/spaces for fuzzy comparison
          const bare = (s: string) => s.replace(/[-'\s]/g, '').toLowerCase();

          // Build indexes
          const exactMap: Record<string, WwccRec>   = {}; // full_name_norm → rec
          const strippedMap: Record<string, WwccRec> = {}; // bare(norm) → rec (first wins)
          const lastNameMap: Record<string, typeof records> = {}; // bare(lastName) → [recs]

          // Also build normalised-name index for the primary lookup
          const normedMap: Record<string, WwccRec> = {};

          for (const rec of records) {
            const entry: WwccRec = { wwcc_number: rec.wwcc_number, wwcc_expiry: rec.wwcc_expiry, under_18: rec.under_18 ?? false, is_internal_casual: rec.is_internal_casual === true };
            exactMap[rec.full_name_norm] = entry;

            // Also index by our aggressive normalisation (catches stored RL/abbrev suffixes)
            const normedKey = normaliseName(rec.full_name);
            if (!normedMap[normedKey]) normedMap[normedKey] = entry;

            const b = bare(normedKey);
            if (!strippedMap[b]) strippedMap[b] = entry;

            const parts = normedKey.replace(/[-']/g, ' ').trim().split(/\s+/);
            const lastName = bare(parts[parts.length - 1]);
            if (lastName) {
              if (!lastNameMap[lastName]) lastNameMap[lastName] = [];
              lastNameMap[lastName].push(rec);
            }
          }

          /**
           * Multi-strategy lookup:
           * 1. Exact normalised match
           * 2. Bare match (strip hyphens/apostrophes/spaces) - catches Al-Maarrawie vs Almaarrawie
           * 3. Unique last-name match - catches any first-name mismatch when surname is unique
           * 4. Same last-name + matching first initial - narrows when multiple share a surname
           */
          const lookup = (name: string): WwccRec | null => {
            // Apply same comprehensive normalisation as the sync scripts
            const norm = normaliseName(name);

            // 1. Exact stored norm
            if (exactMap[norm]) return exactMap[norm];

            // 2. Normalised match (catches stored abbrev suffixes like RL)
            if (normedMap[norm]) return normedMap[norm];

            // 3. Bare match (hyphens/apostrophes/spaces stripped)
            const b = bare(norm);
            if (strippedMap[b]) return strippedMap[b];

            // Build last name from normalised input
            const parts = norm.replace(/[-']/g, ' ').trim().split(/\s+/);
            const lastName = bare(parts[parts.length - 1]);
            const candidates = lastNameMap[lastName] ?? [];

            // 4. Unique last name - handles different first names (Caitlin vs Catey)
            if (candidates.length === 1) {
              const c = candidates[0];
              return { wwcc_number: c.wwcc_number, wwcc_expiry: c.wwcc_expiry, under_18: c.under_18 ?? false, is_internal_casual: c.is_internal_casual === true };
            }

            // 5. Same last name + first initial
            if (candidates.length > 1 && parts.length > 1) {
              const firstInitial = bare(parts[0])[0];
              const initialMatches = candidates.filter(c => {
                const cParts = normaliseName(c.full_name).split(/\s+/);
                return bare(cParts[0])[0] === firstInitial;
              });
              if (initialMatches.length === 1) {
                const m = initialMatches[0];
                return { wwcc_number: m.wwcc_number, wwcc_expiry: m.wwcc_expiry, under_18: m.under_18 ?? false, is_internal_casual: m.is_internal_casual === true };
              }
            }

            // 6. Levenshtein ≤ 2 on normalised name - catches minor typos / spelling diffs
            // Only run against records with WWCC data (avoid false positives)
            const withData = records.filter(r => r.wwcc_number || r.under_18);
            let bestDist = 3, bestRec: typeof records[0] | null = null;
            for (const r of withData) {
              const d = lev(norm, normaliseName(r.full_name));
              if (d < bestDist) { bestDist = d; bestRec = r; }
            }
            if (bestRec) return { wwcc_number: bestRec.wwcc_number, wwcc_expiry: bestRec.wwcc_expiry, under_18: bestRec.under_18 ?? false, is_internal_casual: bestRec.is_internal_casual === true };

            return null;
          };

          setWwccLookup(() => lookup);
        })
        .catch(() => {});
    }

    setLoading(false);
  }, [selectedCentres, fromDate, toDate, selectedReports]); // eslint-disable-line

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

        {/* Report Selection */}
        <div className="mb-6 mt-4">
          <div className="text-sm font-semibold mb-3" style={{ color: '#2d5c18' }}>Select Reports to Generate</div>
          <div className="grid grid-cols-2 gap-3">
            {REPORT_DEFS.map(r => {
              const isSelected = selectedReports.has(r.id);
              return (
                <button key={r.id}
                  onClick={() => setSelectedReports(prev => {
                    const next = new Set(prev);
                    if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                    return next;
                  })}
                  className="text-left p-3 rounded-xl border-2 transition-all"
                  style={{
                    borderColor: isSelected ? '#2d5c18' : '#E2F1DA',
                    backgroundColor: isSelected ? '#E2F1DA' : 'white',
                  }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span>{r.icon}</span>
                    <span className="text-sm font-semibold" style={{ color: '#2d5c18' }}>{r.label}</span>
                    {isSelected && <span className="ml-auto text-xs">✓</span>}
                  </div>
                  <div className="text-xs" style={{ color: '#596570' }}>{r.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <button onClick={generate} disabled={loading || selectedReports.size === 0}
          className={btn + ' mt-4 text-white disabled:opacity-50'}
          style={{ backgroundColor: '#5a9228' }}>
          {loading
            ? '⟳ Generating...'
            : selectedReports.size === 0
            ? 'Select a report above'
            : `📊 Generate ${selectedReports.size === 1
                ? REPORT_DEFS.find(r => selectedReports.has(r.id))?.label ?? 'Report'
                : selectedReports.size + ' Reports'}`}
        </button>
      </div>

      {/* Report results */}
      {generated && (
        <>
          <div className="flex gap-2 mb-5 flex-wrap">
            {REPORT_DEFS.filter(r => selectedReports.has(r.id)).map(r => (
              <button key={r.id} onClick={() => setViewingReport(r.id)}
                className={btn}
                style={viewingReport === r.id
                  ? { backgroundColor: '#2d5c18', color: 'white' }
                  : { backgroundColor: 'white', color: '#2d5c18', border: '1px solid #D0E8B8' }}>
                {r.icon} {r.label}
              </button>
            ))}
          </div>

          <div ref={printRef}>

            {/* ── EDUCATOR RECORD ── */}
            {viewingReport === 'educator' && (
              <div className="space-y-6">
                {/* Reg 151 banner */}
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                  <strong>Regulation 151 Record</strong> - Each row is a single time block: one educator, one room, one period. Float movements are broken into individual blocks. Linked to the Plan of Day float schedule and lunch planner.
                </div>

                {/* Room filter + WWCC resync */}
                {educatorRows.length > 0 && (
                  <div className="flex items-center gap-3 flex-wrap">
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
                    <button
                      disabled={wwccSyncing}
                      onClick={async () => {
                        setWwccSyncing(true);
                        setWwccSyncMsg(null);
                        try {
                          let total = 0;
                          for (const c of selectedCentres) {
                            const r = await fetch('/api/sync-wwcc-centre', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ centre: c.name }),
                            });
                            const j = await r.json();
                            total += j.upserted ?? 0;
                          }
                          setWwccSyncMsg(`✅ WWCC synced — ${total} records updated.`);
                          // Reload WWCC lookup after sync
                          const res = await fetch('/api/staff-wwcc');
                          if (res.ok) {
                            const records: { full_name: string; full_name_norm: string; wwcc_number: string | null; wwcc_expiry: string | null; under_18: boolean; is_internal_casual?: boolean }[] = await res.json();
                            const normMap: Record<string, WwccRec> = {};
                            for (const rec of records) {
                              normMap[rec.full_name_norm] = {
                                wwcc_number: rec.wwcc_number,
                                wwcc_expiry: rec.wwcc_expiry,
                                under_18: rec.under_18 ?? false,
                                is_internal_casual: rec.is_internal_casual === true,
                              };
                            }
                            setWwccLookup(() => (name: string) => normMap[name.toLowerCase().replace(/\s+/g,' ').trim()] ?? null);
                          }
                        } catch (e: any) {
                          setWwccSyncMsg(`❌ Sync failed: ${e.message}`);
                        } finally {
                          setWwccSyncing(false);
                          setTimeout(() => setWwccSyncMsg(null), 5000);
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                      style={{ backgroundColor: wwccSyncing ? '#e5e7eb' : '#2d5c18', color: wwccSyncing ? '#6b7280' : 'white' }}>
                      {wwccSyncing ? '⏳ Syncing…' : '🔄 Resync WWCC'}
                    </button>
                    {wwccSyncMsg && (
                      <span className="text-xs" style={{ color: wwccSyncMsg.startsWith('✅') ? '#2d5c18' : '#dc2626' }}>
                        {wwccSyncMsg}
                      </span>
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
                            {(() => { const seenNamesInner = new Set<number>(); return filtered.map((e) => {
                              const isLunch       = e.blockType === 'lunch_break';
                              const isGrouping    = e.blockType === 'grouping';
                              const isMorningFG   = isGrouping && parseInt(e.inTime) < 12;
                              const isAfternoonFG = isGrouping && parseInt(e.inTime) >= 12;
                              const isFloat    = e.staffType === 'float' || e.staffType === 'iss';
                              const isLeave    = e.staffType === 'leave';
                              const isExternal = e.staffType === 'external';
                              const isInternalCasual = wwccLookup(e.name)?.is_internal_casual === true;
                              const isCover    = e.blockType === 'lunch_cover' || e.blockType === 'float_move';
                              const isFirstRowInner = isLeave || !seenNamesInner.has(e.employeeId);
                              if (!isLeave) seenNamesInner.add(e.employeeId);
                              const prevSame = !isFirstRowInner
                                && (isLunch || isGrouping || isCover || e.blockType === 'shift');
                              const isSupport = e.staffType === 'support';
                              const bg = isLunch       ? '#fffbeb'
                                : isMorningFG   ? '#f0fdf4'
                                : isAfternoonFG ? '#faf5ff'
                                : isLeave    ? '#fef2f2'
                                : isExternal ? '#fff7ed'
                                : isInternalCasual ? '#fef3c7'
                                : isFloat    ? '#eff6ff'
                                : isSupport  ? '#faf5ff'
                                : isCover    ? '#f0fdf4'
                                : 'white';
                              const fgColor = isMorningFG ? '#166534' : '#6d28d9';

                              return (
                              <tr key={`${e.employeeId}-${e.inTime}-${e.room}`}
                                className="border-t"
                                style={{ borderColor: prevSame ? '#f3f4f6' : '#E2F1DA', backgroundColor: bg }}>
                                <td className="py-2 px-4 font-medium" style={{ color: '#050505' }}>
                                  {prevSame
                                    ? <span style={{ color: '#9ca3af' }}>└ {e.name}</span>
                                    : <span>{e.name}
                                        {isExternal && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fed7aa', color: '#c2410c' }}>EC</span>}
                                        {isInternalCasual && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>IC</span>}
                                        {isFloat && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>{e.staffType === 'iss' ? 'ISS' : 'Float'}</span>}
                                        {isLeave && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>Leave</span>}
                                        {isSupport && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }}>Support</span>}
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
                                      backgroundColor: isLunch ? '#fef3c7' : isGrouping ? '#d1fae5' : isCover ? '#dcfce7' : isLeave ? '#fee2e2' : isFloat ? '#dbeafe' : isSupport ? '#ede9fe' : '#f0fdf4',
                                      color: isLunch ? '#92400e' : isGrouping ? '#065f46' : isCover ? '#166534' : isLeave ? '#dc2626' : isFloat ? '#1d4ed8' : isSupport ? '#6d28d9' : '#166534',
                                    }}>
                                    {isLunch ? 'Lunch' : isGrouping ? 'Grouped' : e.blockType === 'lunch_cover' ? 'Lunch cover' : e.blockType === 'float_move' ? 'Float' : isLeave ? 'Leave' : isExternal ? 'External Casual' : isInternalCasual ? 'Internal Casual' : isSupport ? 'Support' : 'Shift'}
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
                                    if (noUsefulData) return <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>No WWCC on file</span>;
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
                            });})()}
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
            {viewingReport === 'ratio' && (
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
            {viewingReport === 'trends' && (
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

            {/* ── OCCUPANCY TRENDS ── */}
            {viewingReport === 'occupancy' && (
              <div className="space-y-4">
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                  <strong>Attendance Trends</strong> - Real daily attendance vs the same day last week. Green = up, Red = down significantly.
                </div>

                {occupancyRows.length > 0 && (() => {
                  const totalBooked = occupancyRows.reduce((s, r) => s + (r.booked || 0), 0);
                  const totalThis = occupancyRows.reduce((s, r) => s + r.actual, 0);
                  const totalLast  = occupancyRows.reduce((s, r) => s + r.lastWeek, 0);
                  const netChange  = totalThis - totalLast;
                  const daysUp   = occupancyRows.filter(r => r.change > 0).length;
                  const daysDown = occupancyRows.filter(r => r.change < 0).length;
                  return (
                    <div className="flex gap-3 flex-wrap">
                      {totalBooked > 0 && (
                        <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                          <div className="text-2xl font-bold">{totalBooked}</div>
                          <div className="text-xs">Total Booked (Owna)</div>
                        </div>
                      )}
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                        <div className="text-2xl font-bold">{totalThis}</div>
                        <div className="text-xs">Total Attended</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: netChange >= 0 ? '#E2F1DA' : '#fef2f2', color: netChange >= 0 ? '#2d5c18' : '#991b1b' }}>
                        <div className="text-2xl font-bold">{netChange >= 0 ? '+' : ''}{netChange}</div>
                        <div className="text-xs">vs Same Period Last Week</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#f0fdf4', color: '#166534' }}>
                        <div className="text-2xl font-bold">{daysUp} ↑ / {daysDown} ↓</div>
                        <div className="text-xs">Days up / down vs last week</div>
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ backgroundColor: '#F5FAF3' }}>
                        {['Date','Campus','Occupancy %','Booked','Attended','Absent','Last Week','Change','Trend'].map(h => (
                          <th key={h} className="py-2 px-4 text-xs font-semibold text-left" style={{ color: '#5a9228' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {occupancyRows.length === 0 ? (
                        <tr><td colSpan={9} className="py-6 text-center text-sm italic" style={{ color: '#596570' }}>No attendance data for selected period.</td></tr>
                      ) : occupancyRows.map((r, i) => {
                        const rowBg = r.lastWeek > 0 && r.change < -5
                          ? '#fef2f2'
                          : r.lastWeek > 0 && r.change > 5
                          ? '#f0fdf4'
                          : i % 2 === 0 ? 'white' : '#fafffe';
                        return (
                          <tr key={i} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: rowBg }}>
                            <td className="py-2 px-4" style={{ color: '#050505' }}>{safeFormat(new Date(r.date), 'd MMM yyyy')}</td>
                            <td className="py-2 px-4" style={{ color: '#050505' }}>{r.campus}</td>
                            <td className="py-2 px-4 font-medium" style={{ color: '#7c3aed' }}>
                              {r.capacity > 0 && r.booked > 0
                                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                    style={{
                                      backgroundColor: r.booked / r.capacity >= 0.9 ? '#dcfce7' : r.booked / r.capacity >= 0.75 ? '#fef9c3' : '#fee2e2',
                                      color: r.booked / r.capacity >= 0.9 ? '#166534' : r.booked / r.capacity >= 0.75 ? '#854d0e' : '#991b1b',
                                    }}>
                                    {Math.round(r.booked / r.capacity * 100)}%
                                  </span>
                                : <span style={{ color: '#9ca3af' }}>-</span>}
                            </td>
                            <td className="py-2 px-4 font-medium" style={{ color: '#1d4ed8' }}>{r.booked > 0 ? r.booked : '-'}</td>
                            <td className="py-2 px-4 font-medium" style={{ color: '#050505' }}>{r.actual}</td>
                            <td className="py-2 px-4" style={{ color: r.booked > 0 && r.actual < r.booked ? '#d97706' : '#596570' }}>
                              {r.booked > 0 ? r.booked - r.actual : '-'}
                            </td>
                            <td className="py-2 px-4" style={{ color: '#596570' }}>{r.lastWeek > 0 ? r.lastWeek : '-'}</td>
                            <td className="py-2 px-4 font-medium" style={{ color: r.change > 0 ? '#166534' : r.change < 0 ? '#991b1b' : '#596570' }}>
                              {r.change > 0 ? `+${r.change}` : r.change < 0 ? String(r.change) : '-'}
                            </td>
                            <td className="py-2 px-4">
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                style={r.lastWeek === 0
                                  ? { backgroundColor: '#f3f4f6', color: '#6b7280' }
                                  : r.change < -5
                                  ? { backgroundColor: '#fee2e2', color: '#991b1b' }
                                  : r.change > 5
                                  ? { backgroundColor: '#dcfce7', color: '#166534' }
                                  : { backgroundColor: '#f3f4f6', color: '#374151' }}>
                                {r.lastWeek === 0 ? 'No prior data' : r.change > 5 ? '↑ Up' : r.change < -5 ? '↓ Down' : '→ Stable'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Average row */}
                      {occupancyRows.length > 0 && (() => {
                        const withCap = occupancyRows.filter(r => r.capacity > 0 && r.booked > 0);
                        const avgOccPct = withCap.length > 0
                          ? Math.round(withCap.reduce((s, r) => s + r.booked / r.capacity * 100, 0) / withCap.length)
                          : null;
                        const avgBooked    = occupancyRows.length ? Math.round(occupancyRows.reduce((s,r)=>s+r.booked,0)/occupancyRows.length) : 0;
                        const avgAttended  = occupancyRows.length ? Math.round(occupancyRows.reduce((s,r)=>s+r.actual,0)/occupancyRows.length) : 0;
                        const avgAbsent    = avgBooked - avgAttended;
                        const avgLastWeek  = occupancyRows.filter(r=>r.lastWeek>0).length
                          ? Math.round(occupancyRows.filter(r=>r.lastWeek>0).reduce((s,r)=>s+r.lastWeek,0)/occupancyRows.filter(r=>r.lastWeek>0).length)
                          : null;
                        return (
                          <tr className="border-t-2 font-semibold" style={{ borderColor: '#2d5c18', backgroundColor: '#F5FAF3' }}>
                            <td className="py-2 px-4" style={{ color: '#2d5c18' }}>Average</td>
                            <td className="py-2 px-4" style={{ color: '#596570' }}></td>
                            <td className="py-2 px-4">
                              {avgOccPct !== null
                                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                    style={{ backgroundColor: avgOccPct >= 90 ? '#dcfce7' : avgOccPct >= 75 ? '#fef9c3' : '#fee2e2', color: avgOccPct >= 90 ? '#166534' : avgOccPct >= 75 ? '#854d0e' : '#991b1b' }}>
                                    {avgOccPct}%
                                  </span>
                                : <span style={{ color: '#9ca3af' }}>-</span>}
                            </td>
                            <td className="py-2 px-4" style={{ color: '#1d4ed8' }}>{avgBooked || '-'}</td>
                            <td className="py-2 px-4">{avgAttended || '-'}</td>
                            <td className="py-2 px-4" style={{ color: '#d97706' }}>{avgAbsent > 0 ? avgAbsent : '-'}</td>
                            <td className="py-2 px-4">{avgLastWeek ?? '-'}</td>
                            <td className="py-2 px-4"></td>
                            <td className="py-2 px-4"></td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── ROSTER OPTIMISATION ── */}
            {viewingReport === 'roster-opt' && (
              <div className="space-y-6">
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                  <strong>Roster Optimisation</strong> - Average staffing vs. required per 30-min slot. Required staff calculated using real NSW age-based ratios (1:4 under 2, 1:5 aged 2-3, 1:10 aged 3+) from actual child ages in Owna. Surplus = Floor Staff (ratio) minus Required. Surplus (incl Off Floor) adds off-floor staff who can step onto the floor, excluding the centre director, chefs/cooks, and trainees on study time.
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleGenerateRosterSuggestions}
                    disabled={rosterSuggestionsLoading}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: '#2d5c18' }}
                  >
                    {rosterSuggestionsLoading ? 'Analysing…' : 'Generate roster suggestions'}
                  </button>
                  {rosterSuggestions !== null && !rosterSuggestionsLoading && (
                    <span className="text-sm" style={{ color: '#596570' }}>
                      {rosterSuggestions.every(r => r.optimal)
                        ? 'All rosters are optimal'
                        : `${rosterSuggestions.filter(r => !r.optimal).length} centre/date(s) need changes`}
                    </span>
                  )}
                </div>

                {rosterSuggestions !== null && (
                  <div className="space-y-4">
                    {rosterSuggestions.map((result, ri) => (
                      <div key={ri} className="rounded-xl border p-4" style={{ borderColor: '#E2F1DA', backgroundColor: '#fafffe' }}>
                        <div className="font-bold text-sm mb-2" style={{ color: '#2d5c18' }}>
                          {result.centre} · {result.date}
                        </div>
                        {result.optimal ? (
                          <div className="rounded-lg p-3 text-sm font-medium" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                            Roster is already optimal
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="space-y-2">
                              {result.suggestions.map((s, si) => (
                                <div key={si} className="rounded-lg p-3 text-sm" style={{ backgroundColor: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}>
                                  <strong>Suggestion {si + 1}:</strong> {s.text}
                                  <div className="text-xs mt-1" style={{ color: '#a16207' }}>
                                    Peak shortfall: {s.shortfallFte.toFixed(1)} FTE · Covers {s.coversStart}–{s.coversEnd}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: '#f0f0f0', color: '#555' }}>
                              <strong>Before → After:</strong>{' '}
                              {result.beforeShortfallSlots.length} shortfall slot{result.beforeShortfallSlots.length === 1 ? '' : 's'} ({result.beforeShortfallSlots.join(', ')}){' '}
                              → {result.afterShortfallSlots.length === 0 ? '0 shortfall slots' : `${result.afterShortfallSlots.length} remaining (${result.afterShortfallSlots.join(', ')})`}
                              {result.afterShortfallSlots.length > 0 && (
                                <span style={{ color: '#991b1b' }}> · Warning: suggestions create or leave shortfalls elsewhere.</span>
                              )}
                              {(() => {
                                const openSlot = result.slotBySlot[0];
                                const closeSlot = result.slotBySlot[result.slotBySlot.length - 1];
                                const openStaff = openSlot?.afterAvailable ?? 0;
                                const closeStaff = closeSlot?.afterAvailable ?? 0;
                                const openLow = openStaff < 2;
                                const closeLow = closeStaff < 2;
                                if (!openLow && !closeLow) return null;
                                return (
                                  <span style={{ color: '#991b1b' }}>
                                    {' '}· Opening/closing minimum 2 staff not met ({openLow ? `opening ${openStaff.toFixed(1)}` : ''}{openLow && closeLow ? ', ' : ''}{closeLow ? `closing ${closeStaff.toFixed(1)}` : ''}).
                                  </span>
                                );
                              })()}
                            </div>

                            {result.slotBySlot.length > 0 && (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs mt-2">
                                  <thead>
                                    <tr style={{ backgroundColor: '#F5FAF3' }}>
                                      <th className="py-1 px-2 text-left font-semibold" style={{ color: '#5a9228' }}>Time</th>
                                      <th className="py-1 px-2 text-center font-semibold" style={{ color: '#5a9228' }}>Staff Before</th>
                                      <th className="py-1 px-2 text-center font-semibold" style={{ color: '#5a9228' }}>Staff After</th>
                                      <th className="py-1 px-2 text-center font-semibold" style={{ color: '#5a9228' }}>Surplus Before</th>
                                      <th className="py-1 px-2 text-center font-semibold" style={{ color: '#5a9228' }}>Surplus After</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {result.slotBySlot.map((row, ridx) => {
                                      const changed = row.beforeAvailable !== row.afterAvailable || row.beforeSurplus !== row.afterSurplus;
                                      const isShortBefore = row.beforeSurplus < 0;
                                      const isShortAfter = row.afterSurplus < 0;
                                      if (!changed && !isShortBefore && !isShortAfter) return null;
                                      return (
                                        <tr key={ridx} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: isShortAfter ? '#fef2f2' : 'white' }}>
                                          <td className="py-1 px-2 font-mono font-medium" style={{ color: '#2d5c18' }}>{row.slot}</td>
                                          <td className="py-1 px-2 text-center" style={{ color: '#596570' }}>{row.totalDays > 0 ? row.beforeAvailable.toFixed(1) : '—'}</td>
                                          <td className="py-1 px-2 text-center font-medium" style={{ color: row.afterAvailable !== row.beforeAvailable ? '#2d5c18' : '#596570' }}>{row.totalDays > 0 ? row.afterAvailable.toFixed(1) : '—'}</td>
                                          <td className="py-1 px-2 text-center" style={{ color: isShortBefore ? '#dc2626' : row.beforeSurplus > 1 ? '#d97706' : '#166534' }}>{row.totalDays > 0 ? (row.beforeSurplus >= 0 ? '+' : '') + row.beforeSurplus.toFixed(1) : '—'}</td>
                                          <td className="py-1 px-2 text-center font-semibold" style={{ color: isShortAfter ? '#dc2626' : row.afterSurplus > 1 ? '#d97706' : '#166534' }}>{row.totalDays > 0 ? (row.afterSurplus >= 0 ? '+' : '') + row.afterSurplus.toFixed(1) : '—'}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {rosterRecs.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold mb-1" style={{ color: '#050505' }}>💡 Recommendations</div>
                    {rosterRecs.map((rec, i) => (
                      <div key={i} className="rounded-xl p-3 text-sm"
                        style={rec.type === 'understaffed'
                          ? { backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }
                          : { backgroundColor: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}>
                        <strong>{rec.campus}:</strong> {rec.text}
                      </div>
                    ))}
                  </div>
                )}

                {rosterOptData.length === 0 ? (
                  <div className="text-sm italic" style={{ color: '#596570' }}>No roster data for selected period.</div>
                ) : rosterOptData.map(({ campus: cn, slots }) => (
                  <div key={cn} className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
                    <div className="px-5 py-3" style={{ backgroundColor: '#2d5c18' }}>
                      <div className="font-bold text-sm text-white">{cn}</div>
                      <div className="text-xs" style={{ color: '#A0D083' }}>Averages across {slots[0]?.totalDays ?? 0} day(s) · 07:00-18:00 in 30-min slots</div>
                    </div>
                    <div className="overflow-x-auto">
                      {(() => {
                        const singleDay = fromDate === toDate;
                        const colHeaders = singleDay
                          ? ['Time','Children','Staff (Floor)','Required','Surplus','Off Floor','Surplus (incl Off Floor)','Status','ISS']
                          : ['Time','Avg Children','Avg Staff (Floor)','Required','Surplus','Off Floor','Surplus (incl Off Floor)','Status','ISS'];
                        return (
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ backgroundColor: '#F5FAF3' }}>
                            {colHeaders.map(h => (
                              <th key={h} className="py-2 px-3 text-xs font-semibold text-left" style={{ color: '#5a9228' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map((s, si) => {
                            const singleDay = fromDate === toDate;
                            const fmt1 = (n: number) => singleDay ? String(Math.round(n)) : n.toFixed(1);
                            const avgCh   = s.totalDays > 0 ? fmt1(s.sumChildren  / s.totalDays) : '—';
                            const avgSt   = s.totalDays > 0 ? fmt1(s.sumStaff     / s.totalDays) : '—';
                            const avgOff         = s.totalDays > 0 ? fmt1(s.sumOffFloor / s.totalDays) : '—';
                            const avgISS         = s.totalDays > 0 ? fmt1(s.sumISS      / s.totalDays) : '—';
                            const avgReq         = s.totalDays > 0 ? fmt1(s.sumRequired  / s.totalDays) : '—';
                            const surplus        = s.totalDays > 0 ? (s.sumStaff - s.sumRequired) / s.totalDays : 0;
                            const surplusInclOff = s.totalDays > 0 ? (s.sumStaff + s.sumOffFloorExclDirector - s.sumRequired) / s.totalDays : 0;
                            const rowBg2 = surplus < -0.5 ? '#fef2f2' : surplus < 0 ? '#fffbeb' : si % 2 === 0 ? 'white' : '#fafffe';
                            const badge = surplus < -0.5
                              ? { bg: '#fee2e2', color: '#991b1b', label: '⚠️ Short' }
                              : surplus < 0
                              ? { bg: '#fef9c3', color: '#854d0e', label: '⚡ Tight' }
                              : surplus > 1
                              ? { bg: '#fef9c3', color: '#92400e', label: '↑ Over' }
                              : { bg: '#dcfce7', color: '#166534', label: '✅ OK' };
                            return (
                              <tr key={si} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: rowBg2 }}>
                                <td className="py-1.5 px-3 font-mono text-xs font-bold" style={{ color: '#2d5c18' }}>{s.time}</td>
                                <td className="py-1.5 px-3 text-xs" style={{ color: '#596570' }}>{avgCh}</td>
                                <td className="py-1.5 px-3 text-xs font-medium" style={{ color: '#2d5c18' }}>{avgSt}</td>
                                <td className="py-1.5 px-3 text-xs" style={{ color: '#596570' }}>{avgReq}</td>
                                <td className="py-1.5 px-3 text-xs font-semibold"
                                  style={{ color: surplus < 0 ? '#dc2626' : surplus > 1 ? '#d97706' : '#166534' }}>
                                  {s.totalDays > 0 ? (surplus >= 0 ? '+' : '') + surplus.toFixed(1) : '—'}
                                </td>
                                <td className="py-1.5 px-3 text-xs" style={{ color: '#7c3aed' }}>{avgOff}</td>
                                <td className="py-1.5 px-3 text-xs font-semibold"
                                  style={{ color: surplusInclOff < 0 ? '#dc2626' : surplusInclOff > 1 ? '#d97706' : '#166534' }}>
                                  {s.totalDays > 0 ? (surplusInclOff >= 0 ? '+' : '') + surplusInclOff.toFixed(1) : '—'}
                                </td>
                                <td className="py-1.5 px-3">
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                    style={{ backgroundColor: badge.bg, color: badge.color }}>
                                    {badge.label}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 text-xs" style={{ color: '#0891b2' }}>{avgISS}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                        );
                      })()} {/* end singleDay IIFE */}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── WWCC EXPIRIES ── */}
            {viewingReport === 'wwcc-expiry' && (
              <div className="space-y-4">
                <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                  <strong>WWCC Expiry Monitor</strong> - Working With Children Check expiry dates. Sorted soonest first. Under-18 staff are excluded (exempt from WWCC).
                </div>

                {(() => {
                  const expired = wwccExpiryRows.filter(r => r.daysRemaining !== null && r.daysRemaining < 0);
                  const exp30   = wwccExpiryRows.filter(r => r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining < 30);
                  const exp90   = wwccExpiryRows.filter(r => r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining < 90);
                  return (
                    <div className="flex gap-3 flex-wrap">
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                        <div className="text-2xl font-bold">{expired.length}</div>
                        <div className="text-xs">Expired</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#fed7aa', color: '#9a3412' }}>
                        <div className="text-2xl font-bold">{exp30.length}</div>
                        <div className="text-xs">Expiring &lt;30 days</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
                        <div className="text-2xl font-bold">{exp90.length}</div>
                        <div className="text-xs">Expiring &lt;90 days</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#F5FAF3', color: '#2d5c18' }}>
                        <div className="text-2xl font-bold">{wwccExpiryRows.length}</div>
                        <div className="text-xs">Total Staff</div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-2 flex-wrap">
                    {(['all', 'expired', '30', '60', '90'] as const).map(f => {
                      const fLabel: Record<string, string> = { all: 'All', expired: 'Expired', '30': 'Expiring <30d', '60': 'Expiring <60d', '90': 'Expiring <90d' };
                      return (
                        <button key={f} onClick={() => setWwccExpiryFilter(f)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                          style={wwccExpiryFilter === f
                            ? { backgroundColor: '#2d5c18', color: 'white' }
                            : { backgroundColor: 'white', color: '#5a9228', border: '1px solid #D0E8B8' }}>
                          {fLabel[f]}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    disabled={wwccSyncing}
                    onClick={async () => {
                      setWwccSyncing(true);
                      setWwccSyncMsg(null);
                      try {
                        const centres = [...new Set(wwccExpiryRows.map(r => r.centre).filter(Boolean))];
                        if (centres.length === 0) { setWwccSyncMsg('No centres to sync.'); return; }
                        let total = 0;
                        for (const c of centres) {
                          const r = await fetch('/api/sync-wwcc-centre', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ centre: c }),
                          });
                          const j = await r.json();
                          total += j.upserted ?? 0;
                        }
                        setWwccSyncMsg(`✅ Synced — ${total} records updated. Reload to see latest data.`);
                      } catch (e: any) {
                        setWwccSyncMsg(`❌ Sync failed: ${e.message}`);
                      } finally {
                        setWwccSyncing(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                    style={{ backgroundColor: wwccSyncing ? '#e5e7eb' : '#2d5c18', color: wwccSyncing ? '#6b7280' : 'white' }}>
                    {wwccSyncing ? '⏳ Syncing…' : '🔄 Sync WWCC'}
                  </button>
                </div>
                {wwccSyncMsg && (
                  <div className="text-xs px-3 py-2 rounded-xl" style={{ backgroundColor: '#F5FAF3', color: '#2d5c18' }}>
                    {wwccSyncMsg}
                  </div>
                )}

                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ backgroundColor: '#F5FAF3' }}>
                        {['Name','Centre','Status','WWCC Number','Expiry Date','Days Remaining'].map(h => (
                          <th key={h} className="py-2 px-4 text-xs font-semibold text-left" style={{ color: '#5a9228' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const filtered = wwccExpiryRows.filter(r => {
                          if (wwccExpiryFilter === 'all')     return true;
                          if (wwccExpiryFilter === 'expired') return r.daysRemaining !== null && r.daysRemaining < 0;
                          if (wwccExpiryFilter === '30')      return r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining < 30;
                          if (wwccExpiryFilter === '60')      return r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining < 60;
                          if (wwccExpiryFilter === '90')      return r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining < 90;
                          return true;
                        });
                        if (filtered.length === 0) return (
                          <tr><td colSpan={5} className="py-6 text-center text-sm italic" style={{ color: '#596570' }}>No records match this filter.</td></tr>
                        );
                        return filtered.map((r, i) => {
                          const badgeBg    = r.daysRemaining === null ? '#f3f4f6'
                            : r.daysRemaining < 0  ? '#fee2e2'
                            : r.daysRemaining < 30 ? '#fed7aa'
                            : r.daysRemaining < 60 ? '#fef9c3'
                            : r.daysRemaining < 90 ? '#fef9c3'
                            : '#dcfce7';
                          const badgeColor = r.daysRemaining === null ? '#6b7280'
                            : r.daysRemaining < 0  ? '#991b1b'
                            : r.daysRemaining < 30 ? '#9a3412'
                            : r.daysRemaining < 60 ? '#854d0e'
                            : r.daysRemaining < 90 ? '#92400e'
                            : '#166534';
                          const dLabel = r.daysRemaining === null ? '-'
                            : r.daysRemaining < 0 ? `Expired ${Math.abs(r.daysRemaining)}d ago`
                            : `${r.daysRemaining}d`;
                          return (
                            <tr key={i} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: i % 2 === 0 ? 'white' : '#fafffe' }}>
                              <td className="py-2 px-4 font-medium" style={{ color: '#050505' }}>{r.full_name}</td>
                              <td className="py-2 px-4" style={{ color: '#596570' }}>{r.centre || '-'}</td>
                              <td className="py-2 px-4">
                                {r.exemptReason === 'under_18' && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>Under 18</span>}
                                {r.exemptReason === 'kitchen'  && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>Kitchen Staff</span>}
                                {!r.exemptReason && <span className="text-xs" style={{ color: '#9ca3af' }}>-</span>}
                              </td>
                              <td className="py-2 px-4 font-mono text-xs" style={{ color: '#1e3a5f' }}>{r.wwcc_number ?? '-'}</td>
                              <td className="py-2 px-4 text-xs" style={{ color: '#596570' }}>
                                {r.wwcc_expiry ? new Date(r.wwcc_expiry).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                              </td>
                              <td className="py-2 px-4">
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                  style={{ backgroundColor: badgeBg, color: badgeColor }}>
                                  {dLabel}
                                </span>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}


            {/* ── STAFFING ANALYSIS ── */}
            {viewingReport === 'staffing-analysis' && (() => {
              // Group rows by campus
              const byCampus: Record<string, StaffingAnalysisRow[]> = {};
              for (const row of staffingAnalysisRows) {
                (byCampus[row.campus] ??= []).push(row);
              }
              const campuses = Object.keys(byCampus);

              const avgSurplus = staffingAnalysisRows.length
                ? staffingAnalysisRows.reduce((s, r) => s + r.floatSurplus, 0) / staffingAnalysisRows.length
                : 0;
              const daysGreen   = staffingAnalysisRows.filter(r => r.status === 'green').length;
              const daysAmber   = staffingAnalysisRows.filter(r => r.status === 'amber').length;
              const daysRed     = staffingAnalysisRows.filter(r => r.status === 'red').length;
              const daysUnknown = staffingAnalysisRows.filter(r => r.status === 'unknown').length;

              return (
                <div className="space-y-4">
                  <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                    <strong>Staffing Analysis</strong> — Float pool surplus/deficit per centre per day. Buffer = 1 per 6 floor staff (1:6 ratio). AD counts only for centres with fewer than 100 children. Mirrors the Float Pool panel on the morning briefing.
                  </div>

                  {/* Summary stats */}
                  {staffingAnalysisRows.length > 0 && (
                    <div className="flex gap-3 flex-wrap">
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: avgSurplus >= 0 ? '#E2F1DA' : '#fee2e2', color: avgSurplus >= 0 ? '#2d5c18' : '#991b1b' }}>
                        <div className="text-2xl font-bold">{avgSurplus >= 0 ? '+' : ''}{avgSurplus.toFixed(1)}</div>
                        <div className="text-xs">Avg Float Surplus</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[100px]" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                        <div className="text-2xl font-bold">{daysGreen}</div>
                        <div className="text-xs">Days Green</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[100px]" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
                        <div className="text-2xl font-bold">{daysAmber}</div>
                        <div className="text-xs">Days Amber</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[100px]" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                        <div className="text-2xl font-bold">{daysRed}</div>
                        <div className="text-xs">Days Red</div>
                      </div>
                      {daysUnknown > 0 && (
                        <div className="rounded-xl p-3 flex-1 min-w-[100px]" style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}>
                          <div className="text-2xl font-bold">{daysUnknown}</div>
                          <div className="text-xs">No Data</div>
                        </div>
                      )}
                    </div>
                  )}

                  {campuses.length === 0 ? (
                    <div className="text-sm italic" style={{ color: '#596570' }}>No staffing data for selected period.</div>
                  ) : campuses.map(campus => {
                    const campusRows = byCampus[campus];
                    const campusAvg  = campusRows.reduce((s, r) => s + r.floatSurplus, 0) / campusRows.length;
                    const cpGreen    = campusRows.filter(r => r.status === 'green').length;
                    const cpAmber    = campusRows.filter(r => r.status === 'amber').length;
                    const cpRed      = campusRows.filter(r => r.status === 'red').length;
                    return (
                      <div key={campus} className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
                        <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: '#2d5c18' }}>
                          <div>
                            <div className="font-bold text-sm text-white">{campus}</div>
                            <div className="text-xs" style={{ color: '#A0D083' }}>
                              {campusRows.length} day{campusRows.length !== 1 ? 's' : ''}
                              {' - avg surplus '}{campusAvg >= 0 ? '+' : ''}{campusAvg.toFixed(1)}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {cpGreen > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>G:{cpGreen}</span>}
                            {cpAmber > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>A:{cpAmber}</span>}
                            {cpRed   > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>R:{cpRed}</span>}
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr style={{ backgroundColor: '#F5FAF3' }}>
                                {['Date','Children','Floor Staff','Required','Room ±','Float Buffer','Floats','AD','Available','Surplus','Status'].map(h => (
                                  <th key={h} className="py-2 px-3 text-xs font-semibold text-left" style={{ color: '#5a9228' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {campusRows.map((r, i) => {
                                const rowBg = r.status === 'green' ? (i % 2 === 0 ? '#f0fdf4' : '#dcfce7')
                                  : r.status === 'amber' ? (i % 2 === 0 ? '#fefce8' : '#fef9c3')
                                  : r.status === 'red'   ? (i % 2 === 0 ? '#fff1f2' : '#fee2e2')
                                  : (i % 2 === 0 ? 'white' : '#fafffe');
                                const surplusColor = r.floatSurplus > 0 ? '#166534' : r.floatSurplus < 0 ? '#dc2626' : '#854d0e';
                                const statusBadge = r.status === 'green'
                                  ? { bg: '#dcfce7', color: '#166534', label: 'Green' }
                                  : r.status === 'amber'
                                  ? { bg: '#fef9c3', color: '#854d0e', label: 'Amber' }
                                  : r.status === 'red'
                                  ? { bg: '#fee2e2', color: '#991b1b', label: 'Red' }
                                  : { bg: '#f3f4f6', color: '#6b7280', label: 'Unknown' };
                                const dateFmt = (() => { try { return format(new Date(r.date + 'T12:00:00'), 'EEE d MMM'); } catch { return r.date; } })();
                                return (
                                  <tr key={i} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: rowBg }}>
                                    <td className="py-2 px-3 font-medium text-xs" style={{ color: '#2d5c18' }}>{dateFmt}</td>
                                    <td className="py-2 px-3 text-xs" style={{ color: '#596570' }}>{r.children}</td>
                                    <td className="py-2 px-3 text-xs font-medium" style={{ color: '#050505' }}>{r.totalFloorStaff}</td>
                                    <td className="py-2 px-3 text-xs" style={{ color: '#596570' }}>{r.required}</td>
                                    <td className="py-2 px-3 text-xs font-medium"
                                      style={{ color: r.roomSurplus < 0 ? '#dc2626' : r.roomSurplus > 0 ? '#166534' : '#596570' }}>
                                      {r.roomSurplus > 0 ? '+' + r.roomSurplus : r.roomSurplus}
                                    </td>
                                    <td className="py-2 px-3 text-xs" style={{ color: '#7c3aed' }}>{r.bufferRequired.toFixed(1)}</td>
                                    <td className="py-2 px-3 text-xs font-medium" style={{ color: '#1d4ed8' }}>{r.floatCount}</td>
                                    <td className="py-2 px-3 text-xs" style={{ color: r.adAvailable > 0 ? '#059669' : '#9ca3af' }}>
                                      {r.adAvailable > 0 ? r.adAvailable : '-'}
                                    </td>
                                    <td className="py-2 px-3 text-xs font-medium" style={{ color: '#059669' }}>
                                      {r.floatCount + r.adAvailable + Math.max(0, r.roomSurplus)}
                                      {r.roomSurplus > 0 && <span className="ml-1 text-xs" style={{ color: '#7c3aed' }}>({r.floatCount + r.adAvailable}+{r.roomSurplus}rm)</span>}
                                    </td>
                                    <td className="py-2 px-3 text-xs font-bold" style={{ color: surplusColor }}>
                                      {r.floatSurplus >= 0 ? `+${r.floatSurplus.toFixed(1)}` : r.floatSurplus.toFixed(1)}
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                        style={{ backgroundColor: statusBadge.bg, color: statusBadge.color }}>
                                        {statusBadge.label}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── CASUAL REPORT ── */}
            {viewingReport === 'casual' && (() => {
              const totalInternalHours = casualRows.reduce((s, r) => s + r.internalHours, 0);
              const totalExternalHours = casualRows.reduce((s, r) => s + r.externalHours, 0);
              const totalExternalCostCents = casualRows.reduce((s, r) => s + r.externalCostCents, 0);

              // Build a lookup of date -> centre -> row
              const byDateCentre: Record<string, Record<string, CasualDayRow>> = {};
              for (const row of casualRows) {
                (byDateCentre[row.date] ??= {})[row.campus] = row;
              }

              // Build ISO week buckets (Mon-Sun) covering the selected date range
              const weekBuckets: { weekStart: string; weekEnd: string; dates: string[] }[] = [];
              const start = parseISO(fromDate);
              const end = parseISO(toDate);
              const firstDay = startOfWeek(start, { weekStartsOn: 1 });
              let cursor = firstDay;
              while (!isAfter(cursor, end)) {
                const weekDates: string[] = [];
                for (let d = 0; d < 7; d++) {
                  const day = add(cursor, { days: d });
                  if (!isBefore(day, start) && !isAfter(day, end)) {
                    weekDates.push(format(day, 'yyyy-MM-dd'));
                  }
                }
                if (weekDates.length > 0) {
                  weekBuckets.push({
                    weekStart: format(cursor, 'yyyy-MM-dd'),
                    weekEnd: format(add(cursor, { days: 6 }), 'yyyy-MM-dd'),
                    dates: weekDates,
                  });
                }
                cursor = add(cursor, { days: 7 });
              }

              const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

              return (
                <div className="space-y-4">
                  <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                    <strong>Casual Report</strong> - Internal and external casual hours by centre and day, with total external casual cost.
                  </div>

                  {casualRows.length > 0 && (
                    <div className="flex gap-3 flex-wrap">
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                        <div className="text-2xl font-bold">{totalInternalHours.toFixed(1)}</div>
                        <div className="text-xs">Internal Hours</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#fed7aa', color: '#c2410c' }}>
                        <div className="text-2xl font-bold">{totalExternalHours.toFixed(1)}</div>
                        <div className="text-xs">External Hours</div>
                      </div>
                      <div className="rounded-xl p-3 flex-1 min-w-[140px]" style={{ backgroundColor: '#f0fdf4', color: '#166534' }}>
                        <div className="text-2xl font-bold">${(totalExternalCostCents / 100).toFixed(2)}</div>
                        <div className="text-xs">External Cost</div>
                      </div>
                    </div>
                  )}

                  {casualRows.length === 0 ? (
                    <div className="text-sm italic" style={{ color: '#596570' }}>No casual data for the selected period.</div>
                  ) : weekBuckets.map(({ weekStart, weekEnd, dates }) => {
                    const activeCentres = selectedCentres.length > 0
                      ? selectedCentres.map(c => c.name).sort()
                      : [...new Set(casualRows.filter(r => dates.includes(r.date)).map(r => r.campus))].sort();

                    const weekRows = activeCentres.map(campus => {
                      const centreTotalCostCents = dates.reduce((s, d) => s + (byDateCentre[d]?.[campus]?.externalCostCents ?? 0), 0);
                      return { campus, centreTotalCostCents };
                    });
                    const weekExternalCostCents = weekRows.reduce((s, r) => s + r.centreTotalCostCents, 0);

                    return (
                      <div key={weekStart} className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
                        <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: '#2d5c18' }}>
                          <div className="font-bold text-sm text-white">Week of {safeFormat(parseISO(weekStart), 'd MMMM yyyy')} – {safeFormat(parseISO(weekEnd), 'd MMMM yyyy')}</div>
                          <div className="text-xs text-white">
                            <span>{activeCentres.length} centre{activeCentres.length !== 1 ? 's' : ''}</span>
                            {weekExternalCostCents > 0 && <span className="ml-3">· ${(weekExternalCostCents / 100).toFixed(2)} external</span>}
                          </div>
                        </div>
                        <div className="p-4 overflow-x-auto">
                          <table className="w-full text-sm min-w-[800px]">
                            <thead>
                              <tr style={{ backgroundColor: '#F5FAF3' }}>
                                <th className="py-2 px-3 text-xs font-semibold text-left sticky left-0 bg-[#F5FAF33]" style={{ color: '#5a9228' }}>Centre</th>
                                {dayLabels.map(label => (
                                  <th key={label} className="py-2 px-2 text-xs font-semibold text-center" style={{ color: '#5a9228', minWidth: 90 }}>{label}</th>
                                ))}
                                <th className="py-2 px-3 text-xs font-semibold text-right" style={{ color: '#5a9228' }}>External Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeCentres.map((campus, i) => {
                                const centreTotalCostCents = weekRows.find(r => r.campus === campus)?.centreTotalCostCents ?? 0;
                                return (
                                  <tr key={campus} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: i % 2 === 0 ? 'white' : '#fafffe' }}>
                                    <td className="py-2 px-3 font-medium sticky left-0" style={{ color: '#050505', backgroundColor: i % 2 === 0 ? 'white' : '#fafffe' }}>{campus}</td>
                                    {dayLabels.map((_, dayIndex) => {
                                      const date = dates.find(d => (parseISO(d).getDay() + 6) % 7 === dayIndex);
                                      const row = date ? byDateCentre[date]?.[campus] : undefined;
                                      return (
                                        <td key={dayIndex} className="py-2 px-2 text-center align-top" style={{ color: '#050505' }}>
                                          {row ? (
                                            <div className="flex flex-col gap-0.5 text-xs">
                                              <span style={{ color: '#92400e' }}>{row.internalHours.toFixed(1)}h int</span>
                                              <span style={{ color: '#c2410c' }}>{row.externalHours.toFixed(1)}h ext</span>
                                            </div>
                                          ) : (
                                            <span className="text-xs" style={{ color: '#94a3b8' }}>—</span>
                                          )}
                                        </td>
                                      );
                                    })}
                                    <td className="py-2 px-3 text-right font-medium" style={{ color: '#c2410c' }}>${(centreTotalCostCents / 100).toFixed(2)}</td>
                                  </tr>
                                );
                              })}
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
