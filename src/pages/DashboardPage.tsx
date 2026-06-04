import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, startOfWeek, format, isToday, isPast, isFuture } from 'date-fns';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { fetchRosters, fetchAbsentStaff } from '../deputy';
import { getAttendance, getStaffRequired, getStatus } from '../attendance';
import { formatDate } from '../dateUtils';
import { fetchAttendanceForDate, fetchForecast, getForecastPeak } from '../api/ownaData';
import { getUser } from '../auth';
import type { AbsentStaff } from '../types';

const centre = CENTRES[0]; // Oatley
const allRoomUnitIds = centre.rooms.map(r => r.deputyUnitId);

interface DaySummary {
  date: string;
  dateObj: Date;
  totalChildren: number;
  staffRequired: number;
  staffRostered: number;
  status: 'green' | 'amber' | 'red';
  loading: boolean;
  error?: string;
  isForecast?: boolean;
}

function getWeekStart(offset: number): Date {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  return addDays(weekStart, offset * 7);
}

function getGreeting(): string {
  const hour = new Date().toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Sydney' });
  const h = parseInt(hour, 10);
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function StatusDot({ status }: { status: 'green' | 'amber' | 'red' | 'loading' }) {
  const colors = {
    green: '#16a34a',
    amber: '#d97706',
    red: '#dc2626',
    loading: '#d1d5db',
  };
  return (
    <div
      className="w-3 h-3 rounded-full flex-shrink-0"
      style={{ backgroundColor: colors[status] }}
    />
  );
}

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

// SVG Bar Chart for the week overview
function WeekBarChart({
  days,
  onDayClick,
}: {
  days: DaySummary[];
  onDayClick: (date: string) => void;
}) {
  const maxVal = Math.max(
    ...days.map(d => Math.max(d.totalChildren, d.staffRostered)),
    10
  );
  const chartH = 140;
  const barW = 20;
  const gap = 8;
  const groupW = barW * 2 + gap;
  const colW = 70;
  const cols = 5;
  const svgW = cols * colW;

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={chartH + 60} className="w-full" viewBox={`0 0 ${svgW} ${chartH + 60}`}>
        {/* Y grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = chartH - frac * chartH;
          const val = Math.round(frac * maxVal);
          return (
            <g key={frac}>
              <line x1={0} y1={y} x2={svgW} y2={y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={2} y={y - 3} fontSize={9} fill="#9ca3af">{val}</text>
            </g>
          );
        })}

        {days.map((day, i) => {
          const cx = i * colW + colW / 2;
          const isCurrentDay = isToday(day.dateObj);
          const isPastDay = !isCurrentDay && isPast(day.dateObj);
          const isFutureDay = isFuture(day.dateObj) && !isToday(day.dateObj);

          const childH = day.loading ? 0 : Math.round((day.totalChildren / maxVal) * chartH);
          const staffH = day.loading ? 0 : Math.round((day.staffRostered / maxVal) * chartH);

          const childColor = isPastDay ? '#9ca3af' : isFutureDay ? '#E2F1DA' : '#4ade80';
          const staffColor = isPastDay ? '#6b7280' : isFutureDay ? '#5a922899' : '#A0D083';

          const xLeft = cx - groupW / 2;
          const xRight = xLeft + barW + gap;

          return (
            <g
              key={day.date}
              className="cursor-pointer"
              onClick={() => onDayClick(day.date)}
            >
              {/* Today highlight background */}
              {isCurrentDay && (
                <rect
                  x={cx - colW / 2 + 4}
                  y={0}
                  width={colW - 8}
                  height={chartH + 2}
                  rx={6}
                  fill="#E2F1DA"
                />
              )}

              {/* Children bar */}
              {day.loading ? (
                <rect
                  x={xLeft}
                  y={chartH / 2}
                  width={barW}
                  height={chartH / 2}
                  rx={3}
                  fill="#e5e7eb"
                  className="animate-pulse"
                />
              ) : (
                <rect
                  x={xLeft}
                  y={chartH - childH}
                  width={barW}
                  height={childH}
                  rx={3}
                  fill={childColor}
                />
              )}

              {/* Staff bar */}
              {day.loading ? (
                <rect
                  x={xRight}
                  y={chartH / 3}
                  width={barW}
                  height={(chartH * 2) / 3}
                  rx={3}
                  fill="#e5e7eb"
                  className="animate-pulse"
                />
              ) : (
                <rect
                  x={xRight}
                  y={chartH - staffH}
                  width={barW}
                  height={staffH}
                  rx={3}
                  fill={staffColor}
                />
              )}

              {/* Day label */}
              <text
                x={cx}
                y={chartH + 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={isCurrentDay ? 700 : 500}
                fill={isCurrentDay ? '#A0D083' : '#6b7280'}
              >
                {format(day.dateObj, 'EEE')}
              </text>

              {/* Date */}
              <text
                x={cx}
                y={chartH + 30}
                textAnchor="middle"
                fontSize={10}
                fill={isCurrentDay ? '#5a9228' : '#9ca3af'}
              >
                {format(day.dateObj, 'd MMM')}
              </text>

              {/* Status dot */}
              {!day.loading && (
                <circle
                  cx={cx}
                  cy={chartH + 46}
                  r={5}
                  fill={
                    day.status === 'green'
                      ? '#16a34a'
                      : day.status === 'amber'
                      ? '#d97706'
                      : '#dc2626'
                  }
                />
              )}
              {day.loading && (
                <circle cx={cx} cy={chartH + 46} r={5} fill="#e5e7eb" />
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex gap-6 mt-2 text-xs" style={{ color: '#596570' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#4ade80' }} />
          <span>Children expected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#A0D083' }} />
          <span>Staff rostered</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = getUser();
  const [weekOffset, setWeekOffset] = useState(0);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [absentToday, setAbsentToday] = useState<AbsentStaff[]>([]);
  const [loadingAbsent, setLoadingAbsent] = useState(true);

  const weekStart = getWeekStart(weekOffset);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const todayStr = formatDate(new Date());
  const todaySummary = days.find(d => d.date === todayStr);

  // Load a single day's summary
  const loadDay = useCallback(async (dateObj: Date): Promise<DaySummary> => {
    const date = formatDate(dateObj);
    let totalChildren = 0;
    let staffRequired = 0;
    let isForecast = false;

    try {
      const ownaRecords = await fetchAttendanceForDate('oatley', date);
      if (ownaRecords.length > 0) {
        totalChildren = new Set(
          ownaRecords.filter(r => r.sign_in).map(r => r.child_name)
        ).size;
        staffRequired = centre.rooms.reduce((sum, room) => {
          const roomCount = ownaRecords.filter(
            r => r.room_name === (room.ownaRoomName || room.name) && r.sign_in
          ).length;
          return sum + getStaffRequired(roomCount, room.ratio);
        }, 0);
      } else {
        const forecast = await fetchForecast('oatley', date);
        const hasForecast = Object.keys(forecast).length > 0;

        if (hasForecast) {
          isForecast = true;
          totalChildren = centre.rooms.reduce((sum, room) => {
            const peak = getForecastPeak(forecast, room.ownaRoomName || room.name);
            return sum + Math.round(peak);
          }, 0);
          staffRequired = centre.rooms.reduce((sum, room) => {
            const peak = getForecastPeak(forecast, room.ownaRoomName || room.name);
            return sum + getStaffRequired(Math.round(peak), room.ratio);
          }, 0);
        } else {
          totalChildren = centre.rooms.reduce(
            (sum, room) => sum + getAttendance(date, room.id),
            0
          );
          staffRequired = centre.rooms.reduce((sum, room) => {
            const att = getAttendance(date, room.id);
            return sum + getStaffRequired(att, room.ratio);
          }, 0);
        }
      }
    } catch {
      totalChildren = centre.rooms.reduce(
        (sum, room) => sum + getAttendance(date, room.id),
        0
      );
      staffRequired = centre.rooms.reduce((sum, room) => {
        const att = getAttendance(date, room.id);
        return sum + getStaffRequired(att, room.ratio);
      }, 0);
    }

    try {
      const rosters = await fetchRosters(date, allRoomUnitIds);
      const roomUnitIds = new Set(centre.rooms.map(r => r.deputyUnitId));
      const uniqueStaff = new Set(
        rosters.filter(r => roomUnitIds.has(r.unitId)).map(r => r.employeeId)
      );
      const staffRostered = uniqueStaff.size;
      const status = getStatus(staffRostered, staffRequired);
      return { date, dateObj, totalChildren, staffRequired, staffRostered, status, loading: false, isForecast };
    } catch {
      return {
        date,
        dateObj,
        totalChildren,
        staffRequired,
        staffRostered: 0,
        status: 'red',
        loading: false,
        error: 'Failed to load',
        isForecast,
      };
    }
  }, []);

  // Load week data
  useEffect(() => {
    setDays(
      weekDays.map(dateObj => ({
        date: formatDate(dateObj),
        dateObj,
        totalChildren: 0,
        staffRequired: 0,
        staffRostered: 0,
        status: 'red' as const,
        loading: true,
      }))
    );

    weekDays.forEach(async (dateObj, i) => {
      const summary = await loadDay(dateObj);
      setDays(prev => {
        const next = [...prev];
        next[i] = summary;
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  // Load absent staff for today
  useEffect(() => {
    setLoadingAbsent(true);
    fetchAbsentStaff(todayStr, allRoomUnitIds)
      .then(setAbsentToday)
      .finally(() => setLoadingAbsent(false));
  }, [todayStr]);

  // Status display helpers
  const statusLabel = todaySummary?.status === 'green'
    ? '✅ All good'
    : todaySummary?.status === 'amber'
    ? '⚠️ Check rosters'
    : '🚨 Action needed';

  const statusColor = todaySummary?.status === 'green'
    ? '#16a34a'
    : todaySummary?.status === 'amber'
    ? '#d97706'
    : '#dc2626';

  // Alert days: days where staff is short
  const alertDays = days.filter(d => !d.loading && (d.status === 'amber' || d.status === 'red'));

  const weekLabel = weekOffset === 0
    ? 'This Week'
    : weekOffset === 1
    ? 'Next Week'
    : weekOffset === -1
    ? 'Last Week'
    : `Week of ${format(weekStart, 'd MMM')}`;

  return (
    <Layout>
      {/* ── Header greeting ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold leading-tight" style={{ color: '#2d5c18' }}>
              {getGreeting()}{user ? `, ${user.name}` : ''}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
              {format(new Date(), 'EEEE d MMMM yyyy')} — Oatley Centre
            </p>
          </div>
        </div>
        {user && (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0"
            style={{ backgroundColor: '#5a9228' }}
            title={user.name}
          >
            {getInitials(user.name)}
          </div>
        )}
      </div>

      {/* ── Today at a Glance (hero) ── */}
      <div
        className="rounded-2xl p-6 mb-6 shadow-sm border"
        style={{ backgroundColor: '#A0D083', borderColor: '#2d5c18' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#E2F1DA' }}>
              Today at a Glance
            </div>
            <div className="text-2xl font-bold text-white">
              {format(new Date(), 'EEEE d MMMM')}
            </div>
          </div>
          <button
            onClick={() => navigate(`/day/${todayStr}`)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90 active:scale-95 flex-shrink-0"
            style={{ backgroundColor: '#5a9228', color: 'white' }}
          >
            View Today's Plan →
          </button>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-3">
          {/* Children */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-2xl mb-1">🧒</div>
            {todaySummary?.loading !== false ? (
              <>
                <SkeletonPulse className="h-7 w-12 mb-1 bg-white/20" />
                <SkeletonPulse className="h-3 w-20 bg-white/10" />
              </>
            ) : (
              <>
                <div className="text-3xl font-bold text-white">{todaySummary.totalChildren}</div>
                <div className="text-xs mt-0.5" style={{ color: '#E2F1DA' }}>
                  Children expected
                  {todaySummary.isForecast && (
                    <span className="ml-1 opacity-70">(forecast)</span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Staff */}
          <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-2xl mb-1">👥</div>
            {todaySummary?.loading !== false ? (
              <>
                <SkeletonPulse className="h-7 w-12 mb-1 bg-white/20" />
                <SkeletonPulse className="h-3 w-20 bg-white/10" />
              </>
            ) : (
              <>
                <div className="text-3xl font-bold text-white">{todaySummary.staffRostered}</div>
                <div className="text-xs mt-0.5" style={{ color: '#E2F1DA' }}>
                  Staff rostered
                  <span className="ml-1 opacity-60">
                    (need {todaySummary.staffRequired})
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Status */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: todaySummary?.loading !== false ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.08)',
            }}
          >
            <div className="text-2xl mb-1">🚦</div>
            {todaySummary?.loading !== false ? (
              <>
                <SkeletonPulse className="h-7 w-24 mb-1 bg-white/20" />
                <SkeletonPulse className="h-3 w-16 bg-white/10" />
              </>
            ) : (
              <>
                <div
                  className="text-base font-bold leading-tight"
                  style={{ color: statusColor === '#16a34a' ? '#E2F1DA' : statusColor === '#d97706' ? '#fcd34d' : '#fca5a5' }}
                >
                  {statusLabel}
                </div>
                <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Staffing status
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Week chart + Alerts (two-column on desktop) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Week bar chart (2/3 width) */}
        <div
          className="lg:col-span-2 rounded-2xl p-6 shadow-sm border"
          style={{ backgroundColor: 'white', borderColor: '#e0e8e0' }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#5a9228' }}>
                {weekLabel}
              </div>
              <h2 className="text-base font-bold" style={{ color: '#2d5c18' }}>
                Children vs Staff — {format(weekStart, 'd MMM')} to {format(addDays(weekStart, 4), 'd MMM')}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setWeekOffset(w => w - 1)}
                className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm transition-colors hover:bg-gray-50"
                style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
              >
                ←
              </button>
              <button
                onClick={() => setWeekOffset(0)}
                className="px-2.5 h-8 rounded-lg border text-xs font-medium transition-colors hover:bg-gray-50"
                style={{ borderColor: weekOffset === 0 ? '#5a9228' : '#c0d0c0', color: weekOffset === 0 ? '#5a9228' : '#A0D083' }}
              >
                Now
              </button>
              <button
                onClick={() => setWeekOffset(w => w + 1)}
                className="w-8 h-8 rounded-lg border flex items-center justify-center text-sm transition-colors hover:bg-gray-50"
                style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
              >
                →
              </button>
            </div>
          </div>

          <WeekBarChart days={days} onDayClick={date => navigate(`/day/${date}`)} />
        </div>

        {/* Alerts + Absent (1/3 width) */}
        <div className="space-y-4">
          {/* Staffing Alerts */}
          <div
            className="rounded-2xl p-5 shadow-sm border"
            style={{ backgroundColor: 'white', borderColor: '#e0e8e0' }}
          >
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#5a9228' }}>
              Staffing Alerts
            </div>

            {days.some(d => d.loading) ? (
              <div className="space-y-2">
                <SkeletonPulse className="h-12" />
                <SkeletonPulse className="h-12" />
              </div>
            ) : alertDays.length === 0 ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm" style={{ color: '#596570' }}>All days look good 🎉</span>
              </div>
            ) : (
              <div className="space-y-2">
                {alertDays.map(day => {
                  const isCurrentDay = isToday(day.dateObj);
                  const shortfall = day.staffRequired - day.staffRostered;
                  return (
                    <button
                      key={day.date}
                      onClick={() => navigate(`/day/${day.date}`)}
                      className="w-full text-left rounded-xl p-3 border transition-all hover:shadow-sm"
                      style={{
                        backgroundColor: day.status === 'red' ? '#fef2f2' : '#fffbeb',
                        borderColor: day.status === 'red' ? '#fecaca' : '#fde68a',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <StatusDot status={day.status} />
                          <span className="text-sm font-semibold" style={{ color: '#2d5c18' }}>
                            {format(day.dateObj, 'EEE d MMM')}
                            {isCurrentDay && (
                              <span className="ml-1 text-xs font-normal" style={{ color: '#5a9228' }}>Today</span>
                            )}
                          </span>
                        </div>
                        <span className="text-xs font-medium" style={{ color: day.status === 'red' ? '#dc2626' : '#d97706' }}>
                          →
                        </span>
                      </div>
                      <div className="text-xs mt-1" style={{ color: '#596570' }}>
                        {shortfall > 0
                          ? `${shortfall} staff short (${day.staffRostered}/${day.staffRequired} needed)`
                          : `Marginal — check rosters`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Absent Today */}
          <div
            className="rounded-2xl p-5 shadow-sm border"
            style={{ backgroundColor: 'white', borderColor: '#e0e8e0' }}
          >
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#5a9228' }}>
              Absent Today
            </div>

            {loadingAbsent ? (
              <div className="space-y-2">
                <SkeletonPulse className="h-8" />
                <SkeletonPulse className="h-8" />
              </div>
            ) : absentToday.length === 0 ? (
              <div className="flex items-center gap-2 py-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm" style={{ color: '#596570' }}>No absences recorded</span>
              </div>
            ) : (
              <div className="space-y-2">
                {absentToday.map(s => (
                  <div
                    key={s.employeeId}
                    className="flex items-center gap-3 py-1.5 border-b last:border-0"
                    style={{ borderColor: '#f0f0f0' }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: '#5a9228' }}
                    >
                      {getInitials(s.employeeName)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: '#2d5c18' }}>
                        {s.employeeName}
                      </div>
                      <div className="text-xs" style={{ color: '#9a9a9a' }}>{s.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick nav ── */}
      <div
        className="rounded-2xl p-5 shadow-sm border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ backgroundColor: 'white', borderColor: '#e0e8e0' }}
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#5a9228' }}>
            Navigation
          </div>
          <p className="text-sm" style={{ color: '#596570' }}>
            Jump to the full week view or a specific day
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navigate('/week')}
            className="px-4 py-2 rounded-xl border font-medium text-sm transition-all hover:shadow-sm"
            style={{ borderColor: '#5a9228', color: '#5a9228' }}
          >
            📅 Full Week View
          </button>
          <button
            onClick={() => navigate(`/day/${todayStr}`)}
            className="px-4 py-2 rounded-xl font-medium text-sm text-white transition-all hover:opacity-90"
            style={{ backgroundColor: '#5a9228' }}
          >
            📋 Today's Plan
          </button>
          <button
            onClick={() => navigate('/ratio')}
            className="px-4 py-2 rounded-xl font-medium text-sm transition-all hover:opacity-90"
            style={{ backgroundColor: '#A0D083', color: '#E2F1DA' }}
          >
            📊 Ratio Dashboard
          </button>
        </div>
      </div>
    </Layout>
  );
}
