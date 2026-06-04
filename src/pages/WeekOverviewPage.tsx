import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, startOfWeek, format, isToday } from 'date-fns';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { fetchRosters } from '../deputy';
import { getAttendance, getStaffRequired, getStatus } from '../attendance';
import { formatDate } from '../dateUtils';
import { fetchAttendanceForDate, fetchForecast, getForecastPeak } from '../api/ownaData';

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
  isForecast?: boolean; // true if children count came from forecast (not live/booked)
}

function getWeekStart(offset: number): Date {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  return addDays(weekStart, offset * 7);
}

export default function WeekOverviewPage() {
  const navigate = useNavigate();
  const [weekOffset, setWeekOffset] = useState(0);
  const [days, setDays] = useState<DaySummary[]>([]);

  const weekStart = getWeekStart(weekOffset);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  const [realAtt, setRealAtt] = useState<Record<string, number>>({});
useEffect(() => {
  // Load attendance from localStorage
  const att: Record<string, number> = {};
  for (const room of centre.rooms) {
    att[room.id] = getAttendance(formatDate(weekStart), room.id);
  }
  setRealAtt(att);
}, [weekStart]);

const loadDay = useCallback(async (dateObj: Date): Promise<DaySummary> => {
    const date = formatDate(dateObj);
    
    // Fetch real attendance from Owna (Supabase) — fall back to forecast, then localStorage
    let totalChildren = 0;
    let staffRequired = 0;
    let isForecast = false;
    try {
      const ownaRecords = await fetchAttendanceForDate('oatley', date);
      if (ownaRecords.length > 0) {
        // Use actual attendance: count unique children who signed in
        totalChildren = new Set(ownaRecords.filter(r => r.sign_in).map(r => r.child_name)).size;
        // Staff required based on actual room attendance counts
        staffRequired = centre.rooms.reduce((sum, room) => {
          const roomCount = ownaRecords.filter(r => r.room_name === (room.ownaRoomName || room.name) && r.sign_in).length;
          return sum + getStaffRequired(roomCount, room.ratio);
        }, 0);
      } else {
        // No Owna data — try forecast first
        const forecast = await fetchForecast('oatley', date);
        const hasForecast = Object.keys(forecast).length > 0;
        
        if (hasForecast) {
          // Use forecast peak counts per room
          isForecast = true;
          totalChildren = centre.rooms.reduce((sum, room) => {
            const ownaName = room.ownaRoomName || room.name;
            const peak = getForecastPeak(forecast, ownaName);
            return sum + Math.round(peak);
          }, 0);
          staffRequired = centre.rooms.reduce((sum, room) => {
            const ownaName = room.ownaRoomName || room.name;
            const peak = getForecastPeak(forecast, ownaName);
            return sum + getStaffRequired(Math.round(peak), room.ratio);
          }, 0);
        } else {
          // Fall back to booked counts from localStorage
          totalChildren = centre.rooms.reduce((sum, room) => sum + (realAtt[room.id] || getAttendance(date, room.id)), 0);
          staffRequired = centre.rooms.reduce((sum, room) => {
            const att = realAtt[room.id] || getAttendance(date, room.id);
            return sum + getStaffRequired(att, room.ratio);
          }, 0);
        }
      }
    } catch {
      totalChildren = centre.rooms.reduce((sum, room) => sum + (realAtt[room.id] || getAttendance(date, room.id)), 0);
      staffRequired = centre.rooms.reduce((sum, room) => {
        const att = realAtt[room.id] || getAttendance(date, room.id);
        return sum + getStaffRequired(att, room.ratio);
      }, 0);
    }
    
    // Fetch live rosters from Deputy
    try {
      const rosters = await fetchRosters(date, allRoomUnitIds);
      // Count unique staff (by employee ID) across room units only (exclude float/leave)
      const roomUnitIds = new Set(centre.rooms.map(r => r.deputyUnitId));
      const uniqueStaff = new Set(
        rosters.filter(r => roomUnitIds.has(r.unitId)).map(r => r.employeeId)
      );
      const staffRostered = uniqueStaff.size;
      const status = getStatus(staffRostered, staffRequired);
      return { date, dateObj, totalChildren, staffRequired, staffRostered, status, loading: false, isForecast };
    } catch {
      return { date, dateObj, totalChildren, staffRequired, staffRostered: 0, status: 'red' as const, loading: false, error: 'Failed to load', isForecast };
    }
  }, [realAtt]);

  useEffect(() => {
    // Initialize with loading state
    setDays(weekDays.map(dateObj => ({
      date: formatDate(dateObj),
      dateObj,
      totalChildren: 0,
      staffRequired: 0,
      staffRostered: 0,
      status: 'red' as const,
      loading: true,
    })));

    // Load each day
    weekDays.forEach(async (dateObj, i) => {
      const summary = await loadDay(dateObj);
      setDays(prev => {
        const next = [...prev];
        next[i] = summary;
        return next;
      });
    });
  }, [weekOffset]);

  const weekLabel = `Week of ${format(weekStart, 'd MMM yyyy')}`;

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2d5c18' }}>Week Overview</h1>
          <p className="text-sm mt-1" style={{ color: '#596570' }}>Oatley Centre — {weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="px-3 py-2 rounded-lg border font-medium text-sm transition-colors hover:bg-gray-100"
            style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
          >
            ←
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-2 rounded-lg border font-medium text-sm transition-colors hover:bg-gray-100"
            style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
          >
            Today
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="px-3 py-2 rounded-lg border font-medium text-sm transition-colors hover:bg-gray-100"
            style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
          >
            →
          </button>
        </div>
      </div>

      {/* Day cards */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        {days.map((day) => {
          const isCurrentDay = isToday(day.dateObj);
          const statusColor = {
            green: '#16a34a',
            amber: '#d97706',
            red: '#dc2626',
          }[day.status];
          const statusBg = {
            green: '#f0fdf4',
            amber: '#fffbeb',
            red: '#fef2f2',
          }[day.status];

          return (
            <div
              key={day.date}
              onClick={() => navigate(`/day/${day.date}`)}
              className="rounded-xl p-4 cursor-pointer transition-all hover:shadow-md border-2"
              style={{
                backgroundColor: isCurrentDay ? '#E2F1DA' : 'white',
                borderColor: isCurrentDay ? '#5a9228' : '#e0e8e0',
              }}
            >
              {/* Date header */}
              <div className="mb-3">
                <div className="text-sm font-semibold" style={{ color: '#5a9228' }}>
                  {format(day.dateObj, 'EEE')}
                </div>
                <div className="text-xl font-bold" style={{ color: '#2d5c18' }}>
                  {format(day.dateObj, 'd MMM')}
                </div>
                {isCurrentDay && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white mt-1 inline-block" style={{ backgroundColor: '#5a9228' }}>
                    Today
                  </span>
                )}
              </div>

              {day.loading ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              ) : (
                <>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span style={{ color: '#596570' }}>Children</span>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold" style={{ color: '#2d5c18' }}>{day.totalChildren}</span>
                        {day.isForecast && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', fontSize: '10px' }}>
                            📊
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#596570' }}>Required</span>
                      <span className="font-semibold" style={{ color: '#2d5c18' }}>{day.staffRequired}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#596570' }}>Rostered</span>
                      <span className="font-semibold" style={{ color: '#2d5c18' }}>{day.staffRostered}</span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: statusBg }}>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: statusColor }}></div>
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: statusColor }}>
                      {day.status === 'green' ? 'Staffed' : day.status === 'amber' ? 'Marginal' : 'Understaffed'}
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-6 flex flex-wrap gap-4 text-sm" style={{ color: '#596570' }}>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span>Staffed (≥ required)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500"></div>
          <span>Marginal (within 1)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span>Understaffed (&gt;1 short)</span>
        </div>
      </div>
    </Layout>
  );
}
