/**
 * FloatBreakPanel
 *
 * Unified float coverage schedule — replaces the separate Lunch Break Plan.
 * Reads directly from float_schedules (saved via Plan Day float panel) so the
 * two views are always in sync.
 *
 * Shows each float's full day as a timeline:
 *   🔢 Ratio cover  |  🍽 Lunch cover  |  📚 Programming  |  🍽 Own break
 *
 * If no float schedule is saved, shows an empty state prompting the director
 * to plan the float's day via the Plan Day section above.
 */
import { useState, useEffect } from 'react';
import type { FloatStaff } from '../types';

interface FloatBlock {
  id:                   string;
  type:                 'start' | 'end' | 'break';
  startTime:            string;
  endTime:              string;
  roomName:             string;
  coveringEmployeeId:   number | null;
  coveringEmployeeName: string;
  coverType?:           'lunch' | 'programming' | 'ratio';
  notes:                string;
}

interface FloatScheduleRow {
  employee_id:   number;
  employee_name: string;
  schedule:      FloatBlock[];
}

interface Props {
  centreId: string;
  date:     string;
  floats:   FloatStaff[];
  issStaff: FloatStaff[];
}

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.XW_jTY26ZVzT_GqRpZMr0bFIhKDiQLGLIT4w3g-xc2c';

const COVER_META: Record<string, { label: string; emoji: string; bg: string; text: string; border: string }> = {
  ratio:       { label: 'Ratio cover',      emoji: '🔢', bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  lunch:       { label: 'Lunch cover',      emoji: '🍽', bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  programming: { label: 'Programming cover',emoji: '📚', bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
  cleaning:    { label: 'Cleaning duties',  emoji: '🧹', bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
};

function blockMeta(block: FloatBlock) {
  if (block.type === 'break' && block.coverType) return COVER_META[block.coverType];
  if (block.type === 'break') {
    // infer from notes
    const n = (block.notes || '').toLowerCase();
    if (n.includes('programming')) return COVER_META.programming;
    if (n.includes('ratio') || n.includes('shortage')) return COVER_META.ratio;
    return COVER_META.lunch;
  }
  return null; // start/end blocks — shown differently
}

export default function FloatBreakPanel({ centreId, date, floats, issStaff }: Props) {
  const [schedules, setSchedules] = useState<FloatScheduleRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const allFloatIds = new Set([...floats.map(f => f.employeeId), ...issStaff.map(f => f.employeeId)]);

  useEffect(() => {
    if (!centreId || !date) return;
    setLoading(true);

    fetch(
      `${SUPABASE_URL}/rest/v1/float_schedules?centre_id=eq.${encodeURIComponent(centreId)}&date=eq.${date}&select=employee_id,employee_name,schedule`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
    )
      .then(r => r.ok ? r.json() : [])
      .then((rows: FloatScheduleRow[]) => {
        // Only show actual floats/ISS for this centre
        const relevant = rows.filter(r => allFloatIds.has(r.employee_id));
        setSchedules(relevant);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [centreId, date]); // eslint-disable-line

  const hasData = schedules.length > 0;

  return (
    <div className="rounded-2xl border overflow-hidden shadow-sm mb-6" style={{ borderColor: '#c7d2fe' }}>
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between cursor-pointer select-none"
        style={{ backgroundColor: '#eef2ff' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold" style={{ color: '#3730a3' }}>📋 Float Schedule</span>
          <span className="text-xs" style={{ color: '#6366f1' }}>
            Coverage plan · linked to Plan Day
          </span>
          {!loading && hasData && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: '#e0e7ff', color: '#4338ca' }}>
              {schedules.length} float{schedules.length !== 1 ? 's' : ''} scheduled
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: '#6366f1' }}>{collapsed ? '▾' : '▴'}</span>
      </div>

      {!collapsed && (
        <div className="bg-white">
          {loading ? (
            <div className="px-4 py-6 text-sm italic text-center" style={{ color: '#9ca3af' }}>
              Loading float schedules…
            </div>
          ) : !hasData ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm" style={{ color: '#9ca3af' }}>No float schedule saved for today.</p>
              <p className="text-xs mt-1" style={{ color: '#c4b5fd' }}>
                Use the <strong>Plan Day</strong> section above to schedule your floats — it will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: '#e0e7ff' }}>
              {schedules.map(float => (
                <div key={float.employee_id} className="px-4 py-3">
                  {/* Float header */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: allFloatIds.has(float.employee_id) &&
                        issStaff.some(f => f.employeeId === float.employee_id) ? '#7c3aed' : '#4338ca' }}>
                      {float.employee_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm font-semibold" style={{ color: '#1e1b4b' }}>{float.employee_name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: '#e0e7ff', color: '#4338ca' }}>
                      {issStaff.some(f => f.employeeId === float.employee_id) ? 'ISS' : 'Float'}
                    </span>
                  </div>

                  {/* Timeline blocks */}
                  <div className="space-y-1 ml-9">
                    {(float.schedule || []).map((block, i) => {
                      const meta = blockMeta(block);
                      const isOwnBreak = block.type === 'break' && !block.coveringEmployeeId && !block.coveringEmployeeName;
                      const isShift    = block.type === 'start' || block.type === 'end';

                      if (isShift) {
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs" style={{ color: '#6b7280' }}>
                            <span className="font-mono w-24 flex-shrink-0">{block.startTime}–{block.endTime}</span>
                            <span>📍 {block.roomName || '—'}</span>
                            {block.notes && <span className="opacity-60">· {block.notes}</span>}
                          </div>
                        );
                      }

                      if (isOwnBreak) {
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs rounded-lg px-2 py-1"
                            style={{ backgroundColor: '#fef9c3', color: '#713f12' }}>
                            <span className="font-mono w-24 flex-shrink-0">{block.startTime}–{block.endTime}</span>
                            <span>🍽 Own lunch break</span>
                            {block.notes && <span className="opacity-60">· {block.notes}</span>}
                          </div>
                        );
                      }

                      return (
                        <div key={i} className="flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 border"
                          style={{ backgroundColor: meta?.bg ?? '#f9fafb', color: meta?.text ?? '#374151', borderColor: meta?.border ?? '#e5e7eb' }}>
                          <span className="font-mono w-24 flex-shrink-0 mt-0.5">{block.startTime}–{block.endTime}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{meta?.emoji ?? '☕'} {block.roomName || '—'}</span>
                              {meta && (
                                <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold"
                                  style={{ backgroundColor: meta.border + '44', color: meta.text }}>
                                  {meta.label}
                                </span>
                              )}
                            </div>
                            {block.coveringEmployeeName && (
                              <div className="mt-0.5 opacity-80">
                                Covering: <strong>{block.coveringEmployeeName}</strong>
                              </div>
                            )}
                            {block.notes && block.notes !== meta?.label && (
                              <div className="mt-0.5 opacity-60">{block.notes}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {(!float.schedule || float.schedule.length === 0) && (
                      <span className="text-xs italic" style={{ color: '#9ca3af' }}>No blocks planned</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
