import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, startOfWeek, format, isToday } from 'date-fns';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { fetchRosters } from '../deputy';
import { getAttendance, getStaffRequired, getStatus } from '../attendance';
import { formatDate } from '../dateUtils';

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

  const loadDay = useCallback(async (dateObj: Date): Promise<DaySummary> => {
    const date = formatDate(dateObj);
    
    // Calculate total children from attendance
    const totalChildren = centre.rooms.reduce((sum, room) => {
      return sum + getAttendance(date, room.id);
    }, 0);
    
    const staffRequired = centre.rooms.reduce((sum, room) => {
      const attendance = getAttendance(date, room.id);
      return sum + getStaffRequired(attendance, room.ratio);
    }, 0);
    
    // Fetch live rosters
    try {
      const rosters = await fetchRosters(date, allRoomUnitIds);
      // Count unique staff (by employee ID) across room units only
      const roomUnitIds = new Set(centre.rooms.map(r => r.deputyUnitId));
      const uniqueStaff = new Set(
        rosters.filter(r => roomUnitIds.has(r.unitId)).map(r => r.employeeId)
      );
      const staffRostered = uniqueStaff.size;
      const status = getStatus(staffRostered, staffRequired);
      
      return { date, dateObj, totalChildren, staffRequired, staffRostered, status, loading: false };
    } catch {
      return { date, dateObj, totalChildren, staffRequired, staffRostered: 0, status: 'red', loading: false, error: 'Failed to load' };
    }
  }, []);

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
          <h1 className="text-2xl font-bold" style={{ color: '#1a2e1a' }}>Week Overview</h1>
          <p className="text-sm mt-1" style={{ color: '#6a8a6a' }}>Oatley Centre — {weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="px-3 py-2 rounded-lg border font-medium text-sm transition-colors hover:bg-gray-100"
            style={{ borderColor: '#c0d0c0', color: '#1a2e1a' }}
          >
            ←
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-2 rounded-lg border font-medium text-sm transition-colors hover:bg-gray-100"
            style={{ borderColor: '#c0d0c0', color: '#1a2e1a' }}
          >
            Today
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="px-3 py-2 rounded-lg border font-medium text-sm transition-colors hover:bg-gray-100"
            style={{ borderColor: '#c0d0c0', color: '#1a2e1a' }}
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
                backgroundColor: isCurrentDay ? '#e8f0e8' : 'white',
                borderColor: isCurrentDay ? '#4a7a3a' : '#e0e8e0',
              }}
            >
              {/* Date header */}
              <div className="mb-3">
                <div className="text-sm font-semibold" style={{ color: '#4a7a3a' }}>
                  {format(day.dateObj, 'EEE')}
                </div>
                <div className="text-xl font-bold" style={{ color: '#1a2e1a' }}>
                  {format(day.dateObj, 'd MMM')}
                </div>
                {isCurrentDay && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white mt-1 inline-block" style={{ backgroundColor: '#4a7a3a' }}>
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
                    <div className="flex justify-between">
                      <span style={{ color: '#6a8a6a' }}>Children</span>
                      <span className="font-semibold" style={{ color: '#1a2e1a' }}>{day.totalChildren}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#6a8a6a' }}>Required</span>
                      <span className="font-semibold" style={{ color: '#1a2e1a' }}>{day.staffRequired}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#6a8a6a' }}>Rostered</span>
                      <span className="font-semibold" style={{ color: '#1a2e1a' }}>{day.staffRostered}</span>
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
      <div className="mt-6 flex flex-wrap gap-4 text-sm" style={{ color: '#6a8a6a' }}>
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
