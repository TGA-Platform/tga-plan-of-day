import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { CheckCircle, AlertCircle, Clock, Download, UserCheck, CalendarRange, Brain, X, Edit3 } from 'lucide-react';
import Layout from '../components/Layout';
import { getUser, getAllowedCentres } from '../auth';
import { CENTRES } from '../config';
import { formatHours, roundTimesheet } from '../lib/roundingEngine';
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
  const [editingRow, setEditingRow] = useState<TimesheetApproval | null>(null);
  const [approvedStart, setApprovedStart] = useState('');
  const [approvedEnd, setApprovedEnd] = useState('');
  const [approvedLunch, setApprovedLunch] = useState('');
  const [editFlags, setEditFlags] = useState<string[]>([]);

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

  function computeApprovedValues(row: TimesheetApproval) {
    if (row.status === 'approved' && row.approved_start_time && row.approved_end_time) {
      return {
        start: row.approved_start_time,
        end: row.approved_end_time,
        lunch: String(row.approved_lunch_duration ?? row.roster_lunch_duration ?? 30),
        flags: row.flags || [],
      };
    }
    const rostered = {
      start: row.roster_start_time || row.actual_start_time || '08:00',
      end: row.roster_end_time || row.actual_end_time || '16:00',
      lunchDuration: row.roster_lunch_duration ?? 30,
    };
    const actual = {
      start: row.actual_start_time || undefined,
      end: row.actual_end_time || undefined,
      lunchStart: row.actual_lunch_start || undefined,
      lunchEnd: row.actual_lunch_end || undefined,
    };
    const computed = roundTimesheet(rostered, actual);
    return {
      start: computed.approvedStart,
      end: computed.approvedEnd,
      lunch: String(computed.approvedLunchDuration),
      flags: computed.flags,
    };
  }

  function openEditModal(row: TimesheetApproval) {
    const values = computeApprovedValues(row);
    setEditingRow(row);
    setApprovedStart(values.start);
    setApprovedEnd(values.end);
    setApprovedLunch(values.lunch);
    setEditFlags(values.flags);
  }

  function closeEditModal() {
    setEditingRow(null);
    setApprovedStart('');
    setApprovedEnd('');
    setApprovedLunch('');
    setEditFlags([]);
  }

  function recomputeFlagsFromEdit(): string[] {
    if (!editingRow) return [];
    const flags: string[] = [];
    const rosterStart = editingRow.roster_start_time;
    const rosterEnd = editingRow.roster_end_time;
    const rosterLunch = editingRow.roster_lunch_duration ?? 30;
    if (rosterStart && approvedStart && approvedStart !== rosterStart) {
      flags.push(`Approved start ${approvedStart} differs from rostered ${rosterStart}`);
    }
    if (rosterEnd && approvedEnd && approvedEnd !== rosterEnd) {
      flags.push(`Approved end ${approvedEnd} differs from rostered ${rosterEnd}`);
    }
    if (String(rosterLunch) !== approvedLunch) {
      flags.push(`Approved lunch ${approvedLunch} min differs from rostered ${rosterLunch} min`);
    }
    return flags.length ? flags : editFlags;
  }

  function approvedHoursFromEdit(): number {
    if (!approvedStart || !approvedEnd || !approvedLunch) return 0;
    const [sh, sm] = approvedStart.split(':').map(Number);
    const [eh, em] = approvedEnd.split(':').map(Number);
    const startM = sh * 60 + sm;
    const endM = eh * 60 + em;
    const lunchM = Math.max(0, Number(approvedLunch) || 0);
    return Math.max(0, (endM - startM - lunchM) / 60);
  }

  async function saveApproval(row: TimesheetApproval, approve: boolean) {
    setSavingId(row.id || `${row.staff_id}:${row.date}`);
    setError('');
    try {
      const body: any = {
        centreId: row.centre_id,
        staffId: row.staff_id,
        date: row.date,
        approverName: user?.name || user?.email || 'Director',
      };
      if (approve) {
        body.approvedStart = approvedStart;
        body.approvedEnd = approvedEnd;
        body.approvedLunchDuration = Number(approvedLunch) || 0;
        body.approvedHours = approvedHoursFromEdit();
        body.flags = recomputeFlagsFromEdit();
        body.status = body.flags.length ? 'flagged' : 'approved';
      }
      const res = await fetch('/api/timesheet-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save');
      setRows(prev => prev.map(r => (r.staff_id === row.staff_id && r.date === row.date ? data.row : r)));
      closeEditModal();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    }
    setSavingId(null);
  }

  async function approveAll() {
    const pending = rows.filter(r => r.status === 'pending' || r.status === 'flagged');
    for (const row of pending) {
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
                        <button
                          onClick={() => openEditModal(row)}
                          disabled={savingId === (row.id || `${row.staff_id}:${row.date}`)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
                          style={{ backgroundColor: row.status === 'approved' ? '#596570' : '#5a9228' }}
                        >
                          {row.status === 'approved' ? <Edit3 size={14} /> : <CheckCircle size={14} />}
                          {savingId === (row.id || `${row.staff_id}:${row.date}`) ? 'Saving…' : (row.status === 'approved' ? 'Edit' : 'Review')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {editingRow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
                <h3 className="text-lg font-bold" style={{ color: '#2d5c18' }}>Review & approve</h3>
                <button onClick={closeEditModal} className="p-1 rounded hover:bg-gray-100" style={{ color: '#596570' }}>
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <div className="font-semibold" style={{ color: '#050505' }}>{editingRow.staff_name}</div>
                  <div className="text-xs" style={{ color: '#596570' }}>{format(parseISO(editingRow.date), 'EEEE, d MMMM yyyy')}</div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="rounded-xl p-3" style={{ backgroundColor: '#F5FAF3' }}>
                    <div className="text-xs font-semibold uppercase mb-1" style={{ color: '#596570' }}>Rostered</div>
                    <div style={{ color: '#050505' }}>{editingRow.roster_start_time || '—'} – {editingRow.roster_end_time || '—'}</div>
                    {editingRow.roster_lunch_duration ? <div className="text-xs" style={{ color: '#596570' }}>Lunch {editingRow.roster_lunch_duration} min</div> : null}
                  </div>
                  <div className="rounded-xl p-3" style={{ backgroundColor: '#F5FAF3' }}>
                    <div className="text-xs font-semibold uppercase mb-1" style={{ color: '#596570' }}>Actual</div>
                    <div style={{ color: '#050505' }}>{editingRow.actual_start_time || '—'} – {editingRow.actual_end_time || '—'}</div>
                    {editingRow.actual_lunch_start && editingRow.actual_lunch_end ? <div className="text-xs" style={{ color: '#596570' }}>Lunch {editingRow.actual_lunch_start}–{editingRow.actual_lunch_end}</div> : null}
                  </div>
                </div>

                <div className="border-t pt-4" style={{ borderColor: '#E2F1DA' }}>
                  <div className="text-sm font-semibold mb-2" style={{ color: '#2d5c18' }}>Approved times</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs mb-1" style={{ color: '#596570' }}>Start</label>
                      <input
                        type="time"
                        value={approvedStart}
                        onChange={e => setApprovedStart(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border text-sm"
                        style={{ borderColor: '#D0E8B8' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: '#596570' }}>End</label>
                      <input
                        type="time"
                        value={approvedEnd}
                        onChange={e => setApprovedEnd(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border text-sm"
                        style={{ borderColor: '#D0E8B8' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ color: '#596570' }}>Lunch (min)</label>
                      <input
                        type="number"
                        value={approvedLunch}
                        onChange={e => setApprovedLunch(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border text-sm"
                        style={{ borderColor: '#D0E8B8' }}
                        min={0}
                      />
                    </div>
                  </div>
                  <div className="mt-3 p-3 rounded-xl" style={{ backgroundColor: '#E2F1DA' }}>
                    <div className="text-xs" style={{ color: '#596570' }}>Approved hours</div>
                    <div className="text-2xl font-bold" style={{ color: '#2d5c18' }}>{formatHours(approvedHoursFromEdit())}</div>
                  </div>
                </div>

                {editFlags.length > 0 && (
                  <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
                    {editFlags.map((f, i) => <div key={i}>• {f}</div>)}
                  </div>
                )}

                {editingRow.leave_type && (
                  <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: '#f3e8ff', color: '#7c3aed' }}>
                    Leave shift: approved times match rostered.
                  </div>
                )}

                {editingRow.employee_comment && (
                  <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                    <div className="font-semibold text-xs mb-1">Employee comment</div>
                    {editingRow.employee_comment}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t" style={{ borderColor: '#E2F1DA' }}>
                <button
                  onClick={closeEditModal}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border"
                  style={{ borderColor: '#D0E8B8', color: '#596570' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveApproval(editingRow, true)}
                  disabled={savingId === (editingRow.id || `${editingRow.staff_id}:${editingRow.date}`) || !approvedStart || !approvedEnd}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
                  style={{ backgroundColor: '#5a9228' }}
                >
                  {savingId === (editingRow.id || `${editingRow.staff_id}:${editingRow.date}`) ? 'Saving…' : (editingRow.status === 'approved' ? 'Save changes' : 'Approve')}
                </button>
              </div>
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
