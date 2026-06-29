import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import Layout from '../components/Layout';
import { CENTRES, LUNCH_WINDOW } from '../config';
import { fetchRosters, fetchAbsentStaff } from '../deputy';
import { getAttendance, setAttendance, getStaffRequired, formatTime } from '../attendance';
import type { RosteredStaff, AbsentStaff } from '../types';
import {
  fetchAttendanceForDate,
  fetchTrends,
  fetchForecast,
  groupAttendanceByRoom,
  getForecastPeak,
  getForecastForSlot,
  type AttendanceRecord,
  type TrendRecord,
  type ForecastData,
} from '../api/ownaData';
import { buildRoomTimeline, generateTimeSlots, type RoomTimeSlot } from '../utils/timeline';
import { casualsNeeded, getTrendRate, formatRate } from '../utils/trends';
import { runOptimizer, roleLabel } from '../utils/rosterOptimizer';
import { getCentreRuleSet } from '../utils/centreConfigStorage';
import type { AllocationPlan } from '../types/config';

const centre = CENTRES[0];
const allRoomUnitIds = centre.rooms.map(r => r.deputyUnitId);
// Include float (224) and leave units (134 Annual Leave, 142 Sick Leave) in the query
const FLOAT_UNIT_ID = 224;
const LEAVE_UNIT_IDS_POD = [134, 142];
const allQueryUnitIds = [...allRoomUnitIds, FLOAT_UNIT_ID, ...LEAVE_UNIT_IDS_POD];

const STATUS_COLOR = { green: '#16a34a', amber: '#d97706', red: '#dc2626' };
const STATUS_BG = { green: '#dcfce7', amber: '#fef3c7', red: '#fee2e2' };
const STATUS_LABEL = { green: 'Fully Staffed', amber: 'Marginal', red: 'Understaffed' };

// Roles that don't count towards ratio by default
const DEFAULT_EXCLUDED_ROLES = ['Director', 'Cook', 'Admin'];

export default function DayDetailPage() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();

  const [rosters, setRosters] = useState<RosteredStaff[]>([]);
  const [absentStaff, setAbsentStaff] = useState<AbsentStaff[]>([]);
  const [attendance, setAttendanceState] = useState<Record<string, number>>({});
  const [ownaAttendance, setOwnaAttendance] = useState<AttendanceRecord[]>([]);
  const [trends, setTrends] = useState<TrendRecord[]>([]);
  const [forecast, setForecast] = useState<ForecastData>({});
  const [hasForecast, setHasForecast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ownaLoading, setOwnaLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [excludedRoles, setExcludedRoles] = useState<string[]>(
    () => JSON.parse(localStorage.getItem('pod_excluded_roles') || JSON.stringify(DEFAULT_EXCLUDED_ROLES))
  );
  const [activeTab, setActiveTab] = useState<'timeline' | 'rooms' | 'casuals' | 'plan'>('timeline');
  const [allocationPlan, setAllocationPlan] = useState<AllocationPlan | null>(null);

  // Lunch allocations — ordered schedule of who each float is covering
  interface LunchSlot {
    coveringName: string;
    coveringRoom: string;
    slotStart: string; // e.g. '12:00'
    slotEnd: string;   // e.g. '12:30'
  }
  interface LunchAllocation {
    floatEmployeeId: number;
    floatName: string;
    mode: 'ratio' | 'lunch';
    ratioRoom: string;   // used when mode='ratio'
    slots: LunchSlot[];  // ordered lunch coverage schedule
  }
  const [lunchAllocations, setLunchAllocations] = useState<LunchAllocation[]>(() => {
    try { return JSON.parse(localStorage.getItem(`pod_lunch_alloc_${date || ''}`) || '[]'); }
    catch { return []; }
  });

  function getLunchAlloc(floatId: number): LunchAllocation | undefined {
    return lunchAllocations.find(a => a.floatEmployeeId === floatId);
  }


  function upsertAlloc(floatId: number, floatName: string, patch: Partial<LunchAllocation>) {
    setLunchAllocations(prev => {
      const exists = prev.find(a => a.floatEmployeeId === floatId);
      let next: LunchAllocation[];
      if (exists) {
        next = prev.map(a => a.floatEmployeeId === floatId ? { ...a, ...patch } : a);
      } else {
        next = [...prev, { floatEmployeeId: floatId, floatName, mode: 'lunch', ratioRoom: '', slots: [], ...patch }];
      }
      localStorage.setItem(`pod_lunch_alloc_${date || ''}`, JSON.stringify(next));
      return next;
    });
  }

  function updateSlot(floatId: number, slotIdx: number, patch: Partial<LunchSlot>) {
    setLunchAllocations(prev => {
      const next = prev.map(a => {
        if (a.floatEmployeeId !== floatId) return a;
        const slots = a.slots.map((s, i) => i === slotIdx ? { ...s, ...patch } : s);
        return { ...a, slots };
      });
      localStorage.setItem(`pod_lunch_alloc_${date || ''}`, JSON.stringify(next));
      return next;
    });
  }

  function addSlot(floatId: number) {
    setLunchAllocations(prev => {
      const next = prev.map(a => {
        if (a.floatEmployeeId !== floatId) return a;
        const last = a.slots[a.slots.length - 1];
        const newStart = last?.slotEnd || '12:00';
        const [h, m] = newStart.split(':').map(Number);
        const endMins = (h * 60 + m + 30) % (24 * 60);
        const newEnd = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
        return { ...a, slots: [...a.slots, { coveringName: '', coveringRoom: '', slotStart: newStart, slotEnd: newEnd }] };
      });
      localStorage.setItem(`pod_lunch_alloc_${date || ''}`, JSON.stringify(next));
      return next;
    });
  }

  function removeSlot(floatId: number, slotIdx: number) {
    setLunchAllocations(prev => {
      const next = prev.map(a => {
        if (a.floatEmployeeId !== floatId) return a;
        return { ...a, slots: a.slots.filter((_, i) => i !== slotIdx) };
      });
      localStorage.setItem(`pod_lunch_alloc_${date || ''}`, JSON.stringify(next));
      return next;
    });
  }
  const timelineRef = useRef<HTMLDivElement>(null);

  const safeDate = date || format(new Date(), 'yyyy-MM-dd');
  const dateObj = parseISO(safeDate);
  const dateLabel = format(dateObj, 'EEEE, d MMMM yyyy');
  // reserved: const dayOfWeek = dateObj.getDay();

  // Load attendance from localStorage
  useEffect(() => {
    const att: Record<string, number> = {};
    for (const room of centre.rooms) {
      att[room.id] = getAttendance(safeDate, room.id);
    }
    setAttendanceState(att);
  }, [safeDate]);

  // Load Deputy data + run optimizer
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchRosters(safeDate, allQueryUnitIds),
      fetchAbsentStaff(safeDate, allQueryUnitIds),
    ]).then(([r, a]) => {
      setRosters(r);
      setAbsentStaff(a);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [safeDate]);

  // Load Owna data from Supabase + forecast
  useEffect(() => {
    setOwnaLoading(true);
    Promise.all([
      fetchAttendanceForDate('oatley', safeDate),
      fetchTrends('oatley'),
      fetchForecast('oatley', safeDate),
    ]).then(([att, tr, fc]) => {
      setOwnaAttendance(att);
      setTrends(tr);
      setForecast(fc);
      setHasForecast(Object.keys(fc).length > 0);
      setOwnaLoading(false);
    }).catch(() => setOwnaLoading(false));
  }, [safeDate]);

  // Run optimizer whenever rosters or attendance data changes
  useEffect(() => {
    if (loading || ownaLoading) return;
    const ruleSet = getCentreRuleSet(centre.id);
    const ownaByRoomLocal = groupAttendanceByRoom(ownaAttendance);
    const hasLive = ownaAttendance.length > 0;

    const roomAttendance: Record<string, number> = {};
    for (const room of centre.rooms) {
      const ownaName = room.ownaRoomName || room.name;
      const roomOwna = ownaByRoomLocal[ownaName] || [];
      const trendRate = getTrendRate(room.ownaRoomName || room.name, safeDate, trends);
      if (hasLive) {
        const booked = roomOwna.length;
        roomAttendance[room.id] = Math.round(booked * trendRate);
      } else if (Object.keys(forecast).length > 0) {
        const peak = getForecastPeak(forecast, ownaName);
        roomAttendance[room.id] = Math.round(peak);
      } else {
        roomAttendance[room.id] = attendance[room.id] ?? 0;
      }
    }

    const plan = runOptimizer({
      rooms: centre.rooms.map(r => ({
        id: r.id,
        name: r.name,
        ratio: r.ratio,
        deputyUnitId: r.deputyUnitId,
      })),
      rosters,
      roomAttendance,
      ruleSet,
      floatUnitId: FLOAT_UNIT_ID,
      ignoreUnitIds: LEAVE_UNIT_IDS_POD,
    });
    setAllocationPlan(plan);
  }, [loading, ownaLoading, rosters, ownaAttendance, forecast, attendance, safeDate, trends]);

  function handleAttendanceChange(roomId: string, value: number) {
    setAttendanceState(prev => ({ ...prev, [roomId]: value }));
    setAttendance(safeDate, roomId, value);
  }

  function toggleExcludedRole(role: string) {
    setExcludedRoles(prev => {
      const next = prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role];
      localStorage.setItem('pod_excluded_roles', JSON.stringify(next));
      return next;
    });
  }

  // Group Owna attendance by room (keyed by Owna room name, e.g. "0-1 Room")
  const ownaByRoom = groupAttendanceByRoom(ownaAttendance);
  const hasLiveData = ownaAttendance.length > 0;

  // Compute room stats
  const roomStats = centre.rooms.map(room => {
    // Use Owna room name for attendance lookup (Owna uses "0-1 Room", not "Explorers")
    const ownaName = room.ownaRoomName || room.name;
    const roomOwna = ownaByRoom[ownaName] || [];
    const liveSignedIn = roomOwna.filter(r => r.sign_in && !r.sign_out).length;
    const totalSignedIn = roomOwna.filter(r => r.sign_in).length;

    // Booked = total children enrolled for this room today (Owna scrapes ALL children,
    // including those who are absent — sign_in is null for no-shows)
    // For today's date, show actual signed-in children instead of total booked
    // Falls back to localStorage manual override if no Owna data (future dates)
    const signedInFromOwna = roomOwna.filter(r => r.sign_in).length;
    const booked = hasLiveData ? signedInFromOwna : (attendance[room.id] ?? 0);

    // Anticipated = booked × historical attendance rate (ALWAYS ≤ booked)
    // This is the planning number: how many we expect to show up based on past patterns
    const trendRate = getTrendRate(ownaName, safeDate, trends);
    const anticipated = Math.round(booked * trendRate);
    
    const staffRequired = getStaffRequired(anticipated, room.ratio);
    const roomRosters = rosters.filter(r => r.unitId === room.deputyUnitId);
    const uniqueStaff = [...new Map(roomRosters.map(r => [r.employeeId, r])).values()];
    
    // Filter excluded roles from count
    const countableStaff = uniqueStaff.filter(s =>
      !excludedRoles.some(role => s.employeeName.toLowerCase().includes(role.toLowerCase()))
    );
    
    const staffRostered = countableStaff.length;
    const diff = staffRostered - staffRequired;
    const casuals = casualsNeeded(staffRostered, anticipated, room.ratio);

    // Build timeline
    const timeline = buildRoomTimeline(
      safeDate,
      roomOwna,
      rosters,
      room.deputyUnitId,
      room.ratio,
      anticipated,
    );

    const overallStatus: 'green' | 'amber' | 'red' = diff >= 0 ? 'green' : diff >= -1 ? 'amber' : 'red';

    return {
      room,
      booked,
      anticipated,
      liveSignedIn,
      totalSignedIn,
      trendRate,
      staffRequired,
      staffRostered,
      uniqueStaff,
      diff,
      casuals,
      status: overallStatus,
      timeline,
      roomOwna,
    };
  });

  // Float staff
  const floatRosters = rosters.filter(r => r.unitId === 224);
  const floatStaff = [...new Map(floatRosters.map(r => [r.employeeId, r])).values()];

  // Auto-assign floats — ratio gaps first, then ordered lunch coverage schedule
  useEffect(() => {
    if (floatStaff.length === 0 || loading) return;
    const existing = lunchAllocations.map(a => a.floatEmployeeId);
    const unassigned = floatStaff.filter(s => !existing.includes(s.employeeId));
    if (unassigned.length === 0) return;

    // Rooms with a staffing deficit (ratio priority)
    const understaffed = [...roomStats].filter(r => r.diff < 0).sort((a, b) => a.diff - b.diff);

    // All countable staff across all rooms (for lunch schedule)
    const allCountableStaff: { name: string; room: string }[] = [];
    for (const rs of [...roomStats].sort((a, b) => b.staffRostered - a.staffRostered)) {
      for (const s of rs.uniqueStaff) {
        if (!excludedRoles.some(role => s.employeeName.toLowerCase().includes(role.toLowerCase()))) {
          allCountableStaff.push({ name: s.employeeName, room: rs.room.name });
        }
      }
    }

    // Helper: add minutes to a HH:MM string
    function addMins(time: string, mins: number): string {
      const [h, m] = time.split(':').map(Number);
      const total = h * 60 + m + mins;
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }

    let ratioQueue = [...understaffed];
    const newAllocs: LunchAllocation[] = [];

    unassigned.forEach((floatMember, floatIdx) => {
      if (ratioQueue.length > 0) {
        // Fill ratio gap — assign to understaffed room
        const targetRoom = ratioQueue.shift()!;
        newAllocs.push({
          floatEmployeeId: floatMember.employeeId,
          floatName: floatMember.employeeName,
          mode: 'ratio',
          ratioRoom: targetRoom.room.name,
          slots: [],
        });
      } else {
        // Build ordered lunch coverage schedule for this float
        // Split staff evenly across floats assigned to lunch
        const lunchFloatCount = unassigned.length - understaffed.length;
        const lunchFloatIdx = floatIdx - understaffed.length;
        const staffForThisFloat = allCountableStaff.filter((_, i) => i % lunchFloatCount === lunchFloatIdx);

        let slotStart = '12:00';
        const slots: LunchSlot[] = staffForThisFloat.map(person => {
          const slotEnd = addMins(slotStart, 30);
          const slot: LunchSlot = { coveringName: person.name, coveringRoom: person.room, slotStart, slotEnd };
          slotStart = slotEnd;
          return slot;
        });

        newAllocs.push({
          floatEmployeeId: floatMember.employeeId,
          floatName: floatMember.employeeName,
          mode: 'lunch',
          ratioRoom: '',
          slots,
        });
      }
    });

    if (newAllocs.length > 0) {
      setLunchAllocations(prev => {
        const next = [...prev, ...newAllocs];
        localStorage.setItem(`pod_lunch_alloc_${date || ''}`, JSON.stringify(next));
        return next;
      });
    }
  }, [floatStaff.length, loading]);

  // Totals
  const totalBooked = roomStats.reduce((s, r) => s + r.booked, 0);
  const totalAnticipated = roomStats.reduce((s, r) => s + r.anticipated, 0);
  const totalSignedIn = roomStats.reduce((s, r) => s + r.liveSignedIn, 0);
  const totalRequired = roomStats.reduce((s, r) => s + r.staffRequired, 0);
  const totalRostered = roomStats.reduce((s, r) => s + r.staffRostered, 0);
  // Use optimizer result when available; fall back to manual float calculation
  const totalDeficit = roomStats.reduce((s, r) => s + r.casuals, 0);
  const floatsAvailable = floatStaff.length;
  const floatsUsed = Math.min(floatsAvailable, totalDeficit);
  const totalCasuals = allocationPlan
    ? allocationPlan.totalCasualsNeeded
    : Math.max(0, totalDeficit - floatsAvailable);
  const totalDiff = totalRostered - totalRequired;
  const overallStatus: 'green' | 'amber' | 'red' =
    totalDiff >= 0 ? 'green' : totalDiff >= -1 ? 'amber' : 'red';

  // Forecast summary for banner
  const forecastTotalChildren = hasForecast && !hasLiveData
    ? centre.rooms.reduce((sum, room) => {
        const ownaName = room.ownaRoomName || room.name;
        const peak = getForecastPeak(forecast, ownaName);
        return sum + Math.round(peak);
      }, 0)
    : null;
  const forecastTotalRequired = forecastTotalChildren !== null
    ? centre.rooms.reduce((sum, room) => {
        const ownaName = room.ownaRoomName || room.name;
        const peak = getForecastPeak(forecast, ownaName);
        return sum + getStaffRequired(Math.round(peak), room.ratio);
      }, 0)
    : null;
  const showForecastBanner = hasForecast && !hasLiveData;
  const forecastBannerStatus: 'green' | 'amber' | 'red' =
    forecastTotalRequired !== null && forecastTotalChildren !== null
      ? (totalRostered >= (forecastTotalRequired || 0) ? 'green' : totalRostered >= (forecastTotalRequired || 0) - 1 ? 'amber' : 'red')
      : 'amber';

  // Rooms needing casuals (after float coverage)
  const casualsNeededRooms = roomStats.filter(r => r.casuals > 0);

  // Timeline slots for header (all rooms)
  const timeSlots = generateTimeSlots(safeDate);
  // Show every 4th slot label (hourly)
  const showLabel = (i: number) => i % 4 === 0;

  return (
    <Layout>
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="no-print mb-4 flex items-center gap-2 text-sm font-medium transition-colors"
        style={{ color: '#5a9228' }}
      >
        ← Back to Week
      </button>

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2d5c18' }}>{dateLabel}</h1>
          <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
            Oatley Centre — Staffing Intelligence Dashboard
          </p>
          {hasLiveData && !ownaLoading && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-xs font-medium text-green-700">Live Owna data active</span>
            </div>
          )}
          {!hasLiveData && !ownaLoading && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-2 h-2 rounded-full bg-amber-400"></div>
              <span className="text-xs text-amber-700">No live sign-in data — showing trend estimates</span>
            </div>
          )}
          {ownaLoading && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse"></div>
              <span className="text-xs text-gray-500">Loading Owna data…</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 no-print">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-2 rounded-lg border text-sm font-medium transition-colors"
            style={{ borderColor: '#c0d0c0', color: '#596570' }}
          >
            ⚙️ Settings
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg border font-medium text-sm transition-colors"
            style={{ borderColor: '#5a9228', color: '#5a9228' }}
          >
            🖨 Print
          </button>
        </div>
      </div>

      {/* ── HEADER SUMMARY BAR ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {[
          { label: 'Booked', value: totalBooked, sub: 'children' },
          { label: 'Anticipated', value: totalAnticipated, sub: 'children' },
          { label: 'Signed In', value: hasLiveData ? totalSignedIn : '—', sub: 'live' },
          { label: 'Staff Rostered', value: totalRostered, sub: 'educators' },
          { label: 'Staff Required', value: totalRequired, sub: 'for ratio' },
          {
            label: 'Casuals Needed',
            value: totalCasuals > 0 ? `+${totalCasuals}` : floatsUsed > 0 ? '🔄' : '✓',
            sub: totalCasuals > 0 ? `after ${floatsAvailable} float${floatsAvailable !== 1 ? 's' : ''}` : floatsUsed > 0 ? 'floats cover it' : 'all good',
            alert: totalCasuals > 0,
          },
        ].map(stat => (
          <div
            key={stat.label}
            className="bg-white rounded-xl p-3 border"
            style={{
              borderColor: stat.alert ? '#fca5a5' : '#e0e8e0',
              backgroundColor: stat.alert ? '#fff5f5' : 'white',
            }}
          >
            <div className="text-xs font-medium mb-0.5" style={{ color: '#596570' }}>{stat.label}</div>
            <div
              className="text-2xl font-bold"
              style={{ color: stat.alert ? '#dc2626' : '#A0D083' }}
            >
              {stat.value}
            </div>
            <div className="text-xs" style={{ color: '#9aaa9a' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Overall status banner */}
      <div
        className="rounded-xl px-4 py-3 mb-5 flex items-center gap-3 flex-wrap"
        style={{ backgroundColor: STATUS_BG[overallStatus] }}
      >
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLOR[overallStatus] }}></div>
        <span className="font-semibold" style={{ color: STATUS_COLOR[overallStatus] }}>
          {STATUS_LABEL[overallStatus]}
        </span>
        {loading && <span className="text-sm opacity-60">— Loading Deputy data…</span>}
        {totalCasuals > 0 && (
          <span className="ml-auto text-sm font-medium" style={{ color: '#dc2626' }}>
            ⚠️ {totalCasuals} casual{totalCasuals > 1 ? 's' : ''} needed ({floatsAvailable > 0 ? `${floatsAvailable} float${floatsAvailable > 1 ? 's' : ''} available` : 'no floats rostered'})
          </span>
        )}
        {totalCasuals === 0 && floatsUsed > 0 && (
          <span className="ml-auto text-sm font-medium" style={{ color: '#1d4ed8' }}>
            🔄 {floatsUsed} float{floatsUsed > 1 ? 's' : ''} covering room gaps
          </span>
        )}
      </div>

      {/* Forecast banner */}
      {showForecastBanner && (
        <div
          className="rounded-xl px-4 py-3 mb-4 flex items-center gap-3 flex-wrap no-print"
          style={{
            backgroundColor: forecastBannerStatus === 'green' ? '#f0fdf4' : forecastBannerStatus === 'amber' ? '#fffbeb' : '#fef2f2',
            border: `1px solid ${forecastBannerStatus === 'green' ? '#E2F1DA' : forecastBannerStatus === 'amber' ? '#fde68a' : '#fca5a5'}`,
          }}
        >
          <span className="text-lg">📊</span>
          <div className="flex-1">
            <span className="font-semibold text-sm" style={{ color: '#2d5c18' }}>Forecast (based on historical data)</span>
            <span className="text-sm ml-2" style={{ color: '#596570' }}>
              ~{forecastTotalChildren} children expected, {forecastTotalRequired} staff needed, {totalRostered} rostered
            </span>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{
              backgroundColor: STATUS_COLOR[forecastBannerStatus] + '22',
              color: STATUS_COLOR[forecastBannerStatus],
            }}
          >
            {forecastBannerStatus === 'green' ? 'Well staffed' : forecastBannerStatus === 'amber' ? 'Marginal' : 'Understaffed'}
          </span>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-white rounded-2xl border p-5 mb-5 no-print" style={{ borderColor: '#e0e8e0' }}>
          <h3 className="font-semibold mb-3" style={{ color: '#2d5c18' }}>Centre Settings</h3>
          <p className="text-sm mb-3" style={{ color: '#596570' }}>
            Select roles that do <strong>not</strong> count towards educator-to-child ratios:
          </p>
          <div className="flex flex-wrap gap-3">
            {['Director', 'Cook', 'Admin', 'Trainee (0.5×)'].map(role => (
              <label key={role} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludedRoles.includes(role)}
                  onChange={() => toggleExcludedRole(role)}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: '#5a9228' }}
                />
                <span className="text-sm" style={{ color: '#2d5c18' }}>{role}</span>
              </label>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: '#9aaa9a' }}>Settings saved in your browser.</p>
        </div>
      )}

      {/* ── TAB NAVIGATION ── */}
      <div className="flex gap-1 mb-5 no-print bg-white rounded-xl p-1 border" style={{ borderColor: '#e0e8e0' }}>
        {([
          { id: 'timeline', label: '📊 Timeline' },
          { id: 'rooms', label: '🏫 Rooms' },
          { id: 'plan', label: allocationPlan && allocationPlan.totalCasualsNeeded === 0 ? '✅ Roster Plan' : allocationPlan && allocationPlan.totalCasualsNeeded > 0 ? `🚨 Roster Plan (${allocationPlan.totalCasualsNeeded} casual${allocationPlan.totalCasualsNeeded > 1 ? 's' : ''})` : '📋 Roster Plan' },
          { id: 'casuals', label: totalCasuals > 0 ? `🚨 Casuals (${totalCasuals})` : totalDeficit > 0 ? `🔄 Floats cover gaps` : `✅ Staffing` },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all"
            style={{
              backgroundColor: activeTab === tab.id ? '#5a9228' : 'transparent',
              color: activeTab === tab.id ? 'white' : '#596570',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TIMELINE TAB ── */}
      {activeTab === 'timeline' && (
        <div className="bg-white rounded-2xl border overflow-hidden mb-5" style={{ borderColor: '#e0e8e0' }}>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#e0e8e0' }}>
            <div>
              <h2 className="font-semibold" style={{ color: '#2d5c18' }}>15-Minute Staffing Timeline</h2>
              <p className="text-xs mt-0.5" style={{ color: '#596570' }}>
                🟢 Staffed &nbsp; 🟡 Marginal &nbsp; 🔴 Understaffed &nbsp; ⬜ No children
              </p>
            </div>
            <div className="text-xs" style={{ color: '#9aaa9a' }}>6:00 AM → 6:30 PM</div>
          </div>

          <div className="overflow-x-auto" ref={timelineRef}>
            <div style={{ minWidth: '800px' }}>
              {/* Time axis header */}
              <div className="flex border-b" style={{ borderColor: '#f0f4f0' }}>
                <div className="flex-shrink-0 w-28 px-3 py-2 text-xs font-semibold" style={{ color: '#596570' }}>Room</div>
                <div className="flex flex-1">
                  {timeSlots.map((slot, i) => (
                    <div
                      key={i}
                      className="flex-1 text-center"
                      style={{ minWidth: '14px', fontSize: '10px', color: '#9aaa9a', padding: '4px 0' }}
                    >
                      {showLabel(i) ? `${slot.hour === 12 ? 12 : slot.hour > 12 ? slot.hour - 12 : slot.hour}${slot.hour < 12 ? 'a' : 'p'}` : ''}
                    </div>
                  ))}
                </div>
              </div>

              {/* Room rows */}
              {roomStats.map(({ room, timeline }) => {
                const ownaName = room.ownaRoomName || room.name;
                const roomForecast = forecast[ownaName];
                const forecastPeak = hasForecast && !hasLiveData ? getForecastPeak(forecast, ownaName) : 0;
                return (
                  <div key={room.id} className="flex items-center border-b" style={{ borderColor: '#f5f7f5' }}>
                    <div className="flex-shrink-0 w-28 px-3 py-2">
                      <div className="text-xs font-semibold" style={{ color: '#2d5c18' }}>{room.name}</div>
                      <div className="text-xs" style={{ color: '#9aaa9a' }}>{room.ageGroup}</div>
                      {hasForecast && !hasLiveData && forecastPeak > 0 && (
                        <div className="text-xs mt-0.5 px-1.5 py-0.5 rounded inline-block" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', fontSize: '10px' }}>
                          📊 ~{Math.round(forecastPeak)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 h-10 items-stretch gap-px px-px relative">
                      {/* Forecast overlay bars */}
                      {hasForecast && !hasLiveData && roomForecast && (
                        <div className="absolute inset-0 flex gap-px px-px pointer-events-none" style={{ opacity: 0.3 }}>
                          {timeSlots.map((slot, i) => {
                            const slotStr = `${String(slot.hour).padStart(2,'0')}:${String(slot.minute).padStart(2,'0')}`;
                            const forecastCount = getForecastForSlot(forecast, ownaName, slotStr);
                            const maxForecast = forecastPeak || 1;
                            const pct = Math.min(forecastCount / maxForecast, 1);
                            return (
                              <div
                                key={i}
                                className="flex-1 flex items-end"
                              >
                                <div
                                  style={{
                                    width: '100%',
                                    height: `${Math.round(pct * 100)}%`,
                                    backgroundColor: '#0369a1',
                                    borderRadius: '2px 2px 0 0',
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {timeline.map((slot, i) => (
                        <TimelineCell
                          key={i}
                          slot={slot}
                          showTooltip={true}
                          roomName={room.name}
                          ratio={room.ratio}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t flex flex-wrap gap-4 text-xs" style={{ borderColor: '#f0f4f0', color: '#596570' }}>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-green-200 border border-green-400"></div>
              <span>Adequate staffing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-amber-200 border border-amber-400"></div>
              <span>1 staff short</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-red-200 border border-red-400"></div>
              <span>Understaffed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200"></div>
              <span>No children</span>
            </div>
          </div>
        </div>
      )}

      {/* ── ROSTER PLAN TAB ── */}
      {activeTab === 'plan' && (
        <div className="mb-5">
          {/* Config link */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-lg" style={{ color: '#2d5c18' }}>Optimised Roster Plan</h2>
              <p className="text-xs mt-0.5" style={{ color: '#596570' }}>
                How to deploy available staff to meet ratios — casuals only after all options exhausted
              </p>
            </div>
            <a href="/config" className="text-xs px-3 py-1.5 rounded-lg border font-medium no-print"
               style={{ borderColor: '#c0d0c0', color: '#5a9228' }}>
              ⚙️ Rules
            </a>
          </div>

          {!allocationPlan ? (
            <div className="bg-white rounded-2xl border p-8 text-center" style={{ borderColor: '#e0e8e0' }}>
              <div className="animate-pulse text-gray-400 text-sm">Building plan…</div>
            </div>
          ) : (
            <>
              {/* Summary banner */}
              <div
                className="rounded-2xl px-5 py-4 mb-4 border"
                style={{
                  backgroundColor: allocationPlan.totalCasualsNeeded === 0 ? '#f0fdf4' : '#fef2f2',
                  borderColor: allocationPlan.totalCasualsNeeded === 0 ? '#E2F1DA' : '#fca5a5',
                }}
              >
                {allocationPlan.summary.map((line, i) => (
                  <p key={i} className="text-sm font-medium" style={{ color: '#2d5c18' }}>{line}</p>
                ))}
              </div>

              {/* Room allocations */}
              <div className="space-y-3">
                {allocationPlan.rooms.map(room => {
                  const statusColor = room.casualsNeeded > 0 ? '#dc2626' : room.gap < 0 ? '#d97706' : '#16a34a';
                  const statusBg = room.casualsNeeded > 0 ? '#fff5f5' : room.gap < 0 ? '#fffbeb' : '#f0fdf4';
                  const statusLabel = room.casualsNeeded > 0
                    ? `⚠️ ${room.casualsNeeded} casual${room.casualsNeeded > 1 ? 's' : ''} needed`
                    : room.gap < 0 ? '✅ Covered' : '✅ Staffed';
                  return (
                    <div key={room.roomId} className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: '#e0e8e0' }}>
                      {/* Room header */}
                      <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: statusBg, borderBottom: '1px solid #e0e8e0' }}>
                        <div>
                          <span className="font-semibold" style={{ color: '#2d5c18' }}>{room.roomName}</span>
                          <span className="text-xs ml-2" style={{ color: '#596570' }}>1:{room.ratio} ratio · {room.anticipatedChildren} children anticipated</span>
                        </div>
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: statusColor + '22', color: statusColor }}>
                          {statusLabel}
                        </span>
                      </div>

                      <div className="px-4 py-3">
                        {/* Staff required vs allocated */}
                        <div className="flex items-center gap-4 text-sm mb-3">
                          <span style={{ color: '#596570' }}>Required: <strong style={{ color: '#2d5c18' }}>{room.requiredStaff}</strong></span>
                          <span style={{ color: '#596570' }}>Allocated: <strong style={{ color: statusColor }}>{room.totalAllocated}</strong></span>
                        </div>

                        {/* Regular staff */}
                        {room.regularStaff.length > 0 && (
                          <div className="mb-2">
                            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#5a9228' }}>Room Staff</div>
                            <div className="space-y-1">
                              {room.regularStaff.map(s => (
                                <div key={s.employeeId} className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                                  <span style={{ color: '#2d5c18' }}>{s.employeeName}</span>
                                  <span className="text-xs" style={{ color: '#9aaa9a' }}>({roleLabel(s.role)})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Additional deployed staff */}
                        {room.additionalStaff.length > 0 && (
                          <div className="mb-2">
                            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#1d4ed8' }}>Deploy to fill gap</div>
                            <div className="space-y-1">
                              {room.additionalStaff.map(s => (
                                <div key={s.employeeId} className="flex items-center gap-2 text-sm">
                                  <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                                  <span className="font-medium" style={{ color: '#1d4ed8' }}>{s.employeeName}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                        style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>
                                    {roleLabel(s.role)}
                                  </span>
                                  <span className="text-xs" style={{ color: '#596570' }}>→ {room.roomName}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Casuals still needed */}
                        {room.casualsNeeded > 0 && (
                          <div className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#fff5f5' }}>
                            <span className="font-semibold text-red-600">⚠️ {room.casualsNeeded} external casual{room.casualsNeeded > 1 ? 's' : ''} required</span>
                            <span className="text-xs ml-1 text-red-400">— no eligible staff remaining in pool</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Unused pool */}
              {allocationPlan.unusedPool.length > 0 && (
                <div className="mt-4 bg-white rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#596570' }}>Available pool — not needed for ratio today</div>
                  <div className="flex flex-wrap gap-2">
                    {allocationPlan.unusedPool.map(s => (
                      <span key={s.employeeId} className="text-xs px-2.5 py-1 rounded-full border"
                            style={{ borderColor: '#c0d0c0', color: '#5a9228' }}>
                        {s.employeeName} <span style={{ color: '#9aaa9a' }}>({roleLabel(s.role)})</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs mt-2" style={{ color: '#596570' }}>These staff can be assigned to lunch cover or other duties.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── CASUALS TAB ── */}
      {activeTab === 'casuals' && (
        <div className="mb-5">
          {/* Forecast Staffing section */}
          {hasForecast && (
            <div className="bg-white rounded-2xl border p-5 mb-4" style={{ borderColor: '#bae6fd' }}>
              <h3 className="font-semibold mb-3 flex items-center gap-2" style={{ color: '#0369a1' }}>
                <span>📊</span>
                <span>Forecast Staffing</span>
                <span className="text-xs font-normal px-2 py-0.5 rounded-full" style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}>based on historical data</span>
              </h3>
              <div className="space-y-2">
                {centre.rooms.map(room => {
                  const ownaName = room.ownaRoomName || room.name;
                  const peakCount = Math.round(getForecastPeak(forecast, ownaName));
                  if (peakCount === 0) return null;
                  const needed = getStaffRequired(peakCount, room.ratio);
                  const rostered = roomStats.find(r => r.room.id === room.id)?.staffRostered || 0;
                  const diff = rostered - needed;
                  return (
                    <div key={room.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ backgroundColor: '#f0f9ff' }}>
                      <div className="text-sm font-medium w-24 flex-shrink-0" style={{ color: '#2d5c18' }}>{room.name}</div>
                      <div className="text-xs" style={{ color: '#596570' }}>~{peakCount} children at peak → {needed} staff needed</div>
                      <div className="ml-auto text-xs font-semibold" style={{ color: diff >= 0 ? '#16a34a' : '#dc2626' }}>
                        {rostered} rostered ({diff >= 0 ? '+' : ''}{diff})
                      </div>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </div>
          )}

          {/* Float coverage summary */}
          {totalDeficit > 0 && floatsAvailable > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
              <span className="text-xl flex-shrink-0">🔄</span>
              <div>
                <p className="font-semibold text-sm" style={{ color: '#1e40af' }}>
                  {floatsAvailable} float{floatsAvailable > 1 ? 's' : ''} rostered today — deploy {floatsUsed > 0 ? `${floatsUsed}` : 'them'} to cover room gaps first
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#3730a3' }}>
                  Room deficit: {totalDeficit} · Floats available: {floatsAvailable} · External casuals needed after floats: {totalCasuals}
                </p>
              </div>
            </div>
          )}
          {totalDeficit > 0 && floatsAvailable === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
              <span className="text-xl flex-shrink-0">⚠️</span>
              <p className="text-sm" style={{ color: '#92400e' }}>No floats rostered today — all shortfalls require external casuals.</p>
            </div>
          )}

          {totalCasuals === 0 && totalDeficit === 0 ? (
            <div className="bg-white rounded-2xl border p-8 text-center" style={{ borderColor: '#e0e8e0' }}>
              <div className="text-4xl mb-3">✅</div>
              <h3 className="text-lg font-semibold mb-1" style={{ color: '#2d5c18' }}>No casuals needed today!</h3>
              <p className="text-sm" style={{ color: '#596570' }}>All rooms are adequately staffed based on anticipated attendance.</p>
            </div>
          ) : totalCasuals === 0 && totalDeficit > 0 ? (
            <div className="bg-white rounded-2xl border p-8 text-center" style={{ borderColor: '#e0e8e0' }}>
              <div className="text-4xl mb-3">✅</div>
              <h3 className="text-lg font-semibold mb-1" style={{ color: '#2d5c18' }}>Floats cover all gaps — no external casuals needed!</h3>
              <p className="text-sm" style={{ color: '#596570' }}>The {floatsAvailable} rostered float{floatsAvailable > 1 ? 's' : ''} can fill the staffing gaps. Assign them to the rooms below.</p>
            </div>
          ) : (
            <>
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-4">
                <h2 className="text-lg font-bold mb-1" style={{ color: '#991b1b' }}>
                  ⚠️ {totalCasuals} external casual{totalCasuals > 1 ? 's' : ''} still needed today
                </h2>
                <p className="text-sm" style={{ color: '#7f1d1d' }}>
                  After deploying {floatsAvailable > 0 ? `${floatsUsed} float${floatsUsed > 1 ? 's' : ''}` : 'available floats'}, {totalCasuals} gap{totalCasuals > 1 ? 's' : ''} still need{totalCasuals === 1 ? 's' : ''} an external casual.
                </p>
              </div>

              <div className="space-y-3">
                {casualsNeededRooms.map(({ room, casuals, anticipated, staffRequired, staffRostered, timeline }) => {
                  // Find peak shortage window
                  const redSlots = timeline.filter(s => s.status === 'red');
                  const peakStart = redSlots[0];
                  const peakEnd = redSlots[redSlots.length - 1];
                  
                  return (
                    <div
                      key={room.id}
                      className="bg-white rounded-2xl border p-5"
                      style={{ borderColor: '#fca5a5' }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 rounded-full bg-red-500"></div>
                            <h3 className="font-semibold" style={{ color: '#2d5c18' }}>{room.name}</h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                              {casuals} casual{casuals > 1 ? 's' : ''} needed
                            </span>
                          </div>
                          <p className="text-sm" style={{ color: '#596570' }}>
                            {anticipated} children anticipated → {staffRequired} staff required → {staffRostered} rostered
                          </p>
                          {peakStart && (
                            <p className="text-sm mt-1 font-medium" style={{ color: '#dc2626' }}>
                              Peak gap: {peakStart.label} – {peakEnd?.label || peakStart.label}
                            </p>
                          )}
                        </div>
                        <div
                          className="flex-shrink-0 rounded-xl px-4 py-2 text-center"
                          style={{ backgroundColor: '#fee2e2' }}
                        >
                          <div className="text-2xl font-bold text-red-600">{casuals}</div>
                          <div className="text-xs text-red-500">casual{casuals > 1 ? 's' : ''}</div>
                        </div>
                      </div>

                      {/* Mini timeline for this room */}
                      <div className="mt-3 overflow-x-auto">
                        <div className="flex h-4 gap-px" style={{ minWidth: '400px' }}>
                          {timeline.map((slot, i) => (
                            <div
                              key={i}
                              className="flex-1 rounded-sm"
                              style={{
                                backgroundColor:
                                  slot.status === 'green' ? '#E2F1DA' :
                                  slot.status === 'amber' ? '#fde68a' :
                                  slot.status === 'red' ? '#fca5a5' :
                                  '#f3f4f6',
                              }}
                              title={`${slot.label}: ${slot.rostered}/${slot.required} staff`}
                            />
                          ))}
                        </div>
                        <div className="flex justify-between text-xs mt-1" style={{ color: '#9aaa9a' }}>
                          <span>6 AM</span>
                          <span>12 PM</span>
                          <span>6:30 PM</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ROOMS TAB ── */}
      {activeTab === 'rooms' && (
        <div className="space-y-4 mb-5">
          {roomStats.map(({ room, booked, anticipated, liveSignedIn, trendRate, staffRequired, staffRostered, uniqueStaff, diff, status, roomOwna }) => (
            <div
              key={room.id}
              className="bg-white rounded-2xl border overflow-hidden"
              style={{ borderColor: '#e0e8e0' }}
            >
              {/* Room card header */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{
                  backgroundColor: status === 'green' ? '#f0fdf4' : status === 'amber' ? '#fffbeb' : '#fff5f5',
                  borderBottom: '1px solid #e0e8e0',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLOR[status] }}></div>
                  <div>
                    <span className="font-semibold" style={{ color: '#2d5c18' }}>{room.name}</span>
                    <span className="text-xs ml-2" style={{ color: '#596570' }}>{room.ageGroup} · 1:{room.ratio} ratio</span>
                  </div>
                </div>
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{ backgroundColor: STATUS_COLOR[status] + '22', color: STATUS_COLOR[status] }}
                >
                  {STATUS_LABEL[status]}
                </span>
              </div>

              {/* Room card body */}
              <div className="px-4 py-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  <div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#596570' }}>Booked</div>
                    <input
                      type="number"
                      min="0" max="99"
                      value={booked}
                      onChange={e => handleAttendanceChange(room.id, parseInt(e.target.value) || 0)}
                      className="w-full text-center rounded-lg border px-2 py-1.5 font-semibold text-lg focus:outline-none"
                      style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#596570' }}>
                      Anticipated ({formatRate(trendRate)})
                    </div>
                    <div
                      className="rounded-lg border px-2 py-1.5 font-semibold text-lg text-center"
                      style={{ borderColor: '#c0d0c0', color: '#5a9228', backgroundColor: '#f0f9f0' }}
                    >
                      {anticipated}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#596570' }}>
                      {hasLiveData ? 'Signed In (live)' : 'Signed In'}
                    </div>
                    <div
                      className="rounded-lg border px-2 py-1.5 font-semibold text-lg text-center"
                      style={{
                        borderColor: '#c0d0c0',
                        color: hasLiveData ? '#A0D083' : '#9aaa9a',
                        backgroundColor: hasLiveData ? '#f0f4f0' : '#f9f9f9'
                      }}
                    >
                      {hasLiveData ? liveSignedIn : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#596570' }}>Staff</div>
                    <div
                      className="rounded-lg border px-2 py-1.5 font-semibold text-lg text-center"
                      style={{
                        borderColor: '#c0d0c0',
                        color: diff >= 0 ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {staffRostered}/{staffRequired}
                      <span className="text-sm ml-1">
                        ({diff >= 0 ? '+' : ''}{diff})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Rostered staff chips */}
                <div>
                  <div className="text-xs font-medium mb-2" style={{ color: '#596570' }}>Rostered Staff</div>
                  {loading ? (
                    <div className="flex gap-2">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-7 w-24 rounded-full bg-gray-100 animate-pulse"></div>
                      ))}
                    </div>
                  ) : uniqueStaff.length === 0 ? (
                    <span className="text-sm" style={{ color: '#9aaa9a' }}>No staff rostered</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {uniqueStaff.map(s => {
                        const isExcluded = excludedRoles.some(role =>
                          s.employeeName.toLowerCase().includes(role.toLowerCase())
                        );
                        return (
                          <div
                            key={s.employeeId}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium"
                            style={{
                              backgroundColor: isExcluded ? '#f3f4f6' : '#E2F1DA',
                              color: isExcluded ? '#9ca3af' : '#2a5a2a',
                              opacity: isExcluded ? 0.7 : 1,
                            }}
                            title={s.startTime ? `${formatTime(s.startTime)} – ${formatTime(s.endTime)}` : ''}
                          >
                            {s.employeeName}
                            {isExcluded && <span title="Not counted in ratio" style={{ fontSize: '10px' }}> ✗</span>}
                            {s.startTime && (
                              <span className="opacity-60 ml-1">
                                {formatTime(s.startTime)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Live children */}
                {hasLiveData && roomOwna.length > 0 && (
                  <div className="mt-3 pt-3 border-t" style={{ borderColor: '#f0f4f0' }}>
                    <div className="text-xs font-medium mb-2" style={{ color: '#596570' }}>
                      Children Signed In ({liveSignedIn} current / {roomOwna.filter(r => r.sign_in).length} total today)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {roomOwna
                        .filter(r => r.sign_in)
                        .sort((a, b) => (a.sign_in || '').localeCompare(b.sign_in || ''))
                        .map((child, i) => {
                          const isPresent = child.sign_in && !child.sign_out;
                          return (
                            <span
                              key={i}
                              className="text-xs px-2 py-1 rounded-full"
                              style={{
                                backgroundColor: isPresent ? '#dcfce7' : '#f3f4f6',
                                color: isPresent ? '#166534' : '#6b7280',
                              }}
                              title={`In: ${child.sign_in ? new Date(child.sign_in).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '?'}${child.sign_out ? ` | Out: ${new Date(child.sign_out).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
                            >
                              {child.child_name || 'Child'}
                            </span>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── FLOAT STAFF & LUNCH COVERAGE ── */}
      <div className="bg-white rounded-2xl border mb-4 overflow-hidden" style={{ borderColor: '#e0e8e0' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#f8f4e8', borderBottom: '1px solid #e8e0d0' }}>
          <div>
            <h3 className="font-semibold" style={{ color: '#92400e' }}>🔄 Float Staff & Lunch Coverage</h3>
            <p className="text-xs mt-0.5" style={{ color: '#a16207' }}>
              Floats count towards ratio at start/end of shift · lunch window {LUNCH_WINDOW.start}–{LUNCH_WINDOW.end}
            </p>
          </div>
          {floatStaff.length > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
              {floatStaff.length} float{floatStaff.length > 1 ? 's' : ''} rostered
            </span>
          )}
        </div>
        <div className="p-4">
          {loading ? (
            <div className="animate-pulse h-16 bg-gray-100 rounded-lg"></div>
          ) : floatStaff.length === 0 ? (
            <p className="text-sm" style={{ color: '#9aaa9a' }}>No float staff rostered today</p>
          ) : (
            <div className="space-y-4">
              {/* Float availability summary */}
              <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#fef9ec' }}>
                <span style={{ color: '#92400e' }}>💡 </span>
                <span style={{ color: '#78350f' }}>
                  {floatStaff.length} float{floatStaff.length > 1 ? 's' : ''} available to supplement ratio before {LUNCH_WINDOW.start} and after {LUNCH_WINDOW.end}.
                  {totalCasuals > 0 && floatStaff.length > 0 && (
                    <span className="font-semibold"> Floats can offset up to {Math.min(floatStaff.length, totalCasuals)} of the {totalCasuals} casual need{totalCasuals > 1 ? 's' : ''}.</span>
                  )}
                </span>
              </div>

              {/* Per-float card */}
              {floatStaff.map(s => {
                const alloc = getLunchAlloc(s.employeeId);
                const shiftStart = s.startTime ? formatTime(s.startTime) : '?';
                const shiftEnd = s.endTime ? formatTime(s.endTime) : '?';
                return (
                  <div key={s.employeeId} className="rounded-xl border overflow-hidden" style={{ borderColor: '#e8e0d0' }}>
                    {/* Float header */}
                    <div className="px-4 py-2 flex items-center justify-between" style={{ backgroundColor: '#fffbeb' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-base">👤</span>
                        <span className="font-semibold text-sm" style={{ color: '#2d5c18' }}>{s.employeeName}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fde68a', color: '#92400e' }}>Float</span>
                      </div>
                      <span className="text-xs" style={{ color: '#596570' }}>Shift: {shiftStart} – {shiftEnd}</span>
                    </div>

                    {/* Shift summary bar */}
                    <div className="px-4 py-2">
                      <div className="flex items-center gap-1 text-xs flex-wrap">
                        {alloc?.ratioRoom ? (
                          <span className="rounded-full px-2.5 py-0.5 font-medium" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                            ✅ Ratio: {alloc.ratioRoom}
                          </span>
                        ) : (
                          <span className="rounded-full px-2.5 py-0.5 font-medium" style={{ backgroundColor: '#f3f4f6', color: '#9aaa9a' }}>
                            No ratio room set
                          </span>
                        )}
                        {alloc?.slots && alloc.slots.length > 0 ? (
                          <span className="rounded-full px-2.5 py-0.5 font-medium" style={{ backgroundColor: '#fde68a', color: '#92400e' }}>
                            🍽 {alloc.slots.length} lunch slot{alloc.slots.length > 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="rounded-full px-2.5 py-0.5 font-medium" style={{ backgroundColor: '#f3f4f6', color: '#9aaa9a' }}>
                            No lunch slots
                          </span>
                        )}
                        <span className="text-gray-400">{shiftStart}–{shiftEnd}</span>
                      </div>
                    </div>

                    {/* Assignment section */}
                    <div className="px-4 pb-4 space-y-4">

                      {/* ── Ratio cover ── */}
                      <div className="rounded-xl p-3" style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}>
                        <div className="text-xs font-semibold mb-2" style={{ color: '#166534' }}>✅ Ratio cover</div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs" style={{ color: '#596570' }}>Assigned room:</span>
                          <select
                            value={alloc?.ratioRoom || ''}
                            onChange={e => upsertAlloc(s.employeeId, s.employeeName, { mode: alloc?.mode ?? 'ratio', ratioRoom: e.target.value })}
                            className="text-sm rounded-lg border px-2 py-1.5 focus:outline-none"
                            style={{ borderColor: '#E2F1DA', color: '#2d5c18' }}
                          >
                            <option value="">— none / not on ratio —</option>
                            {centre.rooms.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                          </select>
                        </div>
                        {alloc?.ratioRoom && (
                          <p className="text-xs mt-1.5" style={{ color: '#166534' }}>
                            Counted in {alloc.ratioRoom} for the full shift
                          </p>
                        )}
                      </div>

                      {/* ── Lunch cover schedule ── */}
                      <div className="rounded-xl p-3" style={{ backgroundColor: '#fef9ec', border: '1px solid #fde68a' }}>
                        <div className="text-xs font-semibold mb-2" style={{ color: '#92400e' }}>🍽 Lunch cover schedule</div>
                        {(!alloc?.slots || alloc.slots.length === 0) && (
                          <p className="text-xs mb-2" style={{ color: '#9aaa9a' }}>No lunch slots yet — add one below</p>
                        )}
                        <div className="space-y-2">
                          {(alloc?.slots || []).map((slot, idx) => (
                            <div key={idx} className="flex items-center gap-2 rounded-lg px-3 py-2 bg-white" style={{ border: '1px solid #fde68a' }}>
                              <span className="text-xs font-bold w-5 flex-shrink-0" style={{ color: '#92400e' }}>{idx + 1}.</span>
                              <input type="time" value={slot.slotStart}
                                onChange={e => updateSlot(s.employeeId, idx, { slotStart: e.target.value })}
                                className="text-xs rounded border px-1.5 py-1 focus:outline-none w-20 flex-shrink-0"
                                style={{ borderColor: '#d0c8b0' }} />
                              <span className="text-xs flex-shrink-0" style={{ color: '#596570' }}>→</span>
                              <input type="time" value={slot.slotEnd}
                                onChange={e => updateSlot(s.employeeId, idx, { slotEnd: e.target.value })}
                                className="text-xs rounded border px-1.5 py-1 focus:outline-none w-20 flex-shrink-0"
                                style={{ borderColor: '#d0c8b0' }} />
                              <input type="text" placeholder="Staff name" value={slot.coveringName}
                                onChange={e => updateSlot(s.employeeId, idx, { coveringName: e.target.value })}
                                className="text-xs rounded border px-1.5 py-1 focus:outline-none flex-1 min-w-0"
                                style={{ borderColor: '#d0c8b0' }} />
                              <select value={slot.coveringRoom}
                                onChange={e => updateSlot(s.employeeId, idx, { coveringRoom: e.target.value })}
                                className="text-xs rounded border px-1.5 py-1 focus:outline-none flex-shrink-0"
                                style={{ borderColor: '#d0c8b0', color: '#2d5c18', maxWidth: '110px' }}>
                                <option value="">— room —</option>
                                {centre.rooms.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                              </select>
                              <button onClick={() => removeSlot(s.employeeId, idx)}
                                className="text-xs px-1.5 py-1 rounded hover:bg-red-100 transition-colors flex-shrink-0"
                                style={{ color: '#dc2626' }}>✕</button>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => addSlot(s.employeeId)}
                          className="mt-2 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors hover:bg-amber-50"
                          style={{ borderColor: '#fde68a', color: '#92400e' }}>
                          + Add lunch slot
                        </button>
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

            {/* ── ABSENT STAFF ── */}
      <div className="mb-5">
        <div className="bg-white rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
          <h3 className="font-semibold mb-3" style={{ color: '#2d5c18' }}>Absent Staff</h3>
          {loading ? (
            <div className="animate-pulse h-16 bg-gray-100 rounded-lg"></div>
          ) : absentStaff.length === 0 ? (
            <p className="text-sm" style={{ color: '#9aaa9a' }}>No absences recorded</p>
          ) : (
            <div className="space-y-2">
              {absentStaff.map(s => (
                <div key={s.employeeId} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ backgroundColor: '#fff5f5' }}>
                  <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0"></div>
                  <div>
                    <div className="text-sm font-medium" style={{ color: '#2d5c18' }}>{s.employeeName}</div>
                    <div className="text-xs" style={{ color: '#9a6a6a' }}>{s.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Print footer */}
      <div className="hidden print:block mt-8 pt-4 border-t text-xs text-gray-500">
        Generated: {format(new Date(), 'dd/MM/yyyy HH:mm')} — TGA Plan of the Day — Oatley
      </div>
    </Layout>
  );
}

// ─── Timeline Cell Component ───────────────────────────────────────────────────

interface TimelineCellProps {
  slot: RoomTimeSlot;
  showTooltip: boolean;
  roomName: string;
  ratio: number;
}

function TimelineCell({ slot, ratio }: Omit<TimelineCellProps, 'roomName'> & { roomName?: string }) {
  const [showTip, setShowTip] = useState(false);

  const bg =
    slot.status === 'green' ? '#E2F1DA' :
    slot.status === 'amber' ? '#fde68a' :
    slot.status === 'red' ? '#fca5a5' :
    '#f3f4f6';

  const border =
    slot.status === 'green' ? '#4ade80' :
    slot.status === 'amber' ? '#fbbf24' :
    slot.status === 'red' ? '#f87171' :
    '#e5e7eb';

  return (
    <div
      className="flex-1 relative cursor-pointer"
      style={{
        backgroundColor: bg,
        border: `1px solid ${border}`,
        borderRadius: '2px',
        minWidth: '10px',
        transition: 'opacity 0.1s',
      }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      title={`${slot.label} — ${slot.signedIn > 0 ? `${slot.signedIn} signed in` : `${slot.anticipated} anticipated`} children, ${slot.rostered}/${slot.required} staff`}
    >
      {showTip && (
        <div
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none"
          style={{ whiteSpace: 'nowrap' }}
        >
          <div
            className="text-xs rounded-lg px-3 py-2 shadow-lg"
            style={{ backgroundColor: '#A0D083', color: 'white' }}
          >
            <div className="font-semibold mb-1">{slot.label}</div>
            {slot.signedIn > 0 && <div>Signed in: {slot.signedIn}</div>}
            <div>Anticipated: {slot.anticipated}</div>
            <div>Required: {slot.required} staff (1:{ratio})</div>
            <div>Rostered: {slot.rostered} staff</div>
            {slot.required > slot.rostered && (
              <div className="text-red-300 font-medium mt-1">
                Shortage: {slot.required - slot.rostered}
              </div>
            )}
          </div>
          <div
            className="w-2 h-2 mx-auto"
            style={{
              backgroundColor: '#A0D083',
              clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
            }}
          />
        </div>
      )}
    </div>
  );
}
