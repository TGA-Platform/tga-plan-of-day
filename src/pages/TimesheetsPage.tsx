import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { CheckCircle, AlertCircle, Clock, Download, UserCheck, CalendarRange, Brain } from 'lucide-react';
import Layout from '../components/Layout';
import { getUser, getAllowedCentres } from '../auth';
import { CENTRES } from '../config';
import { formatHours } from '../lib/roundingEngine';
import type { TimesheetApproval } from '../types';

interface TimesheetSummary {
  total: number;
  pending: number;
  flagged: number;
  approved: number;
  leave: number;
  noShows: number;
}

export default function TimesheetsPage() {
  const navigate = useNavigate();
  const user = getUser();
  const allowedCentres = user ? getAllowedCentres(user) : [];
  const [centreId, setCentreId] = useState(allowedCentres[0]?.id || CENTRES[0]?.id);
  const today = format(new Date(), 'yyyy-MM-dd');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [rows, setRows] = useState<TimesheetApproval[]>([]);
  const [summary, setSummary] = useState<TimesheetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState<string[]>([]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadTimesheets();
  }, [centreId, startDate, endDate]);

  async function loadTimesheets() {
    setLoading(true);
    setError('');
    setAiNotes([]);
    try {
      const res = await fetch(
        `/api/timesheets?centreId=${encodeURIComponent(centreId)}` +
        `&startDate=${startDate}&endDate=${endDate}`
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load');
      setRows(data.rows || []);
      setSummary(data.summary || null);
      generateAiNotes(data.rows || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load timesheets');
    }
    setLoading(false);
  }

  function generateAiNotes(rows: TimesheetApproval[]) {
    const notes: string[] = [];
    const noShows = rows.filter(r => (r.flags || []).some(f => f.includes('No clock events')));
    if (noShows.length) notes.push(`${noShows.length} rostered shift${noShows.length > 1 ? 's' : ''} with no clock-in/out or leave — review and mark leave if applicable.`);
    const late = rows.filter(r => (r.flags || []).some(f => f.includes('late')));
    if (late.length) notes.push(`${late.length} shift${late.length > 1 ? 's' : ''} started or finished outside the ±15 min tolerance.`);
    const longLunch = rows.filter(r => (r.flags || []).some(f => f.includes('Lunch')));
    if (longLunch.length) notes.push(`${longLunch.length} lunch break${longLunch.length > 1 ? 's' : ''} differ from rostered duration by more than 15 min.`);
    const leave = rows.filter(r => r.leave_type);
    if (leave.length) notes.push(`${leave.length} leave shift${leave.length > 1 ? 's' : ''} ready for approval.`);
    setAiNotes(notes);
  }

  async function approveRow(row: TimesheetApproval) {
    setSavingId(row.id || `${row.staff_id}:${row.date}`);
    try {
      const res = await fetch('/api/timesheet-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centreId: row.centre_id,
          staffId: row.staff_id,
          date: row.date,
          approverName: user?.name || user?.email || 'Director',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to approve');
      setRows(prev => prev.map(r => (r.staff_id === row.staff_id && r.date === row.date ? data.row : r)));
    } catch (e: any) {
      setError(e.message || 'Failed to approve');
    }
    setSavingId(null);
  }

  async function approveAll() {
    const pending = rows.filter(r => r.status === 'pending' || r.status === 'flagged');
    for (const row of pending) {
      await approveRow(row);
    }
  }

  function exportCSV() {
    const centreName = allowedCentres.find(c => c.id === centreId)?.name || centreId;
    const header = ['Date', 'Staff', 'Roster Start', 'Roster End', 'Roster Lunch', 'Actual Start', 'Actual End', 'Actual Lunch Start', 'Actual Lunch End', 'Approved Start', 'Approved End', 'Approved Lunch', 'Hours', 'Status', 'Leave Type', 'Flags', 'Approved By', 'Approved At'];
    const lines = rows.map(r => [
      r.date,
      r.staff_name,
      r.roster_start_time || '',
      r.roster_end_time || '',
      r.roster_lunch_duration ?? '',
      r.actual_start_time || '',
      r.actual_end_time || '',
      r.actual_lunch_start || '',
      r.actual_lunch_end || '',
      r.approved_start_time || '',
      r.approved_end_time || '',
      r.approved_lunch_duration ?? '',
      r.approved_hours ?? '',
      r.status,
      r.leave_type || '',
      (r.flags || []).join('; '),
      r.approver_name || '',
      r.approved_at ? format(parseISO(r.approved_at), 'dd/MM/yyyy h:mm a') : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheets-${centreName}-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pendingCount = useMemo(() => rows.filter(r => r.status === 'pending' || r.status === 'flagged').length, [rows]);

  return (
    <Layout>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ color: '#2d5c18' }}>Timesheets</h1>
            <select
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
              value={centreId}
              onChange={e => setCentreId(e.target.value)}
            >
              {allowedCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <CalendarRange size={18} style={{ color: '#596570' }} />
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              />
              <span style={{ color: '#596570' }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {pendingCount > 0 && (
              <button
                onClick={approveAll}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white active:scale-95 transition-transform"
                style={{ backgroundColor: '#5a9228' }}
              >
                <UserCheck size={18} />
                Approve all ({pendingCount})
              </button>
            )}
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border active:scale-95 transition-transform"
              style={{ borderColor: '#D0E8B8', color: '#2d5c18', backgroundColor: 'white' }}
            >
              <Download size={18} />
              Export CSV
            </button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <SummaryCard label="Total" value={summary.total} color="#596570" />
            <SummaryCard label="Pending" value={summary.pending} color="#92400e" bg="#fef3c7" />
            <SummaryCard label="Flagged" value={summary.flagged} color="#dc2626" bg="#fee2e2" />
            <SummaryCard label="Approved" value={summary.approved} color="#166534" bg="#dcfce7" />
            <SummaryCard label="Leave" value={summary.leave} color="#7c3aed" bg="#f3e8ff" />
            <SummaryCard label="No show" value={summary.noShows} color="#991b1b" bg="#fee2e2" />
          </div>
        )}

        {aiNotes.length > 0 && (
          <div className="rounded-xl border p-4" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
            <div className="flex items-center gap-2 mb-2">
              <Brain size={18} style={{ color: '#2d5c18' }} />
              <span className="font-semibold text-sm" style={{ color: '#2d5c18' }}>Assistant notes</span>
            </div>
            <ul className="space-y-1">
              {aiNotes.map((note, i) => (
                <li key={i} className="text-sm flex items-start gap-2" style={{ color: '#050505' }}>
                  <span style={{ color: '#5a9228' }}>•</span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12" style={{ color: '#596570' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border" style={{ borderColor: '#E2F1DA', color: '#596570' }}>
            No shifts found for this date range.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: '#F5FAF3' }}>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Date / Staff</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Rostered</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Actual</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Approved</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Hours</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Status</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id || `${row.staff_id}:${row.date}`} className="border-t" style={{ borderColor: '#E2F1DA' }}>
                      <td className="px-4 py-3">
                        <div className="font-medium" style={{ color: '#050505' }}>{row.staff_name}</div>
                        <div className="text-xs" style={{ color: '#596570' }}>{format(parseISO(row.date), 'EEE d MMM')}</div>
                        {row.leave_type && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: '#f3e8ff', color: '#7c3aed' }}>
                            {row.leave_type} leave
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" style={{ color: '#596570' }}>
                        {row.roster_start_time || '—'} – {row.roster_end_time || '—'}
                        {row.roster_lunch_duration ? <div className="text-xs">Lunch {row.roster_lunch_duration} min</div> : null}
                      </td>
                      <td className="px-4 py-3" style={{ color: '#596570' }}>
                        <div>{row.actual_start_time || '—'} – {row.actual_end_time || '—'}</div>
                        {row.actual_lunch_start && row.actual_lunch_end && (
                          <div className="text-xs">Lunch {row.actual_lunch_start}–{row.actual_lunch_end}</div>
                        )}
                      </td>
                      <td className="px-4 py-3" style={{ color: '#050505' }}>
                        {row.approved_start_time || '—'} – {row.approved_end_time || '—'}
                        {row.approved_lunch_duration ? <div className="text-xs">Lunch {row.approved_lunch_duration} min</div> : null}
                      </td>
                      <td className="px-4 py-3 font-semibold" style={{ color: '#050505' }}>
                        {row.approved_hours ? formatHours(row.approved_hours) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} flags={row.flags || []} />
                      </td>
                      <td className="px-4 py-3">
                        {(row.status === 'pending' || row.status === 'flagged') ? (
                          <button
                            onClick={() => approveRow(row)}
                            disabled={savingId === (row.id || `${row.staff_id}:${row.date}`)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
                            style={{ backgroundColor: '#5a9228' }}
                          >
                            <CheckCircle size={14} />
                            {savingId === (row.id || `${row.staff_id}:${row.date}`) ? 'Saving…' : 'Approve'}
                          </button>
                        ) : (
                          <div className="text-xs" style={{ color: '#596570' }}>
                            {row.approver_name || 'Approved'}
                            {row.approved_at && <div>{format(parseISO(row.approved_at), 'd MMM h:mm a')}</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value, color, bg }: { label: string; value: number; color: string; bg?: string }) {
  return (
    <div className="rounded-xl border p-3 text-center" style={{ borderColor: '#E2F1DA', backgroundColor: bg || 'white' }}>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs" style={{ color: '#596570' }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status, flags }: { status: string; flags: string[] }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
        <CheckCircle size={12} />
        Approved
      </span>
    );
  }
  if (status === 'flagged') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold" title={flags.join('\n')} style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
        <AlertCircle size={12} />
        Flagged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
      <Clock size={12} />
      Pending
    </span>
  );
}
