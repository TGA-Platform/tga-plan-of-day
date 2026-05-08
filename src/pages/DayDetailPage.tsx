import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { fetchRosters, fetchAbsentStaff } from '../deputy';
import { getAttendance, setAttendance, getStaffRequired, getStatus, formatTime } from '../attendance';
import type { RosteredStaff, AbsentStaff } from '../types';

const centre = CENTRES[0];
const allRoomUnitIds = centre.rooms.map(r => r.deputyUnitId);

const LUNCH_SLOTS = [
  '10:00–10:40',
  '10:40–11:20',
  '11:20–12:00',
  '12:00–12:40',
  '12:40–13:20',
];

export default function DayDetailPage() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  
  const [rosters, setRosters] = useState<RosteredStaff[]>([]);
  const [absentStaff, setAbsentStaff] = useState<AbsentStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendanceState] = useState<Record<string, number>>({});
  
  const safeDate = date || format(new Date(), 'yyyy-MM-dd');
  const dateObj = parseISO(safeDate);
  const dateLabel = format(dateObj, 'EEEE, d MMMM yyyy');

  // Load attendance from localStorage
  useEffect(() => {
    const att: Record<string, number> = {};
    for (const room of centre.rooms) {
      att[room.id] = getAttendance(safeDate, room.id);
    }
    setAttendanceState(att);
  }, [safeDate]);

  // Load rosters from Deputy
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchRosters(safeDate, allRoomUnitIds),
      fetchAbsentStaff(safeDate, allRoomUnitIds),
    ]).then(([r, a]) => {
      setRosters(r);
      setAbsentStaff(a);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [safeDate]);

  function handleAttendanceChange(roomId: string, value: number) {
    setAttendanceState(prev => ({ ...prev, [roomId]: value }));
    setAttendance(safeDate, roomId, value);
  }

  // Compute room stats
  const roomStats = centre.rooms.map(room => {
    const expected = attendance[room.id] ?? getAttendance(safeDate, room.id);
    const staffRequired = getStaffRequired(expected, room.ratio);
    const roomRosters = rosters.filter(r => r.unitId === room.deputyUnitId);
    const uniqueStaff = [...new Map(roomRosters.map(r => [r.employeeId, r])).values()];
    const staffRostered = uniqueStaff.length;
    const diff = staffRostered - staffRequired;
    const status = getStatus(staffRostered, staffRequired);
    
    return { room, expected, staffRequired, staffRostered, uniqueStaff, diff, status };
  });

  // Float staff: rostered to Float Staff unit (224)
  const floatRosters = rosters.filter(r => r.unitId === 224);
  const floatStaff = [...new Map(floatRosters.map(r => [r.employeeId, r])).values()];

  // Totals
  const totalChildren = Object.values(attendance).reduce((a, b) => a + b, 0);
  const totalRequired = roomStats.reduce((s, r) => s + r.staffRequired, 0);
  const totalRostered = new Set(rosters.filter(r => centre.rooms.some(room => room.deputyUnitId === r.unitId)).map(r => r.employeeId)).size;
  const totalDiff = totalRostered - totalRequired;
  const overallStatus = getStatus(totalRostered, totalRequired);

  const statusColor = { green: '#16a34a', amber: '#d97706', red: '#dc2626' };
  const statusBg = { green: '#dcfce7', amber: '#fef3c7', red: '#fee2e2' };
  const statusLabel = { green: 'Fully Staffed', amber: 'Marginal', red: 'Understaffed' };

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1a2e1a' }}>{dateLabel}</h1>
          <p className="text-sm mt-0.5" style={{ color: '#6a8a6a' }}>Oatley Centre — Plan of the Day</p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-print px-4 py-2 rounded-lg border font-medium text-sm transition-colors"
          style={{ borderColor: '#4a7a3a', color: '#4a7a3a' }}
        >
          🖨 Print Plan
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Children', value: totalChildren },
          { label: 'Staff Required', value: totalRequired },
          { label: 'Staff Rostered', value: totalRostered },
          { label: 'Difference', value: totalDiff >= 0 ? `+${totalDiff}` : totalDiff, colored: true },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-xl p-4 border" style={{ borderColor: '#e0e8e0' }}>
            <div className="text-xs font-medium mb-1" style={{ color: '#6a8a6a' }}>{stat.label}</div>
            <div
              className="text-2xl font-bold"
              style={{ color: stat.colored ? (totalDiff >= 0 ? '#16a34a' : '#dc2626') : '#1a2e1a' }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Overall status */}
      <div
        className="rounded-xl px-4 py-3 mb-6 flex items-center gap-3"
        style={{ backgroundColor: statusBg[overallStatus] }}
      >
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColor[overallStatus] }}></div>
        <span className="font-semibold" style={{ color: statusColor[overallStatus] }}>
          {statusLabel[overallStatus]}
        </span>
        {loading && <span className="text-sm opacity-60 ml-2">Loading live Deputy data…</span>}
      </div>

      {/* Room table */}
      <div className="bg-white rounded-2xl border overflow-hidden mb-6" style={{ borderColor: '#e0e8e0' }}>
        <div className="px-4 py-3 border-b font-semibold text-sm" style={{ borderColor: '#e0e8e0', color: '#1a2e1a' }}>
          Room Staffing
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide" style={{ backgroundColor: '#f0f4f0', color: '#6a8a6a' }}>
                <th className="text-left px-4 py-3">Room</th>
                <th className="text-left px-4 py-3">Age</th>
                <th className="text-center px-3 py-3">Ratio</th>
                <th className="text-center px-3 py-3">Expected</th>
                <th className="text-center px-3 py-3">Required</th>
                <th className="text-left px-4 py-3">Rostered Staff</th>
                <th className="text-center px-3 py-3">Count</th>
                <th className="text-center px-3 py-3">Diff</th>
                <th className="text-center px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {roomStats.map(({ room, expected, staffRequired, staffRostered, uniqueStaff, diff, status }) => (
                <tr key={room.id} className="border-t" style={{ borderColor: '#f0f4f0' }}>
                  <td className="px-4 py-3 font-semibold" style={{ color: '#1a2e1a' }}>{room.name}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#6a8a6a' }}>{room.ageGroup}</td>
                  <td className="px-3 py-3 text-center" style={{ color: '#6a8a6a' }}>1:{room.ratio}</td>
                  <td className="px-3 py-3 text-center">
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={expected}
                      onChange={e => handleAttendanceChange(room.id, parseInt(e.target.value) || 0)}
                      className="w-16 text-center rounded-lg border px-2 py-1 font-semibold focus:outline-none"
                      style={{ borderColor: '#c0d0c0', color: '#1a2e1a', backgroundColor: '#f9fdf9' }}
                    />
                  </td>
                  <td className="px-3 py-3 text-center font-semibold" style={{ color: '#1a2e1a' }}>{staffRequired}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {loading ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-400">Loading…</span>
                      ) : uniqueStaff.length === 0 ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-400">No staff</span>
                      ) : (
                        uniqueStaff.map(s => (
                          <span
                            key={s.employeeId}
                            className="text-xs px-2 py-1 rounded-full font-medium"
                            style={{ backgroundColor: '#e8f0e8', color: '#2a5a2a' }}
                            title={s.startTime ? `${formatTime(s.startTime)} – ${formatTime(s.endTime)}` : ''}
                          >
                            {s.employeeName}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center font-bold" style={{ color: '#1a2e1a' }}>{staffRostered}</td>
                  <td className="px-3 py-3 text-center font-bold" style={{ color: diff >= 0 ? '#16a34a' : '#dc2626' }}>
                    {diff >= 0 ? `+${diff}` : diff}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div
                      className="w-3 h-3 rounded-full mx-auto"
                      style={{ backgroundColor: statusColor[status] }}
                      title={statusLabel[status]}
                    ></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Float / Break Cover */}
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

        {/* Absent Staff */}
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

      {/* Lunch Rotation */}
      <div className="bg-white rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
        <h3 className="font-semibold mb-3" style={{ color: '#1a2e1a' }}>Lunch Rotation</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1].map(group => {
            const groupLabel = group === 0 ? 'Group A' : 'Group B';
            // Alternate rooms between groups
            const groupRooms = centre.rooms.filter((_, i) => i % 2 === group);
            
            return (
              <div key={group} className="rounded-xl p-3" style={{ backgroundColor: '#f5f7f5' }}>
                <div className="text-sm font-semibold mb-2" style={{ color: '#4a7a3a' }}>{groupLabel}</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: '#6a8a6a' }}>
                      <th className="text-left py-1">Time Slot</th>
                      <th className="text-left py-1">Room</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LUNCH_SLOTS.map((slot, i) => (
                      <tr key={slot} className="border-t" style={{ borderColor: '#e0e8e0' }}>
                        <td className="py-1.5 font-medium" style={{ color: '#1a2e1a' }}>{slot}</td>
                        <td className="py-1.5" style={{ color: '#4a7a3a' }}>
                          {groupRooms[i % groupRooms.length]?.name || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>

      {/* Print footer */}
      <div className="hidden print:block mt-8 pt-4 border-t text-xs text-gray-500">
        Generated: {format(new Date(), 'dd/MM/yyyy HH:mm')} — TGA Plan of the Day — Oatley
      </div>
    </Layout>
  );
}
