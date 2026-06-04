/**
 * GroupingPanel
 *
 * Morning + Afternoon consolidation planning.
 * Works for today (live data) or future dates (trend-based projections).
 * Directors can open the night before, load trends, edit projections, and
 * generate the full day's grouping timeline based on anticipated staffing.
 */
import { useState, useEffect, useRef } from 'react';
import type { Room, AttendanceChild, RosteredStaff, FloatStaff } from '../types';
import type { GroupingSession, StaffAvailable, GroupingResult } from '../utils/groupingEngine';
import { computeDayTransitions, calcRequired } from '../utils/groupingEngine';
import { getUser } from '../auth';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Props {
  centreId:           string;
  date:               string;
  rooms:              Room[];
  attendanceChildren: AttendanceChild[];
  rosters:            RosteredStaff[];
  floats:             FloatStaff[];
  issStaff:           FloatStaff[];
  supportStaff:       RosteredStaff[];
  nonRatioUnitIds?:   number[];
}

interface WindowSessions {
  sessions:  GroupingSession[];
  computing: boolean;
  computed:  boolean;
}

interface Transition {
  timeMins: number;
  endMins:  number;
  sessions: GroupingSession[];
}

// Per-window config
const WINDOWS = [
  {
    key:         'morning'  as const,
    label:       'ðŸŒ… Morning',
    min:         '07:00',
    scanEnd:     '12:00',
    slots:       ['07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30'],
    color:       '#fef3c7',
    borderColor: '#fcd34d',
    textColor:   '#92400e',
    trendNote:   'Children arriving - numbers build',
  },
  {
    key:         'afternoon' as const,
    label:       'ðŸŒ† Afternoon',
    min:         '15:00',
    scanEnd:     '19:00',
    slots:       ['15:00','15:30','16:00','16:30','17:00','17:30'],
    color:       '#ede9fe',
    borderColor: '#a78bfa',
    textColor:   '#5b21b6',
    trendNote:   'Children leaving - numbers drop',
  },
] as const;

const STATUS_COLORS = {
  suggested:        { bg: '#fef9c3', border: '#fde047', text: '#854d0e', label: 'Suggested' },
  confirmed:        { bg: '#dcfce7', border: '#86efac', text: '#166534', label: 'Confirmed âœ“' },
  'auto-confirmed': { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', label: 'Auto-confirmed' },
  modified:         { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8', label: 'Modified' },
  reconstructed:    { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', label: 'Reconstructed' },
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function toMins(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minsToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Notes are stored as JSON { sessionNote, roomNotes } or plain text (legacy)
function parseNotes(raw: string | null | undefined): { sessionNote: string; roomNotes: Record<string, string> } {
  if (!raw) return { sessionNote: '', roomNotes: {} };
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && ('roomNotes' in p || 'sessionNote' in p)) {
      return { sessionNote: p.sessionNote ?? '', roomNotes: p.roomNotes ?? {} };
    }
  } catch { /* not JSON - treat as plain session note */ }
  return { sessionNote: raw, roomNotes: {} };
}
function serializeNotes(sessionNote: string, roomNotes: Record<string, string>): string {
  const hasRoom = Object.values(roomNotes).some(n => n.trim());
  if (!hasRoom) return sessionNote; // keep plain text when no room notes
  return JSON.stringify({ sessionNote: sessionNote.trim(), roomNotes });
}
function isToday(date: string): boolean {
  const t = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  return date === `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}
function isFuture(date: string): boolean {
  const t = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const today = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  return date > today;
}
function deputyToHHMM(t: string | number | null | undefined): string {
  if (!t) return '00:00';
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const hh = String(d.toLocaleString('en-AU', { hour: '2-digit', hour12: false, timeZone: 'Australia/Sydney' })).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return String(t) || '00:00';
}
function medianAgeMonths(ageGroup: string): number {
  const m = ageGroup.match(/(\d+)-(\d+)/);
  if (!m) return 24;
  return Math.round((parseInt(m[1]) + parseInt(m[2])) / 2 * 12);
}

// â”€â”€â”€ Staff enrichment helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Enriches saved sessions with the full allStaff roster for the session window.
// Morning: anyone starting before/within the session (ss <= endM)
// Afternoon: anyone finishing within/after the session (eff >= startM)
function enrichSessions(
  sessions:  GroupingSession[],
  allStaff:  StaffAvailable[],
  rooms:     Room[],
  winKey:    'morning' | 'afternoon',
): GroupingSession[] {
  // Cross-session FG room lookup: empId â†’ roomId.
  // Floats assigned to a specific room in the Family Grouping should follow
  // that room into its split session (e.g. Jack in FG â†’ d1_0_1 â†’ Mixed 0â€“2).
  const fgRoomAssignment = new Map<number, string>();
  for (const s of sessions) {
    if ((s.roomsIncluded ?? []).length !== rooms.length) continue; // only FG sessions
    (s.staffIds ?? []).forEach((empId, i) => {
      const roomId = (s.staffRooms ?? [])[i];
      if (empId && roomId) fgRoomAssignment.set(empId, roomId);
    });
  }

  return sessions.map(session => {
    const startM = toMins(session.sessionStart);
    const endM   = toMins(session.sessionEnd);
    const groupRoomIds = new Set(session.roomsIncluded ?? []);
    const groupUnitIds = new Set(
      rooms.filter(r => groupRoomIds.has(r.id)).map(r => r.deputyUnitId)
    );

    const onShift = allStaff.filter(s => {
      const ss  = toMins(s.shiftStart);
      const se  = toMins(s.shiftEnd);
      const eff = se === 0 ? 24 * 60 : se;
      if (winKey === 'morning') {
        // Morning: started BEFORE session ends. Exactly-at-end goes to next session.
        return ss < endM && eff > startM;
      } else {
        // Afternoon: still on shift when session begins.
        // Finishing EXACTLY at session start means they're leaving â€” not present.
        return ss < endM && eff > startM;
      }
    });

    const roomStaff = onShift.filter(s => groupUnitIds.has(s.unitId));

    // UnitIds that belong to ANY room in this centre (used to exclude room staff
    // from the float path - stale saved staff_ids may put them in wrong groups)
    const allCentreUnitIds = new Set(rooms.map(r => r.deputyUnitId));

    // For Family Grouping (all rooms combined): auto-include ALL on-shift
    // non-room staff (floats, ISS, support) - no split ambiguity.
    // For split sessions: only include TRUE non-room staff (floats/ISS whose
    // unitId is NOT any room in the centre) that are explicitly in staffIds.
    const isFamilyGrouping = groupRoomIds.size === rooms.length;
    const savedNonRoomIds = new Set(
      (session.staffIds ?? []).filter(
        id => !onShift.some(s => s.employeeId === id && groupUnitIds.has(s.unitId))
      )
    );
    const floatStaff = onShift.filter(s => {
      if (groupUnitIds.has(s.unitId)) return false; // handled by roomStaff
      if (s.type === 'support') return false;       // chefs/admin/directors â€” never auto-included
      if (isFamilyGrouping) return true;            // FG: include floats + ISS on shift
      // FG room assignment â€” staff was assigned to a room in this group (e.g. Jack)
      const fgRoom = fgRoomAssignment.get(s.employeeId);
      if (fgRoom && groupRoomIds.has(fgRoom)) return true;
      // Explicitly saved in this sessionâ€™s staffIds
      if (savedNonRoomIds.has(s.employeeId)) return true;
      // Block unassigned room staff from other groups (stale saved data)
      if (allCentreUnitIds.has(s.unitId)) return false;
      return false;
    });
    const groupStaff = [...roomStaff, ...floatStaff];
    return {
      ...session,
      staffIds:   groupStaff.map(s => s.employeeId),
      staffNames: groupStaff.map(s => s.employeeName),
      staffRooms: groupStaff.map(s => {
        const m = rooms.find(r => r.deputyUnitId === s.unitId);
        return m ? m.id : (session.roomsIncluded?.[0] ?? '');
      }),
    };
  });
}

// â”€â”€â”€ Window Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function WindowSection({
  win, centreId, date, rooms, allStaff, children,
}: {
  win:      typeof WINDOWS[number];
  centreId: string;
  date:     string;
  rooms:    Room[];
  allStaff: StaffAvailable[];
  children: AttendanceChild[];
}) {
  const today  = isToday(date);
  const future = isFuture(date);
  const [state, setState]           = useState<WindowSessions>({ sessions: [], computing: false, computed: false });
  const [transitions, setTrans]     = useState<Transition[]>([]);
  // Raw sessions from Supabase (un-enriched) - stored separately so enrichment
  // can re-run whenever allStaff updates (avoids stale-closure issue).
  const [rawSessions, setRawSessions] = useState<(typeof state)['sessions']>([]);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [saveFlash, setSaveFlash]   = useState<string | null>(null);
  const [collapsed, setCollapsed]   = useState(false);
  const [projections, setProjections] = useState<Record<string, number[]> | null>(null);
  const [__projLoading, setProjLoading] = useState(false);
  const [_projDates, setProjDates]     = useState<string[]>([]);
  const [_showProjGrid, setShowProjGrid]   = useState(false);
  const [saveStatus, setSaveStatus]       = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Configurable split thresholds (total children that trigger each new stage)
  const defaultThresholds = win.key === 'morning' ? [16, 30, 50] : [50, 30, 16];
  const [thresholds, setThresholds]       = useState<number[]>(defaultThresholds);
  const [showThresholdEdit, setShowThresholdEdit] = useState(false);
  const [dragOver, setDragOver]               = useState<string | null>(null);
  const [editingTimeIdx, setEditingTimeIdx]   = useState<number | null>(null);
  const [editTimeVal, setEditTimeVal]         = useState<{ start: string; end: string }>({ start: '', end: '' });
  const dragRef = useRef<{ fromSessionKey: string; staffIdx: number } | null>(null);
  const user = getUser();

  const slotMins = win.slots.map(s => toMins(s));

  // â”€â”€ Data helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Children present at a given time from actual sign-in/out data
  function childrenAt(timeMins: number): Record<string, { ageMonths: number; room: string }[]> {
    const map: Record<string, { ageMonths: number; room: string }[]> = {};
    for (const room of rooms) {
      const owna = (room.ownaRoomName ?? room.name).toLowerCase();
      map[room.id] = children.filter(c => {
        if (!c.room?.toLowerCase().includes(owna) || !c.sign_in) return false;
        const si = toMins(c.sign_in);
        const so = c.sign_out
          ? toMins(c.sign_out)
          : (win.key === 'afternoon' && c.predicted_sign_out ? toMins(c.predicted_sign_out) : 24 * 60);
        return si <= timeMins && so > timeMins;
      }).map(c => ({ ageMonths: c.ageMonths, room: room.id }));
    }
    return map;
  }

  // Children map built from trend projections (synthetic, for planning)
  function projectedChildrenAt(timeMins: number): Record<string, { ageMonths: number; room: string }[]> | null {
    if (!projections) return null;
    const slotIdx = slotMins.reduce((best, m, i) => Math.abs(m - timeMins) < Math.abs(slotMins[best] - timeMins) ? i : best, 0);
    const map: Record<string, { ageMonths: number; room: string }[]> = {};
    for (const room of rooms) {
      const count = projections[room.id]?.[slotIdx] ?? 0;
      const ageM = medianAgeMonths(room.ageGroup);
      map[room.id] = Array.from({ length: count }, () => ({ ageMonths: ageM, room: room.id }));
    }
    return map;
  }

  // Best available children data at a time point
  function bestChildrenAt(timeMins: number): Record<string, { ageMonths: number; room: string }[]> {
    // If we have actual data and it's not a future date, prefer actuals
    if (!future && children.length > 0) {
      const actual = childrenAt(timeMins);
      const hasAny = Object.values(actual).some(a => a.length > 0);
      if (hasAny) return actual;
    }
    // Fall back to projections
    return projectedChildrenAt(timeMins) ?? childrenAt(timeMins);
  }

  // â”€â”€ Trends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const fetchTrends = async () => {
    setProjLoading(true);
    try {
      const url = `/api/attendance-trends?campus=${encodeURIComponent(centreId)}&date=${date}&slots=${win.slots.join(',')}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('fetch failed');
      const { dates, trends: rawTrends } = await r.json();
      if (!rawTrends || Object.keys(rawTrends).length === 0) {
        // No historical data - initialise with zeros so director can fill in manually
        const zeros: Record<string, number[]> = {};
        for (const room of rooms) zeros[room.id] = win.slots.map(() => 0);
        setProjections(zeros);
        setProjDates([]);
        setShowProjGrid(true);
        return;
      }
      // Map Owna room names â†’ room IDs
      const mapped: Record<string, number[]> = {};
      for (const room of rooms) {
        const owna = (room.ownaRoomName ?? room.name).toLowerCase();
        const matchKey = Object.keys(rawTrends).find(k =>
          k.toLowerCase().includes(owna) || owna.includes(k.toLowerCase())
        );
        mapped[room.id] = matchKey ? rawTrends[matchKey] : win.slots.map(() => 0);
      }
      setProjections(mapped);
      setProjDates(dates ?? []);
      setShowProjGrid(true);
    } catch {
      // Init with zeros so director can manually fill
      const zeros: Record<string, number[]> = {};
      for (const room of rooms) zeros[room.id] = win.slots.map(() => 0);
      setProjections(zeros);
      setShowProjGrid(true);
    } finally {
      setProjLoading(false);
    }
  };

  // Auto-load trends for future dates
  useEffect(() => {
    if (future && rooms.length > 0 && !projections && !__projLoading) {
      fetchTrends();
    }
  }, [date, future, rooms.length]); // eslint-disable-line

  // Re-enrich whenever allStaff updates (rosters load async after sessions fetch)
  useEffect(() => {
    if (rawSessions.length === 0 || allStaff.length === 0) return;
    const enriched = enrichSessions(rawSessions, allStaff, rooms, win.key);
    setState({ sessions: enriched, computing: false, computed: true });
    const byTime: Record<string, GroupingSession[]> = {};
    for (const s of enriched) (byTime[s.sessionStart] ??= []).push(s);
    const trans: Transition[] = Object.entries(byTime)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([start, sessions], i, arr) => ({
        timeMins: toMins(start),
        endMins:  i + 1 < arr.length ? toMins(arr[i+1][0]) : toMins(win.scanEnd),
        sessions,
      }));
    setTrans(trans);
  }, [allStaff.length, rawSessions.length]); // eslint-disable-line

  // â”€â”€ Load saved sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  useEffect(() => {
    if (rooms.length === 0) return;
    let cancelled = false;
    fetch(`/api/grouping-sessions?centre=${encodeURIComponent(centreId)}&date=${date}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: any[]) => {
        if (cancelled) return;
        const winSessions = rows
          .filter((row: any) => {
            const m = toMins(row.session_start);
            return m >= toMins(win.min) && m <= toMins(win.scanEnd);
          })
          .map((row: any) => ({
            id: row.id, centreId: row.centre_id, date: row.date,
            sessionStart: row.session_start, sessionEnd: row.session_end,
            groupLabel: row.group_label, roomsIncluded: row.rooms_included ?? [],
            staffIds: row.staff_ids ?? [], staffNames: row.staff_names ?? [],
            staffRooms: row.staff_rooms ?? [], heldInRoom: row.held_in_room ?? '',
            childrenCount: row.children_count ?? 0,
            confirmationStatus: row.confirmation_status,
            confirmedBy: row.confirmed_by, notes: row.notes,
          } as GroupingSession));
        if (winSessions.length > 0) {
          // Deduplicate: keep only one session per (group_label, sessionStart, sessionEnd)
          // Multiple saves can stack up the same session in the DB
          const seen = new Map<string, GroupingSession>();
          for (const s of winSessions) {
            const key = `${s.sessionStart}:${s.sessionEnd}:${s.groupLabel}`;
            const existing = seen.get(key);
            // Prefer confirmed/modified over suggested/reconstructed
            const priority = (st: GroupingSession['confirmationStatus']) =>
              st === 'confirmed' ? 3 : st === 'modified' ? 2 : st === 'auto-confirmed' ? 1 : 0;
            if (!existing || priority(s.confirmationStatus) > priority(existing.confirmationStatus)) {
              seen.set(key, s);
            }
          }
          const dedupedSessions = [...seen.values()];

          setRawSessions(dedupedSessions); // store raw - enrichment runs in separate effect
          // Immediate enrich with whatever allStaff we have right now
          const enriched = enrichSessions(dedupedSessions, allStaff, rooms, win.key);
          setState({ sessions: enriched, computing: false, computed: true });
          const byTime: Record<string, GroupingSession[]> = {};
          for (const s of enriched) (byTime[s.sessionStart] ??= []).push(s);
          const trans: Transition[] = Object.entries(byTime)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([start, sessions], i, arr) => ({
              timeMins: toMins(start),
              endMins:  i + 1 < arr.length ? toMins(arr[i+1][0]) : toMins(win.scanEnd),
              sessions,
            }));
          setTrans(trans);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [centreId, date, rooms.length]); // eslint-disable-line

  // â”€â”€ Compute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const compute = async () => {
    if (rooms.length === 0) return;
    setState(s => ({ ...s, computing: true }));

    const winStart = toMins(win.min);
    const scanEnd  = toMins(win.scanEnd);
    const STEP     = 15;
    const status: GroupingSession['confirmationStatus'] = (today || future) ? 'suggested' : 'reconstructed';

    const timePoints: number[] = [];
    for (let t = winStart; t <= scanEnd; t += STEP) timePoints.push(t);

    const childrenTimeline = timePoints.map(t => ({ timeMins: t, childrenByRoom: bestChildrenAt(t) }));
    // Progressive staff timeline: at each slot t, who is on shift RIGHT NOW.
    // This drives transition detection correctly (rooms split when enough staff arrive).
    // Staff-per-session expansion (morning = starters during window,
    // afternoon = still on shift) is applied separately below when building sessions.
    const staffTimeline    = timePoints.map(t => ({
      timeMins: t,
      staffAvailable: allStaff.filter(s => {
        const start        = toMins(s.shiftStart);
        const end          = toMins(s.shiftEnd);
        const effectiveEnd = end === 0 ? 24 * 60 : end;
        return start <= t && effectiveEnd > t;
      }),
    }));

    // Morning: use first (smallest) threshold to determine when rooms first split
    // Afternoon: use low minSplit (3) - let staff finishing shifts drive consolidation naturally
    const minSplit = win.key === 'morning'
      ? Math.max(3, Math.floor((thresholds[0] ?? 16) / 2))
      : 3;
    const raw = computeDayTransitions(rooms, childrenTimeline, staffTimeline, winStart, scanEnd, STEP, minSplit);

    // Morning only: always insert a Family Grouping entry at 7am as the opening state
    // (Afternoon does not get a forced start - we only show from when rooms combine)
    if (win.key === 'morning' && (raw.length === 0 || raw[0].timeMins > winStart)) {
      const cbr0   = bestChildrenAt(winStart);
      const staff0 = staffTimeline[0]?.staffAvailable ?? [];
      const total  = Object.values(cbr0).flat().length;
      raw.unshift({
        timeMins: winStart,
        result: {
          groups: [{
            groupId: 'pre-open', label: 'Family Grouping',
            isFamilyGroup: true, isMixed: false, rooms,
            ageMinMonths: 0, ageMaxMonths: 72, childrenCount: total,
            staffNeeded: 0, assignedStaff: staff0,
          }] as any,
          staffUsed: 0, staffAvail: staff0.length, isOptimal: false, canSplitMore: false,
          suggestedAt: new Date().toISOString(),
        },
      });
    }

    // Morning: collapse consecutive Family Grouping stages into one.
    // The algorithm creates a new transition every 15 min as staff arrive,
    // but if it's still all-rooms combined the grouping hasn't changed -
    // only show a new stage when the number/nature of groups actually changes.
    // Afternoon: only show from when rooms START combining.
    const isFG = (r: { result: GroupingResult }) =>
      r.result.groups.length === 1 &&
      (r.result.groups[0].isFamilyGroup ||
       r.result.groups[0].groupId === 'family' ||
       r.result.groups[0].groupId === 'pre-open');

    const displayRaw = win.key === 'afternoon'
      ? raw.filter(({ result }) => result.groups.length < rooms.length)
      : raw.reduce<typeof raw>((acc, cur) => {
          // If both last and current are still FG, collapse into first (skip cur)
          const last = acc[acc.length - 1];
          if (last && isFG(last) && isFG(cur)) return acc;
          return [...acc, cur];
        }, []);

    if (displayRaw.length === 0) {
      setState({ sessions: [], computing: false, computed: true });
      setTrans([]);
      return;
    }

    // Cross-session FG room assignment for the compute path.
    // As each FG session is built, record empId â†’ roomId so subsequent
    // split sessions know where each float belongs (e.g. Jack â†’ d1_0_1).
    const computedFGRoomMap = new Map<number, string>();

    const allSessions: GroupingSession[] = [];
    const trans: Transition[] = displayRaw.map(({ timeMins, result }, i) => {
      const startStr    = minsToHHMM(timeMins);
      const nextMins    = i + 1 < displayRaw.length ? displayRaw[i + 1].timeMins : scanEnd;
      const endStr      = minsToHHMM(nextMins);
      const cbr         = bestChildrenAt(timeMins);

      const sessions: GroupingSession[] = result.groups.map(g => {
        const heldInRoom = g.rooms.reduce((best: string, r: Room) =>
          (cbr[r.id]?.length ?? 0) > (cbr[best]?.length ?? 0) ? r.id : best,
          g.rooms[0]?.id ?? ''
        );
        return {
          centreId, date,
          sessionStart: startStr, sessionEnd: endStr,
          groupLabel:   g.label,
          roomsIncluded: g.rooms.map((r: Room) => r.id),
          // Expand staff for this session window, correctly split across groups:
          //
          // 1. Room staff - on shift during the window AND their Deputy unit is
          //    one of the rooms in THIS group. No double-counting across groups.
          //
          // 2. Float / support staff - not tied to a specific room, so use the
          //    algorithm's original assignment (g.assignedStaff) as the source of
          //    truth for which group they belong to, then verify they're on shift.
          ...(() => {
            const startM = timeMins;
            const endM   = nextMins;
            const groupUnitIds = new Set(g.rooms.map((r: Room) => r.deputyUnitId));

            // Strict boundary both directions:
            // Morning: ss < endM  (starts exactly at sessionEnd â†’ next session)
            // Afternoon: eff > startM (ends exactly at sessionStart â†’ they're leaving)
            const onShift = allStaff.filter(s => {
              const ss  = toMins(s.shiftStart);
              const se  = toMins(s.shiftEnd);
              const eff = se === 0 ? 24 * 60 : se;
              return ss < endM && eff > startM;
            });

            // Room staff: unitId belongs to one of this group's rooms
            const roomStaff = onShift.filter(s => groupUnitIds.has(s.unitId));

            // For Family Grouping: include all non-room staff on shift.
            // For split sessions: include staff the algorithm assigned here
            // (assignedNonRoomIds is authoritative â€” may include cross-room staff
            // legitimately sent for ratio coverage, so check it BEFORE blocking
            // room staff of other groups).
            const isFG = g.isFamilyGroup || g.rooms.length === rooms.length;
            const allCentreUnitIdsComp = new Set(rooms.map((r: Room) => r.deputyUnitId));
            const assignedNonRoomIds = new Set(
              (g.assignedStaff as StaffAvailable[])
                .filter(s => !groupUnitIds.has(s.unitId))
                .map(s => s.employeeId)
            );
            const floatStaff = onShift.filter(s => {
              if (groupUnitIds.has(s.unitId)) return false;
              if (s.type === 'support') return false; // chefs/admin â€” never in ratio
              if (isFG) return true;
              // Float was in FG with a room that belongs to this split group
              const fgRoomComp = computedFGRoomMap.get(s.employeeId);
              if (fgRoomComp && g.rooms.some((r: Room) => r.id === fgRoomComp)) return true;
              // Algorithm-assigned: include (cross-room ratio coverage)
              if (assignedNonRoomIds.has(s.employeeId)) return true;
              // Block unassigned room staff from other groups
              if (allCentreUnitIdsComp.has(s.unitId)) return false;
              return false;
            });

            // After building groupStaff, record FG room assignments for split sessions
            // (computed AFTER floatStaff so the full list is used)
            const isThisFG = isFG;

            const groupStaff = [...roomStaff, ...floatStaff];

            // Update FG room map so subsequent split sessions know where each float belongs
            if (isThisFG) {
              groupStaff.forEach((s: StaffAvailable) => {
                const match = g.rooms.find((r: Room) => r.deputyUnitId === s.unitId);
                const roomId = match?.id ?? g.rooms[0]?.id ?? '';
                if (roomId) computedFGRoomMap.set(s.employeeId, roomId);
              });
            }

            return {
              staffIds:   groupStaff.map((s: StaffAvailable) => s.employeeId),
              staffNames: groupStaff.map((s: StaffAvailable) => s.employeeName),
              staffRooms: groupStaff.map((s: StaffAvailable) => {
                const match = g.rooms.find((r: Room) => r.deputyUnitId === s.unitId);
                return match ? match.id : (g.rooms[0]?.id ?? '');
              }),
            };
          })(),
          heldInRoom,
          childrenCount: g.childrenCount,
          confirmationStatus: status,
        };
      });
      allSessions.push(...sessions);
      return { timeMins, endMins: nextMins, sessions };
    });

    // Cap at 3 transitions, then make end times contiguous
    const MAX_TRANS = 3;
    const pickedTrans = trans.length <= MAX_TRANS ? trans : (() => {
      const first = trans[0];
      const last  = trans[trans.length - 1];
      let middle: Transition;
      if (win.key === 'morning') {
        middle = trans.slice(1, -1).find(t => t.sessions.length > first.sessions.length)
          ?? trans[Math.floor(trans.length / 2)];
      } else {
        // Afternoon: all-separate stages already filtered - show chronologically
        // (first combining time â†’ most consolidated)
        const first = trans[0];
        const last  = trans[trans.length - 1];
        const middle2 = trans[Math.floor(trans.length / 2)];
        return [first, middle2, last];
      }
      return [first, middle, last];
    })();

    // Recalculate end times so stages are perfectly contiguous
    const cappedTrans: Transition[] = pickedTrans.map((t, i) => {
      const nextStart = pickedTrans[i + 1]?.timeMins ?? scanEnd;
      const newEndStr = minsToHHMM(nextStart);
      return {
        ...t,
        endMins: nextStart,
        sessions: t.sessions.map(s => ({ ...s, sessionEnd: newEndStr })),
      };
    });

    setState({ sessions: allSessions, computing: false, computed: true });
    setTrans(cappedTrans);
    setSaveStatus('idle'); // reset so Save button appears fresh
  };

  const savePlan = async () => {
    if (state.sessions.length === 0) return;
    setSaveStatus('saving');
    try {
      const r = await fetch('/api/grouping-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: state.sessions, centre: centreId, date }),
      });
      if (!r.ok) throw new Error(await r.text());
      // Update local sessions with returned IDs
      const saved = await r.json();
      if (Array.isArray(saved) && saved.length > 0) {
        setState(s => ({
          ...s,
          sessions: s.sessions.map(sess => ({ ...sess, id: saved.find((sv: any) => sv.session_start === sess.sessionStart && sv.group_label === sess.groupLabel)?.id ?? sess.id })),
        }));
        setTrans(ts => ts.map(t => ({
          ...t,
          sessions: t.sessions.map((sess) => {
            const match = saved.find((sv: any) =>
              sv.session_start === sess.sessionStart && sv.group_label === sess.groupLabel
            );
            return match ? { ...sess, id: match.id } : sess;
          }),
        })));
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  // â”€â”€ Session actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const patchSession = (patch: Partial<GroupingSession> & { id?: string }) => {
    setState(s => ({ ...s, sessions: s.sessions.map(x => x.id === patch.id ? { ...x, ...patch } : x) }));
    setTrans(ts => ts.map(t => ({ ...t, sessions: t.sessions.map(x => x.id === patch.id ? { ...x, ...patch } : x) })));
  };

  // Move a staff member from one group to another within the same transition
  const saveStageTime = (ti: number, newStart: string, newEnd: string) => {
    setTrans(ts => {
      const updated = ts.map((t, i) => {
        if (i === ti) {
          // Update this stage's start and end
          return {
            ...t,
            timeMins: toMins(newStart),
            endMins:  toMins(newEnd),
            sessions: t.sessions.map(s => ({ ...s, sessionStart: newStart, sessionEnd: newEnd })),
          };
        }
        if (i === ti - 1) {
          // Previous stage ends where this one now starts
          return {
            ...t,
            endMins: toMins(newStart),
            sessions: t.sessions.map(s => ({ ...s, sessionEnd: newStart })),
          };
        }
        if (i === ti + 1) {
          // Next stage starts where this one now ends
          return {
            ...t,
            timeMins: toMins(newEnd),
            sessions: t.sessions.map(s => ({ ...s, sessionStart: newEnd })),
          };
        }
        return t;
      });
      setState(s => ({ ...s, sessions: updated.flatMap(t => t.sessions) }));
      return updated;
    });
    setEditingTimeIdx(null);
    setSaveStatus('idle');
  };

  // Add a blank stage after a given index
  const addStageAfter = (idx: number) => {
    const prev = transitions[idx];
    const next = transitions[idx + 1];
    if (!prev) return;
    const midMins = Math.round((prev.timeMins + (next?.timeMins ?? toMins(win.scanEnd))) / 2);
    const midTime = minsToHHMM(midMins);
    const newStage: Transition = {
      timeMins: midMins,
      endMins:  next?.timeMins ?? toMins(win.scanEnd),
      sessions: prev.sessions.map(s => ({ ...s, id: undefined, sessionStart: midTime, sessionEnd: minsToHHMM(next?.timeMins ?? toMins(win.scanEnd)) })),
    };
    // Shorten prev stage end
    const updated = transitions.map((t, i) => i === idx ? { ...t, endMins: midMins, sessions: t.sessions.map(s => ({ ...s, sessionEnd: midTime })) } : t);
    updated.splice(idx + 1, 0, newStage);
    setTrans(updated);
    setState(s => ({ ...s, sessions: updated.flatMap(t => t.sessions) }));
    setSaveStatus('idle');
  };

  // Remove a stage (merges its time into the previous stage)
  const removeStage = (idx: number) => {
    if (transitions.length <= 1) return;
    const updated = transitions.filter((_, i) => i !== idx).map((t, i, arr) => ({
      ...t,
      endMins: i + 1 < arr.length ? arr[i + 1].timeMins : toMins(win.scanEnd),
      sessions: t.sessions.map(s => ({
        ...s,
        sessionEnd: minsToHHMM(i + 1 < arr.length ? arr[i + 1].timeMins : toMins(win.scanEnd)),
      })),
    }));
    setTrans(updated);
    setState(s => ({ ...s, sessions: updated.flatMap(t => t.sessions) }));
    setSaveStatus('idle');
  };

  const moveStaffBetweenGroups = (
    fromSessionKey: string,  // session.id or groupLabel fallback
    toSessionKey:   string,
    staffIdx:       number,
  ) => {
    setTrans(ts => ts.map(t => {
      const from = t.sessions.find(s => (s.id ?? s.groupLabel) === fromSessionKey);
      const to   = t.sessions.find(s => (s.id ?? s.groupLabel) === toSessionKey);
      if (!from || !to) return t;
      const empId   = from.staffIds[staffIdx];
      const empName = from.staffNames[staffIdx];
      if (!empId) return t;
      // Remove from source
      const newFrom: GroupingSession = {
        ...from,
        staffIds:   from.staffIds.filter((_, i) => i !== staffIdx),
        staffNames: from.staffNames.filter((_, i) => i !== staffIdx),
        staffRooms: (from.staffRooms ?? []).filter((_, i) => i !== staffIdx),
      };
      // Add to destination (default room = first room in that group)
      const newTo: GroupingSession = {
        ...to,
        staffIds:   [...to.staffIds, empId],
        staffNames: [...to.staffNames, empName],
        staffRooms: [...(to.staffRooms ?? []), to.roomsIncluded[0] ?? ''],
      };
      return { ...t, sessions: t.sessions.map(s => {
        const key = s.id ?? s.groupLabel;
        if (key === fromSessionKey) return newFrom;
        if (key === toSessionKey)   return newTo;
        return s;
      })};
    }));
    // Mirror into flat sessions state
    setState(s => {
      const updated = [...s.sessions];
      const fromIdx = updated.findIndex(x => (x.id ?? x.groupLabel) === fromSessionKey);
      const toIdx   = updated.findIndex(x => (x.id ?? x.groupLabel) === toSessionKey);
      if (fromIdx < 0 || toIdx < 0) return s;
      const from = updated[fromIdx];
      const to   = updated[toIdx];
      const empId   = from.staffIds[staffIdx];
      const empName = from.staffNames[staffIdx];
      updated[fromIdx] = { ...from, staffIds: from.staffIds.filter((_,i)=>i!==staffIdx), staffNames: from.staffNames.filter((_,i)=>i!==staffIdx), staffRooms: (from.staffRooms??[]).filter((_,i)=>i!==staffIdx) };
      updated[toIdx]   = { ...to, staffIds: [...to.staffIds, empId], staffNames: [...to.staffNames, empName], staffRooms: [...(to.staffRooms??[]), to.roomsIncluded[0]??''] };
      return { ...s, sessions: updated };
    });
    setSaveStatus('idle');
  };
  const confirm = async (session: GroupingSession) => {
    const patch = { id: session.id, confirmationStatus: 'confirmed' as const, confirmedBy: user?.name ?? 'Unknown' };
    patchSession(patch);
    if (session.id) await fetch('/api/grouping-sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {});
    setSaveFlash('Confirmed âœ“'); setTimeout(() => setSaveFlash(null), 2500);
  };
  const saveEdit = async (session: GroupingSession) => {
    const patch = { id: session.id, confirmationStatus: 'modified' as const, confirmedBy: user?.name ?? 'Unknown', sessionStart: session.sessionStart, sessionEnd: session.sessionEnd, staffIds: session.staffIds, staffNames: session.staffNames, staffRooms: session.staffRooms, heldInRoom: session.heldInRoom, notes: session.notes };
    patchSession(patch);
    if (session.id) await fetch('/api/grouping-sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {});
    setEditingId(null); setSaveFlash('Saved âœ“'); setTimeout(() => setSaveFlash(null), 2500);
  };
  const confirmAll = async (t: Transition) => {
    for (const s of t.sessions) if (s.confirmationStatus === 'suggested' || s.confirmationStatus === 'reconstructed') await confirm(s);
  };

  const unconfirmed = state.sessions.filter(s => s.confirmationStatus === 'suggested' || s.confirmationStatus === 'reconstructed').length;

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="border-t first:border-t-0" style={{ borderColor: '#e0e7ff' }}>
      {/* Window header */}
      <div className="px-4 py-3 flex items-center gap-3 cursor-pointer select-none"
        style={{ backgroundColor: win.color + '99' }}
        onClick={() => setCollapsed(c => !c)}>
        <span className="text-sm font-bold" style={{ color: win.textColor }}>{win.label}</span>
        <span className="text-xs" style={{ color: win.textColor, opacity: 0.7 }}>
          {win.key === 'afternoon' ? 'from first room combining' : `${win.min} onwards`}
        </span>
        {state.computed && transitions.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: win.borderColor + '55', color: win.textColor }}>
            {transitions.length} transition{transitions.length !== 1 ? 's' : ''}
          </span>
        )}
        {unconfirmed > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
            {unconfirmed} need confirmation
          </span>
        )}

        {saveFlash && <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>{saveFlash}</span>}
        <div className="ml-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>

          {state.computed && state.sessions.length > 0 && (
            <button
              onClick={savePlan}
              disabled={saveStatus === 'saving'}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold border disabled:opacity-50"
              style={{
                borderColor: saveStatus === 'saved' ? '#86efac' : saveStatus === 'error' ? '#fca5a5' : win.borderColor,
                color:       saveStatus === 'saved' ? '#166534' : saveStatus === 'error' ? '#991b1b' : win.textColor,
                backgroundColor: saveStatus === 'saved' ? '#dcfce7' : saveStatus === 'error' ? '#fee2e2' : 'white',
              }}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'âœ“ Saved' : saveStatus === 'error' ? 'âœ— Error - retry' : 'ðŸ’¾ Save plan'}
            </button>
          )}
          <button onClick={compute} disabled={state.computing}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: win.textColor }}>
            {state.computing ? 'Computing...' : state.computed ? 'â†º Re-compute' : 'â–¶ Generate timeline'}
          </button>
          <span className="text-xs" style={{ color: win.textColor }}>{collapsed ? 'â–¾' : 'â–´'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="bg-white">


          {/* Timeline */}
          {!state.computed ? (
            <div className="px-4 py-5 text-sm text-center" style={{ color: '#9ca3af' }}>
              {future
                ? 'Click â–¶ Generate timeline to plan the day.'
                : 'Click â–¶ Generate timeline to see how groupings evolve.'}
            </div>
          ) : transitions.length === 0 ? (
            <div className="px-4 py-5 text-sm text-center" style={{ color: '#9ca3af' }}>
              {win.key === 'afternoon'
                ? 'Rooms running independently all afternoon - no combining required today.'
                : 'No consolidation periods - staffing covers all rooms throughout this window.'}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: '#f3f4f6' }}>
              {/* Threshold configuration */}
              <div className="px-4 py-2 flex items-center gap-2 border-b flex-wrap" style={{ borderColor: '#f3f4f6', backgroundColor: '#fafafa' }}>
                <span className="text-xs" style={{ color: '#6b7280' }}>Split at:</span>
                {thresholds.map((th, i) => (
                  showThresholdEdit ? (
                    <input key={i} type="number" min={1} max={999} value={th}
                      onChange={e => setThresholds(prev => prev.map((v, j) => j === i ? parseInt(e.target.value)||v : v))}
                      className="text-xs border rounded px-1.5 py-0.5 w-14 text-center"
                      style={{ borderColor: '#fcd34d', color: '#92400e' }} />
                  ) : (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: '#fef9c3', color: '#92400e' }}>
                      ~{th} children
                    </span>
                  )
                ))}
                <button onClick={() => { setShowThresholdEdit(v => !v); }}
                  className="text-xs px-2 py-0.5 rounded border ml-1"
                  style={{ borderColor: '#e5e7eb', color: '#6b7280', backgroundColor: 'white' }}>
                  {showThresholdEdit ? 'Done' : 'Edit'}
                </button>
                {showThresholdEdit && (
                  <button onClick={() => setThresholds(prev => [...prev, Math.round((prev[prev.length-1]||50) * 1.6)])}
                    className="text-xs px-2 py-0.5 rounded border"
                    style={{ borderColor: '#e5e7eb', color: '#6b7280', backgroundColor: 'white' }}>+ Add threshold</button>
                )}
                {showThresholdEdit && thresholds.length > 1 && (
                  <button onClick={() => setThresholds(prev => prev.slice(0,-1))}
                    className="text-xs px-2 py-0.5 rounded border"
                    style={{ borderColor: '#fca5a5', color: '#dc2626', backgroundColor: 'white' }}>- Remove last</button>
                )}
                <span className="text-xs ml-auto" style={{ color: '#9ca3af' }}>Re-compute to apply changes</span>
              </div>

              {transitions.map((t, ti) => {
                const tUnconfirmed = t.sessions.filter(s => s.confirmationStatus === 'suggested' || s.confirmationStatus === 'reconstructed').length;
                // Show note on first transition where all rooms are independent
                const isFirstAllSep = win.key === 'morning'
                  && t.sessions.length === rooms.length
                  && (ti === 0 || transitions[ti - 1].sessions.length < rooms.length);

                return (
                  <div key={ti} className="px-4 py-3">
                              {/* Transition header */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {editingTimeIdx === ti ? (
                        <div className="flex items-center gap-1.5">
                          <input type="time" value={editTimeVal.start}
                            onChange={e => setEditTimeVal(v => ({ ...v, start: e.target.value }))}
                            className="text-xs border rounded-lg px-2 py-1 font-bold"
                            style={{ borderColor: win.borderColor, color: win.textColor }} />
                          <span className="text-xs" style={{ color: win.textColor }}>-</span>
                          <input type="time" value={editTimeVal.end}
                            onChange={e => setEditTimeVal(v => ({ ...v, end: e.target.value }))}
                            className="text-xs border rounded-lg px-2 py-1 font-bold"
                            style={{ borderColor: win.borderColor, color: win.textColor }} />
                          <button onClick={() => saveStageTime(ti, editTimeVal.start, editTimeVal.end)}
                            className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                            style={{ backgroundColor: win.textColor }}>Save</button>
                          <button onClick={() => setEditingTimeIdx(null)}
                            className="text-xs px-2 py-1 rounded-lg border"
                            style={{ borderColor: '#e5e7eb', color: '#6b7280', backgroundColor: 'white' }}>Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingTimeIdx(ti); setEditTimeVal({ start: minsToHHMM(t.timeMins), end: minsToHHMM(t.endMins) }); }}
                          className="text-xs font-bold px-2 py-1 rounded-lg"
                          style={{ backgroundColor: win.borderColor + '33', color: win.textColor }}
                          title="Click to edit times">
                          {minsToHHMM(t.timeMins)} - {minsToHHMM(t.endMins)} âœï¸
                        </button>
                      )}
                      <span className="text-xs" style={{ color: '#9ca3af' }}>
                        {t.sessions.length} group{t.sessions.length !== 1 ? 's' : ''} Â·
                        {(() => {
                          const endCbrTotal = Object.values(bestChildrenAt(t.endMins)).flat().length;
                          const startTotal  = t.sessions.reduce((n, s) => n + s.childrenCount, 0);
                          return (
                            <>
                              <span className="font-medium" style={{ color: '#374151' }}> {startTotal} now</span>
                              {endCbrTotal > startTotal && (
                                <span className="font-medium" style={{ color: '#4338ca' }}> â†’ ~{endCbrTotal} by {minsToHHMM(t.endMins)}</span>
                              )}
                            </>
                          );
                        })()}
                        {(future || (win.key === 'afternoon' && today)) && <span className="italic"> (projected)</span>}
                      </span>
                      {/* Stage split / consolidation trigger */}
                      {ti < thresholds.length && (
                        <span className="text-xs px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: win.key === 'morning' ? '#f0fdf4' : '#fef3c7', color: win.key === 'morning' ? '#166534' : '#92400e' }}>
                          {win.key === 'morning'
                            ? `splits at ~${thresholds[ti]} children`
                            : `consolidates at ~${thresholds[ti]} children`}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1.5">
                        {tUnconfirmed > 0 && (
                          <button onClick={() => confirmAll(t)}
                            className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                            style={{ backgroundColor: '#16a34a' }}>
                            âœ“ Confirm all
                          </button>
                        )}
                        {transitions.length > 1 && !isFirstAllSep && (
                          <button onClick={() => removeStage(ti)}
                            className="text-xs px-2 py-1 rounded-lg border"
                            style={{ borderColor: '#fca5a5', color: '#dc2626', backgroundColor: 'white' }}
                            title="Remove this stage">
                            - Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {/* When all rooms are independent: just show the note, skip individual cards */}
                    {isFirstAllSep ? (
                      <p className="text-xs py-1 font-medium" style={{ color: '#16a34a' }}>
                        âœ… All rooms now running independently.
                      </p>
                    ) : (<div className="flex flex-col gap-2">
                      {t.sessions.map((session, idx) => {
                        const colors    = STATUS_COLORS[session.confirmationStatus] ?? STATUS_COLORS.suggested;
                        const isEditing = editingId === (session.id ?? `t${ti}-${idx}`);
                        const editable  = { ...session };
                        const isMultiRoom = session.roomsIncluded.length > 1;

                        // Per-room counts: START of stage (current) and END of stage (anticipated)
                        const roomCbrStart = bestChildrenAt(t.timeMins);
                        const roomCbrEnd   = bestChildrenAt(t.endMins);

                        const roomCounts = session.roomsIncluded.map(rid => {
                          const room = rooms.find(r => r.id === rid);
                          return {
                            rid,
                            name:       room?.name ?? rid,
                            ageGroup:   room?.ageGroup ?? '',
                            countStart: roomCbrStart[rid]?.length ?? 0,
                            countEnd:   roomCbrEnd[rid]?.length ?? 0,
                          };
                        });

                        // Age breakdown at END of stage
                        const ageBreakdown: Record<string, number> = {};
                        session.roomsIncluded.forEach(rid => {
                          const room = rooms.find(r => r.id === rid);
                          const bracket = room?.ageGroup ?? 'Other';
                          ageBreakdown[bracket] = (ageBreakdown[bracket] ?? 0) + (roomCbrEnd[rid]?.length ?? 0);
                        });
                        const totalEnd = Object.values(ageBreakdown).reduce((a, b) => a + b, 0);

                        return (
                          <div key={session.id ?? idx}
                            className="rounded-xl border px-3 py-2 transition-all"
                            style={{
                              borderColor: dragOver === (session.id ?? session.groupLabel) ? '#6366f1' : colors.border,
                              backgroundColor: dragOver === (session.id ?? session.groupLabel) ? '#eef2ff' : colors.bg + '55',
                              outline: dragOver === (session.id ?? session.groupLabel) ? '2px dashed #6366f1' : 'none',
                            }}
                            onDragOver={e => { e.preventDefault(); setDragOver(session.id ?? session.groupLabel); }}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={e => {
                              e.preventDefault();
                              setDragOver(null);
                              if (!dragRef.current) return;
                              const { fromSessionKey, staffIdx } = dragRef.current;
                              const toKey = session.id ?? session.groupLabel;
                              if (fromSessionKey !== toKey) moveStaffBetweenGroups(fromSessionKey, toKey, staffIdx);
                              dragRef.current = null;
                            }}
                          >

                            {/* Header */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold" style={{ color: '#111827' }}>{session.groupLabel}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded-full border"
                                style={{ backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }}>
                                {colors.label}
                              </span>
                              <span className="text-xs font-medium" style={{ color: '#6b7280' }}>
                                ðŸ‘¶ {session.childrenCount}
                                {totalEnd !== session.childrenCount && (
                                  <span style={{ color: '#4338ca' }}> â†’ ~{totalEnd} by {minsToHHMM(t.endMins)}</span>
                                )}
                              </span>
                              {/* Ratio compliance badge - use END of period for peak count
                                   (morning: children still arriving; afternoon: children leaving) */}
                              {(() => {
                                const cbr = bestChildrenAt(t.endMins);
                                const kids = (session.roomsIncluded ?? []).flatMap(rid => cbr[rid] ?? []);
                                const required = kids.length > 0
                                  ? Math.max(2, calcRequired(kids))
                                  : 0;
                                const actual = session.staffIds.length;
                                const diff   = actual - required;
                                if (required === 0) return null;
                                return (
                                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                                    style={{
                                      backgroundColor: diff >= 0 ? '#dcfce7' : '#fee2e2',
                                      color:           diff >= 0 ? '#166534' : '#dc2626',
                                    }}>
                                    {diff > 0 ? `+${diff} surplus` : diff < 0 ? `${diff} short` : 'âœ… exact'}
                                    {' '}Â· {actual}/{required} staff
                                  </span>
                                );
                              })()}
                              <div className="ml-auto flex items-center gap-1.5">
                                {(session.confirmationStatus === 'suggested' || session.confirmationStatus === 'reconstructed') && (
                                  <button onClick={() => confirm(session)}
                                    className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                                    style={{ backgroundColor: '#16a34a' }}>âœ“</button>
                                )}
                                <button onClick={() => setEditingId(isEditing ? null : (session.id ?? `t${ti}-${idx}`))}
                                  className="text-xs px-2.5 py-1 rounded-lg border font-medium"
                                  style={{ borderColor: '#c7d2fe', color: '#4338ca', backgroundColor: 'white' }}>
                                  {isEditing ? 'Cancel' : 'Edit'}
                                </button>
                                {isEditing && (
                                  <button onClick={() => saveEdit(editable)}
                                    className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                                    style={{ backgroundColor: '#4338ca' }}>Save</button>
                                )}
                              </div>
                            </div>

                            {/* Per-room breakdown - shows anticipated count at END of stage */}
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                              {roomCounts.map(({ rid, name, countEnd }) => (
                                <span key={rid} className="text-xs">
                                  <span style={{ color: '#9ca3af' }}>{name}:</span>{' '}
                                  <span style={{ color: '#374151', fontWeight: 500 }}>{countEnd}</span>
                                </span>
                              ))}
                            </div>

                            {/* Age breakdown at end of stage */}
                            {totalEnd > 0 && (
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                {Object.entries(ageBreakdown).filter(([, c]) => c > 0).map(([bracket, count]) => (
                                  <span key={bracket} className="text-xs px-1.5 py-0.5 rounded"
                                    style={{ backgroundColor: '#f0f9ff', color: '#0369a1' }}>
                                    {bracket}: {count}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Held in room */}
                            {isMultiRoom && (
                              <div className="mt-1.5 flex items-center gap-2">
                                <span className="text-xs" style={{ color: '#9ca3af' }}>Held in:</span>
                                {isEditing ? (
                                  <select defaultValue={session.heldInRoom ?? ''}
                                    onChange={e => { editable.heldInRoom = e.target.value; }}
                                    className="text-xs border rounded-lg px-1.5 py-0.5"
                                    style={{ borderColor: '#c7d2fe', color: '#374151' }}>
                                    <option value="">- select room -</option>
                                    {session.roomsIncluded.map(rid => {
                                      const room = rooms.find(r => r.id === rid);
                                      return room ? <option key={rid} value={rid}>{room.name}</option> : null;
                                    })}
                                  </select>
                                ) : (
                                  <span className="text-xs font-medium" style={{ color: '#374151' }}>
                                    {rooms.find(r => r.id === session.heldInRoom)?.name
                                      ?? <span style={{ color: '#f59e0b' }}>Not set - tap Edit</span>}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Staff with shift times + move between groups */}
                            <div className="mt-1.5 flex flex-col gap-1">
                              {session.staffIds.map((empId, i) => {
                                const name = session.staffNames[i];
                                if (!name || name.startsWith('Staff #')) return null;
                                const assignedRoomId = (session.staffRooms ?? [])[i] ?? '';
                                const assignedRoom   = rooms.find(r => r.id === assignedRoomId);
                                const staffInfo      = allStaff.find(s => s.employeeId === empId);
                                const shiftLabel     = staffInfo?.shiftStart && staffInfo?.shiftEnd
                                  ? `${staffInfo.shiftStart} - ${staffInfo.shiftEnd}` : null;
                                const sessionKey = session.id ?? session.groupLabel;
                                return (
                                  <div key={i} className="flex items-center gap-2 flex-wrap">
                                    <span
                                      draggable
                                      onDragStart={() => { dragRef.current = { fromSessionKey: sessionKey, staffIdx: i }; }}
                                      onDragEnd={() => { dragRef.current = null; }}
                                      className="text-xs px-2 py-0.5 rounded-full border flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
                                      style={{ backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }}
                                      title="Drag to move to another group">
                                      â ¿ ðŸ‘¤ {name}
                                    </span>
                                    {shiftLabel && (
                                      <span className="text-xs flex-shrink-0" style={{ color: '#9ca3af' }}>{shiftLabel}</span>
                                    )}
                                    {isEditing ? (
                                      <select defaultValue={assignedRoomId}
                                        onChange={e => {
                                          const r2 = [...(editable.staffRooms ?? [])];
                                          while (r2.length <= i) r2.push('');
                                          r2[i] = e.target.value;
                                          editable.staffRooms = r2;
                                        }}
                                        className="text-xs border rounded-lg px-1.5 py-0.5"
                                        style={{ borderColor: '#c7d2fe', color: '#374151' }}>
                                        <option value="">- unassigned -</option>
                                        {session.roomsIncluded.map(rid => {
                                          const room = rooms.find(r => r.id === rid);
                                          return room ? <option key={rid} value={rid}>{room.name}</option> : null;
                                        })}
                                      </select>
                                    ) : assignedRoom ? (
                                      <span className="text-xs" style={{ color: '#6b7280' }}>â†’ {assignedRoom.name}</span>
                                    ) : null}
                                    {/* Move to another group */}
                                    {isEditing && t.sessions.length > 1 && (
                                      <select
                                        value=""
                                        onChange={e => {
                                          if (!e.target.value) return;
                                          moveStaffBetweenGroups(
                                            session.id ?? session.groupLabel,
                                            e.target.value,
                                            i,
                                          );
                                          setEditingId(null);
                                        }}
                                        className="text-xs border rounded-lg px-1.5 py-0.5"
                                        style={{ borderColor: '#f9a8d4', color: '#9d174d', backgroundColor: 'white' }}>
                                        <option value="">â†’ Move to group...</option>
                                        {t.sessions
                                          .filter(s => (s.id ?? s.groupLabel) !== (session.id ?? session.groupLabel))
                                          .map(s => (
                                            <option key={s.id ?? s.groupLabel} value={s.id ?? s.groupLabel}>
                                              {s.groupLabel}
                                            </option>
                                          ))}
                                      </select>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Add staff from broader pool when editing (e.g. to cover shortfalls) */}
                            {isEditing && (() => {
                              const startM = t.timeMins;
                              const endM   = t.endMins;
                              const currentIds = new Set(session.staffIds);
                              const available = allStaff.filter(s => {
                                if (currentIds.has(s.employeeId)) return false;
                                const ss  = toMins(s.shiftStart);
                                const se  = toMins(s.shiftEnd);
                                const eff = se === 0 ? 24 * 60 : se;
                                return ss <= endM && eff > startM;
                              });
                              if (available.length === 0) return null;
                              return (
                                <div className="mt-2">
                                  <select
                                    value=""
                                    onChange={e => {
                                      const empId = parseInt(e.target.value);
                                      const staff = available.find(s => s.employeeId === empId);
                                      if (!staff) return;
                                      editable.staffIds   = [...(editable.staffIds ?? session.staffIds), empId];
                                      editable.staffNames = [...(editable.staffNames ?? session.staffNames), staff.employeeName];
                                      editable.staffRooms = [...(editable.staffRooms ?? session.staffRooms ?? []), session.roomsIncluded[0] ?? ''];
                                      // Force re-render by triggering a state update
                                      patchSession({ ...editable });
                                    }}
                                    className="text-xs border rounded-lg px-2 py-1 w-full"
                                    style={{ borderColor: '#86efac', color: '#166534', backgroundColor: '#f0fdf4' }}>
                                    <option value="">+ Add staff to this group...</option>
                                    {['room','float','iss','support'].map(type => {
                                      const group = available.filter(s => s.type === type);
                                      if (group.length === 0) return null;
                                      const label = type === 'room' ? 'Room staff' : type === 'float' ? 'Float' : type === 'iss' ? 'ISS' : 'Support';
                                      return (
                                        <optgroup key={type} label={label}>
                                          {group.map(s => (
                                            <option key={s.employeeId} value={s.employeeId}>
                                              {s.employeeName} ({s.shiftStart}-{s.shiftEnd})
                                            </option>
                                          ))}
                                        </optgroup>
                                      );
                                    })}
                                  </select>
                                </div>
                              );
                            })()}

                            {/* Session note + per-room notes */}
                            {isEditing ? (
                              <div className="mt-2 space-y-1.5">
                                {/* Session-level note */}
                                <textarea
                                  defaultValue={parseNotes(session.notes).sessionNote}
                                  placeholder="General note for this grouping..."
                                  rows={2}
                                  onChange={e => {
                                    const cur = parseNotes(editable.notes ?? session.notes);
                                    editable.notes = serializeNotes(e.target.value, cur.roomNotes);
                                  }}
                                  className="w-full text-xs border rounded-lg px-2 py-1.5 resize-none"
                                  style={{ borderColor: '#c7d2fe', color: '#374151' }}
                                />
                                {/* Per-room notes */}
                                {session.roomsIncluded.length > 1 && (
                                  <div className="space-y-1">
                                    <div className="text-xs font-semibold" style={{ color: '#6b7280' }}>Room notes</div>
                                    {session.roomsIncluded.map(rid => {
                                      const room = rooms.find(r => r.id === rid);
                                      if (!room) return null;
                                      return (
                                        <div key={rid} className="flex items-center gap-2">
                                          <span className="text-xs flex-shrink-0 font-medium" style={{ color: '#374151', minWidth: 100 }}>
                                            ðŸ“ {room.name}
                                          </span>
                                          <input
                                            type="text"
                                            defaultValue={parseNotes(session.notes).roomNotes[rid] ?? ''}
                                            placeholder="Add note..."
                                            onChange={e => {
                                              const cur = parseNotes(editable.notes ?? session.notes);
                                              cur.roomNotes[rid] = e.target.value;
                                              editable.notes = serializeNotes(cur.sessionNote, cur.roomNotes);
                                            }}
                                            className="flex-1 text-xs border rounded-lg px-2 py-1"
                                            style={{ borderColor: '#e5e7eb', color: '#374151' }}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ) : (() => {
                              const { sessionNote, roomNotes } = parseNotes(session.notes);
                              const hasRoom = Object.values(roomNotes).some(n => n.trim());
                              return (
                                <>
                                  {sessionNote && (
                                    <div className="mt-1.5 text-xs px-2 py-1 rounded-lg"
                                      style={{ backgroundColor: '#fefce8', color: '#713f12', borderLeft: '3px solid #fde047' }}>
                                      ðŸ’¬ {sessionNote}
                                    </div>
                                  )}
                                  {hasRoom && (
                                    <div className="mt-1.5 space-y-0.5">
                                      {session.roomsIncluded.map(rid => {
                                        const note = roomNotes[rid];
                                        if (!note?.trim()) return null;
                                        const room = rooms.find(r => r.id === rid);
                                        return (
                                          <div key={rid} className="text-xs px-2 py-0.5 rounded"
                                            style={{ backgroundColor: '#f0f9ff', color: '#0369a1', borderLeft: '2px solid #7dd3fc' }}>
                                            ðŸ“ {room?.name}: {note}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </>
                              );
                            })()}

                            {session.confirmedBy && session.confirmationStatus === 'confirmed' && (
                              <div className="mt-1 text-xs" style={{ color: '#9ca3af' }}>Confirmed by {session.confirmedBy}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>)}
                  </div>

                );
              }).reduce<React.ReactNode[]>((acc, node, ti) => {
                acc.push(node);
                const nextSessions = transitions[ti + 1]?.sessions;
                if (!nextSessions || nextSessions.length === rooms.length) return acc;
                acc.push(
                  <div key={`add-${ti}`} className="flex justify-center py-1 border-t" style={{ borderColor: '#f3f4f6' }}>
                    <button onClick={() => addStageAfter(ti)}
                      className="text-xs px-3 py-0.5 rounded-full border"
                      style={{ borderColor: '#c7d2fe', color: '#6366f1', backgroundColor: 'white' }}>
                      + Add stage
                    </button>
                  </div>
                );
                return acc;
              }, [])}

              {/* Add stage between last transition and end */}
              {transitions.length > 0 && transitions[transitions.length-1]?.sessions.length !== rooms.length && (
                <div className="px-4 py-1 flex justify-center border-t" style={{ borderColor: '#f3f4f6' }}>
                  <button
                    onClick={() => addStageAfter(transitions.length - 1)}
                    className="text-xs px-3 py-1 rounded-lg border"
                    style={{ borderColor: '#c7d2fe', color: '#4338ca', backgroundColor: 'white' }}>
                    + Add stage
                  </button>
                </div>
              )}
              <div className="px-4 py-2 text-xs" style={{ color: '#9ca3af' }}>
                Confirmed groupings feed into the Reg 151 report.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function GroupingPanel({ centreId, date, rooms, attendanceChildren: children, rosters, floats, issStaff, supportStaff }: Props) {
  const allStaff: StaffAvailable[] = [
    ...rosters.map(s => ({ employeeId: s.employeeId, employeeName: s.employeeName, shiftStart: deputyToHHMM(s.startTime), shiftEnd: deputyToHHMM(s.endTime), type: 'room' as const, unitId: s.unitId })),
    ...floats.map(s => ({ employeeId: s.employeeId, employeeName: s.employeeName, shiftStart: deputyToHHMM(s.startTime), shiftEnd: deputyToHHMM(s.endTime), type: 'float' as const, unitId: s.unitId })),
    ...issStaff.map(s => ({ employeeId: s.employeeId, employeeName: s.employeeName, shiftStart: deputyToHHMM(s.startTime), shiftEnd: deputyToHHMM(s.endTime), type: 'iss' as const, unitId: s.unitId })),
    ...supportStaff.map(s => ({ employeeId: s.employeeId, employeeName: s.employeeName, shiftStart: deputyToHHMM(s.startTime), shiftEnd: deputyToHHMM(s.endTime), type: 'support' as const, unitId: s.unitId })),
  ];

  const [panelCollapsed, setPanelCollapsed] = useState(false);

  return (
    <div className="rounded-2xl border overflow-hidden shadow-sm mb-6" style={{ borderColor: '#c7d2fe' }}>
      <div className="px-4 py-3 flex items-center gap-3 cursor-pointer select-none"
        style={{ backgroundColor: '#eef2ff' }}
        onClick={() => setPanelCollapsed(c => !c)}>
        <span className="text-sm font-bold" style={{ color: '#3730a3' }}>ðŸ« Room Groupings</span>
        <span className="text-xs" style={{ color: '#6366f1' }}>Morning &amp; Afternoon consolidation</span>
        {isFuture(date) && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#e0e7ff', color: '#4338ca' }}>
            ðŸ“‹ Planning mode
          </span>
        )}
        <span className="text-xs ml-auto" style={{ color: '#6366f1' }}>{panelCollapsed ? 'â–¾' : 'â–´'}</span>
      </div>

      {!panelCollapsed && (
        <div>
          {WINDOWS.map(win => (
            <WindowSection
              key={win.key}
              win={win}
              centreId={centreId}
              date={date}
              rooms={rooms}
              allStaff={allStaff}
              children={children}
            />
          ))}
        </div>
      )}
    </div>
  );
}
