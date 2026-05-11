import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { fetchRosters, fetchAbsentStaff } from '../deputy';
import { getAttendance, setAttendance, getStaffRequired, formatTime } from '../attendance';
import type { RosteredStaff, AbsentStaff } from '../types';
import {
  fetchAttendanceForDate,
  fetchTrends,
  groupAttendanceByRoom,
  type AttendanceRecord,
  type TrendRecord,
} from '../api/ownaData';
import { buildRoomTimeline, generateTimeSlots, type RoomTimeSlot } from '../utils/timeline';
import { anticipatedAttendance, casualsNeeded, getTrendRate, formatRate } from '../utils/trends';

const centre = CENTRES[0];
const allRoomUnitIds = centre.rooms.map(r => r.deputyUnitId);

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
  const [loading, setLoading] = useState(true);
  const [ownaLoading, setOwnaLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [excludedRoles, setExcludedRoles] = useState<string[]>(
    () => JSON.parse(localStorage.getItem('pod_excluded_roles') || JSON.stringify(DEFAULT_EXCLUDED_ROLES))
  );
  const [activeTab, setActiveTab] = useState<'timeline' | 'rooms' | 'casuals'>('timeline');
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

  // Load Deputy data
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchRosters(safeDate, allRoomUnitIds),
      fetchAbsentStaff(safeDate, allRoomUnitIds),
    ]).then(([r, a]) => {
      setRosters(r);
      setAbsentStaff(a);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [safeDate]);

  // Load Owna data from Supabase
  useEffect(() => {
    setOwnaLoading(true);
    Promise.all([
      fetchAttendanceForDate('oatley', safeDate),
      fetchTrends('oatley'),
    ]).then(([att, tr]) => {
      setOwnaAttendance(att);
      setTrends(tr);
      setOwnaLoading(false);
    }).catch(() => setOwnaLoading(false));
  }, [safeDate]);

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

  // Group Owna attendance by room
  const ownaByRoom = groupAttendanceByRoom(ownaAttendance);
  const hasLiveData = ownaAttendance.length > 0;

  // Compute room stats
  const roomStats = centre.rooms.map(room => {
    const booked = attendance[room.id] ?? 0;
    const roomOwna = ownaByRoom[room.name] || [];
    const liveSignedIn = roomOwna.filter(r => r.sign_in && !r.sign_out).length;
    const totalSignedIn = roomOwna.filter(r => r.sign_in).length;
    
    // Anticipated = booked × trend rate (or actual sign-ins if we have live data)
    const trendRate = getTrendRate(room.name, safeDate, trends);
    const anticipated = hasLiveData
      ? Math.max(totalSignedIn, Math.round(booked * trendRate))
      : anticipatedAttendance(booked, room.name, safeDate, trends);
    
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

  // Totals
  const totalBooked = roomStats.reduce((s, r) => s + r.booked, 0);
  const totalAnticipated = roomStats.reduce((s, r) => s + r.anticipated, 0);
  const totalSignedIn = roomStats.reduce((s, r) => s + r.liveSignedIn, 0);
  const totalRequired = roomStats.reduce((s, r) => s + r.staffRequired, 0);
  const totalRostered = roomStats.reduce((s, r) => s + r.staffRostered, 0);
  const totalCasuals = roomStats.reduce((s, r) => s + r.casuals, 0);
  const totalDiff = totalRostered - totalRequired;
  const overallStatus: 'green' | 'amber' | 'red' =
    totalDiff >= 0 ? 'green' : totalDiff >= -1 ? 'amber' : 'red';

  // Rooms needing casuals
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
        style={{ color: '#4a7a3a' }}
      >
        ← Back to Week
      </button>

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1a2e1a' }}>{dateLabel}</h1>
          <p className="text-sm mt-0.5" style={{ color: '#6a8a6a' }}>
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
            style={{ borderColor: '#c0d0c0', color: '#6a8a6a' }}
          >
            ⚙️ Settings
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg border font-medium text-sm transition-colors"
            style={{ borderColor: '#4a7a3a', color: '#4a7a3a' }}
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
            value: totalCasuals > 0 ? `+${totalCasuals}` : '✓',
            sub: totalCasuals > 0 ? 'today' : 'all good',
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
            <div className="text-xs font-medium mb-0.5" style={{ color: '#6a8a6a' }}>{stat.label}</div>
            <div
              className="text-2xl font-bold"
              style={{ color: stat.alert ? '#dc2626' : '#1a2e1a' }}
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
            ⚠️ {totalCasuals} casual{totalCasuals > 1 ? 's' : ''} needed today
          </span>
        )}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-white rounded-2xl border p-5 mb-5 no-print" style={{ borderColor: '#e0e8e0' }}>
          <h3 className="font-semibold mb-3" style={{ color: '#1a2e1a' }}>Centre Settings</h3>
          <p className="text-sm mb-3" style={{ color: '#6a8a6a' }}>
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
                  style={{ accentColor: '#4a7a3a' }}
                />
                <span className="text-sm" style={{ color: '#1a2e1a' }}>{role}</span>
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
          { id: 'casuals', label: `🚨 Casuals${totalCasuals > 0 ? ` (${totalCasuals})` : ''}` },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all"
            style={{
              backgroundColor: activeTab === tab.id ? '#4a7a3a' : 'transparent',
              color: activeTab === tab.id ? 'white' : '#6a8a6a',
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
              <h2 className="font-semibold" style={{ color: '#1a2e1a' }}>15-Minute Staffing Timeline</h2>
              <p className="text-xs mt-0.5" style={{ color: '#6a8a6a' }}>
                🟢 Staffed &nbsp; 🟡 Marginal &nbsp; 🔴 Understaffed &nbsp; ⬜ No children
              </p>
            </div>
            <div className="text-xs" style={{ color: '#9aaa9a' }}>6:00 AM → 6:30 PM</div>
          </div>

          <div className="overflow-x-auto" ref={timelineRef}>
            <div style={{ minWidth: '800px' }}>
              {/* Time axis header */}
              <div className="flex border-b" style={{ borderColor: '#f0f4f0' }}>
                <div className="flex-shrink-0 w-28 px-3 py-2 text-xs font-semibold" style={{ color: '#6a8a6a' }}>Room</div>
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
              {roomStats.map(({ room, timeline }) => (
                <div key={room.id} className="flex items-center border-b" style={{ borderColor: '#f5f7f5' }}>
                  <div className="flex-shrink-0 w-28 px-3 py-2">
                    <div className="text-xs font-semibold" style={{ color: '#1a2e1a' }}>{room.name}</div>
                    <div className="text-xs" style={{ color: '#9aaa9a' }}>{room.ageGroup}</div>
                  </div>
                  <div className="flex flex-1 h-10 items-stretch gap-px px-px">
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
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t flex flex-wrap gap-4 text-xs" style={{ borderColor: '#f0f4f0', color: '#6a8a6a' }}>
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

      {/* ── CASUALS TAB ── */}
      {activeTab === 'casuals' && (
        <div className="mb-5">
          {totalCasuals === 0 ? (
            <div className="bg-white rounded-2xl border p-8 text-center" style={{ borderColor: '#e0e8e0' }}>
              <div className="text-4xl mb-3">✅</div>
              <h3 className="text-lg font-semibold mb-1" style={{ color: '#1a2e1a' }}>No casuals needed today!</h3>
              <p className="text-sm" style={{ color: '#6a8a6a' }}>All rooms are adequately staffed based on anticipated attendance.</p>
            </div>
          ) : (
            <>
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-4">
                <h2 className="text-lg font-bold mb-1" style={{ color: '#991b1b' }}>
                  ⚠️ You need {totalCasuals} casual{totalCasuals > 1 ? 's' : ''} today
                </h2>
                <p className="text-sm" style={{ color: '#7f1d1d' }}>
                  Based on anticipated attendance (trend-adjusted bookings) vs rostered staff.
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
                            <h3 className="font-semibold" style={{ color: '#1a2e1a' }}>{room.name}</h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                              {casuals} casual{casuals > 1 ? 's' : ''} needed
                            </span>
                          </div>
                          <p className="text-sm" style={{ color: '#6a8a6a' }}>
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
                                  slot.status === 'green' ? '#86efac' :
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
                    <span className="font-semibold" style={{ color: '#1a2e1a' }}>{room.name}</span>
                    <span className="text-xs ml-2" style={{ color: '#6a8a6a' }}>{room.ageGroup} · 1:{room.ratio} ratio</span>
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
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#6a8a6a' }}>Booked</div>
                    <input
                      type="number"
                      min="0" max="99"
                      value={booked}
                      onChange={e => handleAttendanceChange(room.id, parseInt(e.target.value) || 0)}
                      className="w-full text-center rounded-lg border px-2 py-1.5 font-semibold text-lg focus:outline-none"
                      style={{ borderColor: '#c0d0c0', color: '#1a2e1a' }}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#6a8a6a' }}>
                      Anticipated ({formatRate(trendRate)})
                    </div>
                    <div
                      className="rounded-lg border px-2 py-1.5 font-semibold text-lg text-center"
                      style={{ borderColor: '#c0d0c0', color: '#4a7a3a', backgroundColor: '#f0f9f0' }}
                    >
                      {anticipated}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#6a8a6a' }}>
                      {hasLiveData ? 'Signed In (live)' : 'Signed In'}
                    </div>
                    <div
                      className="rounded-lg border px-2 py-1.5 font-semibold text-lg text-center"
                      style={{
                        borderColor: '#c0d0c0',
                        color: hasLiveData ? '#1a2e1a' : '#9aaa9a',
                        backgroundColor: hasLiveData ? '#f0f4f0' : '#f9f9f9'
                      }}
                    >
                      {hasLiveData ? liveSignedIn : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: '#6a8a6a' }}>Staff</div>
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
                  <div className="text-xs font-medium mb-2" style={{ color: '#6a8a6a' }}>Rostered Staff</div>
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
                              backgroundColor: isExcluded ? '#f3f4f6' : '#e8f0e8',
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
                    <div className="text-xs font-medium mb-2" style={{ color: '#6a8a6a' }}>
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

      {/* ── FLOAT & ABSENT STAFF ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
          <h3 className="font-semibold mb-3" style={{ color: '#1a2e1a' }}>Float / Break Cover</h3>
          {loading ? (
            <div className="animate-pulse h-16 bg-gray-100 rounded-lg"></div>
          ) : floatStaff.length === 0 ? (
            <p className="text-sm" style={{ color: '#9aaa9a' }}>No float staff rostered</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {floatStaff.map(s => (
                <div key={s.employeeId} className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#f0f4f0' }}>
                  <div className="font-medium" style={{ color: '#1a2e1a' }}>{s.employeeName}</div>
                  {s.startTime && (
                    <div className="text-xs" style={{ color: '#6a8a6a' }}>
                      {formatTime(s.startTime)} – {formatTime(s.endTime)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
          <h3 className="font-semibold mb-3" style={{ color: '#1a2e1a' }}>Absent Staff</h3>
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
                    <div className="text-sm font-medium" style={{ color: '#1a2e1a' }}>{s.employeeName}</div>
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
    slot.status === 'green' ? '#86efac' :
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
            style={{ backgroundColor: '#1a2e1a', color: 'white' }}
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
              backgroundColor: '#1a2e1a',
              clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
            }}
          />
        </div>
      )}
    </div>
  );
}
