import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CENTRES } from '../config';

// 24h ? 12h display: '14:30' ? '2:30pm', '07:00' ? '7am'
function to12h(hhmm: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}
import type { Room, AttendanceChild, RosteredStaff } from '../types';
import { enqueueSave } from '../utils/syncQueue';

// --- Types --------------------------------------------------------------------

interface FamilyGroupingConfig {
  id: string;
  label: string;
  roomIds: string[];    // empty = all rooms
  slots: string[];      // HH:MM slots this applies to
  color: string;        // hex colour
  heldInRoom?: string;  // which room the grouping is physically held in
}

interface RoomVisitor {
  id: string;           // unique per entry
  name: string;         // display name (free text or from dropdown)
  enteredAt: string;    // HH:MM
  exitedAt?: string;    // HH:MM — set when they leave
}

interface RatioCheckSession {
  cells: Record<string, { children: number }>; // "HH:MM:roomId"
  staffAvailableOverride: Record<string, number>; // "HH:MM"
  comments: Record<string, string>; // "HH:MM"
  familyGroupings: FamilyGroupingConfig[];
  staffMoves: Record<string, string>; // "${empId}:${slot}" ? roomId | "none" | "__float__"
  staffTimeOverrides: Record<string, {
    start: string;
    end: string;
    lunchStart?: string;  // HH:MM actual/planned lunch start
    lunchEnd?: string;    // HH:MM actual/planned lunch end
    source?: 'manual' | 'deputy'; // how was this set?
    isOvertime?: boolean; // staff staying back
    comment?: string;     // free-text note
  }>; // "${empId}" ? custom times
  roomVisitors: Record<string, RoomVisitor[]>; // "slot:roomId" ? visitor entries
}

export interface LunchAlert {
  employeeId: number;
  employeeName: string;
  scheduledLunch: string;
  minutesOverdue: number;
}

interface Props {
  centreId: string;
  date: string;
  rooms: Room[];
  children: AttendanceChild[];
  rosters: RosteredStaff[];
  onLunchAlerts?: (alerts: LunchAlert[]) => void;
}

// --- Constants ----------------------------------------------------------------

const MORNING_SLOTS = [
  '07:00','07:15','07:30','07:45',
  '08:00','08:15','08:30','08:45',
  '09:00','09:15','09:30','09:45',
];

const MIDDAY_SLOTS = [
  '10:00','10:30',
  '11:00','11:30',
  '12:00','12:30',
  '13:00','13:30',
];

const AFTERNOON_SLOTS = [
  '14:00','14:30',
  '15:00','15:30','15:45',
  '16:00','16:15','16:30','16:45',
  '17:00','17:15','17:30','17:45',
  '18:00',
];

const FG_COLOURS = ['#7c3aed','#0369a1','#047857','#b45309','#dc2626'];

const EMPTY_SESSION: RatioCheckSession = {
  cells: {},
  staffAvailableOverride: {},
  comments: {},
  familyGroupings: [],
  staffMoves: {},
  staffTimeOverrides: {} as Record<string, { start: string; end: string; lunchStart?: string; lunchEnd?: string; source?: 'manual' | 'deputy'; isOvertime?: boolean; comment?: string }>,
  roomVisitors: {},
};

// --- Ratio calculation --------------------------------------------------------

function calcRequired(u24: number, m24: number, m36: number): number {
  if (u24 + m24 + m36 === 0) return 0;
  let staff = 0;
  let cap = 0;

  const s1 = Math.ceil(u24 / 4); cap = s1 * 4; staff += s1;
  const leftover = Math.max(0, cap - u24);

  const rem24 = Math.max(0, m24 - leftover);
  const s2 = Math.ceil(rem24 / 5); cap = s2 * 5; staff += s2;
  const leftover2 = Math.max(0, cap - rem24);

  const rem36 = Math.max(0, m36 - leftover2);
  staff += Math.ceil(rem36 / 10);

  return Math.max(staff, 1);
}

function roomAgeBucket(ageGroup: string): 'u24' | 'm24' | 'm36' {
  const lower = ageGroup.toLowerCase();
  if (lower.startsWith('0') || lower.startsWith('1')) return 'u24';
  if (lower.startsWith('2')) return 'm24';
  return 'm36';
}

// --- Time helpers -------------------------------------------------------------

function slotToMins(slot: string): number {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m;
}

function rosterTimeToMins(t: string | number | null | undefined): number | null {
  if (!t) return null;
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const localStr = d.toLocaleTimeString('en-AU', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney',
    });
    const [h, m] = localStr.split(':').map(Number);
    return h * 60 + m;
  }
  const parts = String(t).split(':').map(Number);
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

function formatRosterTime(t: string | number | null | undefined): string {
  if (!t) return '';
  const mins = rosterTimeToMins(t);
  if (mins === null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function countChildrenAtSlot(children: AttendanceChild[], room: Room, slot: string): number {
  const slotMins = slotToMins(slot);
  const roomName = room.ownaRoomName ?? room.name;
  return children.filter(c => {
    if (c.room !== roomName) return false;
    if (!c.sign_in) return false;
    const inMins = slotToMins(c.sign_in.slice(0, 5));
    if (inMins > slotMins) return false;
    if (c.sign_out) {
      const outMins = slotToMins(c.sign_out.slice(0, 5));
      if (outMins <= slotMins) return false;
    }
    return true;
  }).length;
}

// @ts-expect-error kept for potential future use
function countStaffAtSlot(rosters: RosteredStaff[], slot: string): number {
  const slotMins = slotToMins(slot);
  return rosters.filter(r => {
    const start = rosterTimeToMins(r.startTime);
    const end = rosterTimeToMins(r.endTime);
    if (start === null || end === null) return false;
    return start <= slotMins && end > slotMins;
  }).length;
}


// --- Cell key helpers ---------------------------------------------------------

function cellKey(slot: string, roomId: string) {
  return `${slot}:${roomId}`;
}

// Short display name: "FirstName L."
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 10);
  return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
}

// Hex colour with alpha for background tint
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// --- Component ----------------------------------------------------------------

export default function RatioCheckPanel({ centreId, date, rooms, children, rosters,
  onLunchAlerts,
}: Props) {
  const [activeSession, setActiveSession] = useState<'morning' | 'midday' | 'afternoon'>('morning');
  const [morningData,   setMorningData]   = useState<RatioCheckSession>(EMPTY_SESSION);
  const [middayData,    setMiddayData]    = useState<RatioCheckSession>(EMPTY_SESSION);
  const [afternoonData, setAfternoonData] = useState<RatioCheckSession>(EMPTY_SESSION);
  const [floatScheds,         setFloatScheds]         = useState<any[]>([]);
  const [lunchScheds,         setLunchScheds]         = useState<Array<{ employeeId: number; lunchStart: string; lunchEnd: string }>>([]);
  const [dayAllocations,      setDayAllocations]      = useState<Record<number,string>>({});

  // -- Lunch break overdue alerts --------------------------------------------
  useEffect(() => {
    if (!onLunchAlerts) return;
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const todayStrLocal = now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
    if (date !== todayStrLocal) { onLunchAlerts([]); return; }
    // Merge overrides across all three session panels to catch any set lunch time
    const allOverrides = { ...morningData.staffTimeOverrides, ...middayData.staffTimeOverrides, ...afternoonData.staffTimeOverrides };
    const alerts: LunchAlert[] = [];
    for (const r of rosters) {
      const override = allOverrides[String(r.employeeId)];
      // If Deputy/manual already shows lunch started — no alert
      if (override?.lunchStart) continue;
      const start = rosterTimeToMins(r.startTime);
      const end   = rosterTimeToMins(r.endTime);
      if (start === null || end === null || end === 0) continue;
      if ((end - start) < 300) continue; // shifts < 5h don't need lunch
      // Expected lunch = midpoint of shift rounded to nearest 30 min
      const midMins = Math.round((start + end) / 2 / 30) * 30;
      const overdueBy = nowMins - midMins;
      if (overdueBy >= 15) {
        const hh = String(Math.floor(midMins / 60)).padStart(2, '0');
        const mm = String(midMins % 60).padStart(2, '0');
        alerts.push({ employeeId: r.employeeId, employeeName: r.employeeName, scheduledLunch: hh + ':' + mm, minutesOverdue: overdueBy });
      }
    }
    onLunchAlerts(alerts);
  }, [morningData.staffTimeOverrides, middayData.staffTimeOverrides, afternoonData.staffTimeOverrides, rosters, date, onLunchAlerts]);
  const [liveChildren,        setLiveChildren]        = useState<AttendanceChild[]>([]); // real-time attendance for this date
  const [historicalChildren, setHistoricalChildren] = useState<AttendanceChild[]>([]);
  const [histDate,           setHistDate]           = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [attendanceRefreshing, setAttendanceRefreshing] = useState(false);
  const [lastAttendanceRefresh, setLastAttendanceRefresh] = useState<Date | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  // Single global time editor modal — one at a time, avoids duplicate popovers
  const [timeEditorModal, setTimeEditorModal] = useState<{ empId: number; name: string; rosterStart: string; rosterEnd: string } | null>(null);
  const [timeEditorStart, setTimeEditorStart] = useState('');
  const [timeEditorEnd, setTimeEditorEnd] = useState('');
  const [timeEditorLunchStart, setTimeEditorLunchStart] = useState('');
  const [timeEditorLunchEnd, setTimeEditorLunchEnd] = useState('');
  const [timeEditorOvertime, setTimeEditorOvertime] = useState(false);
  const [timeEditorComment, setTimeEditorComment] = useState('');
  const [fgPanelOpen, setFgPanelOpen] = useState(false);
  const [editingFgId, setEditingFgId] = useState<string | null>(null);
  const [fgPopoverSlot, setFgPopoverSlot] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragState = useRef<{ empId: number; slot: string; fromSource: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null); // "roomId:slot" | "available:slot"
  const [touchSelected, setTouchSelected] = useState<{ empId: number; slot: string; source: string } | null>(null);

  // Staff Finish Times panel state
  const [showFinishPanel, setShowFinishPanel] = useState(false);
  const [markedFinished, setMarkedFinished] = useState<Set<number>>(new Set());

  // Visitor log modal state
  const [visitorModal, setVisitorModal] = useState<{ slot: string; roomId: string; roomName: string } | null>(null);
  const [visitorName, setVisitorName] = useState('');
  const [visitorTime, setVisitorTime] = useState('');
  const [visitorExitTime, setVisitorExitTime] = useState('');
  const [visitorExitModalState, setVisitorExitModalState] = useState<{ slot: string; roomId: string; roomName: string; visitorId: string; visitorName: string; exitTime: string } | null>(null);
  // showActivityCols removed — all three columns always visible

  // --- Deputy actual timesheets — poll every 5 minutes -----------------------
  const allUnitIds = useMemo(() => {
    const centre = CENTRES.find(c => c.id === centreId);
    if (!centre) return [];
    return [
      ...centre.rooms.map(r => r.deputyUnitId),
      ...(centre.floatUnitIds ?? []),
      ...(centre.issUnitIds ?? []),
      ...(centre.nonRatioUnitIds ?? []),
    ].filter(Boolean);
  }, [centreId]);

  useEffect(() => {
    if (!date || allUnitIds.length === 0) return;

    // Poll on today's date every 5 min (live clock-ins); for past dates, fetch once (approved timesheets)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    const isToday = date === today;
    // Don't fetch future dates — no timesheets yet
    if (date > today) return;

    async function fetchActuals() {
      try {
        const r = await fetch(`/api/deputy-timesheets-actual?unitIds=${allUnitIds.join(',')}&date=${date}`);
        if (!r.ok) return;
        const actuals: Array<{
          employeeId: number; actualStart: string | null; actualEnd: string | null;
          isInProgress: boolean; isRealTime: boolean;
          breaks: Array<{ breakStart: string | null; breakEnd: string | null; type: string; status: string }>;
        }> = await r.json();

        // Merge actuals into time overrides — manual overrides take precedence
        for (const ts of actuals) {
          // Accept both real-time clock-ins (kiosk/app) AND manager-approved timesheets
          // The backend already filters to entries with actual StartTimeLocalized set,
          // so everything returned here has genuine actual times.
          if (!ts.actualStart) continue; // no actual times available — skip
          const key = String(ts.employeeId);

          setMorningData(prev => {
            const existing = prev.staffTimeOverrides[key];
            // Don't overwrite manual overrides
            if (existing?.source === 'manual') return prev;

            const mealBreak = ts.breaks.find(b => b.type === 'meal');
            const lunchStart = mealBreak?.status === 'finished' || mealBreak?.status === 'in_progress'
              ? mealBreak.breakStart ?? undefined : undefined;
            const lunchEnd = mealBreak?.status === 'finished' ? mealBreak.breakEnd ?? undefined : undefined;

            const newOverride = {
              start: ts.actualStart ?? existing?.start ?? '',
              end:   (!ts.isInProgress && ts.actualEnd) ? ts.actualEnd : (existing?.end ?? ''),
              lunchStart: lunchStart ?? existing?.lunchStart,
              lunchEnd:   lunchEnd   ?? existing?.lunchEnd,
              source: 'deputy' as const,
            };
            // Only update if something changed
            if (JSON.stringify(existing) === JSON.stringify(newOverride)) return prev;
            const next = { ...prev, staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: newOverride } };
            save('morning', next);
            return next;
          });
          setMiddayData(prev => {
            const existing = prev.staffTimeOverrides[key];
            if (existing?.source === 'manual') return prev;
            const mealBreak = ts.breaks.find(b => b.type === 'meal');
            const lunchStart = mealBreak?.status === 'finished' || mealBreak?.status === 'in_progress'
              ? mealBreak.breakStart ?? undefined : undefined;
            const lunchEnd = mealBreak?.status === 'finished' ? mealBreak.breakEnd ?? undefined : undefined;
            const newOverride = {
              start: ts.actualStart ?? existing?.start ?? '',
              end:   (!ts.isInProgress && ts.actualEnd) ? ts.actualEnd : (existing?.end ?? ''),
              lunchStart: lunchStart ?? existing?.lunchStart,
              lunchEnd:   lunchEnd   ?? existing?.lunchEnd,
              source: 'deputy' as const,
            };
            if (JSON.stringify(existing) === JSON.stringify(newOverride)) return prev;
            const next = { ...prev, staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: newOverride } };
            save('midday', next);
            return next;
          });
          setAfternoonData(prev => {
            const existing = prev.staffTimeOverrides[key];
            if (existing?.source === 'manual') return prev;
            const mealBreak = ts.breaks.find(b => b.type === 'meal');
            const lunchStart = mealBreak?.status === 'finished' || mealBreak?.status === 'in_progress'
              ? mealBreak.breakStart ?? undefined : undefined;
            const lunchEnd = mealBreak?.status === 'finished' ? mealBreak.breakEnd ?? undefined : undefined;
            const newOverride = {
              start: ts.actualStart ?? existing?.start ?? '',
              end:   (!ts.isInProgress && ts.actualEnd) ? ts.actualEnd : (existing?.end ?? ''),
              lunchStart: lunchStart ?? existing?.lunchStart,
              lunchEnd:   lunchEnd   ?? existing?.lunchEnd,
              source: 'deputy' as const,
            };
            if (JSON.stringify(existing) === JSON.stringify(newOverride)) return prev;
            const next = { ...prev, staffTimeOverrides: { ...prev.staffTimeOverrides, [key]: newOverride } };
            save('afternoon', next);
            return next;
          });
        }
      } catch { /* network error — fail silently */ }
    }

    fetchActuals(); // immediate first fetch
    if (!isToday) return; // past dates: single fetch only (approved timesheets don't change)
    const interval = setInterval(fetchActuals, 5 * 60 * 1000); // today: poll every 5 min for live clock-ins
    return () => clearInterval(interval);
  }, [date, allUnitIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- End Deputy polling ---------------------------------------------------

  // Family groupings are shared across all sessions — merge by id so FGs created in any session are visible everywhere
  const sharedFamilyGroupings = useMemo(() => {
    const allById = new Map<string, FamilyGroupingConfig>();
    for (const d of [morningData, middayData, afternoonData]) {
      for (const fg of (d.familyGroupings ?? [])) {
        allById.set(fg.id, { ...(allById.get(fg.id) ?? {}), ...fg } as FamilyGroupingConfig);
      }
    }
    return [...allById.values()];
  }, [morningData.familyGroupings, middayData.familyGroupings, afternoonData.familyGroupings]);

    // Time overrides are shared across all sessions — merge all three (any session's value wins)
  const sharedTimeOverrides = useMemo(() => ({
    ...morningData.staffTimeOverrides,
    ...middayData.staffTimeOverrides,
    ...afternoonData.staffTimeOverrides,
  }), [morningData.staffTimeOverrides, middayData.staffTimeOverrides, afternoonData.staffTimeOverrides]);

  const sessionData    = activeSession === 'morning' ? morningData : activeSession === 'midday' ? middayData : afternoonData;
  const setSessionData = activeSession === 'morning' ? setMorningData : activeSession === 'midday' ? setMiddayData : setAfternoonData;
  const slots = activeSession === 'morning' ? MORNING_SLOTS : activeSession === 'midday' ? MIDDAY_SLOTS : AFTERNOON_SLOTS;

  // -- Load saved data --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    // Cancel any pending auto-save from the previous date before loading new data.
    // Also reset the user-edited guard so the fresh load can't overwrite new data.
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    pendingSave.current = null;
    hasUserEdited.current = false;
    async function load() {
      try {
        const r = await fetch(`/api/ratio-check?centre_id=${encodeURIComponent(centreId)}&date=${date}`);
        if (!r.ok || cancelled) return;
        const rows: { session: string; data: RatioCheckSession & { familyGroupingSlots?: string[]; familyGroupingRooms?: string[] } }[] = await r.json();
        if (cancelled) return;
        // Reset sessions that have no saved data for this date so stale data
        // from a previous date doesn't linger. Done here (after fetch) not before,
        // so we never trigger an auto-save of empty data.
        const hasMorning   = rows.some(r => r.session === 'morning');
        const hasMidday    = rows.some(r => r.session === 'midday');
        const hasAfternoon = rows.some(r => r.session === 'afternoon');
        if (!hasMorning)   setMorningData(EMPTY_SESSION);
        if (!hasMidday)    setMiddayData(EMPTY_SESSION);
        if (!hasAfternoon) setAfternoonData(EMPTY_SESSION);
        for (const row of rows) {
          // Migration: convert old single-FG format to new multi-FG format
          const legacyFG: FamilyGroupingConfig[] = (row.data as { familyGroupingSlots?: string[]; familyGroupingRooms?: string[] }).familyGroupingSlots?.length ?? 0 > 0 ? [{
            id: 'legacy',
            label: 'FG 1',
            roomIds: (row.data as { familyGroupingRooms?: string[] }).familyGroupingRooms ?? [],
            slots: (row.data as { familyGroupingSlots?: string[] }).familyGroupingSlots ?? [],
            color: '#7c3aed',
          }] : [];

          const d: RatioCheckSession = {
            ...EMPTY_SESSION,
            ...row.data,
            familyGroupings: row.data.familyGroupings ?? legacyFG,
            staffMoves: row.data.staffMoves ?? {},
            staffTimeOverrides: row.data.staffTimeOverrides ?? {},
            roomVisitors: (row.data as any).roomVisitors ?? {},
          };
          if (row.session === 'morning')   setMorningData(d);
          if (row.session === 'midday')    setMiddayData(d);
          if (row.session === 'afternoon') setAfternoonData(d);
        }
      } catch { /* offline */ }
      try {
        const fr = await fetch(`/api/float-schedules?centre=${encodeURIComponent(centreId)}&date=${date}`);
        if (!cancelled && fr.ok) setFloatScheds(await fr.json());
        // Load lunch schedule (from LunchBreakPanel) to show planned lunch times on chips
        try {
          const lr = await fetch(`/api/lunch-schedules?centre=${encodeURIComponent(centreId)}&date=${date}`);
          if (!cancelled && lr.ok) {
            const lrows = await lr.json();
            // API returns [{ schedule: [...] }] — extract the schedule array
            const sched = Array.isArray(lrows) && lrows.length > 0 ? (lrows[0].schedule ?? []) : [];
            setLunchScheds(sched.filter((e: any) => e.employeeId && e.lunchStart));
          }
        } catch { /* offline */ }
      } catch { /* offline */ }
      // Fetch live attendance for the actual date - always real-time for Ratio Check
      try {
        const centre = CENTRES.find(ce => ce.id === centreId);
        const campusName = (centre as any)?.ownaName ?? centre?.name ?? centreId;
        const lr = await fetch(`/api/attendance?campus=${encodeURIComponent(campusName)}&date=${date}`);
        if (!cancelled && lr.ok) {
          const rows = await lr.json();
          if (Array.isArray(rows)) {
            setLiveChildren(rows.map((r: any) => ({
              child_name: r.child_name ?? '', room: r.room ?? '',
              sign_in: r.sign_in ?? null, sign_out: r.sign_out ?? null,
              predicted_sign_out: r.predicted_sign_out ?? null,
              age: r.age ?? null, ageMonths: 0,
            })));
            if (!cancelled) setLastAttendanceRefresh(new Date());
          }
        }
      } catch { /* offline */ }
      // Load day-level staff allocations from Plan view drags
      try {
        const ar = await fetch(`/api/staff-allocations?centre=${encodeURIComponent(centreId)}&date=${date}`);
        if (!cancelled && ar.ok) {
          const rows = await ar.json();
          if (Array.isArray(rows) && rows[0]?.moves) setDayAllocations(rows[0].moves);
        }
      } catch { /* offline */ }
      // Historical attendance: same weekday 7 days ago from attendance_daily
      try {
        const centre = CENTRES.find(ce => ce.id === centreId);
        const campusName = (centre as any)?.ownaName ?? centre?.name ?? centreId;
        const d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() - 7);
        const lastWeek = d.toISOString().slice(0, 10);
        const hr = await fetch(`/api/attendance?campus=${encodeURIComponent(campusName)}&date=${lastWeek}`);
        if (!cancelled && hr.ok) {
          const rows = await hr.json();
          if (Array.isArray(rows) && rows.length > 0) {
            setHistoricalChildren(rows.map((r: any) => ({
              child_name: r.child_name ?? '', room: r.room ?? '',
              sign_in: r.sign_in ?? null, sign_out: r.sign_out ?? null,
              predicted_sign_out: r.predicted_sign_out ?? null,
              age: r.age ?? null, ageMonths: 0,
            })));
            setHistDate(lastWeek);
          }
        }
      } catch { /* offline */ }
    }
    load();
    return () => { cancelled = true; };
  }, [centreId, date]);

  // -- Periodic live attendance refresh (every 2 minutes) --------------------
  // Keeps child counts current as children sign in throughout the day.
  // This is especially important when Family Grouping is set up in advance �
  // FG cells auto-populate from liveChildren, so they need fresh data.
  const refreshLiveAttendance = useCallback(async () => {
    if (!centreId || !date) return;
    setAttendanceRefreshing(true);
    try {
      const centre = CENTRES.find(ce => ce.id === centreId);
      const campusName = (centre as any)?.ownaName ?? centre?.name ?? centreId;
      const lr = await fetch(`/api/attendance?campus=${encodeURIComponent(campusName)}&date=${date}`);
      if (lr.ok) {
        const rows = await lr.json();
        if (Array.isArray(rows)) {
          setLiveChildren(rows.map((r: any) => ({
            child_name: r.child_name ?? '', room: r.room ?? '',
            sign_in: r.sign_in ?? null, sign_out: r.sign_out ?? null,
            predicted_sign_out: r.predicted_sign_out ?? null,
            age: r.age ?? null, ageMonths: 0,
          })));
          setLastAttendanceRefresh(new Date());
        }
      }
    } catch { /* offline */ }
    setAttendanceRefreshing(false);
  }, [centreId, date]);

  useEffect(() => {
    const interval = setInterval(refreshLiveAttendance, 2 * 60 * 1000); // every 2 minutes
    return () => clearInterval(interval);
  }, [refreshLiveAttendance]);

  // -- Auto-save --------------------------------------------------------------
  const save = useCallback(async (session: 'morning' | 'midday' | 'afternoon', data: RatioCheckSession) => {
    if (!centreId || !date) return; // guard: don't attempt save without required props
    setSaveStatus('saving');
    const result = await enqueueSave('/api/ratio-check', { centre_id: centreId, date, session, data });
    if (result === 'saved') {
      setSaveStatus('saved');
    } else if (result === 'queued') {
      // Saved locally, will sync when Supabase comes back
      setSaveStatus('saved'); // show saved — it IS saved locally and will sync
      console.warn('[RatioCheck] Supabase unavailable — queued for retry');
    } else {
      setSaveStatus('error');
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveStatus('idle'), 3000);
  }, [centreId, date]);

  // -- Computed children counts (auto-populated) ------------------------------
  // Computed children counts for Ratio Check:
  // Priority: 1. Live attendance for this date (real-time) — if live data is loaded,
  //              use it as-is (even if 0 = no children signed in yet).
  //              Only fall back to prop/hist if NO live data has loaded at all.
  //           2. Prop children (parent-provided, may be historical in plan mode)
  //           3. Historical same-day-last-week fallback
  const hasLiveData = liveChildren.length > 0;
  const autoChildCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const slot of slots) {
      for (const room of rooms) {
        if (hasLiveData) {
          // Live data loaded — trust it exactly (0 means 0 children signed in yet)
          counts[cellKey(slot, room.id)] = countChildrenAtSlot(liveChildren, room, slot);
        } else {
          // No live data yet — fall back to prop then historical
          const prop = countChildrenAtSlot(children, room, slot);
          const hist = countChildrenAtSlot(historicalChildren, room, slot);
          counts[cellKey(slot, room.id)] = prop > 0 ? prop : hist;
        }
      }
    }
    return counts;
  }, [liveChildren, hasLiveData, children, historicalChildren, rooms, slots]);

  // -- Computed: staff present at each slot -----------------------------------
  const staffAtSlotMap = useMemo(() => {
    const map: Record<string, RosteredStaff[]> = {};
    // Use allSlots (not just current session) so offFloorStaffBySlot can find
    // staff objects for any session's lunch/programming blocks
    const allSlots = [...MORNING_SLOTS, ...MIDDAY_SLOTS, ...AFTERNOON_SLOTS];
    for (const slot of allSlots) {
      const slotMins = slotToMins(slot);
      map[slot] = rosters.filter(r => {
        // Use time override if set, otherwise fall back to raw roster times
        const override = sharedTimeOverrides[String(r.employeeId)];
        const startStr = override?.start || formatRosterTime(r.startTime);
        const endStr   = override?.end   || formatRosterTime(r.endTime);
        if (!startStr || !endStr) return false;
        const start = slotToMins(startStr);
        const end   = slotToMins(endStr);
        return start <= slotMins && end > slotMins;
      });
    }
    return map;
  }, [rosters, slots, sharedTimeOverrides]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future use

  // Actual RosteredStaff objects who are off floor at each slot, grouped by activity type
  // Used to show draggable badges in activity columns
  const offFloorStaffBySlot = useMemo(() => {
    const map: Record<string, { programming: RosteredStaff[]; lunch: RosteredStaff[]; cleaning: RosteredStaff[] }> = {};
    const allSlots = [...MORNING_SLOTS, ...MIDDAY_SLOTS, ...AFTERNOON_SLOTS];
    for (const slot of allSlots) {
      const slotMins = slotToMins(slot);
      // Track by empId to deduplicate and enforce single-column placement
      const progIds = new Set<number>(), lunchIds = new Set<number>(), cleanIds = new Set<number>();
      const progStaff: RosteredStaff[] = [], lunchStaff: RosteredStaff[] = [], cleanStaff: RosteredStaff[] = [];
      for (const fsRow of floatScheds) {
        for (const block of (fsRow.schedule ?? [])) {
          const covId = block.coveringEmployeeId as number | undefined;
          if (!covId) continue;
          const bStart = slotToMins(String(block.startTime ?? '00:00'));
          const bEnd   = slotToMins(String(block.endTime   ?? '00:00'));
          if (slotMins < bStart || slotMins >= bEnd) continue;
          // If manually moved to a different activity or back to a room - suppress float-schedule entry
          const manualMove = sessionData.staffMoves[`${covId}:${slot}`];
          if (manualMove !== undefined) continue; // manual placement always wins
          const staffObj = (staffAtSlotMap[slot] ?? []).find(s => s.employeeId === covId);
          if (!staffObj) continue;
          const ct = String(block.coverType ?? '').toLowerCase();
          // Deduplicate: only add once per employee per activity column
          if (ct === 'programming' && !progIds.has(covId)) {
            progIds.add(covId); progStaff.push(staffObj);
          } else if (ct === 'cleaning' && !cleanIds.has(covId)) {
            cleanIds.add(covId); cleanStaff.push(staffObj);
          } else if (block.type === 'break' && ct !== 'ratio' && !lunchIds.has(covId)) {
            lunchIds.add(covId); lunchStaff.push(staffObj);
          }
        }
      }
      map[slot] = { programming: progStaff, lunch: lunchStaff, cleaning: cleanStaff };
    }
    return map;
  }, [floatScheds, sessionData.staffMoves, staffAtSlotMap]);

  // Who is off floor at each slot (person being covered for programming/lunch/cleaning)
  // Manual staffMoves overrides take priority - dragging someone back to a room cancels their off-floor status
  const offFloorBySlot = useMemo(() => {
    const activityMoves = new Set(['__programming__', '__lunch__', '__cleaning__', '__additional__', '__removed__']);
    const map: Record<string, Set<number>> = {};
    const allSlots = [...MORNING_SLOTS, ...MIDDAY_SLOTS, ...AFTERNOON_SLOTS];
    for (const slot of allSlots) {
      const slotMins = slotToMins(slot);
      const offFloor = new Set<number>();
      for (const fsRow of floatScheds) {
        for (const block of (fsRow.schedule ?? [])) {
          const covId = block.coveringEmployeeId as number | undefined;
          if (!covId) continue;
          const bStart = slotToMins(String(block.startTime ?? '00:00'));
          const bEnd   = slotToMins(String(block.endTime   ?? '00:00'));
          if (slotMins < bStart || slotMins >= bEnd) continue;
          // Check if manually overridden - if staffMoves points them to a room, they're on floor
          const manualMove = sessionData.staffMoves[`${covId}:${slot}`];
          if (manualMove !== undefined && !activityMoves.has(manualMove)) continue; // back on floor
          const ct = String(block.coverType ?? '').toLowerCase();
          if (ct === 'programming' || ct === 'cleaning') offFloor.add(covId);
          if (block.type === 'break' && ct !== 'ratio') offFloor.add(covId);
        }
      }
      map[slot] = offFloor;
    }
    return map;
  }, [floatScheds, sessionData.staffMoves]);

  // Which floats are covering which rooms at each slot
  // keyed: slot ? roomId ? [floatEmployeeIds]
  const floatCoveringRoomBySlot = useMemo(() => {
    const map: Record<string, Record<string, number[]>> = {};
    const allSlots = [...MORNING_SLOTS, ...MIDDAY_SLOTS, ...AFTERNOON_SLOTS];
    for (const slot of allSlots) {
      const slotMins = slotToMins(slot);
      const roomCover: Record<string, number[]> = {};
      for (const fsRow of floatScheds) {
        const floatEmpId = fsRow.employee_id as number;
        if (!floatEmpId) continue;
        for (const block of (fsRow.schedule ?? [])) {
          if (!block.roomId) continue;
          const bStart = slotToMins(String(block.startTime ?? '00:00'));
          const bEnd   = slotToMins(String(block.endTime   ?? '00:00'));
          if (slotMins < bStart || slotMins >= bEnd) continue;
          // Float is covering a room (any block type that puts them in a room)
          if (!roomCover[block.roomId]) roomCover[block.roomId] = [];
          if (!roomCover[block.roomId].includes(floatEmpId)) roomCover[block.roomId].push(floatEmpId);
        }
      }
      map[slot] = roomCover;
    }
    return map;
  }, [floatScheds]);

  // -- Computed getters -------------------------------------------------------

  function getChildCount(slot: string, roomId: string): number {
    const key = cellKey(slot, roomId);
    const cell = sessionData.cells[key];
    return cell?.children ?? autoChildCounts[key] ?? 0;
  }

  function getStaffRequired(slot: string, room: Room): number {
    const count = getChildCount(slot, room.id);
    if (count === 0) return 0;
    const bucket = roomAgeBucket(room.ageGroup);
    const u24 = bucket === 'u24' ? count : 0;
    const m24 = bucket === 'm24' ? count : 0;
    const m36 = bucket === 'm36' ? count : 0;
    return calcRequired(u24, m24, m36);
  }

  /** Get actual Room objects for a FG config (empty roomIds = all rooms) */
  function getFGRoomsForConfig(fg: FamilyGroupingConfig): Room[] {
    if (fg.roomIds.length === 0) return rooms;
    return rooms.filter(r => fg.roomIds.includes(r.id));
  }

  /** Find which FG (if any) a room belongs to at a given slot */
  function getFGForRoomAtSlot(slot: string, roomId: string): FamilyGroupingConfig | null {
    return sharedFamilyGroupings.find(fg =>
      fg.slots.includes(slot) &&
      (fg.roomIds.length === 0 || fg.roomIds.includes(roomId))
    ) ?? null;
  }

  /** Get FGs active at a slot */
  function getFGsAtSlot(slot: string): FamilyGroupingConfig[] {
    return sharedFamilyGroupings.filter(fg => fg.slots.includes(slot));
  }

  /** Combined required for a specific FG at a slot */
  function getFGRequiredForConfig(slot: string, fg: FamilyGroupingConfig): number {
    const fgRooms = getFGRoomsForConfig(fg);
    let u24 = 0, m24 = 0, m36 = 0;
    for (const room of fgRooms) {
      const count = getChildCount(slot, room.id);
      const bucket = roomAgeBucket(room.ageGroup);
      if (bucket === 'u24') u24 += count;
      else if (bucket === 'm24') m24 += count;
      else m36 += count;
    }
    return calcRequired(u24, m24, m36);
  }

  /** Total required across all rooms at a slot (respecting FG groupings) */
  function getTotalRequired(slot: string): number {
    const activeFGs = getFGsAtSlot(slot);
    const roomsInAnyFG = new Set<string>();

    let total = 0;
    for (const fg of activeFGs) {
      const fgRooms = getFGRoomsForConfig(fg);
      for (const room of fgRooms) roomsInAnyFG.add(room.id);
      total += getFGRequiredForConfig(slot, fg);
    }
    // Add non-FG rooms individually
    for (const room of rooms) {
      if (!roomsInAnyFG.has(room.id)) {
        total += getStaffRequired(slot, room);
      }
    }
    return total;
  }

  function getTotalChildren(slot: string): number {
    return rooms.reduce((sum, room) => sum + getChildCount(slot, room.id), 0);
  }

  /** Count staff physically on the floor - in a room - at this slot.
   *  Excludes anyone in Additional Duties, unassigned floats, or off-floor.
   *  Includes active visitors (e.g. AD passing through).
   *  Manual override (staffAvailableOverride) still takes priority if set. */
  function getStaffOnFloor(slot: string): number {
    const empIds = new Set<number>();
    for (const room of rooms) {
      getStaffForRoom(slot, room).forEach(s => empIds.add(s.employeeId));
    }
    // Add active visitors across all rooms at this slot
    let visitorCount = 0;
    for (const room of rooms) {
      visitorCount += countActiveVisitors(slot, room.id);
    }
    return empIds.size + visitorCount;
  }

  function getStaffAvailable(slot: string): number {
    return sessionData.staffAvailableOverride[slot] ?? getStaffOnFloor(slot);
  }

  /** Determine the effective room for a staff member at a given slot */
  function getEffectiveRoom(empId: number, slot: string, naturalRoomId: string): string {
    const slotMove = sessionData.staffMoves[`${empId}:${slot}`];
    if (slotMove !== undefined) {
      if (slotMove === '__removed__') return '__removed__';
      return slotMove;
    }
    // Fall back to day-level allocation from Plan view if no per-slot override
    const dayMove = dayAllocations[empId];
    if (dayMove) return dayMove;
    return naturalRoomId;
  }

  /** Staff for a specific room at a slot - dedup ensures no-one appears in multiple places */
  function getStaffForRoom(slot: string, room: Room): RosteredStaff[] {
    const available = staffAtSlotMap[slot] ?? [];
    const offFloor = offFloorBySlot[slot] ?? new Set<number>();
    const floatCovers = (floatCoveringRoomBySlot[slot] ?? {})[room.id] ?? [];
    // Exclude anyone manually placed in an activity column or float pool
    const inActivity = new Set<number>(
      available.filter(s => {
        const mv = sessionData.staffMoves[`${s.employeeId}:${slot}`];
        return mv === '__programming__' || mv === '__lunch__' || mv === '__cleaning__' || mv === '__additional__';
      }).map(s => s.employeeId)
    );
    const rosterInRoom = available.filter(s => {
      if (offFloor.has(s.employeeId)) return false;
      if (inActivity.has(s.employeeId)) return false;
      const naturalRoom = rooms.find(rm => rm.deputyUnitId === s.unitId);
      const effective = getEffectiveRoom(s.employeeId, slot, naturalRoom?.id ?? '');
      return effective === room.id;
    });
    const floatStaffInRoom = available.filter(s =>
      floatCovers.includes(s.employeeId) &&
      !offFloor.has(s.employeeId) &&
      !inActivity.has(s.employeeId) &&
      !rosterInRoom.some(r => r.employeeId === s.employeeId)
    );
    return [...rosterInRoom, ...floatStaffInRoom];
  }

  /** Staff on shift at a slot not currently assigned to any room (excludes Additional Duties) */
  function getUnassignedStaffAtSlot(slot: string): RosteredStaff[] {
    const available = staffAtSlotMap[slot] ?? [];
    const roomUnitIds = new Set(rooms.map(r => r.deputyUnitId));
    const roomIds = new Set(rooms.map(r => r.id));
    return available.filter(r => {
      const moveKey = `${r.employeeId}:${slot}`;
      const move = sessionData.staffMoves[moveKey];
      if (move !== undefined) {
        return !roomIds.has(move) && move !== '__additional__';
      }
      return !roomUnitIds.has(r.unitId);
    });
  }

  /** All off-floor staff at a slot: unassigned to any room OR explicitly moved to Additional Duties.
   *  Excludes staff in programming/lunch/cleaning columns AND floats actively covering a room from the schedule. */
  function getAdditionalDutiesStaff(slot: string): RosteredStaff[] {
    const available = staffAtSlotMap[slot] ?? [];
    const roomUnitIds = new Set(rooms.map(r => r.deputyUnitId));
    const roomIds = new Set(rooms.map(r => r.id));
    const activityMoves = new Set(['__programming__', '__lunch__', '__cleaning__']);
    // Floats covering a room from the schedule should not appear in Additional Duties
    const floatCovers = floatCoveringRoomBySlot[slot] ?? {};
    const floatsCoveringRoom = new Set(Object.values(floatCovers).flat());
    return available.filter(r => {
      // Exclude floats actively covering a room via their scheduled plan
      if (floatsCoveringRoom.has(r.employeeId)) return false;
      const moveKey = `${r.employeeId}:${slot}`;
      const move = sessionData.staffMoves[moveKey];
      if (move !== undefined) return !roomIds.has(move) && !activityMoves.has(move);
      // Native float unit staff belong in float pool, not additional duties
      const centreConfig2 = CENTRES.find(c => c.id === centreId);
      const floatUnitIds2 = new Set(centreConfig2?.floatUnitIds ?? []);
      if (floatUnitIds2.has(r.unitId)) return false;
      return !roomUnitIds.has(r.unitId);
    });
  }

  /** Staff manually assigned to an activity at a slot via drag */
  function getManualActivityStaff(slot: string, activity: '__programming__' | '__lunch__' | '__cleaning__'): RosteredStaff[] {
    return (staffAtSlotMap[slot] ?? []).filter(r =>
      sessionData.staffMoves[`${r.employeeId}:${slot}`] === activity
    );
  }

  // -- Mutation helpers -------------------------------------------------------

  function updateCell(slot: string, roomId: string, patch: Partial<{ children: number }>) {
    setSessionData(prev => {
      const key = cellKey(slot, roomId);
      const existing = prev.cells[key] ?? { children: autoChildCounts[key] ?? 0 };
      const next = { ...prev, cells: { ...prev.cells, [key]: { ...existing, ...patch } } };
      scheduleAutoSave(next);
      return next;
    });
  }

  function updateStaffAvailable(slot: string, value: number | null) {
    setSessionData(prev => {
      const next: RatioCheckSession = { ...prev, staffAvailableOverride: { ...prev.staffAvailableOverride } };
      if (value === null) {
        delete next.staffAvailableOverride[slot];
      } else {
        next.staffAvailableOverride[slot] = value;
      }
      scheduleAutoSave(next);
      return next;
    });
  }


  // -- Family Grouping helpers ------------------------------------------------

  /** Write FG changes to ALL three sessions so groupings persist across morning/midday/afternoon */
  function syncFGToAllSessions(updater: (fgs: FamilyGroupingConfig[]) => FamilyGroupingConfig[]) {
    hasUserEdited.current = true;
    // Compute new FG lists outside setState updaters to avoid calling async save()
    // inside a React state updater (unreliable — updaters may run multiple times).
    let nextMorning:   RatioCheckSession | null = null;
    let nextMidday:    RatioCheckSession | null = null;
    let nextAfternoon: RatioCheckSession | null = null;
    setMorningData(prev =>   { nextMorning   = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; return nextMorning; });
    setMiddayData(prev =>    { nextMidday    = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; return nextMidday; });
    setAfternoonData(prev => { nextAfternoon = { ...prev, familyGroupings: updater(prev.familyGroupings ?? []) }; return nextAfternoon; });
    // Schedule saves after state updates are queued
    setTimeout(() => {
      if (nextMorning)   save('morning',   nextMorning);
      if (nextMidday)    save('midday',    nextMidday);
      if (nextAfternoon) save('afternoon', nextAfternoon);
    }, 0);
  }

  function addFamilyGrouping() {
    const idx = sharedFamilyGroupings.length % FG_COLOURS.length;
    const newFG: FamilyGroupingConfig = {
      id: Math.random().toString(36).slice(2, 9),
      label: `FG ${sharedFamilyGroupings.length + 1}`,
      roomIds: [],
      slots: [],
      color: FG_COLOURS[idx],
    };
    syncFGToAllSessions(fgs => [...fgs.filter(f => f.id !== newFG.id), newFG]);
    setEditingFgId(newFG.id);
  }

  function updateFG(id: string, patch: Partial<FamilyGroupingConfig>) {
    syncFGToAllSessions(fgs => fgs.map(fg => fg.id === id ? { ...fg, ...patch } : fg));
  }

  function deleteFG(id: string) {
    syncFGToAllSessions(fgs => fgs.filter(fg => fg.id !== id));
    if (editingFgId === id) setEditingFgId(null);
  }

  /** Add or remove a slot from a FG */
  function toggleSlotInFG(fgId: string, slot: string) {
    syncFGToAllSessions(fgs => {
      const fg = fgs.find(f => f.id === fgId);
      if (!fg) return fgs;
      const newSlots = fg.slots.includes(slot)
        ? fg.slots.filter(s => s !== slot)
        : [...fg.slots, slot];
      return fgs.map(f => f.id === fgId ? { ...f, slots: newSlots } : f);
    });
  }

  /** Add a new FG with just this slot in it */
  function addFamilyGroupingWithSlot(slot: string) {
    const idx = sharedFamilyGroupings.length % FG_COLOURS.length;
    const newFG: FamilyGroupingConfig = {
      id: Math.random().toString(36).slice(2, 9),
      label: `FG ${sharedFamilyGroupings.length + 1}`,
      roomIds: [],
      slots: [slot],
      color: FG_COLOURS[idx],
    };
    syncFGToAllSessions(fgs => [...fgs.filter(f => f.id !== newFG.id), newFG]);
    setFgPopoverSlot(null);
    setFgPanelOpen(true);
    setEditingFgId(newFG.id);
  }

  /** Set FG slots from a From/To range (replaces slots for that FG) */
  function setFGSlotRange(fgId: string, fromSlot: string, toSlot: string) {
    const startMins = slotToMins(fromSlot);
    const endMins = slotToMins(toSlot);
    const rangeSlots = slots.filter(s => {
      const m = slotToMins(s);
      return m >= startMins && m <= endMins;
    });
    updateFG(fgId, { slots: rangeSlots });
  }

  function moveStaff(empId: number, slot: string, targetRoomId: string) {
    setSessionData(prev => {
      const newMoves = { ...prev.staffMoves, [`${empId}:${slot}`]: targetRoomId };

      // Propagate to subsequent slots in this session where staff is present and no override exists
      const slotIdx = slots.indexOf(slot);
      if (slotIdx !== -1) {
        for (let i = slotIdx + 1; i < slots.length; i++) {
          const futureSlot = slots[i];
          const futureKey = `${empId}:${futureSlot}`;
          const staffPresent = (staffAtSlotMap[futureSlot] ?? []).some(s => s.employeeId === empId);
          if (staffPresent && newMoves[futureKey] === undefined) {
            newMoves[futureKey] = targetRoomId;
          }
        }
      }

      const next = { ...prev, staffMoves: newMoves };
      scheduleAutoSave(next);
      return next;
    });
  }

  function resetStaffMove(empId: number, slot: string) {
    setSessionData(prev => {
      const key = `${empId}:${slot}`;
      const moves = { ...prev.staffMoves };
      delete moves[key];
      const next = { ...prev, staffMoves: moves };
      scheduleAutoSave(next);
      return next;
    });
  }

  // Touch tap-to-select / tap-to-place helpers (iPad)
  function handleChipTap(empId: number, slot: string, source: string) {
    if (touchSelected?.empId === empId && touchSelected?.slot === slot) {
      setTouchSelected(null); // deselect
    } else {
      setTouchSelected({ empId, slot, source });
    }
  }

  function handleZoneTap(targetId: string, _slot?: string) {
    if (!touchSelected) return;
    moveStaff(touchSelected.empId, touchSelected.slot, targetId);
    setTouchSelected(null);
  }

  /** Get effective times for a staff member: shared override if set, else natural roster times */
  function getStaffTime(s: RosteredStaff): { start: string; end: string; lunchStart?: string; lunchEnd?: string; source?: string } {
    const override = sharedTimeOverrides[String(s.employeeId)];
    // Planned lunch from LunchBreakPanel (room staff) — fallback when Deputy hasn't recorded actual yet
    const lunchEntry = lunchScheds.find(e => e.employeeId === s.employeeId);
    // Planned lunch from FloatSchedulePanel (float staff own-lunch block)
    const fsRow = floatScheds.find(f => f.employee_id === s.employeeId);
    const ownLunch = fsRow?.schedule?.find((b: any) => b.coverType === 'own-lunch');
    // Planned lunch: prefer LunchBreakPanel, fall back to FloatSchedule own-lunch
    const plannedLunchStart = lunchEntry?.lunchStart ?? ownLunch?.startTime ?? undefined;
    const plannedLunchEnd   = lunchEntry?.lunchEnd   ?? ownLunch?.endTime   ?? undefined;
    if (override) {
      // Deputy actual lunch takes priority; fall back to planned if Deputy hasn't recorded it yet
      return {
        ...override,
        lunchStart: override.lunchStart ?? plannedLunchStart,
        lunchEnd:   override.lunchEnd   ?? plannedLunchEnd,
      };
    }
    // No Deputy override — use roster times + planned lunch
    return {
      start: formatRosterTime(s.startTime),
      end: formatRosterTime(s.endTime),
      lunchStart: plannedLunchStart,
      lunchEnd:   plannedLunchEnd,
    };
  }

  /** Write time override to ALL three sessions so it persists across morning/midday/afternoon.
   *  source='manual' prevents Deputy polling from overwriting it. */
  function updateStaffTimeOverride(empId: number, start: string, end: string, lunchStart?: string, lunchEnd?: string, isOvertime?: boolean, comment?: string) {
    const key = String(empId);
    const applyOverride = (prev: RatioCheckSession): RatioCheckSession => ({
      ...prev,
      staffTimeOverrides: {
        ...prev.staffTimeOverrides,
        [key]: { start, end, lunchStart, lunchEnd, source: 'manual' as const, isOvertime, comment },
      },
    });
    setMorningData(prev => { const next = applyOverride(prev); save('morning', next); return next; });
    setMiddayData(prev =>  { const next = applyOverride(prev);  save('midday',  next); return next; });
    setAfternoonData(prev =>{ const next = applyOverride(prev); save('afternoon',next); return next; });
  }

  /** Clear time override from ALL three sessions */
  function clearStaffTimeOverride(empId: number) {
    const key = String(empId);
    const removeOverride = (prev: RatioCheckSession): RatioCheckSession => {
      const overrides = { ...prev.staffTimeOverrides };
      delete overrides[key];
      return { ...prev, staffTimeOverrides: overrides };
    };
    setMorningData(prev => { const next = removeOverride(prev); save('morning', next); return next; });
    setMiddayData(prev =>  { const next = removeOverride(prev);  save('midday',  next); return next; });
    setAfternoonData(prev =>{ const next = removeOverride(prev); save('afternoon',next); return next; });
  }

  // -- Visitor log helpers --------------------------------------------------

  function getVisitorKey(slot: string, roomId: string) { return `${slot}:${roomId}`; }

  function getVisitorsForSlotRoom(slot: string, roomId: string): RoomVisitor[] {
    return sessionData.roomVisitors?.[getVisitorKey(slot, roomId)] ?? [];
  }

  /** Count visitors currently present at a slot in a room (entered = slotMins, not yet exited or exit > slotMins) */
  function countActiveVisitors(slot: string, roomId: string): number {
    const slotMins = slotToMins(slot);
    return getVisitorsForSlotRoom(slot, roomId).filter(v => {
      const entered = slotToMins(v.enteredAt);
      if (entered > slotMins) return false;
      if (v.exitedAt) {
        const exited = slotToMins(v.exitedAt);
        return exited > slotMins;
      }
      return true; // still present
    }).length;
  }

  function addVisitor(slot: string, roomId: string, name: string, enteredAt: string, exitedAt?: string) {
    const key = getVisitorKey(slot, roomId);
    const newVisitor: RoomVisitor = {
      id: Math.random().toString(36).slice(2, 9),
      name: name.trim(),
      enteredAt,
      exitedAt,
    };
    setSessionData(prev => {
      const existing = prev.roomVisitors?.[key] ?? [];
      const next: RatioCheckSession = {
        ...prev,
        roomVisitors: { ...(prev.roomVisitors ?? {}), [key]: [...existing, newVisitor] },
      };
      scheduleAutoSave(next);
      return next;
    });
  }

  function setVisitorExit(slot: string, roomId: string, visitorId: string, exitedAt: string) {
    const key = getVisitorKey(slot, roomId);
    setSessionData(prev => {
      const existing = prev.roomVisitors?.[key] ?? [];
      const next: RatioCheckSession = {
        ...prev,
        roomVisitors: {
          ...(prev.roomVisitors ?? {}),
          [key]: existing.map(v => v.id === visitorId ? { ...v, exitedAt } : v),
        },
      };
      scheduleAutoSave(next);
      return next;
    });
  }

  function removeVisitor(slot: string, roomId: string, visitorId: string) {
    const key = getVisitorKey(slot, roomId);
    setSessionData(prev => {
      const existing = prev.roomVisitors?.[key] ?? [];
      const next: RatioCheckSession = {
        ...prev,
        roomVisitors: {
          ...(prev.roomVisitors ?? {}),
          [key]: existing.filter(v => v.id !== visitorId),
        },
      };
      scheduleAutoSave(next);
      return next;
    });
  }

  /** Open visitor modal pre-filled with actual current wall-clock time */
  function openVisitorModal(slot: string, roomId: string, roomName: string) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nowTime = `${hh}:${mm}`;
    setVisitorModal({ slot, roomId, roomName });
    setVisitorName('');
    setVisitorTime(nowTime); // prefill with actual current time
    setVisitorExitTime('');
  }

  /** Open visitor exit modal for a specific visitor */
  function openVisitorExitModal(slot: string, roomId: string, roomName: string, visitorId: string, visitorNameStr: string) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nowTime = `${hh}:${mm}`;
    setVisitorExitModalState({ slot, roomId, roomName, visitorId, visitorName: visitorNameStr, exitTime: nowTime });
  }

  /** Confirm adding a visitor from the modal */
  function confirmAddVisitor() {
    if (!visitorModal || !visitorName.trim()) return;
    addVisitor(visitorModal.slot, visitorModal.roomId, visitorName, visitorTime || visitorModal.slot, visitorExitTime || undefined);
    setVisitorModal(null);
  }

  const pendingSave = useRef<{ session: 'morning' | 'midday' | 'afternoon'; data: RatioCheckSession } | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: never auto-save until the user has actually made a change.
  // This prevents load/reset cycles (e.g. on date change or deploy) from
  // overwriting saved data with empty state.
  const hasUserEdited = useRef(false);

  function scheduleAutoSave(data: RatioCheckSession) {
    hasUserEdited.current = true; // mark that user has made at least one edit
    pendingSave.current = { session: activeSession, data };
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (pendingSave.current && hasUserEdited.current) {
        save(pendingSave.current.session, pendingSave.current.data);
        pendingSave.current = null;
      }
    }, 1500);
  }

  // -- Print ------------------------------------------------------------------
  function handlePrint() { window.print(); }

  // ISS unit IDs for badge display on chips
  const issUnitIdsSet = useMemo(() => new Set(CENTRES.find(c => c.id === centreId)?.issUnitIds ?? []), [centreId]);

  // -- Styles ----------------------------------------------------------------
  const TGA_GREEN = '#2d5c18';
  const TGA_BG    = '#F5FAF3';

  const inputStyle: React.CSSProperties = {
    width: '100%',
    border: 'none',
    background: 'transparent',
    fontSize: '11px',
    textAlign: 'center',
    outline: 'none',
    padding: '1px',
  };

  const thStyle: React.CSSProperties = {
    backgroundColor: TGA_GREEN,
    color: 'white',
    padding: '2px 3px',
    fontSize: '9px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    border: '1px solid #1a3a0a',
    textAlign: 'center',
  };

  const tdBase: React.CSSProperties = {
    border: '1px solid #d0d8cc',
    padding: '1px 2px',
    fontSize: '10px',
    verticalAlign: 'middle',
    minWidth: '32px',
    lineHeight: '1.1',
  };

  // -- FG label display helper ------------------------------------------------
  function fgSlotRange(fg: FamilyGroupingConfig): string {
    if (fg.slots.length === 0) return 'No slots';
    const sorted = [...fg.slots].sort();
    if (sorted.length === 1) return sorted[0];
    return `${sorted[0]} — ${sorted[sorted.length - 1]}`;
  }

  const totalFGSlots = sharedFamilyGroupings.reduce((sum, fg) => sum + fg.slots.length, 0);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* -- Print styles -- */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 10px; }
          table { page-break-inside: avoid; }
        }
      `}</style>

      {/* -- Header bar -- */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {/* Session tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {([
            { key: 'morning'   as const, label: 'Morning',   sub: '7am - 10am' },
            { key: 'midday'    as const, label: 'Midday',    sub: '10am - 2pm'  },
            { key: 'afternoon' as const, label: 'Afternoon', sub: '2pm - 6pm' },
          ]).map(({ key: s, label, sub }) => (
            <button key={s} onClick={() => setActiveSession(s)}
              style={{ padding: '6px 14px', borderRadius: '8px', fontWeight: 600, fontSize: '12px', minHeight: '36px', border: 'none', cursor: 'pointer',
                backgroundColor: activeSession === s ? TGA_GREEN : 'white',
                color: activeSession === s ? 'white' : TGA_GREEN,
                boxShadow: activeSession === s ? 'none' : '0 0 0 1px #c0d0c0',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
              }}
            >
              <span>{label}</span>
              <span style={{ fontSize: '9px', fontWeight: 400, opacity: 0.75 }}>{sub}</span>
            </button>
          ))}
        </div>



        {/* Save status */}
        <span style={{ fontSize: '12px', color: saveStatus === 'saved' ? '#16a34a' : saveStatus === 'error' ? '#dc2626' : saveStatus === 'saving' ? '#d97706' : '#9ca3af' }}>
          {saveStatus === 'saving' && 'Saving...'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Save error'}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Live attendance refresh */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
            <button
              onClick={refreshLiveAttendance}
              disabled={attendanceRefreshing}
              style={{
                padding: '6px 12px', borderRadius: '8px', fontWeight: 600, fontSize: '11px',
                backgroundColor: attendanceRefreshing ? '#f3f4f6' : 'white',
                color: attendanceRefreshing ? '#9ca3af' : '#0369a1',
                border: '1px solid #bae6fd', cursor: attendanceRefreshing ? 'default' : 'pointer',
              }}
            >
              {attendanceRefreshing ? '⏳ Refreshing...' : '🔄 Refresh Attendance'}
            </button>
            {lastAttendanceRefresh && (
              <span style={{ fontSize: '9px', color: '#9ca3af' }}>
                Updated {lastAttendanceRefresh.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            )}
          </div>

          {/* Family Groupings panel toggle */}
          <button
            onClick={() => setFgPanelOpen(v => !v)}
            style={{
              padding: '8px 14px', borderRadius: '10px', fontWeight: 600, fontSize: '12px',
              backgroundColor: fgPanelOpen ? '#7c3aed' : 'white',
              color: fgPanelOpen ? 'white' : '#7c3aed',
              border: '1px solid #7c3aed', cursor: 'pointer',
            }}
          >
            🏠 Family Groupings
            {totalFGSlots > 0 && (
              <span style={{ marginLeft: '6px', background: fgPanelOpen ? 'rgba(255,255,255,0.3)' : '#ede9fe', borderRadius: '10px', padding: '0 6px', fontSize: '10px' }}>
                {sharedFamilyGroupings.length}
              </span>
            )}
          </button>

          <button
            onClick={() => save(activeSession, sessionData)}
            style={{
              padding: '8px 16px', borderRadius: '10px', fontWeight: 600, fontSize: '13px',
              backgroundColor: TGA_GREEN, color: 'white', border: 'none', cursor: 'pointer',
            }}
          >
            💾 Save
          </button>
          <button
            onClick={handlePrint}
            style={{
              padding: '8px 16px', borderRadius: '10px', fontWeight: 600, fontSize: '13px',
              backgroundColor: 'white', color: TGA_GREEN, border: '1px solid #c0d0c0', cursor: 'pointer',
            }}
          >
            ?🖨️ Print
          </button>
        </div>
      </div>

      {/* -- Family Groupings Management Panel -- */}
      {fgPanelOpen && (
        <div className="no-print" style={{
          background: '#faf5ff',
          border: '1px solid #c4b5fd',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '13px', color: '#6d28d9' }}>🏠 Family Groupings</span>
            <span style={{ fontSize: '11px', color: '#8b5cf6' }}>
              {sharedFamilyGroupings.length === 0
                ? 'No groupings yet. Add one below.'
                : `${sharedFamilyGroupings.length} grouping(s) configured.`}
            </span>
            <button
              onClick={addFamilyGrouping}
              style={{
                marginLeft: 'auto', padding: '5px 14px', borderRadius: '8px', fontWeight: 600,
                fontSize: '12px', backgroundColor: '#7c3aed', color: 'white', border: 'none', cursor: 'pointer',
              }}
            >
              + Add Grouping
            </button>
          </div>

          {/* FG list */}
          {sharedFamilyGroupings.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', padding: '16px 0' }}>
              No family groupings configured. Click "+ Add Grouping" to create one.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sharedFamilyGroupings.map(fg => {
              const isEditing = editingFgId === fg.id;
              const fgRooms = getFGRoomsForConfig(fg);
              const sortedSlots = [...fg.slots].sort();
              const fromSlot = sortedSlots[0] ?? '';
              const toSlot = sortedSlots[sortedSlots.length - 1] ?? '';

              return (
                <div key={fg.id} style={{
                  border: `2px solid ${fg.color}`,
                  borderRadius: '8px',
                  background: hexToRgba(fg.color, 0.06),
                  overflow: 'hidden',
                }}>
                  {/* FG summary row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', flexWrap: 'wrap' }}>
                    {/* Coloured label */}
                    <span style={{
                      fontWeight: 700, fontSize: '12px', color: fg.color,
                      display: 'flex', alignItems: 'center', gap: '4px',
                    }}>
                      <span style={{
                        display: 'inline-block', width: '10px', height: '10px',
                        borderRadius: '50%', backgroundColor: fg.color, flexShrink: 0,
                      }}></span>
                      {fg.label}
                    </span>

                    {/* Room chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                      {fg.roomIds.length === 0
                        ? <span style={{ fontSize: '10px', backgroundColor: hexToRgba(fg.color, 0.15), color: fg.color, borderRadius: '4px', padding: '1px 6px', fontWeight: 600 }}>All rooms</span>
                        : fgRooms.map(r => (
                          <span key={r.id} style={{ fontSize: '10px', backgroundColor: hexToRgba(fg.color, 0.15), color: fg.color, borderRadius: '4px', padding: '1px 6px' }}>
                            {r.name}
                          </span>
                        ))
                      }
                    </div>

                    {/* Time range */}
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>
                      {fg.slots.length > 0 ? fgSlotRange(fg) : <em>No slots</em>}
                    </span>

                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setEditingFgId(isEditing ? null : fg.id)}
                        style={{
                          padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                          backgroundColor: isEditing ? fg.color : 'white',
                          color: isEditing ? 'white' : fg.color,
                          border: `1px solid ${fg.color}`, cursor: 'pointer',
                        }}
                      >
                        {isEditing ? 'Done' : 'Edit'}
                      </button>
                      <button
                        onClick={() => deleteFG(fg.id)}
                        style={{
                          padding: '3px 8px', borderRadius: '6px', fontSize: '11px',
                          backgroundColor: '#fee2e2', color: '#dc2626',
                          border: '1px solid #fca5a5', cursor: 'pointer', fontWeight: 700,
                        }}
                      >
                        -
                      </button>
                    </div>
                  </div>

                  {/* Inline editor */}
                  {isEditing && (
                    <div style={{
                      borderTop: `1px solid ${hexToRgba(fg.color, 0.3)}`,
                      background: hexToRgba(fg.color, 0.04),
                      padding: '10px 12px',
                      display: 'flex', flexDirection: 'column', gap: '10px',
                    }}>
                      {/* Label */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151', minWidth: '50px' }}>Label</span>
                        <input
                          type="text"
                          value={fg.label}
                          onChange={e => updateFG(fg.id, { label: e.target.value })}
                          style={{
                            border: `1px solid ${hexToRgba(fg.color, 0.5)}`,
                            borderRadius: '6px', padding: '4px 8px', fontSize: '12px',
                            outline: 'none', width: '160px',
                          }}
                        />
                        {/* Colour selector */}
                        <span style={{ fontSize: '11px', color: '#374151', marginLeft: '8px' }}>Colour</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {FG_COLOURS.map(c => (
                            <button
                              key={c}
                              onClick={() => updateFG(fg.id, { color: c })}
                              style={{
                                width: '18px', height: '18px', borderRadius: '50%',
                                backgroundColor: c, border: fg.color === c ? '2px solid #374151' : '2px solid transparent',
                                cursor: 'pointer', padding: 0,
                              }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Rooms */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151', minWidth: '50px', paddingTop: '2px' }}>Rooms</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {rooms.map(r => {
                            const checked = fg.roomIds.length === 0 || fg.roomIds.includes(r.id);
                            return (
                              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => {
                                    const current = fg.roomIds.length === 0 ? rooms.map(rm => rm.id) : [...fg.roomIds];
                                    const next = e.target.checked
                                      ? [...new Set([...current, r.id])]
                                      : current.filter(id => id !== r.id);
                                    const allSelected = rooms.every(rm => next.includes(rm.id));
                                    updateFG(fg.id, { roomIds: allSelected ? [] : next });
                                  }}
                                />
                                {r.name}
                              </label>
                            );
                          })}
                          <button
                            onClick={() => updateFG(fg.id, { roomIds: [] })}
                            style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', border: `1px solid ${hexToRgba(fg.color, 0.5)}`, color: fg.color, backgroundColor: 'white', cursor: 'pointer' }}
                          >
                            All
                          </button>
                        </div>
                      </div>

                      {/* Held in room */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151', minWidth: '50px' }}>Held in</span>
                        <select
                          value={fg.heldInRoom ?? ''}
                          onChange={e => updateFG(fg.id, { heldInRoom: e.target.value || undefined })}
                          style={{ borderRadius: '6px', border: `1px solid ${hexToRgba(fg.color, 0.5)}`, padding: '3px 6px', fontSize: '11px', minWidth: '140px' }}
                        >
                          <option value="">- select location -</option>
                          <optgroup label="Rooms">
                            {(fg.roomIds.length === 0 ? rooms : rooms.filter(r => fg.roomIds.includes(r.id))).map(r => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Outdoor Areas">
                            {(CENTRES.find(c => c.id === centreId)?.outdoorAreas ?? ['Outdoor Area']).map(area => (
                              <option key={area} value={area}>{area}</option>
                            ))}
                          </optgroup>
                        </select>
                        {fg.heldInRoom && <span style={{ fontSize: '10px', color: '#6b7280' }}>Physical location for 151</span>}
                      </div>
                                            {/* Time range */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151', minWidth: '50px' }}>Slots</span>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>From</span>
                        <select
                          value={fromSlot}
                          onChange={e => { if (e.target.value && toSlot) setFGSlotRange(fg.id, e.target.value, toSlot); else if (e.target.value) updateFG(fg.id, { slots: [e.target.value] }); }}
                          style={{ borderRadius: '6px', border: `1px solid ${hexToRgba(fg.color, 0.5)}`, padding: '3px 6px', fontSize: '11px' }}
                        >
                          <option value="">- start -</option>
                          {slots.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>to</span>
                        <select
                          value={toSlot}
                          onChange={e => { if (e.target.value && fromSlot) setFGSlotRange(fg.id, fromSlot, e.target.value); }}
                          style={{ borderRadius: '6px', border: `1px solid ${hexToRgba(fg.color, 0.5)}`, padding: '3px 6px', fontSize: '11px' }}
                        >
                          <option value="">- end -</option>
                          {slots.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {fg.slots.length > 0 && (
                          <span style={{ fontSize: '10px', color: '#8b5cf6' }}>{fg.slots.length} slot(s)</span>
                        )}
                        {fg.slots.length > 0 && (
                          <button
                            onClick={() => updateFG(fg.id, { slots: [] })}
                            style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', border: '1px solid #fca5a5', color: '#dc2626', backgroundColor: '#fee2e2', cursor: 'pointer' }}
                          >
                            Clear slots
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* -- Print header -- */}
      <div className="print-only" style={{ display: 'none', marginBottom: '8px' }}>
        <style>{`.print-only { display: block !important; }`}</style>
        <strong>Head Count / Ratio Check – {activeSession === 'morning' ? 'Morning (7am-10am)' : activeSession === 'midday' ? 'Midday (10am-2pm)' : 'Afternoon (2pm–6pm)'}</strong>
        {histDate && children.filter(ch => ch.sign_in).length === 0 && (
          <span style={{ fontSize: '10px', color: '#92400e', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '4px', padding: '1px 6px', marginLeft: '8px' }}>
            📅 Predicted attendance from {histDate}
          </span>
        )}

      </div>

      {/* -- Staff Finish Times panel -- */}
      {(() => {
        // Build sorted list of all staff finishing today
        const finishList = rosters
          .map(s => {
            const endOverride = sharedTimeOverrides[String(s.employeeId)]?.end;
            const endStr = endOverride || formatRosterTime(s.endTime);
            return { s, endStr };
          })
          .filter(({ endStr }) => !!endStr)
          .sort((a, b) => slotToMins(a.endStr) - slotToMins(b.endStr));

        if (finishList.length === 0) return null;

        return (
          <div className="no-print" style={{
            background: 'white', border: '1px solid #e5e7eb', borderRadius: '10px',
            marginBottom: '8px', overflow: 'hidden',
          }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 14px', cursor: 'pointer',
                backgroundColor: showFinishPanel ? '#f0fdf4' : 'white',
                borderBottom: showFinishPanel ? '1px solid #e5e7eb' : 'none',
              }}
              onClick={() => setShowFinishPanel(v => !v)}
            >
              <span style={{ fontWeight: 700, fontSize: '13px', color: TGA_GREEN }}>📅 Staff Finish Times</span>
              <span style={{ fontSize: '11px', color: '#6b7280' }}>{finishList.length} staff finishing today</span>
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ca3af' }}>{showFinishPanel ? '?' : '?'}</span>
            </div>
            {showFinishPanel && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    <th style={{ padding: '5px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: '80px' }}>Time</th>
                    <th style={{ padding: '5px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Name</th>
                    <th style={{ padding: '5px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Room at finish</th>
                    <th style={{ padding: '5px 10px', textAlign: 'center', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: '40px' }}>?</th>
                  </tr>
                </thead>
                <tbody>
                  {finishList.map(({ s, endStr }) => {
                    const done = markedFinished.has(s.employeeId);
                    // Find the last slot where this staff member appears in any room
                    let lastRoomName = '—';
                    const allSlotsAll = [...MORNING_SLOTS, ...MIDDAY_SLOTS, ...AFTERNOON_SLOTS];
                    for (let i = allSlotsAll.length - 1; i >= 0; i--) {
                      const sl = allSlotsAll[i];
                      for (const room of rooms) {
                        if (getStaffForRoom(sl, room).some(x => x.employeeId === s.employeeId)) {
                          lastRoomName = room.name;
                          break;
                        }
                      }
                      if (lastRoomName !== '—') break;
                    }
                    return (
                      <tr key={s.employeeId} style={{ backgroundColor: done ? '#f3f4f6' : 'white', borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '5px 10px', color: done ? '#9ca3af' : '#374151', textDecoration: done ? 'line-through' : 'none', fontWeight: 600 }}>
                          {to12h(endStr)}
                        </td>
                        <td style={{ padding: '5px 10px', color: done ? '#9ca3af' : '#374151', textDecoration: done ? 'line-through' : 'none' }}>
                          {s.employeeName}
                        </td>
                        <td style={{ padding: '5px 10px', color: done ? '#9ca3af' : '#6b7280', textDecoration: done ? 'line-through' : 'none', fontSize: '11px' }}>
                          {lastRoomName}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={done}
                            onChange={e => {
                              setMarkedFinished(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(s.employeeId); else next.delete(s.employeeId);
                                return next;
                              });
                            }}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* -- Touch selection banner -- */}
      {touchSelected && (() => {
        const s = (staffAtSlotMap[touchSelected.slot] ?? []).find(x => x.employeeId === touchSelected.empId);
        return (
          <div className="no-print" style={{
            display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
            backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '10px',
            marginBottom: '8px', fontSize: '13px',
          }}>
            <span>📌 Moving <strong>{s?.employeeName ?? 'staff member'}</strong> - tap a room or zone to place</span>
            <button onClick={() => setTouchSelected(null)} style={{
              marginLeft: 'auto', border: '1px solid #fcd34d', background: 'white',
              borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px',
            }}>Cancel</button>
          </div>
        );
      })()}

      {/* -- Main grid -- */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', cursor: touchSelected ? 'crosshair' : 'default' }} onClick={() => { if (fgPopoverSlot) setFgPopoverSlot(null); if (touchSelected) setTouchSelected(null); }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, minWidth: '44px', position: 'sticky', left: 0, zIndex: 3 }}>Time</th>
              {rooms.map(room => (
                <th key={room.id} colSpan={3} style={{ ...thStyle, minWidth: '90px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    <span>{room.name}</span>
                    <button
                      className="no-print"
                      onClick={e => { e.stopPropagation(); openVisitorModal(slots[0] ?? '07:00', room.id, room.name); }}
                      style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', border: '1px solid #d8b4fe', background: '#fdf4ff', cursor: 'pointer', color: '#7e22ce', fontWeight: 700, lineHeight: 1.4, flexShrink: 0 }}
                      title="Log off-floor staff entering this room"
                    >➕</button>
                  </div>
                  {/* Active visitors for this room (across all slots) */}
                  {(() => {
                    const allVisitors: Array<{ v: RoomVisitor; slot: string }> = [];
                    for (const s of slots) {
                      for (const v of getVisitorsForSlotRoom(s, room.id)) {
                        if (!v.exitedAt) allVisitors.push({ v, slot: s });
                      }
                    }
                    // Deduplicate by visitorId
                    const seen = new Set<string>();
                    const unique = allVisitors.filter(({ v }) => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
                    if (unique.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px', justifyContent: 'center' }}>
                        {unique.map(({ v, slot: entrySlot }) => (
                          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '2px', background: '#f3e8ff', border: '1px solid #d8b4fe', borderRadius: '4px', padding: '1px 4px', fontSize: '9px', color: '#7e22ce' }}>
                            <span>{v.name.split(' ')[0]} ({v.enteredAt})</span>
                            <button
                              className="no-print"
                              onClick={e => { e.stopPropagation(); openVisitorExitModal(entrySlot, room.id, room.name, v.id, v.name); }}
                              style={{ fontSize: '8px', padding: '0px 3px', borderRadius: '3px', border: '1px solid #d8b4fe', background: '#fdf4ff', color: '#7e22ce', cursor: 'pointer', fontWeight: 600, lineHeight: 1.4 }}
                            >Exit</button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </th>
              ))}
              {/* Totals header */}
              <th style={{ ...thStyle, minWidth: '44px', backgroundColor: '#1a4a0a' }}>Tot<br/>Ch.</th>
              <th style={{ ...thStyle, minWidth: '40px', backgroundColor: '#1a4a0a' }}>Req'd</th>
              <th style={{ ...thStyle, minWidth: '44px' }}>Avail</th>
              <th style={{ ...thStyle, minWidth: '38px' }}>Spare</th>
              <th style={{ ...thStyle, minWidth: '110px', width: '110px', backgroundColor: '#92400e' }}>Additional / Off Floor</th>
              <th style={{ ...thStyle, minWidth: '90px', width: '90px', backgroundColor: '#1e40af' }}>📚 Programming</th>
              <th style={{ ...thStyle, minWidth: '90px', width: '90px', backgroundColor: '#0f766e' }}>🍽 Lunch</th>
              <th style={{ ...thStyle, minWidth: '90px', width: '90px', backgroundColor: '#7e22ce' }}>🧹 Clean</th>

            </tr>
            <tr>
              <th style={{ ...thStyle, backgroundColor: '#3d7822', fontSize: '9px', position: 'sticky', left: 0, zIndex: 3 }}></th>
              {rooms.map(room => (
                <>
                  <th key={`${room.id}-c`} style={{ ...thStyle, backgroundColor: '#3d7822', fontSize: '9px' }}>Children</th>
                  <th key={`${room.id}-r`} style={{ ...thStyle, backgroundColor: '#3d7822', fontSize: '9px' }}>Req'd</th>
                  <th key={`${room.id}-i`} style={{ ...thStyle, backgroundColor: '#3d7822', fontSize: '9px' }}>Staff</th>
                </>
              ))}
              <th style={{ ...thStyle, backgroundColor: '#1a4a0a', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#1a4a0a', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#3d7822', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#3d7822', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#3d7822', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#92400e', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#1e40af', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#0f766e', fontSize: '9px' }}></th>
              <th style={{ ...thStyle, backgroundColor: '#7e22ce', fontSize: '9px' }}></th>

            </tr>
          </thead>
          <tbody>
            {slots.map((slot, i) => {
              const activeFGs = getFGsAtSlot(slot);
              const hasFG = activeFGs.length > 0;
              const staffAvail = getStaffAvailable(slot);
              const totalChildren = getTotalChildren(slot);
              const totalRequired = getTotalRequired(slot);
              const spare = staffAvail - totalRequired;
              const rowBg = i % 2 === 0 ? 'white' : '#fafff8';

              const spareStyle: React.CSSProperties = {
                ...tdBase,
                backgroundColor: spare < 0 ? '#fee2e2' : spare > 0 ? '#dcfce7' : 'white',
                fontWeight: 700,
                color: spare < 0 ? '#dc2626' : spare > 0 ? '#166534' : 'inherit',
                textAlign: 'center',
              };

              // Determine time cell background (use first FG's colour if any, else TGA green)
              const timeCellBg = hasFG ? hexToRgba(activeFGs[0].color, 0.12) : TGA_BG;
              const timeCellColor = hasFG ? activeFGs[0].color : TGA_GREEN;

              return (
                <tr key={slot}>
                  {/* -- Time cell + FG badge(s) -- */}
                  <td style={{
                    ...tdBase,
                    backgroundColor: timeCellBg || 'white',
                    fontWeight: 700,
                    textAlign: 'center',
                    color: timeCellColor,
                    whiteSpace: 'nowrap',
                    padding: '3px 4px',
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <span>{to12h(slot)}</span>

                      {/* FG badges for active FGs */}
                      {activeFGs.length > 0 && (
                        <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          {activeFGs.map(fg => (
                            <button
                              key={fg.id}
                              onClick={e => { e.stopPropagation(); setFgPopoverSlot(fgPopoverSlot === slot ? null : slot); }}
                              className="no-print"
                              style={{
                                fontSize: '8px', padding: '1px 4px', borderRadius: '4px',
                                border: `1px solid ${fg.color}`,
                                cursor: 'pointer',
                                backgroundColor: fg.color,
                                color: 'white',
                                fontWeight: 700, lineHeight: 1.3,
                              }}
                            >
                              {fg.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Add FG badge when none active */}
                      {activeFGs.length === 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); setFgPopoverSlot(fgPopoverSlot === slot ? null : slot); }}
                          className="no-print"
                          title="Add this slot to a Family Grouping"
                          style={{
                            fontSize: '8px', padding: '1px 5px', borderRadius: '4px',
                            border: '1px solid #d1d5db',
                            cursor: 'pointer',
                            backgroundColor: '#f3f4f6',
                            color: '#6b7280',
                            fontWeight: 700, lineHeight: 1.3,
                          }}
                        >
                          FG
                        </button>
                      )}
                    </div>

                    {/* FG popover */}
                    {fgPopoverSlot === slot && (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: 'absolute', top: '100%', left: 0, zIndex: 100,
                          background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '8px',
                          minWidth: '160px', fontSize: '11px',
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#374151', marginBottom: '6px', fontSize: '10px' }}>
                          Add/remove slot from grouping:
                        </div>
                        {sharedFamilyGroupings.length === 0 && (
                          <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '4px' }}>
                            No groupings yet.
                          </div>
                        )}
                        {sharedFamilyGroupings.map(fg => {
                          const hasSlot = fg.slots.includes(slot);
                          return (
                            <button
                              key={fg.id}
                              onClick={() => { toggleSlotInFG(fg.id, slot); setFgPopoverSlot(null); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                width: '100%', padding: '4px 6px', borderRadius: '6px',
                                border: 'none', cursor: 'pointer', textAlign: 'left',
                                backgroundColor: hasSlot ? hexToRgba(fg.color, 0.12) : 'transparent',
                                color: fg.color, fontSize: '11px', fontWeight: hasSlot ? 700 : 400,
                                marginBottom: '2px',
                              }}
                            >
                              <span style={{
                                display: 'inline-block', width: '8px', height: '8px',
                                borderRadius: '50%', backgroundColor: fg.color, flexShrink: 0,
                              }}></span>
                              {fg.label}
                              {hasSlot && <span style={{ marginLeft: 'auto', fontSize: '10px' }}>✓</span>}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => addFamilyGroupingWithSlot(slot)}
                          style={{
                            display: 'block', width: '100%', padding: '4px 6px',
                            borderRadius: '6px', border: '1px dashed #d1d5db',
                            cursor: 'pointer', textAlign: 'left',
                            backgroundColor: 'transparent', color: '#6b7280',
                            fontSize: '10px', marginTop: '4px',
                          }}
                        >
                          + New grouping
                        </button>
                      </div>
                    )}
                  </td>

                  {/* -- Per-room cells -- */}
                  {(() => {
                    const renderedFGIds = new Set<string>();

                    return rooms.map(room => {
                      const fg = getFGForRoomAtSlot(slot, room.id);

                      if (fg) {
                        // This room belongs to a FG at this slot
                        if (renderedFGIds.has(fg.id)) {
                          // Already rendered this FG - skip
                          return null;
                        }

                        // First room of this FG - render merged cell
                        renderedFGIds.add(fg.id);
                        const fgRooms = getFGRoomsForConfig(fg).filter(r => rooms.some(rm => rm.id === r.id));
                        const fgColSpan = fgRooms.length * 3;
                        const fgReq = getFGRequiredForConfig(slot, fg);
                        const fgChildren = fgRooms.reduce((sum, r) => sum + getChildCount(slot, r.id), 0);
                        const fgStaffMembers = fgRooms.flatMap(r =>
                          getStaffForRoom(slot, r).map(s => ({ ...s, inRoomId: r.id, inRoomName: r.name }))
                        );
                        const fgEditKey = `fg-${fg.id}:${slot}`;
                        const fgUnassigned = getUnassignedStaffAtSlot(slot);

                        return (
                          <td
                            key={`fg-${fg.id}-${slot}`}
                            colSpan={fgColSpan}
                            style={{
                              ...tdBase,
                              backgroundColor: hexToRgba(fg.color, 0.07),
                              border: `2px solid ${fg.color}`,
                              padding: '5px 10px',
                              position: 'relative',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, color: fg.color, whiteSpace: 'nowrap' }}>
                                🏠 {fg.label}
                              </span>
                              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                {fgRooms.map(r => {
                                  const cnt = getChildCount(slot, r.id);
                                  return (
                                    <span key={r.id} style={{ fontSize: '9px', color: '#6b7280', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                      {r.name}:
                                      <input
                                        type="number"
                                        min={0}
                                        value={cnt}
                                        onChange={e => updateCell(slot, r.id, { children: parseInt(e.target.value) || 0 })}
                                        style={{ width: '32px', fontSize: '9px', border: '1px solid #d8b4fe', borderRadius: '3px', padding: '0 2px', textAlign: 'center' }}
                                      />
                                    </span>
                                  );
                                })}
                              </div>
                              <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#6b7280' }}>Total: </span>
                                <strong style={{ color: fg.color }}>{fgChildren}</strong>
                              </span>
                              <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#6b7280' }}>Req'd: </span>
                                <strong style={{ color: fgReq > staffAvail ? '#dc2626' : fg.color }}>{fgReq}</strong>
                              </span>
                              {fgStaffMembers.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                  {fgStaffMembers.map((s, ni) => {
                                    const isAdditional = sessionData.staffMoves[`${s.employeeId}:${slot}`] === '__additional__';
                                    const hasOv = sessionData.staffMoves[`${s.employeeId}:${slot}`] !== undefined;
                                    return (
                                      <div key={`${s.employeeId}-${ni}`}
                                        draggable
                                        onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: 'fg' }; }}
                                        title={`${s.employeeName} (${s.inRoomName}) - drag to Additional Duties or a room`}
                                        style={{
                                          fontSize: '9px', cursor: 'grab',
                                          backgroundColor: isAdditional ? '#fef3c7' : '#f0fdf4',
                                          color: isAdditional ? '#92400e' : '#166534',
                                          border: `1px solid ${isAdditional ? '#fde68a' : '#bbf7d0'}`,
                                          borderRadius: '3px', padding: '1px 4px',
                                          display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                                          userSelect: 'none',
                                        }}
                                      >
                                        <span>{shortName(s.employeeName)}{hasOv && !isAdditional && ' ?'}</span>
                                        {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                                        {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                                        {sessionData.staffTimeOverrides[String(s.employeeId)]?.isOvertime && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fee2e2', color: '#dc2626', flexShrink: 0, lineHeight: '13px' }}>OT</span>}
                                        {sessionData.staffTimeOverrides[String(s.employeeId)]?.comment && <span title={sessionData.staffTimeOverrides[String(s.employeeId)]?.comment} style={{ fontSize: '9px', color: '#6366f1', cursor: 'help', flexShrink: 0, lineHeight: 1 }}>✎</span>}
                                        {isAdditional && <span style={{ fontSize: '7px', color: '#b45309' }}>duties</span>}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <button
                                className="no-print"
                                onClick={e => { e.stopPropagation(); setEditingCell(editingCell === fgEditKey ? null : fgEditKey); }}
                                style={{ marginLeft: 'auto', fontSize: '9px', padding: '1px 4px', borderRadius: '3px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer', color: '#6b7280', flexShrink: 0 }}
                              >⚙️</button>
                            </div>

                            {/* FG inline edit popover */}
                            {editingCell === fgEditKey && (
                              <>
                                <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setEditingCell(null)} />
                                <div className="no-print" onClick={e => e.stopPropagation()} style={{
                                  position: 'absolute', top: '100%', left: 0, zIndex: 100,
                                  background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '8px 10px',
                                  minWidth: '240px', fontSize: '11px',
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontWeight: 700, fontSize: '11px', color: fg.color }}>🏠 {fg.label} - {slot}</span>
                                    <button onClick={() => setEditingCell(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px', color: '#6b7280', padding: '0 2px', lineHeight: 1 }}>✕</button>
                                  </div>

                                  {fgStaffMembers.length > 0 && (
                                    <div style={{ marginBottom: '6px' }}>
                                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Current staff</div>
                                      {fgStaffMembers.map((s, ni) => {
                                        const hasOv = sessionData.staffMoves[`${s.employeeId}:${slot}`] !== undefined;
                                        return (
                                          <div key={`${s.employeeId}-${ni}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px', flexWrap: 'wrap' }}>
                                            <span style={{
                                              fontSize: '10px', padding: '2px 6px', borderRadius: '10px',
                                              backgroundColor: hasOv ? '#fef3c7' : '#dcfce7',
                                              color: hasOv ? '#92400e' : '#166534', fontWeight: 600,
                                            }}>
                                              {shortName(s.employeeName)}{hasOv && ' →'}
                                              {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                                              {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                                            </span>
                                            <span style={{ fontSize: '9px', color: '#9ca3af' }}>{s.inRoomName}</span>
                                            <button
                                              onClick={() => moveStaff(s.employeeId, slot, '__removed__')}
                                              style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', border: '1px solid #fca5a5', background: '#fee2e2', color: '#dc2626', cursor: 'pointer' }}
                                            >✕</button>
                                            <select
                                              value=""
                                              onChange={e => { if (e.target.value) moveStaff(s.employeeId, slot, e.target.value); }}
                                              style={{ fontSize: '10px', border: '1px solid #d1d5db', borderRadius: '4px', padding: '1px 3px', cursor: 'pointer' }}
                                            >
                                              <option value="">→ Move to…</option>
                                              {rooms.filter(r => r.id !== s.inRoomId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                            </select>
                                            {hasOv && (
                                              <button
                                                onClick={() => resetStaffMove(s.employeeId, slot)}
                                                style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '4px', border: '1px solid #d1d5db', background: 'white', color: '#6b7280', cursor: 'pointer' }}
                                              >✕</button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {fgUnassigned.length > 0 && (
                                    <>
                                      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '6px 0' }} />
                                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Add staff</div>
                                      {fgUnassigned.map(s => (
                                        <div key={s.employeeId} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px', flexWrap: 'wrap' }}>
                                          <span style={{ fontSize: '10px', color: '#374151', flex: 1 }}>{shortName(s.employeeName)}</span>
                                          {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                                          {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                                          <select
                                            value=""
                                            onChange={e => { if (e.target.value) moveStaff(s.employeeId, slot, e.target.value); }}
                                            style={{ fontSize: '10px', border: '1px solid #86efac', borderRadius: '4px', padding: '1px 4px', cursor: 'pointer', background: '#dcfce7', color: '#166534', fontWeight: 600 }}
                                          >
                                            <option value="">+ Add to-</option>
                                            {fgRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                          </select>
                                        </div>
                                      ))}
                                    </>
                                  )}

                                  {fgStaffMembers.length === 0 && fgUnassigned.length === 0 && (
                                    <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>No staff on shift</div>
                                  )}
                                </div>
                              </>
                            )}
                          </td>
                        );
                      }

                      // Normal room rendering (not in any FG)
                      const key = cellKey(slot, room.id);
                      const cell = sessionData.cells[key];
                      const childCount = cell?.children ?? autoChildCounts[key] ?? 0;
                      const required = getStaffRequired(slot, room);
                      const roomStaff = getStaffForRoom(slot, room);
                      // Per-room ratio check: red if room has fewer staff than required
                      const roomUnderRatio = required > 0 && roomStaff.length < required;
                      const unassignedStaff = getUnassignedStaffAtSlot(slot);
                      const editCellKey = `${room.id}:${slot}`;

                      return (
                        <>
                          {/* Children count */}
                          <td key={`${key}-c`} style={{ ...tdBase, backgroundColor: roomUnderRatio ? '#fee2e2' : rowBg, textAlign: 'center' }}>
                            <input
                              type="number"
                              min={0}
                              value={childCount}
                              onChange={e => updateCell(slot, room.id, { children: parseInt(e.target.value) || 0 })}
                              style={{ ...inputStyle, width: '36px' }}
                            />
                          </td>

                          {/* Staff required */}
                          <td key={`${key}-r`} style={{
                            ...tdBase,
                            backgroundColor: roomUnderRatio ? '#fee2e2' : rowBg,
                            textAlign: 'center',
                            fontWeight: required > 0 ? 600 : 400,
                            color: roomUnderRatio ? '#dc2626' : 'inherit',
                          }}>
                            {required > 0 ? required : ''}
                          </td>

                          {/* Staff chips in room cell + drag target */}
                          <td
                            key={`${key}-i`}
                            style={{
                              ...tdBase,
                              backgroundColor: dragOver === `${room.id}:${slot}` ? '#dbeafe' : touchSelected ? '#fff7ed' : rowBg,
                              verticalAlign: 'top', paddingTop: '3px', position: 'relative',
                              transition: 'background-color 0.1s',
                            }}
                            onDragOver={e => { e.preventDefault(); setDragOver(`${room.id}:${slot}`); }}
                            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                            onDrop={e => {
                              e.preventDefault();
                              setDragOver(null);
                              if (dragState.current) {
                                const { empId, slot: dragSlot } = dragState.current;
                                moveStaff(empId, dragSlot, room.id);
                                dragState.current = null;
                              }
                            }}
                            onClick={e => { if (touchSelected) { e.stopPropagation(); handleZoneTap(room.id, slot); } }}
                          >
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', minHeight: '20px', alignItems: 'flex-start' }}>
                              {roomStaff.map(s => {
                                const hasOverride = sessionData.staffMoves[`${s.employeeId}:${slot}`] !== undefined;
                                const hasTimeOverride = !!sessionData.staffTimeOverrides[String(s.employeeId)];
                                const staffTime = getStaffTime(s);
                                return (
                                  <div
                                    key={s.employeeId}
                                    style={{ position: 'relative', display: 'inline-block' }}
                                  >
                                    <div
                                      draggable
                                      onDragStart={() => {
                                        dragState.current = { empId: s.employeeId, slot, fromSource: room.id };
                                      }}
                                      onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, room.id); }}
                                      title={`${s.employeeName}${hasOverride ? ' (moved)' : ''} - drag or tap to move`}
                                      style={{
                                        fontSize: '11px', padding: '3px 4px 3px 6px', borderRadius: '3px',
                                        backgroundColor: hasOverride ? '#fef3c7' : '#f0fdf4',
                                        color: hasOverride ? '#92400e' : '#166534',
                                        border: `1px solid ${hasTimeOverride ? '#818cf8' : hasOverride ? '#fde68a' : '#bbf7d0'}`,
                                        cursor: 'grab',
                                        display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1px',
                                        userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none', minWidth: '64px',
                                        outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined,
                                        outlineOffset: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '1px' : undefined,
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', width: '100%' }}>
                                        <span>{shortName(s.employeeName)}{hasOverride && ' →'}</span>
                                        {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                                        {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                                        <button
                                          className="no-print"
                                          onClick={e => { e.stopPropagation(); const t = getStaffTime(s); setTimeEditorStart(t.start); setTimeEditorEnd(t.end); setTimeEditorLunchStart(t.lunchStart ?? ''); setTimeEditorLunchEnd(t.lunchEnd ?? ''); setTimeEditorOvertime(sessionData.staffTimeOverrides[s.employeeId]?.isOvertime ?? false); setTimeEditorComment(sessionData.staffTimeOverrides[s.employeeId]?.comment ?? ''); setTimeEditorModal({ empId: s.employeeId, name: s.employeeName, rosterStart: formatRosterTime(s.startTime) || '', rosterEnd: formatRosterTime(s.endTime) || '' }); }}
                                          title="Edit time"
                                          style={{
                                            border: 'none', background: 'none', cursor: 'pointer',
                                            fontSize: '10px', color: hasTimeOverride ? '#6366f1' : '#9ca3af', padding: '0 1px', lineHeight: 1,
                                            display: 'inline-flex', alignItems: 'center',
                                          }}
                                        >⏱</button>
                                        <button
                                          className="no-print"
                                          onClick={e => { e.stopPropagation(); resetStaffMove(s.employeeId, slot); }}
                                          title="Return to natural assignment"
                                          style={{
                                            border: 'none', background: 'none', cursor: 'pointer',
                                            fontSize: '9px', color: '#dc2626', padding: '0 1px', lineHeight: 1,
                                            display: 'inline-flex', alignItems: 'center', fontWeight: 700, marginLeft: 'auto',
                                          }}
                                        >✕</button>
                                      </div>
                                      {staffTime.start && (
                                        <span style={{
                                          fontSize: '9px',
                                          color: staffTime.source === 'deputy' ? '#0369a1' : hasTimeOverride ? '#6366f1' : '#6b7280',
                                          fontWeight: hasTimeOverride ? 700 : 400,
                                        }}>
                                          {staffTime.source === 'deputy' ? '● ' : ''}{to12h(staffTime.start)}–{to12h(staffTime.end)}
                                        </span>
                                      )}
                                      {staffTime.lunchStart && (
                                        <span style={{ fontSize: '9px', color: staffTime.lunchEnd ? '#0369a1' : '#d97706' }}>
                                          🍝 {to12h(staffTime.lunchStart)}{staffTime.lunchEnd ? `–${to12h(staffTime.lunchEnd)}` : '…'}
                                        </span>
                                      )}
                                    </div>

                                  </div>
                                );
                              })}
                              {roomStaff.length === 0 && getVisitorsForSlotRoom(slot, room.id).length === 0 && (
                                <span style={{ fontSize: '9px', color: '#93c5fd', fontStyle: 'italic' }}>
                                  {dragOver === `${room.id}:${slot}` ? 'Drop here' : '-'}
                                </span>
                              )}

                              {/* Visitor chips */}
                              {getVisitorsForSlotRoom(slot, room.id).map(v => {
                                const slotMins = slotToMins(slot);
                                const entered = slotToMins(v.enteredAt);
                                const exited = v.exitedAt ? slotToMins(v.exitedAt) : null;
                                const isActive = entered <= slotMins && (exited === null || exited > slotMins);
                                return (
                                  <div key={v.id} style={{
                                    fontSize: '10px', padding: '2px 5px', borderRadius: '4px',
                                    backgroundColor: isActive ? '#fdf4ff' : '#f3f4f6',
                                    color: isActive ? '#7e22ce' : '#9ca3af',
                                    border: `1px solid ${isActive ? '#d8b4fe' : '#e5e7eb'}`,
                                    display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start',
                                    minWidth: '60px', gap: '1px',
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', width: '100%' }}>
                                      <span style={{ fontSize: '9px' }}>✎</span>
                                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v.name}</span>
                                      <button
                                        className="no-print"
                                        onClick={e => { e.stopPropagation(); removeVisitor(slot, room.id, v.id); }}
                                        title="Remove visitor entry"
                                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '9px', color: '#dc2626', padding: '0 1px', lineHeight: 1, marginLeft: 'auto', fontWeight: 700 }}
                                      >✕</button>
                                    </div>
                                    <div style={{ fontSize: '8px', color: isActive ? '#9333ea' : '#9ca3af', display: 'flex', gap: '3px', alignItems: 'center' }}>
                                      <span>in {to12h(v.enteredAt)}</span>
                                      {v.exitedAt
                                        ? <span>🚪 out {to12h(v.exitedAt)}</span>
                                        : isActive && (
                                          <button
                                            className="no-print"
                                            onClick={e => { e.stopPropagation(); openVisitorExitModal(slot, room.id, room.name, v.id, v.name); }}
                                            title="Record exit time"
                                            style={{
                                              fontSize: '8px', padding: '0px 4px', borderRadius: '3px',
                                              border: '1px solid #d8b4fe', background: '#fdf4ff',
                                              color: '#7e22ce', cursor: 'pointer', fontWeight: 600,
                                            }}
                                          >Exit</button>
                                        )
                                      }
                                    </div>
                                  </div>
                                );
                              })}

                            </div>

                            {/* Simplified popover - Add staff only */}
                            {editingCell === editCellKey && (
                              <>
                                <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setEditingCell(null)} />
                                <div className="no-print" onClick={e => e.stopPropagation()} style={{
                                  position: 'absolute', top: '100%', left: 0, zIndex: 100,
                                  background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '8px 10px',
                                  minWidth: '200px', fontSize: '11px',
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontWeight: 700, fontSize: '11px', color: '#374151' }}>{room.name} - {slot}</span>
                                    <button onClick={() => setEditingCell(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px', color: '#6b7280', padding: '0 2px', lineHeight: 1 }}>✕</button>
                                  </div>

                                  {/* Add staff section only - current staff shown via drag chips */}
                                  {unassignedStaff.length > 0 ? (
                                    <>
                                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Add staff to {room.name}</div>
                                      {unassignedStaff.map(s => (
                                        <div key={s.employeeId} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                                          <span style={{ fontSize: '10px', color: '#374151', flex: 1 }}>{shortName(s.employeeName)}</span>
                                          {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                                          {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                                          <button
                                            onClick={() => { moveStaff(s.employeeId, slot, room.id); setEditingCell(null); }}
                                            style={{ fontSize: '10px', padding: '1px 8px', borderRadius: '4px', border: '1px solid #86efac', background: '#dcfce7', color: '#166534', cursor: 'pointer', fontWeight: 600 }}
                                          >+ Add</button>
                                        </div>
                                      ))}
                                    </>
                                  ) : (
                                    <div style={{ fontSize: '10px', color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>
                                      {(staffAtSlotMap[slot] ?? []).length === 0 ? 'No staff on shift' : 'All on-shift staff assigned'}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </td>
                        </>
                      );
                    });
                  })()}

                  {/* -- Totals: Total Children -- */}
                  <td style={{
                    ...tdBase,
                    backgroundColor: '#f0fdf4',
                    textAlign: 'center',
                    fontWeight: 600,
                    fontSize: '11px',
                    color: '#166534',
                  }}>
                    {totalChildren > 0 ? totalChildren : ''}
                  </td>

                  {/* -- Totals: Staff Required -- */}
                  <td style={{
                    ...tdBase,
                    backgroundColor: '#f0fdf4',
                    textAlign: 'center',
                    fontWeight: 600,
                    fontSize: '11px',
                    color: totalRequired > staffAvail ? '#dc2626' : '#166534',
                  }}>
                    {totalRequired > 0 ? (hasFG ? `${totalRequired}*` : totalRequired) : ''}
                  </td>

                  {/* -- Staff Available -- */}
                  <td style={{ ...tdBase, backgroundColor: rowBg, textAlign: 'center' }}>
                    <input
                      type="number"
                      min={0}
                      value={sessionData.staffAvailableOverride[slot] ?? getStaffOnFloor(slot)}
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        updateStaffAvailable(slot, isNaN(val) ? null : val);
                      }}
                      style={{ ...inputStyle, width: '40px' }}
                    />
                  </td>

                  {/* -- Spare -- */}
                  <td style={spareStyle}>
                    {spare > 0 ? `+${spare}` : spare !== 0 ? spare : '0'}
                  </td>

                  {/* -- Additional Duties column -- */}
                  <td
                    style={{
                      ...tdBase,
                      backgroundColor: dragOver === `additional:${slot}` ? '#fde68a' : '#fffbeb',
                      verticalAlign: 'top',
                      width: '130px',
                      maxWidth: '130px',
                      transition: 'background-color 0.1s',
                    }}
                    onDragOver={e => { e.preventDefault(); setDragOver(`additional:${slot}`); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                    onDrop={e => {
                      e.preventDefault();
                      setDragOver(null);
                      if (dragState.current) {
                        const { empId, slot: dragSlot } = dragState.current;
                        moveStaff(empId, dragSlot, '__additional__');
                        dragState.current = null;
                      }
                    }}
                    onClick={e => { if (touchSelected) { e.stopPropagation(); handleZoneTap('__additional__', slot); } }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', minHeight: '20px' }}>
                      {getAdditionalDutiesStaff(slot).map(s => {
                        const hasTimeOverride = !!sessionData.staffTimeOverrides[String(s.employeeId)];
                        const staffTime = getStaffTime(s);
                        return (
                          <div key={s.employeeId} style={{ position: 'relative', display: 'inline-block' }}>
                            <div
                              draggable
                              onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: '__additional__' }; }}
                              onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, '__additional__'); }}
                              title={s.employeeName + ' - drag or tap to reassign'}
                              style={{
                                fontSize: '11px', padding: '2px 5px', borderRadius: '4px',
                                backgroundColor: '#fef3c7', color: '#92400e',
                                border: `1px solid ${hasTimeOverride ? '#818cf8' : '#fcd34d'}`, cursor: 'grab',
                                display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start',
                                userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none', minWidth: '54px',
                                outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined,
                                outlineOffset: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '1px' : undefined,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', width: '100%' }}>
                                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{shortName(s.employeeName)}</span>
                                {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                                {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                                <button className="no-print" onClick={e => { e.stopPropagation(); const t = getStaffTime(s); setTimeEditorStart(t.start); setTimeEditorEnd(t.end); setTimeEditorLunchStart(t.lunchStart ?? ''); setTimeEditorLunchEnd(t.lunchEnd ?? ''); setTimeEditorOvertime(sessionData.staffTimeOverrides[s.employeeId]?.isOvertime ?? false); setTimeEditorComment(sessionData.staffTimeOverrides[s.employeeId]?.comment ?? ''); setTimeEditorModal({ empId: s.employeeId, name: s.employeeName, rosterStart: formatRosterTime(s.startTime) || '', rosterEnd: formatRosterTime(s.endTime) || '' }); }}
                                  title="Edit time" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '8px', color: hasTimeOverride ? '#6366f1' : '#9ca3af', padding: '0 1px', lineHeight: 1 }}>⏱</button>
                              </div>
                              {staffTime.start && <span style={{ fontSize: '7px', color: staffTime.source === 'deputy' ? '#0369a1' : hasTimeOverride ? '#6366f1' : '#b45309', fontWeight: hasTimeOverride ? 700 : 400 }}>{staffTime.source === 'deputy' ? '● ' : ''}{to12h(staffTime.start)}–{to12h(staffTime.end)}</span>}
              {staffTime.lunchStart && <span style={{ fontSize: '7px', color: staffTime.lunchEnd ? '#0369a1' : '#d97706' }}>🍝 {to12h(staffTime.lunchStart)}{staffTime.lunchEnd ? `–${to12h(staffTime.lunchEnd)}` : '…'}</span>}
                            </div>

                          </div>
                        );
                      })}
                      {getAdditionalDutiesStaff(slot).length === 0 && (
                        <span style={{ fontSize: '9px', color: '#d97706', fontStyle: 'italic' }}>
                          {dragOver === `additional:${slot}` ? 'Drop here' : '-'}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Programming column — always visible */}
                  {(() => {
                    const manualProg = getManualActivityStaff(slot, '__programming__');
                    // floatProg/floatLunch/floatClean now handled by offFloorStaffBySlot (draggable)
                    const bg = dragOver === `prog:${slot}` ? '#bfdbfe' : '#eff6ff';
                    return (
                    <td style={{ ...tdBase, backgroundColor: bg, verticalAlign: 'top', width: '110px', transition: 'background 0.1s' }}
                      onDragOver={e => { e.preventDefault(); setDragOver(`prog:${slot}`); }}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                      onDrop={e => { e.preventDefault(); setDragOver(null); if (dragState.current) { moveStaff(dragState.current.empId, dragState.current.slot, '__programming__'); dragState.current = null; } }}
                      onClick={e => { if (touchSelected) { e.stopPropagation(); handleZoneTap('__programming__', slot); } }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', minHeight: '18px' }}>
                        {manualProg.map(s => (
                          <div key={s.employeeId} draggable onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: '__programming__' }; }}
                            onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, '__programming__'); }}
                            title={s.employeeName + ' - drag or tap to reassign'}
                            style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', whiteSpace: 'nowrap', cursor: 'grab', userSelect: 'none', touchAction: 'none', outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined }}>
                            {shortName(s.employeeName)} <span style={{ fontSize: '9px', opacity: 0.7 }}>✓</span>
                            {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                            {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                          </div>
                        ))}
                        {(offFloorStaffBySlot[slot]?.programming ?? []).filter(s => !manualProg.some(m => m.employeeId === s.employeeId)).map(s => (
                          <div key={'fp'+s.employeeId} draggable
                            onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: '__programming__' }; }}
                            onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, '__programming__'); }}
                            title={s.employeeName + ' - scheduled for programming, drag or tap to reassign'}
                            style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: '#dbeafe', color: '#1e40af', border: '1px dashed #93c5fd', whiteSpace: 'nowrap', cursor: 'grab', userSelect: 'none', touchAction: 'none', outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined }}>
                            {shortName(s.employeeName)}
                            {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                            {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                          </div>
                        ))}
                        {!manualProg.length && !(offFloorStaffBySlot[slot]?.programming?.length) && <span style={{ fontSize: '9px', color: dragOver === `prog:${slot}` ? '#3b82f6' : '#9ca3af' }}>{dragOver === `prog:${slot}` ? 'Drop here' : '-'}</span>}
                      </div>
                    </td>
                    );
                  })()}
                  {/* Lunch column — always visible */}
                  {(() => {
                    const manualLunch = getManualActivityStaff(slot, '__lunch__');

                    const bg = dragOver === `lunch:${slot}` ? '#99f6e4' : '#f0fdfa';
                    return (
                    <td style={{ ...tdBase, backgroundColor: bg, verticalAlign: 'top', width: '110px', transition: 'background 0.1s' }}
                      onDragOver={e => { e.preventDefault(); setDragOver(`lunch:${slot}`); }}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                      onDrop={e => { e.preventDefault(); setDragOver(null); if (dragState.current) { moveStaff(dragState.current.empId, dragState.current.slot, '__lunch__'); dragState.current = null; } }}
                      onClick={e => { if (touchSelected) { e.stopPropagation(); handleZoneTap('__lunch__', slot); } }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', minHeight: '18px' }}>
                        {manualLunch.map(s => (
                          <div key={s.employeeId} draggable onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: '__lunch__' }; }}
                            onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, '__lunch__'); }}
                            title={s.employeeName + ' - drag or tap to reassign'}
                            style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: '#ccfbf1', color: '#0f766e', border: '1px solid #5eead4', whiteSpace: 'nowrap', cursor: 'grab', userSelect: 'none', touchAction: 'none', outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined }}>
                            {shortName(s.employeeName)} <span style={{ fontSize: '9px', opacity: 0.7 }}>✓</span>
                            {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                            {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                          </div>
                        ))}
                        {(offFloorStaffBySlot[slot]?.lunch ?? []).filter(s => !manualLunch.some(m => m.employeeId === s.employeeId)).map(s => (
                          <div key={'fl'+s.employeeId} draggable
                            onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: '__lunch__' }; }}
                            onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, '__lunch__'); }}
                            title={s.employeeName + ' - on lunch break, drag or tap to reassign'}
                            style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: '#ccfbf1', color: '#0f766e', border: '1px dashed #5eead4', whiteSpace: 'nowrap', cursor: 'grab', userSelect: 'none', touchAction: 'none', outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined }}>
                            {shortName(s.employeeName)}
                            {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                            {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                          </div>
                        ))}
                        {!manualLunch.length && !(offFloorStaffBySlot[slot]?.lunch?.length) && <span style={{ fontSize: '9px', color: dragOver === `lunch:${slot}` ? '#0f766e' : '#9ca3af' }}>{dragOver === `lunch:${slot}` ? 'Drop here' : '-'}</span>}
                      </div>
                    </td>
                    );
                  })()}
                  {(() => {
                    const manualClean = getManualActivityStaff(slot, '__cleaning__');

                    const bg = dragOver === `clean:${slot}` ? '#e9d5ff' : '#faf5ff';
                    return (
                    <td style={{ ...tdBase, backgroundColor: bg, verticalAlign: 'top', width: '110px', transition: 'background 0.1s' }}
                      onDragOver={e => { e.preventDefault(); setDragOver(`clean:${slot}`); }}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                      onDrop={e => { e.preventDefault(); setDragOver(null); if (dragState.current) { moveStaff(dragState.current.empId, dragState.current.slot, '__cleaning__'); dragState.current = null; } }}
                      onClick={e => { if (touchSelected) { e.stopPropagation(); handleZoneTap('__cleaning__', slot); } }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', minHeight: '18px' }}>
                        {manualClean.map(s => (
                          <div key={s.employeeId} draggable onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: '__cleaning__' }; }}
                            onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, '__cleaning__'); }}
                            title={s.employeeName + ' - drag or tap to reassign'}
                            style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#7e22ce', border: '1px solid #c4b5fd', whiteSpace: 'nowrap', cursor: 'grab', userSelect: 'none', touchAction: 'none', outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined }}>
                            {shortName(s.employeeName)} <span style={{ fontSize: '9px', opacity: 0.7 }}>✓</span>
                            {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                            {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                          </div>
                        ))}
                        {(offFloorStaffBySlot[slot]?.cleaning ?? []).filter(s => !manualClean.some(m => m.employeeId === s.employeeId)).map(s => (
                          <div key={'fc'+s.employeeId} draggable
                            onDragStart={() => { dragState.current = { empId: s.employeeId, slot, fromSource: '__cleaning__' }; }}
                            onClick={e => { e.stopPropagation(); handleChipTap(s.employeeId, slot, '__cleaning__'); }}
                            title={s.employeeName + ' - scheduled for cleaning, drag or tap to reassign'}
                            style={{ fontSize: '11px', padding: '1px 4px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#7e22ce', border: '1px dashed #c4b5fd', whiteSpace: 'nowrap', cursor: 'grab', userSelect: 'none', touchAction: 'none', outline: touchSelected?.empId === s.employeeId && touchSelected?.slot === slot ? '2px solid #d97706' : undefined }}>
                            {shortName(s.employeeName)}
                            {s.isInternalCasual && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#fef3c7', color: '#92400e', flexShrink: 0, lineHeight: '13px' }}>IC</span>}
                            {issUnitIdsSet.has(s.unitId) && <span style={{ fontSize: '8px', fontWeight: 700, padding: '0 3px', borderRadius: '3px', backgroundColor: '#ede9fe', color: '#6d28d9', flexShrink: 0, lineHeight: '13px' }}>ISS</span>}
                          </div>
                        ))}
                        {!manualClean.length && !(offFloorStaffBySlot[slot]?.cleaning?.length) && <span style={{ fontSize: '9px', color: dragOver === `clean:${slot}` ? '#7e22ce' : '#9ca3af' }}>{dragOver === `clean:${slot}` ? 'Drop here' : '-'}</span>}
                      </div>
                    </td>
                    );
                  })()}

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>



      {/* -- Legend -- */}
      <div className="no-print" style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', color: '#596570', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', verticalAlign: 'middle', marginRight: '4px' }}></span>Short-staffed</span>
        <span><span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: '#dcfce7', border: '1px solid #86efac', verticalAlign: 'middle', marginRight: '4px' }}></span>Spare staff</span>
        <span><span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: hexToRgba('#7c3aed', 0.07), border: '2px solid #7c3aed', verticalAlign: 'middle', marginRight: '4px' }}></span>Family Grouping row</span>
        <span style={{ color: '#8b5cf6' }}>* = FG combined ratio</span>
        <span><span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', verticalAlign: 'middle', marginRight: '4px' }}></span>Additional duties (off floor)</span>
        <span><span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: '#fdf4ff', border: '1px solid #d8b4fe', verticalAlign: 'middle', marginRight: '4px' }}></span>👤 Visitor/passing staff (counts toward floor ratio while present)</span>
      </div>



      {/* -- Footer note -- */}
      <div style={{ marginTop: '12px', fontSize: '10px', color: '#9ca3af' }}>
        Children counts auto-populated from Owna attendance data. Staff Available = staff physically on the floor (in rooms) at each slot - excludes anyone in Additional Duties, Programming, Lunch or Cleaning. Spare = Staff Available - Staff Required.
        Override by editing cells directly. Changes auto-save after 1.5s.
        FG rows use a combined cascade ratio calculation across all age groups (as per NSW regs for family grouping).
        Multiple independent Family Groupings can be active simultaneously - each merges its rooms into one ratio calculation.
        * in Staff Req'd = includes FG combined figure(s).
      </div>
      {/* -- Visitor exit modal -- */}
      {visitorExitModalState && (
        <>
          <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={() => setVisitorExitModalState(null)} />
          <div className="no-print" onClick={e => e.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 1000, background: 'white', borderRadius: '14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.22)', padding: '20px 22px', width: '280px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontWeight: 700, color: '#7e22ce', fontSize: '14px' }}>🚪 Log Room Exit</span>
              <button onClick={() => setVisitorExitModalState(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '20px', color: '#9ca3af', padding: '0 2px', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '14px' }}>
              {visitorExitModalState.visitorName} leaving {visitorExitModalState.roomName}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '13px', color: '#374151', minWidth: '56px' }}>Exit time</span>
              <input
                type="time"
                value={visitorExitModalState.exitTime}
                onChange={e => setVisitorExitModalState(prev => prev ? { ...prev, exitTime: e.target.value } : null)}
                style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                  if (!visitorExitModalState) return;
                  setVisitorExit(visitorExitModalState.slot, visitorExitModalState.roomId, visitorExitModalState.visitorId, visitorExitModalState.exitTime);
                  setVisitorExitModalState(null);
                }}
                style={{ flex: 1, padding: '9px', borderRadius: '8px', border: 'none', backgroundColor: '#7e22ce', color: 'white', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
              >Record Exit</button>
              <button
                onClick={() => setVisitorExitModalState(null)}
                style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white', color: '#6b7280', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              >Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* -- Visitor log modal -- */}
      {visitorModal && (() => {
        // Build dropdown: off-floor staff across all slots in the current session (so header button works regardless of slot)
        const allOffFloor = slots.flatMap(s => getAdditionalDutiesStaff(s));
        const seen = new Set<number>();
        const offFloorCandidates = allOffFloor.filter(s => { if (seen.has(s.employeeId)) return false; seen.add(s.employeeId); return true; });
        return (
          <>
            <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={() => setVisitorModal(null)} />
            <div className="no-print" onClick={e => e.stopPropagation()} style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              zIndex: 1000, background: 'white', borderRadius: '14px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.22)', padding: '20px 22px', width: '300px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 700, color: '#7e22ce', fontSize: '14px' }}>🚪 Log Room Visit</span>
                <button onClick={() => setVisitorModal(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '20px', color: '#9ca3af', padding: '0 2px', lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '14px' }}>
                {visitorModal.roomName} — recording entry at {to12h(visitorTime || visitorModal.slot)}
              </div>

              {/* Person dropdown or free text */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', minWidth: '56px' }}>Person</span>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {offFloorCandidates.length > 0 && (
                      <select
                        value=""
                        onChange={e => { if (e.target.value) setVisitorName(e.target.value); }}
                        style={{ fontSize: '12px', border: '1px solid #d8b4fe', borderRadius: '6px', padding: '5px 8px', color: '#374151', background: '#fdf4ff' }}
                      >
                        <option value="">Select from off-floor staff…</option>
                        {offFloorCandidates.map(s => (
                          <option key={s.employeeId} value={s.employeeName}>{s.employeeName}</option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      placeholder="Or type name (e.g. AD, Director)"
                      value={visitorName}
                      onChange={e => setVisitorName(e.target.value)}
                      style={{ fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', outline: 'none' }}
                      onKeyDown={e => { if (e.key === 'Enter') confirmAddVisitor(); }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', minWidth: '56px' }}>Enter</span>
                  <input type="time" value={visitorTime} onChange={e => setVisitorTime(e.target.value)}
                    style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', minWidth: '56px' }}>Exit</span>
                  <input type="time" value={visitorExitTime} onChange={e => setVisitorExitTime(e.target.value)}
                    placeholder="Leave blank if still in room"
                    style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
                </div>
                <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '-4px' }}>
                  Leave Exit blank to record entry only — you can exit them later from the chip.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={confirmAddVisitor}
                  disabled={!visitorName.trim()}
                  style={{ flex: 1, padding: '9px', borderRadius: '8px', border: 'none', backgroundColor: visitorName.trim() ? '#7e22ce' : '#e9d5ff', color: 'white', fontWeight: 700, fontSize: '13px', cursor: visitorName.trim() ? 'pointer' : 'default' }}
                >Log Entry</button>
                <button
                  onClick={() => setVisitorModal(null)}
                  style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white', color: '#6b7280', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                >Cancel</button>
              </div>
            </div>
          </>
        );
      })()}

      {/* -- Time editor modal — single global instance -- */}
      {timeEditorModal && (
        <>
          <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={() => setTimeEditorModal(null)} />
          <div className="no-print" onClick={e => e.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 1000, background: 'white', borderRadius: '14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.22)', padding: '20px 22px', width: '260px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontWeight: 700, color: '#2d5c18', fontSize: '14px' }}>{timeEditorModal.name}</span>
              <button onClick={() => setTimeEditorModal(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '20px', color: '#9ca3af', padding: '0 2px', lineHeight: 1 }}>✕</button>
            </div>
            {timeEditorModal.rosterStart && (
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '14px' }}>
                Roster: {timeEditorModal.rosterStart}–{timeEditorModal.rosterEnd}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: '#374151', minWidth: '60px' }}>Start</span>
                <input type="time" value={timeEditorStart} onChange={e => setTimeEditorStart(e.target.value)}
                  style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: '#374151', minWidth: '60px' }}>Finish</span>
                <input type="time" value={timeEditorEnd} onChange={e => setTimeEditorEnd(e.target.value)}
                  style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
              </div>
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>🍽 Lunch Break</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', minWidth: '60px' }}>Break start</span>
                  <input type="time" value={timeEditorLunchStart} onChange={e => setTimeEditorLunchStart(e.target.value)}
                    style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', minWidth: '60px' }}>Break end</span>
                  <input type="time" value={timeEditorLunchEnd} onChange={e => setTimeEditorLunchEnd(e.target.value)}
                    style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
                </div>
                <div style={{ fontSize: '10px', color: '#9ca3af' }}>Auto-populated from Deputy when staff clock break. You can override manually.</div>
              </div>
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={timeEditorOvertime} onChange={e => setTimeEditorOvertime(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#dc2626', cursor: 'pointer' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626' }}>🕒 Overtime</span>
                </label>
                {timeEditorOvertime && (
                  <div style={{ fontSize: '11px', color: '#dc2626', backgroundColor: '#fee2e2', borderRadius: '6px', padding: '6px 8px' }}>
                    Set the <strong>Finish</strong> time above to the actual overtime end time — the ratio check will reflect the extended hours.
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', minWidth: '60px', paddingTop: '6px' }}>📝 Note</span>
                  <textarea
                    value={timeEditorComment}
                    onChange={e => setTimeEditorComment(e.target.value)}
                    placeholder="e.g. covering Room 2, late pickup…"
                    rows={2}
                    style={{ fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { updateStaffTimeOverride(timeEditorModal.empId, timeEditorStart, timeEditorEnd, timeEditorLunchStart || undefined, timeEditorLunchEnd || undefined, timeEditorOvertime, timeEditorComment || undefined); setTimeEditorModal(null); }}
                style={{ flex: 1, padding: '9px', borderRadius: '8px', border: 'none', backgroundColor: '#2d5c18', color: 'white', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
              >Save</button>
              <button
                onClick={() => { clearStaffTimeOverride(timeEditorModal.empId); setTimeEditorModal(null); }}
                style={{ padding: '9px 14px', borderRadius: '8px', border: '1px solid #fca5a5', backgroundColor: '#fee2e2', color: '#dc2626', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              >Reset</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
