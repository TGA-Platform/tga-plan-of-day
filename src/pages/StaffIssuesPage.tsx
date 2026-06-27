import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { getUser, getAllowedCentres } from '../auth';
import { CENTRES } from '../config';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface StaffIssue {
  id: string;
  centre_id: string;
  staff_name: string;
  issue_type: string;
  severity: string;
  date_raised: string;
  raised_by: string;
  description: string;
  action_taken?: string;
  outcome?: string;
  status: string;
  follow_up_date?: string;
  hr_involved: boolean;
  created_at?: string;
}

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const B = {
  green: '#2d5c18', greenLight: '#5a9228', bg: '#F5FAF3',
  border: '#E2F1DA', white: '#ffffff', text: '#050505', muted: '#596570',
};

function HrSubNav() {
  const location = useLocation();
  const tabs = [
    { to: '/staffing', label: 'ðŸ‘¥ Staffing Structure' },
    { to: '/staff-accidents', label: 'ðŸ©¹ Accidents' },
    { to: '/staff-issues', label: 'âš ï¸ HR Issues' },
  ];
  return (
    <div className="flex items-center gap-1 mb-4 p-1 bg-white rounded-xl border" style={{ borderColor: B.border }}>
      {tabs.map(t => (
        <Link key={t.to} to={t.to}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          style={{ backgroundColor: location.pathname === t.to ? B.green : 'transparent', color: location.pathname === t.to ? '#fff' : B.muted }}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  'Open': 'bg-blue-100 text-blue-700',
  'Under Review': 'bg-orange-100 text-orange-700',
  'Action Taken': 'bg-yellow-100 text-yellow-700',
  'Resolved': 'bg-green-100 text-green-700',
  'Escalated': 'bg-red-100 text-red-700',
};

const SEVERITY_COLORS: Record<string, string> = {
  'Minor': 'bg-yellow-100 text-yellow-700',
  'Moderate': 'bg-orange-100 text-orange-700',
  'Serious': 'bg-red-100 text-red-700',
};

const ISSUE_TYPE_COLORS: Record<string, string> = {
  'Performance': 'bg-purple-100 text-purple-700',
  'Conduct': 'bg-red-100 text-red-700',
  'Attendance': 'bg-orange-100 text-orange-700',
  'Grievance': 'bg-blue-100 text-blue-700',
  'Bullying/Harassment': 'bg-pink-100 text-pink-700',
  'WHS Concern': 'bg-yellow-100 text-yellow-700',
  'Other': 'bg-gray-100 text-gray-700',
};

const STATUS_OPTIONS = ['Open', 'Under Review', 'Action Taken', 'Resolved', 'Escalated'];
const SEVERITY_OPTIONS = ['Minor', 'Moderate', 'Serious'];
const ISSUE_TYPE_OPTIONS = ['Performance', 'Conduct', 'Attendance', 'Grievance', 'Bullying/Harassment', 'WHS Concern', 'Other'];

const emptyForm = {
  centre_id: '',
  staff_name: '',
  issue_type: 'Performance',
  severity: 'Minor',
  date_raised: '',
  raised_by: '',
  description: '',
  action_taken: '',
  outcome: '',
  status: 'Open',
  follow_up_date: '',
  hr_involved: false,
};

type FormState = typeof emptyForm;

// â”€â”€ Inline Select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InlineStatusSelect({ value, options, onChange, getColor }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  getColor: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={`text-xs font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 ${getColor(value)}`}
      >
        {value} â–¾
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white rounded-xl shadow-xl border overflow-hidden min-w-max" style={{ borderColor: B.border }}>
          {options.map(o => (
            <button
              key={o}
              onClick={e => { e.stopPropagation(); onChange(o); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:opacity-80 transition-opacity text-left ${o === value ? 'font-bold' : ''}`}
            >
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getColor(o)}`}>{o}</span>
              {o === value && <span className="ml-auto text-gray-400">âœ“</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// â”€â”€ Issue Form Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function IssueModal({
  open, onClose, editId, form, setForm, centres, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  editId: string | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  centres: { id: string; name: string }[];
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!open) return null;

  const f = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: B.border }}>
          <h2 className="font-bold text-gray-900">{editId ? 'Edit Staff Issue' : 'Log Staff Issue'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 font-bold text-lg">Ã—</button>
        </div>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Centre *</label>
              <select required value={form.centre_id} onChange={f('centre_id')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]">
                <option value="">Select centre</option>
                {centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Staff Name *</label>
              <input required value={form.staff_name} onChange={f('staff_name')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                placeholder="Staff member's name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Issue Type *</label>
              <select required value={form.issue_type} onChange={f('issue_type')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]">
                {ISSUE_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Severity *</label>
              <select required value={form.severity} onChange={f('severity')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]">
                {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Date Raised *</label>
              <input required type="date" value={form.date_raised} onChange={f('date_raised')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Raised By *</label>
              <input required value={form.raised_by} onChange={f('raised_by')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                placeholder="Name of person raising" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
              <select value={form.status} onChange={f('status')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]">
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Follow Up Date</label>
              <input type="date" value={form.follow_up_date} onChange={f('follow_up_date')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description *</label>
            <textarea required value={form.description} onChange={f('description')} rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a] resize-none"
              placeholder="Describe the issue..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Action Taken</label>
            <textarea value={form.action_taken} onChange={f('action_taken')} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a] resize-none"
              placeholder="What action was taken..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Outcome</label>
            <textarea value={form.outcome} onChange={f('outcome')} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a] resize-none"
              placeholder="Outcome of actions taken..." />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.hr_involved}
              onChange={e => setForm(f => ({ ...f, hr_involved: e.target.checked }))}
              className="w-4 h-4 rounded" style={{ accentColor: B.green }} />
            <span className="text-sm text-gray-700">HR Involved</span>
          </label>

          <div className="flex justify-end gap-3 pt-2 border-t" style={{ borderColor: B.border }}>
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-5 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
              style={{ backgroundColor: B.green }}>
              {editId ? 'Save Changes' : 'Log Issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function StaffIssuesPage() {
  const user = getUser();
  const accessibleCentres = user ? getAllowedCentres(user) : CENTRES;
  const allowedCentreIds = accessibleCentres.map(c => c.id);
  const isMultiCentre = user?.role === 'admin' || user?.role === 'area_manager' || user?.role === 'ceo';

  const [issues, setIssues] = useState<StaffIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedCentre, setSelectedCentre] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/staff-issues?all=true');
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const filtered = allowedCentreIds.length === 0
        ? data
        : data.filter((i: StaffIssue) => allowedCentreIds.includes(i.centre_id));
      setIssues(filtered);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [allowedCentreIds.join(',')]);

  useEffect(() => { load(); }, [load]);

  const filtered = issues
    .filter(i => selectedCentre === 'all' || i.centre_id === selectedCentre)
    .filter(i => selectedStatus === 'all' || i.status === selectedStatus)
    .sort((a, b) => b.date_raised.localeCompare(a.date_raised));

  function openAdd() {
    setForm({ ...emptyForm, centre_id: accessibleCentres[0]?.id || '' });
    setEditId(null);
    setModalOpen(true);
  }

  function openEdit(issue: StaffIssue) {
    setForm({
      centre_id: issue.centre_id,
      staff_name: issue.staff_name,
      issue_type: issue.issue_type,
      severity: issue.severity,
      date_raised: issue.date_raised,
      raised_by: issue.raised_by,
      description: issue.description,
      action_taken: issue.action_taken || '',
      outcome: issue.outcome || '',
      status: issue.status,
      follow_up_date: issue.follow_up_date || '',
      hr_involved: issue.hr_involved,
    });
    setEditId(issue.id);
    setModalOpen(true);
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await fetch('/api/staff-issues', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id, status }),
      });
      setIssues(prev => prev.map(i => i.id === id ? { ...i, status } : i));
      showToast('Status updated');
    } catch (e) { console.error(e); }
  }

  async function handleSeverityChange(id: string, severity: string) {
    try {
      await fetch('/api/staff-issues', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id, severity }),
      });
      setIssues(prev => prev.map(i => i.id === id ? { ...i, severity } : i));
      showToast('Severity updated');
    } catch (e) { console.error(e); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this staff issue? This cannot be undone.')) return;
    try {
      await fetch('/api/staff-issues', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      setIssues(prev => prev.filter(i => i.id !== id));
      showToast('Issue deleted');
    } catch (e) { console.error(e); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.staff_name || !form.centre_id) return;
    try {
      const payload = {
        ...form,
        action_taken: form.action_taken || undefined,
        outcome: form.outcome || undefined,
        follow_up_date: form.follow_up_date || undefined,
      };
      if (editId) {
        await fetch('/api/staff-issues', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', id: editId, ...payload }),
        });
        showToast('Issue updated');
      } else {
        await fetch('/api/staff-issues', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create', ...payload }),
        });
        showToast('Issue logged');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      console.error(e);
    }
  }

  const centreName = (id: string) => CENTRES.find(c => c.id === id)?.name || id;

  return (
    <Layout>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[9999] bg-green-600 text-white px-4 py-2 rounded-xl shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      <div className="space-y-6">
        <HrSubNav />
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Staff Issues</h1>
            <p className="text-sm text-gray-500 mt-0.5">HR issues, performance concerns and grievances</p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ backgroundColor: B.green }}
          >
            +
            Add Staff Issue
          </button>
        </div>

        {/* Summary counters (clickable to filter) */}
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: 'Open', color: 'text-blue-700' },
            { label: 'Under Review', color: 'text-orange-700' },
            { label: 'Action Taken', color: 'text-yellow-700' },
            { label: 'Escalated', color: 'text-red-700' },
            { label: 'Resolved', color: 'text-green-700' },
          ].map(s => (
            <div
              key={s.label}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-center cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedStatus(selectedStatus === s.label ? 'all' : s.label)}
              style={selectedStatus === s.label ? { borderColor: B.green, boxShadow: `0 0 0 2px ${B.green}33` } : {}}
            >
              <div className={`text-2xl font-bold ${s.color}`}>
                {issues.filter(i => i.status === s.label).length}
              </div>
              <div className="text-xs text-gray-500 font-medium mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {isMultiCentre && (
            <select
              value={selectedCentre}
              onChange={e => setSelectedCentre(e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]/20"
            >
              <option value="all">All Centres</option>
              {accessibleCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]/20"
          >
            <option value="all">All Statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {selectedStatus !== 'all' && (
            <button onClick={() => setSelectedStatus('all')} className="text-xs text-gray-500 hover:text-gray-700 underline">
              Clear filter
            </button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center text-sm text-gray-400 animate-pulse">Loading...</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                    {isMultiCentre && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Centre</th>}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Staff Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Issue Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Severity</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Raised By</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">HR</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(issue => {
                    const isExpanded = expanded === issue.id;
                    return (
                      <React.Fragment key={issue.id}>
                        <tr
                          className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => setExpanded(isExpanded ? null : issue.id)}
                        >
                          <td className="px-4 py-3 text-gray-600">{new Date(issue.date_raised).toLocaleDateString('en-AU')}</td>
                          {isMultiCentre && <td className="px-4 py-3 text-gray-600">{centreName(issue.centre_id)}</td>}
                          <td className="px-4 py-3 font-medium text-gray-900">{issue.staff_name}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ISSUE_TYPE_COLORS[issue.issue_type] || 'bg-gray-100 text-gray-700'}`}>
                              {issue.issue_type}
                            </span>
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <InlineStatusSelect
                              value={issue.severity}
                              options={SEVERITY_OPTIONS}
                              onChange={v => handleSeverityChange(issue.id, v)}
                              getColor={s => SEVERITY_COLORS[s] || 'bg-gray-100 text-gray-700'}
                            />
                          </td>
                          <td className="px-4 py-3 text-gray-600">{issue.raised_by}</td>
                          <td className="px-4 py-3">
                            {issue.hr_involved && (
                              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">HR</span>
                            )}
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <InlineStatusSelect
                              value={issue.status}
                              options={STATUS_OPTIONS}
                              onChange={v => handleStatusChange(issue.id, v)}
                              getColor={s => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={e => { e.stopPropagation(); openEdit(issue); }}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-[#4a7a3a] hover:bg-[#4a7a3a]/10 transition-colors"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); handleDelete(issue.id); }}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-gray-100 bg-gray-50/50">
                            <td colSpan={isMultiCentre ? 9 : 8} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div>
                                  <div className="font-semibold text-gray-700 mb-1">Description</div>
                                  <p className="text-gray-600">{issue.description}</p>
                                </div>
                                {issue.action_taken && (
                                  <div>
                                    <div className="font-semibold text-gray-700 mb-1">Action Taken</div>
                                    <p className="text-gray-600">{issue.action_taken}</p>
                                  </div>
                                )}
                                {issue.outcome && (
                                  <div>
                                    <div className="font-semibold text-gray-700 mb-1">Outcome</div>
                                    <p className="text-gray-600">{issue.outcome}</p>
                                  </div>
                                )}
                                {issue.follow_up_date && (
                                  <div>
                                    <div className="font-semibold text-gray-700 mb-1">Follow-up Date</div>
                                    <p className="text-gray-600">{new Date(issue.follow_up_date).toLocaleDateString('en-AU')}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="py-12 text-center">
                  <span className="text-4xl block mb-2">👥</span>
                  <p className="text-sm text-gray-400">No issues match the selected filters</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <IssueModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editId={editId}
        form={form}
        setForm={setForm}
        centres={accessibleCentres}
        onSubmit={handleSubmit}
      />
    </Layout>
  );
}


