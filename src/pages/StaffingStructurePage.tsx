import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, ShieldCheck, AlertTriangle,
  Pencil, Plus, Trash2, Briefcase, UserMinus, Search, List, LayoutGrid,
  ChevronsDown, ChevronsUp, X, AlertCircle, CheckCircle, XCircle, Stethoscope,
  FileText, ExternalLink, Eye,
} from 'lucide-react';
import { getUser } from '../auth';
import { CENTRES } from '../config';
import Layout from '../components/Layout';

// ── Types ──────────────────────────────────────────────────────────────────

interface StaffDoc {
  id: string;
  label: string;
  url: string;
}

interface StaffMemberRow {
  id: string;
  name: string;
  qualification?: string;
  position?: string;
  position_category?: string;
  employment_status?: string;
  role_in_room?: string;
  centre_id: string;
  group_id?: string;
  group_title?: string;
  group_color?: string;
  is_active_group?: boolean;
  start_date?: string;
  end_date?: string;
  dob?: string;
  days_per_week?: string;
  min_hours_pw?: string;
  probationary_date?: string;
  email?: string;
  mobile?: string;
  wwcc_number?: string;
  wwcc_expiry?: string;
  first_aid_code?: string;
  first_aid_expiry?: string;
  cpr_code?: string;
  cpr_expiry?: string;
  anaphylaxis_code?: string;
  anaphylaxis_expiry?: string;
  child_protection_renewal?: string;
  ratio_50?: string;
  action?: string;
  // Documents from Supabase staff_documents table
  docs?: StaffDoc[];
  certDocs?: StaffDoc[];
}

interface OpenPosition {
  id: string;
  centre_id: string;
  room_id?: string;
  title: string;
  qualification_required?: string;
  status: string;
  notes?: string;
  created_at?: string;
}

interface StaffAccident {
  id: string;
  staff_id: string;
  centre_id: string;
  staff_name?: string;
  incident_date: string;
  time_of_injury?: string;
  specific_location?: string;
  circumstances?: string;
  injury_type: string;
  location_on_body?: string;
  first_aid_provided?: string;
  medical_attention?: boolean;
  worker_comp_claim?: boolean;
  return_to_work_date?: string;
  status: string;
  created_at?: string;
}

interface StaffIssue {
  id: string;
  staff_id: string;
  centre_id: string;
  staff_name?: string;
  issue_type: string;
  severity: string;
  date_raised: string;
  raised_by?: string;
  description: string;
  action_taken?: string;
  outcome?: string;
  status: string;
  follow_up_date?: string;
  hr_involved?: boolean;
  created_at?: string;
}

interface BoardData {
  centreId: string;
  groups: Array<{
    id: string;
    title: string;
    color: string;
    isActive: boolean;
    age_min?: number | null;
    age_max?: number | null;
    capacity?: number | null;
    staff: StaffMemberRow[];
  }>;
  editableColumns: Array<{ id: string; label: string; type: string; options?: string[] }>;
  fetchedAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────



const ROLE_COLORS: Record<string, string> = {
  'Room Leader': 'bg-blue-100 text-blue-700',
  'Educator': 'bg-green-100 text-green-700',
  'Educational Leader': 'bg-purple-100 text-purple-700',
  'Assistant Director': 'bg-orange-100 text-orange-700',
  'Centre Director': 'bg-red-100 text-red-700',
  'Trainee': 'bg-yellow-100 text-yellow-700',
  'Float': 'bg-gray-100 text-gray-700',
  'Internal Casual': 'bg-pink-100 text-pink-700',
  'Early Childhood Teacher': 'bg-indigo-100 text-indigo-700',
  'Educator Casual': 'bg-teal-100 text-teal-700',
};

const STATUS_COLORS: Record<string, string> = {
  'Active': 'bg-green-100 text-green-700',
  'On Leave': 'bg-yellow-100 text-yellow-700',
  'Resigned': 'bg-amber-100 text-amber-700',
  'Exited': 'bg-gray-100 text-gray-600',
  'Inactive': 'bg-gray-100 text-gray-600',
  'PPL': 'bg-blue-100 text-blue-700',
  'Long Service': 'bg-purple-100 text-purple-700',
  'Probation': 'bg-orange-100 text-orange-700',
  'Casual': 'bg-pink-100 text-pink-700',
};

const POSITION_STATUS_COLORS: Record<string, string> = {
  'Open': 'bg-emerald-100 text-emerald-700',
  'On Hold': 'bg-yellow-100 text-yellow-700',
  'Offered': 'bg-blue-100 text-blue-700',
  'Filled': 'bg-gray-100 text-gray-500',
};

const ACCIDENT_STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue-100 text-blue-700',
  'Notification Only': 'bg-gray-100 text-gray-700',
  'Medical Treatment': 'bg-orange-100 text-orange-700',
  'Light Duties': 'bg-yellow-100 text-yellow-700',
  'Active Certificate': 'bg-red-100 text-red-700',
  'Case Closed': 'bg-green-100 text-green-700',
  'Not Reporting': 'bg-gray-100 text-gray-500',
};

const INJURY_COLORS: Record<string, string> = {
  'Sprain/Strain': 'bg-orange-100 text-orange-700',
  'Cut/Laceration': 'bg-red-100 text-red-700',
  'Bruise': 'bg-purple-100 text-purple-700',
  'Fracture': 'bg-red-100 text-red-800',
  'Burn': 'bg-orange-100 text-orange-800',
  'Eye Injury': 'bg-blue-100 text-blue-700',
  'Back Injury': 'bg-yellow-100 text-yellow-700',
  'Other': 'bg-gray-100 text-gray-700',
};

const ISSUE_STATUS_COLORS: Record<string, string> = {
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

// ── Helpers ────────────────────────────────────────────────────────────────

function certDays(dateStr?: string | null): number {
  if (!dateStr) return Infinity;
  const today = new Date();
  return Math.round((new Date(dateStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function isStaffCompliant(s: StaffMemberRow): boolean {
  const certs = [s.wwcc_expiry, s.first_aid_expiry, s.cpr_expiry, s.anaphylaxis_expiry];
  return certs.every(e => !!e && certDays(e) >= 0);
}

function complianceColor(pct: number): string {
  if (pct >= 90) return '#2d5c18';
  if (pct >= 70) return '#d97706';
  return '#dc2626';
}

function complianceBg(pct: number): string {
  if (pct >= 90) return '#e8f5e0';
  if (pct >= 70) return '#fffbeb';
  return '#fff5f5';
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CertDot({ expiry }: { expiry?: string | null }) {
  if (!expiry) return <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#d1d5db' }} title="Not recorded" />;
  const days = certDays(expiry);
  if (days < 0) return <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#dc2626' }} title={`Expired ${Math.abs(days)}d ago`} />;
  if (days < 30) return <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#dc2626' }} title={`${days}d remaining`} />;
  if (days < 90) return <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#d97706' }} title={`${days}d`} />;
  return <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#16a34a' }} title={`Valid · ${days}d`} />;
}

// ── Toast utility ──────────────────────────────────────────────────────────

function showToast(msg: string, type: 'success' | 'error' = 'success') {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:500;color:#fff;background:${type === 'error' ? '#ef4444' : '#22c55e'};box-shadow:0 4px 16px rgba(0,0,0,0.15);transition:opacity 0.3s`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ── API helpers ────────────────────────────────────────────────────────────



async function apiGet(path: string) {
  const r = await fetch(`/api/${path}`);
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { error?: string }).error || `HTTP ${r.status}`); }
  return r.json();
}

async function apiPost(path: string, body: unknown) {
  const r = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { error?: string }).error || `HTTP ${r.status}`); }
  return r.json();
}

async function apiPatch(path: string, body: unknown) {
  const r = await fetch(`/api/${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { error?: string }).error || `HTTP ${r.status}`); }
  return r.json();
}

async function apiDelete(path: string) {
  const r = await fetch(`/api/${path}`, { method: 'DELETE' });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { error?: string }).error || `HTTP ${r.status}`); }
  return r.json().catch(() => ({}));
}

// ── Modal wrapper ──────────────────────────────────────────────────────────

function Modal({ isOpen, onClose, title, children, size = 'md' }: {
  isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!isOpen) return null;
  const maxW = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className={`relative w-full ${maxW} max-h-[90vh] overflow-y-auto`} style={{ backgroundColor: '#ffffff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: '1px solid #E2F1DA' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #E2F1DA' }}>
          <h2 className="font-bold" style={{ color: '#050505' }}>{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ color: '#596570' }}>
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Inline Status Select ───────────────────────────────────────────────────

function InlineSelect({ value, options, onChange, getColor }: {
  value: string; options: string[]; onChange: (v: string) => void;
  getColor: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${getColor(value)}`}
      >
        {value}
        <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden min-w-max">
          {options.map(o => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 text-left ${o === value ? 'font-bold' : ''}`}
            >
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getColor(o)}`}>{o}</span>
              {o === value && <span className="ml-auto text-green-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Accidents Section (inside Staff Profile Drawer) ────────────────────────

function AccidentsSection({ staffId, staffName, centreId }: {
  staffId: string; staffName: string; centreId: string;
}) {
  const [accidents, setAccidents] = useState<StaffAccident[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StaffAccident | null>(null);

  const emptyForm = {
    incident_date: '',
    time_of_injury: '',
    specific_location: '',
    circumstances: '',
    injury_type: 'Sprain/Strain',
    location_on_body: '',
    first_aid_provided: '',
    medical_attention: false,
    worker_comp_claim: false,
    return_to_work_date: '',
    status: 'New',
  };
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`staff-accidents?staffId=${staffId}`);
      setAccidents((data as StaffAccident[]) || []);
    } catch { setAccidents([]); }
    finally { setLoading(false); }
  }, [staffId]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm(emptyForm);
    setEditTarget(null);
    setModalOpen(true);
  }

  function openEdit(acc: StaffAccident) {
    setForm({
      incident_date: acc.incident_date || '',
      time_of_injury: acc.time_of_injury || '',
      specific_location: acc.specific_location || '',
      circumstances: acc.circumstances || '',
      injury_type: acc.injury_type || 'Sprain/Strain',
      location_on_body: acc.location_on_body || '',
      first_aid_provided: acc.first_aid_provided || '',
      medical_attention: acc.medical_attention || false,
      worker_comp_claim: acc.worker_comp_claim || false,
      return_to_work_date: acc.return_to_work_date || '',
      status: acc.status || 'New',
    });
    setEditTarget(acc);
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.incident_date) { showToast('Incident date is required', 'error'); return; }
    const payload = { ...form, staff_id: staffId, staff_name: staffName, centre_id: centreId };
    try {
      if (editTarget) {
        await apiPatch(`staff-accidents?id=${editTarget.id}`, payload);
        showToast('Accident updated');
      } else {
        await apiPost('staff-accidents', payload);
        showToast('Accident recorded');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      showToast((err as Error).message || 'Failed to save', 'error');
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await apiPatch(`staff-accidents?id=${id}`, { status });
      setAccidents(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    } catch (err) {
      showToast((err as Error).message || 'Failed to update', 'error');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: '#050505' }}>
          <AlertTriangle size={14} style={{ color: '#d97706' }} />
          Workplace Accidents ({accidents.length})
        </h4>
        <button onClick={openAdd} className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors" style={{ color: '#d97706', backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
          <Plus size={12} />
          Record
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-gray-400 animate-pulse py-3 text-center">Loading...</div>
      ) : accidents.length === 0 ? (
        <div className="text-xs text-gray-400 py-3 text-center italic">No accident records for this staff member</div>
      ) : (
        <div className="space-y-2">
          {accidents.map(acc => (
            <div key={acc.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid #E2F1DA' }}>
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                style={{ backgroundColor: '#ffffff' }}
                onClick={() => setExpanded(expanded === acc.id ? null : acc.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-800">
                      {new Date(acc.incident_date).toLocaleDateString('en-AU')}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${INJURY_COLORS[acc.injury_type] || 'bg-gray-100 text-gray-700'}`}>
                      {acc.injury_type}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACCIDENT_STATUS_COLORS[acc.status] || 'bg-gray-100 text-gray-700'}`}>
                      {acc.status}
                    </span>
                    {acc.medical_attention && <span className="text-xs text-orange-600 font-medium">Medical</span>}
                    {acc.worker_comp_claim && <span className="text-xs text-red-600 font-medium">W/C</span>}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); openEdit(acc); }} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                  <Pencil size={12} />
                </button>
                {expanded === acc.id ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
              </button>
              {expanded === acc.id && (
                <div className="px-3 pb-3 space-y-2" style={{ backgroundColor: '#F5FAF3', borderTop: '1px solid #E2F1DA' }}>
                  <div className="pt-2">
                    <InlineSelect
                      value={acc.status}
                      options={['New', 'Notification Only', 'Medical Treatment', 'Light Duties', 'Active Certificate', 'Case Closed', 'Not Reporting']}
                      onChange={v => handleStatusChange(acc.id, v)}
                      getColor={s => ACCIDENT_STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'}
                    />
                  </div>
                  {acc.time_of_injury && <div className="text-xs text-gray-600"><span className="font-medium">Time:</span> {acc.time_of_injury}</div>}
                  {acc.specific_location && <div className="text-xs text-gray-600"><span className="font-medium">Location:</span> {acc.specific_location}</div>}
                  {acc.circumstances && <div className="text-xs text-gray-600"><span className="font-medium">Circumstances:</span> {acc.circumstances}</div>}
                  {acc.location_on_body && <div className="text-xs text-gray-600"><span className="font-medium">Body location:</span> {acc.location_on_body}</div>}
                  {acc.first_aid_provided && <div className="text-xs text-gray-600"><span className="font-medium">First aid:</span> {acc.first_aid_provided}</div>}
                  {acc.return_to_work_date && <div className="text-xs text-gray-600"><span className="font-medium">RTW date:</span> {new Date(acc.return_to_work_date).toLocaleDateString('en-AU')}</div>}
                  <div className="flex gap-3 text-xs">
                    {acc.medical_attention ? <CheckCircle size={14} className="text-orange-500" /> : <XCircle size={14} className="text-gray-300" />}
                    <span className={acc.medical_attention ? 'text-orange-600 font-medium' : 'text-gray-400'}>Medical Attention</span>
                    {acc.worker_comp_claim ? <CheckCircle size={14} className="text-red-500 ml-2" /> : <XCircle size={14} className="text-gray-300 ml-2" />}
                    <span className={acc.worker_comp_claim ? 'text-red-600 font-medium' : 'text-gray-400'}>Workers' Comp</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Accident Record' : 'Record Workplace Accident'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Incident Date *</label>
              <input type="date" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.incident_date} onChange={e => setForm(f => ({ ...f, incident_date: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Time of Injury</label>
              <input type="time" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.time_of_injury} onChange={e => setForm(f => ({ ...f, time_of_injury: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Specific Location</label>
              <input className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.specific_location} onChange={e => setForm(f => ({ ...f, specific_location: e.target.value }))} placeholder="Where exactly did it occur?" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Injury Type *</label>
              <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.injury_type} onChange={e => setForm(f => ({ ...f, injury_type: e.target.value }))}>
                {['Sprain/Strain', 'Cut/Laceration', 'Bruise', 'Fracture', 'Burn', 'Eye Injury', 'Back Injury', 'Other'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Location on Body</label>
              <input className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.location_on_body} onChange={e => setForm(f => ({ ...f, location_on_body: e.target.value }))} placeholder="e.g. Left wrist" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {['New', 'Notification Only', 'Medical Treatment', 'Light Duties', 'Active Certificate', 'Case Closed', 'Not Reporting'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Return to Work Date</label>
              <input type="date" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.return_to_work_date} onChange={e => setForm(f => ({ ...f, return_to_work_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Circumstances</label>
            <textarea rows={3} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20 resize-none"
              value={form.circumstances} onChange={e => setForm(f => ({ ...f, circumstances: e.target.value }))} placeholder="Describe how the injury occurred..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">First Aid Provided</label>
            <textarea rows={2} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20 resize-none"
              value={form.first_aid_provided} onChange={e => setForm(f => ({ ...f, first_aid_provided: e.target.value }))} />
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.medical_attention} onChange={e => setForm(f => ({ ...f, medical_attention: e.target.checked }))}
                className="w-4 h-4 text-[#2d5c18] border-gray-300 rounded focus:ring-[#2d5c18]" />
              Medical Attention Required
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.worker_comp_claim} onChange={e => setForm(f => ({ ...f, worker_comp_claim: e.target.checked }))}
                className="w-4 h-4 text-[#2d5c18] border-gray-300 rounded focus:ring-[#2d5c18]" />
              Worker's Comp Claim
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2 bg-[#2d5c18] text-white text-sm font-medium rounded-xl hover:bg-[#2d5c18]/90 transition-colors">
              {editTarget ? 'Save Changes' : 'Record Accident'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ── Issues Section (inside Staff Profile Drawer) ───────────────────────────

function IssuesSection({ staffId, staffName, centreId }: {
  staffId: string; staffName: string; centreId: string;
}) {
  const [issues, setIssues] = useState<StaffIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StaffIssue | null>(null);

  const emptyForm = {
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
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`staff-issues?staffId=${staffId}`);
      setIssues((data as StaffIssue[]) || []);
    } catch { setIssues([]); }
    finally { setLoading(false); }
  }, [staffId]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm(emptyForm);
    setEditTarget(null);
    setModalOpen(true);
  }

  function openEdit(issue: StaffIssue) {
    setForm({
      issue_type: issue.issue_type,
      severity: issue.severity,
      date_raised: issue.date_raised,
      raised_by: issue.raised_by || '',
      description: issue.description,
      action_taken: issue.action_taken || '',
      outcome: issue.outcome || '',
      status: issue.status,
      follow_up_date: issue.follow_up_date || '',
      hr_involved: issue.hr_involved || false,
    });
    setEditTarget(issue);
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date_raised || !form.description.trim()) { showToast('Date and description are required', 'error'); return; }
    const payload = { ...form, staff_id: staffId, staff_name: staffName, centre_id: centreId };
    try {
      if (editTarget) {
        await apiPatch(`staff-issues?id=${editTarget.id}`, payload);
        showToast('Issue updated');
      } else {
        await apiPost('staff-issues', payload);
        showToast('Issue logged');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      showToast((err as Error).message || 'Failed to save', 'error');
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await apiPatch(`staff-issues?id=${id}`, { status });
      setIssues(prev => prev.map(i => i.id === id ? { ...i, status } : i));
    } catch (err) {
      showToast((err as Error).message || 'Failed to update', 'error');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: '#050505' }}>
          <AlertCircle size={14} style={{ color: '#dc2626' }} />
          HR Issues ({issues.length})
        </h4>
        <button onClick={openAdd} className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors" style={{ color: '#dc2626', backgroundColor: '#fff5f5', border: '1px solid #fca5a5' }}>
          <Plus size={12} />
          Log Issue
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-gray-400 animate-pulse py-3 text-center">Loading...</div>
      ) : issues.length === 0 ? (
        <div className="text-xs text-gray-400 py-3 text-center italic">No HR issues for this staff member</div>
      ) : (
        <div className="space-y-2">
          {issues.map(issue => (
            <div key={issue.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid #E2F1DA' }}>
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                style={{ backgroundColor: '#ffffff' }}
                onClick={() => setExpanded(expanded === issue.id ? null : issue.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-800">
                      {new Date(issue.date_raised).toLocaleDateString('en-AU')}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ISSUE_TYPE_COLORS[issue.issue_type] || 'bg-gray-100 text-gray-700'}`}>
                      {issue.issue_type}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_COLORS[issue.severity] || 'bg-gray-100 text-gray-700'}`}>
                      {issue.severity}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ISSUE_STATUS_COLORS[issue.status] || 'bg-gray-100 text-gray-700'}`}>
                      {issue.status}
                    </span>
                    {issue.hr_involved && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">HR</span>}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); openEdit(issue); }} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                  <Pencil size={12} />
                </button>
                {expanded === issue.id ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
              </button>
              {expanded === issue.id && (
                <div className="px-3 pb-3 space-y-2" style={{ backgroundColor: '#F5FAF3', borderTop: '1px solid #E2F1DA' }}>
                  <div className="pt-2">
                    <InlineSelect
                      value={issue.status}
                      options={['Open', 'Under Review', 'Action Taken', 'Resolved', 'Escalated']}
                      onChange={v => handleStatusChange(issue.id, v)}
                      getColor={s => ISSUE_STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'}
                    />
                  </div>
                  {issue.raised_by && <div className="text-xs text-gray-600"><span className="font-medium">Raised by:</span> {issue.raised_by}</div>}
                  <div className="text-xs text-gray-600"><span className="font-medium">Description:</span> {issue.description}</div>
                  {issue.action_taken && <div className="text-xs text-gray-600"><span className="font-medium">Action taken:</span> {issue.action_taken}</div>}
                  {issue.outcome && <div className="text-xs text-gray-600"><span className="font-medium">Outcome:</span> {issue.outcome}</div>}
                  {issue.follow_up_date && <div className="text-xs text-gray-600"><span className="font-medium">Follow-up:</span> {new Date(issue.follow_up_date).toLocaleDateString('en-AU')}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit HR Issue' : 'Log HR Issue'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Issue Type *</label>
              <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.issue_type} onChange={e => setForm(f => ({ ...f, issue_type: e.target.value }))}>
                {['Performance', 'Conduct', 'Attendance', 'Grievance', 'Bullying/Harassment', 'WHS Concern', 'Other'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Severity</label>
              <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {['Minor', 'Moderate', 'Serious'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date Raised *</label>
              <input type="date" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.date_raised} onChange={e => setForm(f => ({ ...f, date_raised: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Raised By</label>
              <input className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.raised_by} onChange={e => setForm(f => ({ ...f, raised_by: e.target.value }))} placeholder="Name of person raising" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {['Open', 'Under Review', 'Action Taken', 'Resolved', 'Escalated'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Follow-up Date</label>
              <input type="date" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
                value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
            <textarea rows={3} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20 resize-none"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the issue..." required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action Taken</label>
            <textarea rows={2} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20 resize-none"
              value={form.action_taken} onChange={e => setForm(f => ({ ...f, action_taken: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
            <textarea rows={2} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20 resize-none"
              value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.hr_involved} onChange={e => setForm(f => ({ ...f, hr_involved: e.target.checked }))}
              className="w-4 h-4 text-[#2d5c18] border-gray-300 rounded focus:ring-[#2d5c18]" />
            HR Involved
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2 bg-[#2d5c18] text-white text-sm font-medium rounded-xl hover:bg-[#2d5c18]/90 transition-colors">
              {editTarget ? 'Save Changes' : 'Log Issue'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ── Document Row ─────────────────────────────────────────────────────────

function DocRow({ label, url, expiry, code }: { label: string; url?: string; expiry?: string | null; code?: string | null }) {
  const days = expiry ? certDays(expiry) : null;
  const isExpired = days !== null && days < 0;
  const isWarning = days !== null && days >= 0 && days < 90;
  const dotColor = isExpired ? '#dc2626' : isWarning ? '#d97706' : days !== null ? '#16a34a' : url ? '#16a34a' : '#d1d5db';
  const isImg = url && /\.(jpe?g|png|gif|webp)$/i.test(url);
  const isPdf = url && /\.pdf$/i.test(url);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: '1px solid #F5FAF3' }}>
      <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold" style={{ color: '#050505' }}>{label}</div>
        {code && <div className="text-xs" style={{ color: '#596570' }}>{code}</div>}
        {expiry && (
          <div className="text-xs font-medium" style={{ color: isExpired ? '#dc2626' : isWarning ? '#d97706' : '#16a34a' }}>
            {fmtDate(expiry)}
            {days !== null && days < 0 && ` · Expired ${Math.abs(days)}d ago`}
            {days !== null && days >= 0 && days < 90 && ` · ${days}d remaining`}
          </div>
        )}
        {!expiry && !url && <div className="text-xs" style={{ color: '#d1d5db' }}>Not recorded</div>}
      </div>
      {url && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isImg && (
            <img src={url} alt={label} className="w-8 h-8 rounded object-cover" style={{ border: '1px solid #E2F1DA' }} />
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
            style={{ backgroundColor: '#e8f5e0', color: '#2d5c18', border: '1px solid #D0E8B8' }}
          >
            {isPdf ? <FileText size={11} /> : <Eye size={11} />}
            {isPdf ? 'PDF' : 'View'}
            <ExternalLink size={10} />
          </a>
        </div>
      )}
      {!url && (
        <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}>
          No file
        </span>
      )}
    </div>
  );
}

// ── Staff Profile Drawer ───────────────────────────────────────────────────

function StaffProfileDrawer({
  staff,
  centreId,
  groups,
  initialTab,
  onClose,
  onSaved,
}: {
  staff: StaffMemberRow;
  centreId: string;
  groups: Array<{ id: string; title: string; isActive: boolean }>;
  initialTab?: 'profile' | 'accidents' | 'issues';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<'profile' | 'accidents' | 'issues'>(initialTab || 'profile');
  const [local, setLocal] = useState<StaffMemberRow>({ ...staff });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<StaffMemberRow>({ ...staff });

  async function handleSaveProfile() {
    setSaving(true);
    try {
      const fields: Record<string, string | null | boolean | number> = {
        employment_status: editForm.employment_status || 'Active',
        position: editForm.position || null,
        position_category: editForm.position_category || null,
        qualification: editForm.qualification || null,
        days_per_week: editForm.days_per_week || null,
        min_hours_pw: editForm.min_hours_pw || null,
        email: editForm.email || null,
        mobile: editForm.mobile || null,
        wwcc_number: editForm.wwcc_number || null,
        wwcc_expiry: editForm.wwcc_expiry || null,
        first_aid_code: editForm.first_aid_code || null,
        first_aid_expiry: editForm.first_aid_expiry || null,
        cpr_code: editForm.cpr_code || null,
        cpr_expiry: editForm.cpr_expiry || null,
        anaphylaxis_code: editForm.anaphylaxis_code || null,
        anaphylaxis_expiry: editForm.anaphylaxis_expiry || null,
        child_protection_renewal: editForm.child_protection_renewal || null,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
      };
      await apiPost(`staffing-structure?centreId=${centreId}`, { action: 'update_staff', staffId: staff.id, fields });
      setLocal({ ...local, ...editForm });
      setSaveSuccess(true);
      setTimeout(() => { setSaveSuccess(false); setEditMode(false); }, 1200);
      showToast('Staff profile updated');
      onSaved();
    } catch (err) {
      showToast((err as Error).message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveRoom(groupId: string) {
    if (!groupId) return;
    setSaving(true);
    try {
      await apiPost(`staffing-structure?centreId=${centreId}`, { action: 'move_staff', staffId: staff.id, groupId, centreId });
      showToast('Staff moved to new room');
      onSaved();
      onClose();
    } catch (err) {
      showToast((err as Error).message || 'Failed to move', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusQuickChange(status: string) {
    try {
      await apiPost(`staffing-structure?centreId=${centreId}`, { action: 'update_staff', staffId: staff.id, fields: { employment_status: status } });
      setLocal(prev => ({ ...prev, employment_status: status }));
      showToast('Status updated');
      onSaved();
    } catch (err) {
      showToast((err as Error).message || 'Failed to update', 'error');
    }
  }



  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 transition-opacity" />
      <div
        className="relative w-[480px] max-w-full h-full overflow-y-auto flex flex-col"
        style={{
          backgroundColor: '#ffffff',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          borderLeft: '1px solid #E2F1DA',
          transform: 'translateX(0)',
          transition: 'transform 0.25s ease',
          animation: 'slideInFromRight 0.25s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3" style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #E2F1DA' }}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold" style={{ color: '#050505' }}>{local.name}</h2>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <InlineSelect
                  value={local.employment_status || 'Active'}
                  options={['Active', 'On Leave', 'Resigned', 'Exited', 'Inactive', 'PPL', 'Long Service', 'Probation', 'Casual']}
                  onChange={handleStatusQuickChange}
                  getColor={v => STATUS_COLORS[v] || 'bg-gray-100 text-gray-600'}
                />
                {local.qualification && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{local.qualification}</span>
                )}
                {local.position && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[local.position] || 'bg-gray-100 text-gray-700'}`}>{local.position}</span>
                )}
                {saving && <span className="text-xs text-gray-400 animate-pulse">Saving...</span>}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0" style={{ color: '#596570' }}>
              <X size={16} />
            </button>
          </div>
          {/* Tabs */}
          <div className="flex mt-3" style={{ borderBottom: '2px solid #E2F1DA' }}>
            {(['profile', 'accidents', 'issues'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 py-2 text-xs font-semibold capitalize transition-colors"
                style={tab === t
                  ? {
                      backgroundColor: '#ffffff',
                      color: '#2d5c18',
                      fontWeight: 700,
                      borderBottom: '2px solid #2d5c18',
                      marginBottom: '-2px',
                    }
                  : {
                      backgroundColor: 'transparent',
                      color: '#596570',
                    }
                }
                onMouseEnter={e => { if (tab !== t) (e.currentTarget as HTMLButtonElement).style.color = '#050505'; }}
                onMouseLeave={e => { if (tab !== t) (e.currentTarget as HTMLButtonElement).style.color = '#596570'; }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 px-5 py-4 space-y-5">
          {/* ── Profile Tab ── */}
          {tab === 'profile' && (
            <>
              {/* Move to room */}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#596570' }}>Room / Group</h3>
                <select
                  onChange={e => { if (e.target.value) handleMoveRoom(e.target.value); }}
                  className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={{ border: '1px solid #E2F1DA', backgroundColor: '#ffffff', color: '#050505' }}
                  defaultValue=""
                >
                  <option value="">Move to room...</option>
                  {groups.filter(g => g.isActive).map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </section>

              {/* Employment */}
              {!editMode ? (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#596570' }}>Employment</h3>
                    <button onClick={() => { setEditForm({ ...local }); setEditMode(true); }}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                      style={{ color: '#2d5c18', backgroundColor: '#e8f5e0' }}>
                      <Pencil size={12} /> Edit
                    </button>
                  </div>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E2F1DA' }}>
                    {[
                      { label: 'Status', value: local.employment_status || 'Active' },
                      { label: 'Position', value: local.position },
                      { label: 'Qualification', value: local.qualification },
                      { label: 'Category', value: local.position_category },
                      { label: 'Days/Week', value: local.days_per_week },
                      { label: 'Min Hours/wk', value: local.min_hours_pw },
                      { label: 'Start Date', value: fmtDate(local.start_date) },
                      { label: 'End Date', value: local.end_date },
                    ].filter(r => r.value && r.value !== '—').map((row, i, arr) => (
                      <div key={row.label} className="flex items-center justify-between px-3 py-2 text-sm" style={{ borderBottom: i < arr.length - 1 ? '1px solid #F5FAF3' : 'none' }}>
                        <span style={{ color: '#596570' }}>{row.label}</span>
                        <span className="font-medium" style={{ color: '#050505' }}>{row.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Contact */}
                  {(local.email || local.mobile) && (
                    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: '1px solid #E2F1DA' }}>
                      {local.email && (
                        <div className="flex items-center justify-between px-3 py-2 text-sm" style={{ borderBottom: '1px solid #F5FAF3' }}>
                          <span style={{ color: '#596570' }}>Email</span>
                          <a href={`mailto:${local.email}`} className="hover:underline text-xs" style={{ color: '#2d5c18' }}>{local.email}</a>
                        </div>
                      )}
                      {local.mobile && (
                        <div className="flex items-center justify-between px-3 py-2 text-sm">
                          <span style={{ color: '#596570' }}>Mobile</span>
                          <a href={`tel:${local.mobile}`} className="hover:underline" style={{ color: '#2d5c18' }}>{local.mobile}</a>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              ) : (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#596570' }}>Edit Profile</h3>
                    <button onClick={() => setEditMode(false)} className="text-xs" style={{ color: '#596570' }}>Cancel</button>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                        <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.employment_status || 'Active'} onChange={e => setEditForm(f => ({ ...f, employment_status: e.target.value }))}>
                          {['Active', 'On Leave', 'Resigned', 'Exited', 'Inactive', 'PPL', 'Long Service', 'Probation', 'Casual'].map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Position</label>
                        <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.position || ''} onChange={e => setEditForm(f => ({ ...f, position: e.target.value }))}>
                          <option value="">Select...</option>
                          {Object.keys(ROLE_COLORS).map(r => <option key={r}>{r}</option>)}
                          {['Early Childhood Teacher', 'Assistant Director', 'Centre Director', 'Chef', 'Internal Casual'].map(r => <option key={r}>{r}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Qualification</label>
                        <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.qualification || ''} onChange={e => setEditForm(f => ({ ...f, qualification: e.target.value }))}>
                          <option value="">Select...</option>
                          {['ECT', 'WT ECT', 'Diploma', 'Certificate 3', 'Trainee', 'ISS', 'Chef', 'No Qualification'].map(q => <option key={q}>{q}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                        <select className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.position_category || ''} onChange={e => setEditForm(f => ({ ...f, position_category: e.target.value }))}>
                          <option value="">Select...</option>
                          {['Full Time', 'Part Time', 'Casual', 'As Required'].map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Days/Week</label>
                        <input className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.days_per_week || ''} onChange={e => setEditForm(f => ({ ...f, days_per_week: e.target.value }))} placeholder="e.g. Mon-Fri" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Min Hours/wk</label>
                        <input className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.min_hours_pw || ''} onChange={e => setEditForm(f => ({ ...f, min_hours_pw: e.target.value }))} placeholder="e.g. 38" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                        <input type="email" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.email || ''} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Mobile</label>
                        <input className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.mobile || ''} onChange={e => setEditForm(f => ({ ...f, mobile: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                        <input type="date" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.start_date || ''} onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                        <input type="date" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                          value={editForm.end_date || ''} onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))} />
                      </div>
                    </div>
                    <div className="pt-3" style={{ borderTop: '1px solid #E2F1DA' }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <ShieldCheck size={13} style={{ color: '#596570' }} />
                        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#596570' }}>Certifications</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: 'WWCC Number', field: 'wwcc_number' as const, type: 'text' },
                          { label: 'WWCC Expiry', field: 'wwcc_expiry' as const, type: 'date' },
                          { label: 'First Aid Code', field: 'first_aid_code' as const, type: 'text' },
                          { label: 'First Aid Expiry', field: 'first_aid_expiry' as const, type: 'date' },
                          { label: 'CPR Code', field: 'cpr_code' as const, type: 'text' },
                          { label: 'CPR Expiry', field: 'cpr_expiry' as const, type: 'date' },
                          { label: 'Anaphylaxis Code', field: 'anaphylaxis_code' as const, type: 'text' },
                          { label: 'Anaphylaxis Expiry', field: 'anaphylaxis_expiry' as const, type: 'date' },
                          { label: 'Child Protection', field: 'child_protection_renewal' as const, type: 'date' },
                        ].map(({ label, field, type }) => (
                          <div key={field}>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                            <input
                              type={type}
                              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
                              value={editForm[field] || ''}
                              onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <button onClick={() => setEditMode(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                      <button
                        onClick={handleSaveProfile}
                        disabled={saving || saveSuccess}
                        className="px-5 py-2 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-80 flex items-center gap-1.5"
                        style={{ backgroundColor: saveSuccess ? '#16a34a' : '#2d5c18' }}
                      >
                        {saveSuccess ? (
                          <><CheckCircle size={14} /> Saved!</>
                        ) : saving ? (
                          'Saving...'
                        ) : (
                          'Save Profile'
                        )}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Compliance Checklist */}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: '#596570' }}>
                  <ShieldCheck size={12} />
                  Compliance Checklist
                </h3>
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E2F1DA' }}>
                  {([
                    { label: 'WWCC', expiry: local.wwcc_expiry, extra: local.wwcc_number ? `#${local.wwcc_number}` : null },
                    { label: 'First Aid', expiry: local.first_aid_expiry, extra: local.first_aid_code || null },
                    { label: 'CPR', expiry: local.cpr_expiry, extra: local.cpr_code || null },
                    { label: 'Anaphylaxis', expiry: local.anaphylaxis_expiry, extra: local.anaphylaxis_code || null },
                    { label: 'Qualification', expiry: null, extra: local.qualification || null },
                  ] as Array<{ label: string; expiry?: string | null; extra?: string | null }>).map((item, i, arr) => {
                    const days = item.expiry ? certDays(item.expiry) : null;
                    let statusDot: string;
                    let statusLabel: string;
                    let statusColor: string;
                    if (item.label === 'Qualification') {
                      if (item.extra) {
                        statusDot = '#16a34a'; statusLabel = 'On file'; statusColor = '#16a34a';
                      } else {
                        statusDot = '#dc2626'; statusLabel = 'Missing'; statusColor = '#dc2626';
                      }
                    } else if (days === null || days === Infinity) {
                      statusDot = '#dc2626'; statusLabel = 'Missing'; statusColor = '#dc2626';
                    } else if (days < 0) {
                      statusDot = '#dc2626'; statusLabel = 'Expired'; statusColor = '#dc2626';
                    } else if (days < 90) {
                      statusDot = '#d97706'; statusLabel = 'Expiring soon'; statusColor = '#d97706';
                    } else {
                      statusDot = '#16a34a'; statusLabel = 'Valid'; statusColor = '#16a34a';
                    }
                    return (
                      <div
                        key={item.label}
                        className="flex items-center gap-3 px-3 py-2.5"
                        style={{ borderBottom: i < arr.length - 1 ? '1px solid #F5FAF3' : 'none' }}
                      >
                        {/* Status dot */}
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: statusDot }}
                        />
                        {/* Label */}
                        <span className="text-sm font-medium flex-1" style={{ color: '#050505' }}>{item.label}</span>
                        {/* Extra (number/code) */}
                        {item.extra && item.label !== 'Qualification' && (
                          <span className="text-xs" style={{ color: '#596570' }}>{item.extra}</span>
                        )}
                        {/* Expiry date */}
                        {item.expiry && (
                          <span className="text-xs" style={{ color: '#596570' }}>{fmtDate(item.expiry)}</span>
                        )}
                        {/* Status label */}
                        <span className="text-xs font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* HR Documents */}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: '#596570' }}>
                  <FileText size={12} />
                  HR Documents
                </h3>
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E2F1DA' }}>
                  {[
                    { key: 'qualification', label: 'Qualification / Transcript' },
                    { key: 'induction', label: 'Induction Records' },
                    { key: 'policy_kit', label: 'Policy Kit Signed' },
                    { key: 'staff_record', label: 'Staff Record' },
                    { key: 'job_description', label: 'Job Description' },
                    { key: 'food_handler', label: 'Food Handler Cert' },
                  ].map(({ key, label }) => {
                    const doc = local.docs?.find(d => d.label.toLowerCase().includes(key) || key.split('_').some(k => d.label.toLowerCase().includes(k)));
                    return (
                      <DocRow key={key} label={label} url={doc?.url} />
                    );
                  })}
                </div>
              </section>

              {/* Audit Checklist */}
              {(() => {
                const checks = [
                  { label: 'WWCC', expiry: local.wwcc_expiry, hasDoc: !!local.certDocs?.find(d => /wwcc/i.test(d.label)) },
                  { label: 'First Aid', expiry: local.first_aid_expiry, hasDoc: !!local.certDocs?.find(d => /first.?aid/i.test(d.label)) },
                  { label: 'CPR', expiry: local.cpr_expiry, hasDoc: !!local.certDocs?.find(d => /cpr/i.test(d.label)) },
                  { label: 'Anaphylaxis', expiry: local.anaphylaxis_expiry, hasDoc: !!local.certDocs?.find(d => /anaphylaxis/i.test(d.label)) },
                  { label: 'Child Protection', expiry: local.child_protection_renewal, hasDoc: !!local.certDocs?.find(d => /child.?prot/i.test(d.label)) },
                  { label: 'Qualification Doc', expiry: null, hasDoc: !!local.docs?.find(d => /qualif|transcript/i.test(d.label)) },
                  { label: 'Induction', expiry: null, hasDoc: !!local.docs?.find(d => /induction/i.test(d.label)) },
                  { label: 'Policy Kit', expiry: null, hasDoc: !!local.docs?.find(d => /policy/i.test(d.label)) },
                  { label: 'Staff Record', expiry: null, hasDoc: !!local.docs?.find(d => /record/i.test(d.label)) },
                  { label: 'Job Description', expiry: null, hasDoc: !!local.docs?.find(d => /job.?desc/i.test(d.label)) },
                  { label: 'Food Handler', expiry: null, hasDoc: !!local.docs?.find(d => /food/i.test(d.label)) },

                ];
                const scores = checks.map(c => {
                  if (c.expiry) {
                    const d = certDays(c.expiry);
                    if (d < 0) return 'red';
                    if (d < 90) return 'amber';
                    return 'green';
                  }
                  return c.hasDoc ? 'green' : 'red';
                });
                const greenCount = scores.filter(s => s === 'green').length;
                const amberCount = scores.filter(s => s === 'amber').length;
                const redCount = scores.filter(s => s === 'red').length;
                const pct = Math.round((greenCount / checks.length) * 100);
                return (
                  <section>
                    <h3 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center justify-between" style={{ color: '#596570' }}>
                      <span className="flex items-center gap-1.5"><ShieldCheck size={12} /> Audit Checklist</span>
                      <span className="text-xs font-bold" style={{ color: pct === 100 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626' }}>
                        {greenCount}/{checks.length} on file
                      </span>
                    </h3>
                    {/* Score bar */}
                    <div className="w-full h-2 rounded-full mb-3 overflow-hidden" style={{ backgroundColor: '#F5FAF3' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626' }} />
                    </div>
                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E2F1DA' }}>
                      {checks.map((c, i) => {
                        const s = scores[i];
                        return (
                          <div key={c.label} className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: i < checks.length - 1 ? '1px solid #F5FAF3' : 'none' }}>
                            {s === 'green' && <CheckCircle size={13} style={{ color: '#16a34a', flexShrink: 0 }} />}
                            {s === 'amber' && <AlertTriangle size={13} style={{ color: '#d97706', flexShrink: 0 }} />}
                            {s === 'red' && <XCircle size={13} style={{ color: '#dc2626', flexShrink: 0 }} />}
                            <span className="text-xs flex-1" style={{ color: s === 'red' ? '#dc2626' : s === 'amber' ? '#d97706' : '#050505' }}>
                              {c.label}
                            </span>
                            {c.expiry && (
                              <span className="text-xs" style={{ color: '#596570' }}>{fmtDate(c.expiry)}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {(amberCount > 0 || redCount > 0) && (
                      <div className="mt-2 text-xs flex gap-3">
                        {redCount > 0 && <span style={{ color: '#dc2626' }}>✗ {redCount} missing/expired</span>}
                        {amberCount > 0 && <span style={{ color: '#d97706' }}>⚠ {amberCount} expiring soon</span>}
                      </div>
                    )}
                  </section>
                );
              })()}
            </>
          )}

          {/* ── Accidents Tab ── */}
          {tab === 'accidents' && (
            <AccidentsSection staffId={staff.id} staffName={staff.name} centreId={centreId} />
          )}

          {/* ── Issues Tab ── */}
          {tab === 'issues' && (
            <IssuesSection staffId={staff.id} staffName={staff.name} centreId={centreId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Staff Card (room view) ─────────────────────────────────────────────────

function StaffCard({
  staff,
  onSelect,
  onStatusChange,
  groupId,
}: {
  staff: StaffMemberRow;
  onSelect: (tab?: 'profile' | 'accidents' | 'issues') => void;
  onStatusChange: (staffId: string, status: string) => void;
  groupId?: string;
}) {
  const isResigned = staff.employment_status === 'Resigned';
  const isExited = staff.employment_status === 'Exited';
  const canResign = staff.employment_status === 'Active' || staff.employment_status === 'On Leave' || staff.employment_status === 'Probation' || staff.employment_status === 'Casual';

  return (
    <div
      draggable={!isResigned && !isExited}
      onDragStart={e => {
        if (groupId) {
          e.dataTransfer.setData('application/json', JSON.stringify({ staffId: staff.id, sourceGroupId: groupId }));
          e.dataTransfer.effectAllowed = 'move';
        }
      }}
      className="flex flex-col gap-2 transition-all p-3.5 cursor-move"
      style={isResigned
        ? { backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }
        : isExited
        ? { backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', opacity: 0.7, cursor: 'default' }
        : { backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }
      }
    >
      {/* Name row */}
      <div className="flex items-start justify-between gap-2">
        <button className="flex-1 min-w-0 text-left" onClick={() => onSelect('profile')}>
          <div className="text-sm font-bold truncate" style={{ color: '#050505' }}>{staff.name}</div>
          {staff.qualification && (
            <span className="text-xs font-medium" style={{ color: '#596570' }}>{staff.qualification}</span>
          )}
        </button>
        <div className="flex gap-1">
          {canResign && (
            <button
              onClick={() => onStatusChange(staff.id, 'Resigned')}
              className="rounded-full text-xs font-medium transition-colors hover:opacity-80"
              style={{ border: '1px solid #dc2626', color: '#dc2626', borderRadius: 9999, fontSize: '11px', padding: '2px 10px' }}
              title="Resign"
            >
              Resign
            </button>
          )}
          <button onClick={() => onSelect('accidents')} className="p-1 rounded-lg hover:bg-orange-50 text-gray-400 hover:text-orange-500" title="Accidents">
            <Stethoscope size={13} />
          </button>
          <button onClick={() => onSelect('issues')} className="p-1 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Issues">
            <AlertCircle size={13} />
          </button>
          <button onClick={() => onSelect('profile')} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Edit">
            <Pencil size={13} />
          </button>
        </div>
      </div>

      {/* Position badge */}
      {staff.position && (
        <span className={`self-start text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[staff.position] || 'bg-gray-100 text-gray-700'}`}>
          {staff.position}
        </span>
      )}

      {/* Status */}
      <InlineSelect
        value={staff.employment_status || 'Active'}
        options={['Active', 'On Leave', 'Resigned', 'Exited', 'Inactive', 'PPL', 'Long Service', 'Probation', 'Casual']}
        onChange={v => onStatusChange(staff.id, v)}
        getColor={v => STATUS_COLORS[v] || 'bg-gray-100 text-gray-600'}
      />

      {/* Days worked */}
      {staff.days_per_week && (
        <div className="text-xs" style={{ color: '#596570' }}>
          <span className="font-medium">Days:</span> {staff.days_per_week}
          {staff.min_hours_pw && <span className="ml-2">{staff.min_hours_pw}h/wk</span>}
        </div>
      )}

      {/* Compliance dots */}
      <div className="flex items-center gap-1.5 pt-2 mt-1" style={{ borderTop: '1px solid #E2F1DA' }}>
        <ShieldCheck size={11} style={{ color: '#E2F1DA' }} className="flex-shrink-0" />
        <CertDot expiry={staff.wwcc_expiry} />
        <span className="text-xs" style={{ color: '#596570' }}>WWCC</span>
        <CertDot expiry={staff.first_aid_expiry} />
        <span className="text-xs" style={{ color: '#596570' }}>FA</span>
        <CertDot expiry={staff.cpr_expiry} />
        <span className="text-xs" style={{ color: '#596570' }}>CPR</span>
        <CertDot expiry={staff.anaphylaxis_expiry} />
        <span className="text-xs" style={{ color: '#596570' }}>Ana</span>
      </div>
    </div>
  );
}

// ── Room Management Modals ───────────────────────────────────────────────

const ROOM_PRESET_COLORS = [
  '#2d5c18', '#16a34a', '#22c55e', '#84cc16',
  '#d97706', '#f59e0b', '#eab308',
  '#dc2626', '#ef4444', '#f97316',
  '#3b82f6', '#0ea5e9', '#06b6d4',
  '#6366f1', '#8b5cf6', '#a855f7',
  '#ec4899', '#f43f5e', '#9ca3af',
];

function AddRoomModal({ onClose, onSave }: { onClose: () => void; onSave: (title: string, color: string) => void }) {
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('#2d5c18');

  return (
    <Modal isOpen onClose={onClose} title="Add Room" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Room Name *</label>
          <input
            autoFocus
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Nursery Room 1"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Room Color</label>
          <div className="flex flex-wrap gap-2">
            {ROOM_PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  border: color === c ? '2px solid #050505' : '2px solid transparent',
                  boxShadow: color === c ? '0 0 0 2px #fff inset' : 'none',
                }}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
          <button
            onClick={() => { if (!title.trim()) { showToast('Room name is required', 'error'); return; } onSave(title.trim(), color); onClose(); }}
            className="px-5 py-2 bg-[#2d5c18] text-white text-sm font-medium rounded-xl hover:bg-[#2d5c18]/90 transition-colors"
          >
            Create Room
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditRoomModal({ initialTitle, initialColor, initialAgeMin, initialAgeMax, initialCapacity, onClose, onSave }: {
  groupId: string; initialTitle: string; initialColor: string; initialAgeMin?: number | null; initialAgeMax?: number | null; initialCapacity?: number | null; onClose: () => void; onSave: (title: string, color: string, ageMin: number | null, ageMax: number | null, capacity: number | null) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [color, setColor] = useState(initialColor);
  const [ageMin, setAgeMin] = useState(initialAgeMin !== null && initialAgeMin !== undefined ? String(initialAgeMin) : '');
  const [ageMax, setAgeMax] = useState(initialAgeMax !== null && initialAgeMax !== undefined ? String(initialAgeMax) : '');
  const [capacity, setCapacity] = useState(initialCapacity !== null && initialCapacity !== undefined ? String(initialCapacity) : '');

  return (
    <Modal isOpen onClose={onClose} title="Edit Room" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Room Name *</label>
          <input
            autoFocus
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Room Color</label>
          <div className="flex flex-wrap gap-2">
            {ROOM_PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  border: color === c ? '2px solid #050505' : '2px solid transparent',
                  boxShadow: color === c ? '0 0 0 2px #fff inset' : 'none',
                }}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Age Min (months)</label>
            <input type="number" min="0" max="72"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
              value={ageMin} onChange={e => setAgeMin(e.target.value)} placeholder="e.g. 0" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Age Max (months)</label>
            <input type="number" min="0" max="72"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
              value={ageMax} onChange={e => setAgeMax(e.target.value)} placeholder="e.g. 24" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Capacity</label>
            <input type="number" min="1"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
              value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="e.g. 16" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
          <button
            onClick={() => { if (!title.trim()) { showToast('Room name is required', 'error'); return; } onSave(title.trim(), color, ageMin ? parseInt(ageMin) : null, ageMax ? parseInt(ageMax) : null, capacity ? parseInt(capacity) : null); }}
            className="px-5 py-2 bg-[#2d5c18] text-white text-sm font-medium rounded-xl hover:bg-[#2d5c18]/90 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteRoomModal({ title, staffCount, onClose, onConfirm }: {
  title: string; staffCount: number; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal isOpen onClose={onClose} title="Delete Room" size="sm">
      <div className="space-y-4">
        <p className="text-sm" style={{ color: '#596570' }}>
          Are you sure you want to delete <span className="font-semibold" style={{ color: '#050505' }}>{title}</span>?
        </p>
        {staffCount > 0 ? (
          <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: '#fff5f5', color: '#dc2626', border: '1px solid #fca5a5' }}>
            This room has {staffCount} staff member{staffCount !== 1 ? 's' : ''}. Move all staff out before deleting.
          </div>
        ) : (
          <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
            This room is empty. Deleting it cannot be undone.
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
          <button
            onClick={() => { if (staffCount > 0) { showToast('Move all staff out before deleting', 'error'); return; } onConfirm(); }}
            className="px-5 py-2 text-white text-sm font-medium rounded-xl transition-colors"
            style={{ backgroundColor: staffCount > 0 ? '#d1d5db' : '#dc2626', cursor: staffCount > 0 ? 'not-allowed' : 'pointer' }}
          >
            Delete Room
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Qualification colour map ─────────────────────────────────────────────

const QUALIFICATION_COLORS: Record<string, string> = {
  'ECT': '#3b82f6',
  'WT ECT': '#3b82f6',
  'Diploma': '#22c55e',
  'Certificate 3': '#eab308',
  'Trainee': '#f97316',
  'ISS': '#9ca3af',
  'Chef': '#9ca3af',
  'No Qualification': '#9ca3af',
};

function getQualificationColor(q?: string | null): string {
  if (!q) return '#9ca3af';
  const key = Object.keys(QUALIFICATION_COLORS).find(k => q.toLowerCase().includes(k.toLowerCase()));
  return key ? QUALIFICATION_COLORS[key] : '#9ca3af';
}

// ── Staffing Overview Chart ────────────────────────────────────────────────

function StaffingOverviewChart({
  groups,
  openPositions,
}: {
  groups: Array<{ id: string; title: string; color: string; isActive: boolean; staff: StaffMemberRow[] }>;
  openPositions: OpenPosition[];
}) {
  // Filter staff to Active + On Leave only
  const chartGroups = useMemo(() => {
    return groups
      .filter(g => g.isActive)
      .map(g => ({
        ...g,
        staff: g.staff.filter(s => {
          const status = s.employment_status || 'Active';
          return status === 'Active' || status === 'On Leave';
        }),
      }))
      .filter(g => g.staff.length > 0);
  }, [groups]);

  const maxCount = useMemo(() => {
    return Math.max(...chartGroups.map(g => g.staff.length), 1);
  }, [chartGroups]);

  const openCount = useMemo(() => {
    return openPositions.filter(p => p.status === 'Open' || p.status === 'On Hold').length;
  }, [openPositions]);

  const floatCount = useMemo(() => {
    return groups.flatMap(g => g.staff).filter(s => {
      const status = s.employment_status || 'Active';
      if (status !== 'Active' && status !== 'On Leave') return false;
      const isFloatGroup = s.group_title && /float/i.test(s.group_title);
      const isFloatRole = s.role_in_room && /float/i.test(s.role_in_room);
      return isFloatGroup || isFloatRole;
    }).length;
  }, [groups]);

  const legendItems = [
    { label: 'ECT / WT ECT', color: '#3b82f6' },
    { label: 'Diploma', color: '#22c55e' },
    { label: 'Certificate 3', color: '#eab308' },
    { label: 'Trainee', color: '#f97316' },
    { label: 'Other / No Qual', color: '#9ca3af' },
  ];

  function truncate(str: string, len: number) {
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  return (
    <div style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, padding: 20 }}>
      <h2 className="text-sm font-bold mb-4" style={{ color: '#050505' }}>Staffing Overview</h2>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Section 1: Staff by Room */}
        <div className="flex-1 min-w-0">
          <div className="flex items-end gap-4" style={{ height: 280 }}>
            {chartGroups.map(group => {
              const BAR_PX_PER_STAFF = 18;
              const barHeight = group.staff.length * BAR_PX_PER_STAFF;
              const maxHeight = maxCount * BAR_PX_PER_STAFF;
              return (
                <div key={group.id} className="flex flex-col items-center flex-1 min-w-0" style={{ height: '100%', justifyContent: 'flex-end' }}>
                  {/* Total count above bar */}
                  <span className="text-xs font-bold mb-1" style={{ color: '#050505' }}>{group.staff.length}</span>
                  {/* Stacked bar — fixed px height per staff member */}
                  <div
                    className="w-full flex flex-col-reverse rounded-t-lg overflow-hidden"
                    style={{ height: barHeight, maxHeight }}
                  >
                    {group.staff.map((s, i) => (
                      <div
                        key={`${s.id}-${i}`}
                        className="w-full"
                        style={{ backgroundColor: getQualificationColor(s.qualification), height: BAR_PX_PER_STAFF, borderBottom: '1px solid rgba(255,255,255,0.3)' }}
                        title={`${s.name} — ${s.qualification || 'No Qualification'}`}
                      />
                    ))}
                  </div>
                  {/* Room label */}
                  <span className="text-[10px] font-medium mt-2 text-center w-full" style={{ color: '#596570', wordBreak: 'break-word' }}>
                    {truncate(group.title, 14)}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            {legendItems.map(item => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                <span className="text-[10px] font-medium" style={{ color: '#596570' }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="hidden lg:block w-px" style={{ backgroundColor: '#E2F1DA' }} />

        {/* Section 2: Overview Stats */}
        <div className="flex flex-row lg:flex-col gap-4 lg:min-w-[140px]">
          <div className="flex-1 lg:flex-none px-4 py-3 rounded-xl" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
            <div className="text-2xl font-bold" style={{ color: '#d97706' }}>{openCount}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#92400e' }}>Open Positions</div>
          </div>
          <div className="flex-1 lg:flex-none px-4 py-3 rounded-xl" style={{ backgroundColor: '#f3e8ff', border: '1px solid #d8b4fe' }}>
            <div className="text-2xl font-bold" style={{ color: '#9333ea' }}>{floatCount}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#6b21a8' }}>Float Staff</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add Staff Modal ────────────────────────────────────────────────────────

function AddStaffModal({
  centreId,
  groups,
  prefilledGroupId,
  onClose,
  onSaved,
}: {
  centreId: string;
  groups: Array<{ id: string; title: string; isActive: boolean }>;
  prefilledGroupId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    groupId: prefilledGroupId || groups.filter(g => g.isActive)[0]?.id || '',
    qualification: '',
    position: '',
    employment_status: 'Active',
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name.trim()) { showToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      await apiPost(`staffing-structure?centreId=${centreId}`, {
        action: 'create_staff',
        centreId,
        groupId: form.groupId,
        name: form.name.trim(),
        qualification: form.qualification,
        position: form.position,
        employment_status: form.employment_status,
      });
      showToast('Staff member added');
      onSaved();
      onClose();
    } catch (err) {
      showToast((err as Error).message || 'Failed to add', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Add Staff Member" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
          <input
            autoFocus
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Room</label>
            <select
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
              value={form.groupId}
              onChange={e => setForm(f => ({ ...f, groupId: e.target.value }))}
            >
              {groups.filter(g => g.isActive).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
              value={form.employment_status}
              onChange={e => setForm(f => ({ ...f, employment_status: e.target.value }))}
            >
              {['Active', 'On Leave', 'Resigned', 'Exited', 'Inactive', 'PPL', 'Probation', 'Casual'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Position</label>
            <select
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
              value={form.position}
              onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
            >
              <option value="">Select...</option>
              {['Room Leader', 'Educator', 'Educational Leader', 'Assistant Director', 'Centre Director', 'Trainee', 'Float', 'Internal Casual', 'Early Childhood Teacher', 'Chef'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Qualification</label>
            <select
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
              value={form.qualification}
              onChange={e => setForm(f => ({ ...f, qualification: e.target.value }))}
            >
              <option value="">Select...</option>
              {['ECT', 'WT ECT', 'Diploma', 'Certificate 3', 'Trainee', 'ISS', 'No Qualification'].map(q => <option key={q}>{q}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-[#2d5c18] text-white text-sm font-medium rounded-xl hover:bg-[#2d5c18]/90 transition-colors disabled:opacity-60">
            {saving ? 'Adding...' : 'Add Staff'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Open Positions Modal ───────────────────────────────────────────────────

function OpenPositionModal({
  centreId,
  groups,
  existing,
  onClose,
  onSaved,
}: {
  centreId: string;
  groups: Array<{ id: string; title: string }>;
  existing?: OpenPosition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: existing?.title || '',
    qualification_required: existing?.qualification_required || '',
    room_id: existing?.room_id || '',
    status: existing?.status || 'Open',
    notes: existing?.notes || '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.title.trim()) { showToast('Title is required', 'error'); return; }
    setSaving(true);
    try {
      const payload = { ...form, centre_id: centreId };
      if (existing) {
        await apiPatch(`open-positions?id=${existing.id}`, payload);
        showToast('Position updated');
      } else {
        await apiPost('open-positions', payload);
        showToast('Position added');
      }
      onSaved();
      onClose();
    } catch (err) {
      showToast((err as Error).message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={existing ? 'Edit Open Position' : 'Add Open Position'} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Position Title *</label>
          <input
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Diploma Educator, Room Leader"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Qualification Required</label>
          <input
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d5c18]/20"
            value={form.qualification_required}
            onChange={e => setForm(f => ({ ...f, qualification_required: e.target.value }))}
            placeholder="e.g. Diploma ECE, Certificate III"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Room (optional)</label>
            <select
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
              value={form.room_id}
              onChange={e => setForm(f => ({ ...f, room_id: e.target.value }))}
            >
              <option value="">Any room</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            >
              {['Open', 'On Hold', 'Offered', 'Filled'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none resize-none"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-[#2d5c18] text-white text-sm font-medium rounded-xl hover:bg-[#2d5c18]/90 transition-colors disabled:opacity-60">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Resignation Modal ──────────────────────────────────────────────────────

function ResignationModal({
  staffName,
  onConfirm,
  onCancel,
}: {
  staffName: string;
  onConfirm: (data: { lastDay: string; terminationType: string; reason: string; notes: string; resignationReceivedDate: string }) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [resignationReceivedDate, setResignationReceivedDate] = useState(today);
  const [lastDay, setLastDay] = useState('');
  const [terminationType, setTerminationType] = useState('Voluntary Resignation');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const daysNotice = resignationReceivedDate && lastDay
    ? Math.max(0, Math.round((new Date(lastDay).getTime() - new Date(resignationReceivedDate).getTime()) / 86400000))
    : null;

  return (
    <Modal isOpen onClose={onCancel} title="Mark as Resigned" size="md">
      <div className="space-y-4">
        <p className="text-sm" style={{ color: '#596570' }}>
          You are marking <span className="font-semibold" style={{ color: '#050505' }}>{staffName}</span> as resigned.
          Their card stays visible with an amber highlight until their last day.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Resignation Received</label>
            <input type="date" className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
              style={{ border: '1px solid #E2F1DA' }}
              value={resignationReceivedDate} onChange={e => setResignationReceivedDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>
              Last Day <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input type="date" className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
              style={{ border: '1px solid #E2F1DA' }}
              value={lastDay} onChange={e => setLastDay(e.target.value)} />
          </div>
        </div>

        {daysNotice !== null && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
            style={{ backgroundColor: daysNotice >= 14 ? '#F5FAF3' : '#fffbeb', color: daysNotice >= 14 ? '#2d5c18' : '#92400e', border: `1px solid ${daysNotice >= 14 ? '#D0E8B8' : '#fde68a'}` }}>
            <ShieldCheck size={13} />
            {daysNotice} day{daysNotice !== 1 ? 's' : ''} notice period
            {daysNotice < 14 && ' — less than 2 weeks notice'}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Termination Type</label>
          <select className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
            style={{ border: '1px solid #E2F1DA', backgroundColor: '#ffffff' }}
            value={terminationType} onChange={e => setTerminationType(e.target.value)}>
            {['Voluntary Resignation', 'Transfer to TGA Service', 'Termination', 'Redundancy', 'End of Contract', 'Other'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Reason for Leaving</label>
          <textarea rows={2} className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none resize-none"
            style={{ border: '1px solid #E2F1DA' }}
            value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Relocating, personal reasons, career change..." />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Notes (optional)</label>
          <textarea rows={2} className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none resize-none"
            style={{ border: '1px solid #E2F1DA' }}
            value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional details..." />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm" style={{ color: '#596570' }}>Cancel</button>
          <button
            onClick={() => {
              if (!lastDay) { showToast('Please select a last day', 'error'); return; }
              onConfirm({ lastDay, terminationType, reason, notes, resignationReceivedDate });
            }}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{ backgroundColor: '#d97706', color: '#fff' }}
          >
            <UserMinus size={14} />
            Confirm Resignation
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

const ALL = '__all__';

// ── All Centres Summary Card ────────────────────────────────────────────────

interface CentreSummary {
  centreId: string;
  centreName: string;
  activeStaff: number;
  openPositions: number;
  complianceHealth: 'green' | 'amber' | 'red';
  certAlerts: number;
  compliantStaff: number;
  compliancePct: number;
  loading: boolean;
  error?: string;
}

export default function StaffingStructurePage() {
  const user = getUser();
  const accessible = useMemo(() => {
    if (!user) return [];
    if (user.role === 'admin' || user.role === 'ceo') return CENTRES;
    if (user.role === 'area_manager') return CENTRES;
    return CENTRES.filter(c => c.id === user.centreId);
  }, [user]);

  const multiAccess = accessible.length > 1;
  const [centreId, setCentreId] = useState('');

  // All-centres summary state
  const [centreSummaries, setCentreSummaries] = useState<CentreSummary[]>([]);
  const [_summariesLoading, setSummariesLoading] = useState(false);

  useEffect(() => {
    if (accessible.length > 0 && !centreId) {
      setCentreId(multiAccess ? ALL : accessible[0].id);
    }
  }, [accessible]);

  // Board data (per centre)
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open positions (per centre)
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);

  // UI state
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set());
  const [positionsCollapsed, setPositionsCollapsed] = useState(false);
  const [exitedCollapsed, setExitedCollapsed] = useState(true);

  // Modals
  const [profileTarget, setProfileTarget] = useState<{ staff: StaffMemberRow; tab?: 'profile' | 'accidents' | 'issues' } | null>(null);
  const [addStaffTarget, setAddStaffTarget] = useState<{ groupId?: string } | null>(null);
  const [positionModal, setPositionModal] = useState<{ existing?: OpenPosition } | null>(null);
  const [resignationPending, setResignationPending] = useState<{ staffId: string; staffName: string } | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // Room management modals
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [editRoomTarget, setEditRoomTarget] = useState<{ groupId: string; title: string; color: string; age_min?: number | null; age_max?: number | null; capacity?: number | null } | null>(null);
  const [deleteRoomTarget, setDeleteRoomTarget] = useState<{ groupId: string; title: string; staffCount: number } | null>(null);

  // Load all-centres summary data
  const loadAllCentresSummary = useCallback(async () => {
    if (!multiAccess) return;
    setSummariesLoading(true);
    const initial: CentreSummary[] = accessible.map(c => ({
      centreId: c.id,
      centreName: c.name,
      activeStaff: 0,
      openPositions: 0,
      complianceHealth: 'green' as const,
      certAlerts: 0,
      compliantStaff: 0,
      compliancePct: 0,
      loading: true,
    }));
    setCentreSummaries(initial);
    setSummariesLoading(false);

    // Fetch each centre in parallel
    await Promise.all(accessible.map(async (centre) => {
      try {
        const [boardData, posData] = await Promise.all([
          fetch(`/api/staffing-structure?centreId=${centre.id}`).then(r => r.ok ? r.json() as Promise<BoardData> : Promise.reject()),
          fetch(`/api/open-positions?centreId=${centre.id}`).then(r => r.ok ? r.json() : Promise.resolve([])),
        ]);
        const activeGroups = (boardData as BoardData).groups.filter(g => g.isActive);
        const activeStaff = activeGroups.flatMap(g => g.staff);
        const certAlerts = activeStaff.filter(s => {
          const expiries = [s.wwcc_expiry, s.first_aid_expiry, s.cpr_expiry, s.anaphylaxis_expiry];
          return expiries.some(e => e && certDays(e) < 90);
        }).length;
        const expiredCerts = activeStaff.filter(s => {
          const expiries = [s.wwcc_expiry, s.first_aid_expiry, s.cpr_expiry, s.anaphylaxis_expiry];
          return expiries.some(e => e && certDays(e) < 0);
        }).length;
        const openPos = Array.isArray(posData) ? (posData as OpenPosition[]).filter(p => p.status === 'Open' || p.status === 'On Hold').length : 0;
        const compliantStaff = activeStaff.filter(isStaffCompliant).length;
        const compliancePct = activeStaff.length > 0 ? Math.round((compliantStaff / activeStaff.length) * 100) : 100;
        const health: 'green' | 'amber' | 'red' = expiredCerts > 0 ? 'red' : certAlerts > 0 ? 'amber' : 'green';
        setCentreSummaries(prev => prev.map(s =>
          s.centreId === centre.id
            ? { ...s, loading: false, activeStaff: activeStaff.length, openPositions: openPos, certAlerts, complianceHealth: health, compliantStaff, compliancePct }
            : s
        ));
      } catch {
        setCentreSummaries(prev => prev.map(s =>
          s.centreId === centre.id ? { ...s, loading: false, error: 'Failed' } : s
        ));
      }
    }));
  }, [accessible, multiAccess]);

  const loadData = useCallback((id: string) => {
    if (id === ALL) { setData(null); return; }
    setLoading(true); setError(null); setData(null);
    fetch(`/api/staffing-structure?centreId=${id}`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => { throw new Error(j.error || r.statusText); }))
      .then((d: BoardData) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  const loadPositions = useCallback((id: string) => {
    if (id === ALL) { setOpenPositions([]); return; }
    fetch(`/api/open-positions?centreId=${id}`)
      .then(r => r.ok ? r.json() : Promise.resolve([]))
      .then(d => setOpenPositions(Array.isArray(d) ? d : []))
      .catch(() => setOpenPositions([]));
  }, []);

  useEffect(() => {
    if (centreId) {
      loadData(centreId);
      loadPositions(centreId);
      if (centreId === ALL) {
        loadAllCentresSummary();
      }
    }
  }, [centreId, loadData, loadPositions, loadAllCentresSummary]);

  const activeGroups = useMemo(() => data?.groups.filter(g => g.isActive) ?? [], [data]);
  const inactiveGroups = useMemo(() => data?.groups.filter(g => !g.isActive) ?? [], [data]);
  const exitedGroup = useMemo(() => inactiveGroups.find(g => /exited/i.test(g.title)), [inactiveGroups]);

  const searchLower = search.toLowerCase().trim();
  const filteredGroups = useMemo(() =>
    activeGroups.map(g => ({
      ...g,
      staff: searchLower
        ? g.staff.filter(s => s.name.toLowerCase().includes(searchLower) || (s.position || '').toLowerCase().includes(searchLower) || (s.qualification || '').toLowerCase().includes(searchLower))
        : g.staff,
    })).filter(g => !searchLower || g.staff.length > 0),
    [activeGroups, searchLower]
  );

  // Compliance summary
  const allActive = activeGroups.flatMap(g => g.staff);
  const certAlerts = allActive.filter(s => {
    const expiries = [s.wwcc_expiry, s.first_aid_expiry, s.cpr_expiry, s.anaphylaxis_expiry];
    return expiries.some(e => e && certDays(e) < 90);
  }).length;
  const openPositionCount = openPositions.filter(p => p.status === 'Open' || p.status === 'On Hold').length;

  function toggleRoom(id: string) {
    setCollapsedRooms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() { setCollapsedRooms(new Set()); }

  function collapseAll() {
    setCollapsedRooms(new Set(activeGroups.map(g => g.id)));
  }

  async function handleStatusChange(staffId: string, status: string) {
    if (status === 'Resigned' || status === 'Exited') {
      const sm = allActive.find(s => s.id === staffId);
      if (sm) {
        setResignationPending({ staffId, staffName: sm.name });
        return;
      }
    }
    try {
      await apiPost(`staffing-structure?centreId=${centreId}`, {
        action: 'update_staff', staffId, fields: { employment_status: status },
      });
      loadData(centreId);
      showToast('Status updated');
    } catch (err) {
      showToast((err as Error).message || 'Failed to update', 'error');
    }
  }

  async function handleResignationConfirm(data: { lastDay: string; terminationType: string; reason: string; notes: string; resignationReceivedDate: string }) {
    if (!resignationPending) return;
    const { staffId, staffName } = resignationPending;
    const sm = allActive.find(s => s.id === staffId);
    const formattedDate = new Date(data.lastDay + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    const daysNotice = Math.max(0, Math.round(
      (new Date(data.lastDay).getTime() - new Date(data.resignationReceivedDate).getTime()) / 86400000
    ));
    try {
      // 1. Update staff status + end_date
      await apiPost(`staffing-structure?centreId=${centreId}`, {
        action: 'update_staff', staffId,
        fields: {
          employment_status: 'Resigned',
          end_date: data.lastDay,
        },
      });

      // 2. Create backfill open position
      if (sm) {
        await apiPost('open-positions', {
          centre_id: centreId,
          title: sm.position || 'Educator',
          qualification_required: sm.qualification || '',
          room_id: sm.group_id || undefined,
          status: 'Open',
          notes: `Backfill for ${staffName} — last day ${formattedDate}${data.notes ? `. ${data.notes}` : ''}`,
        });
      }

      // 3. Create offboarding record in Supabase (best-effort)
      try {
        const centreName = CENTRES.find(c => c.id === centreId)?.name ?? centreId;
        await apiPost('staff-offboarding', {
          centre_id: centreId,
          campus: centreName,
          staff_name: staffName,
          staff_email: sm?.email || '',
          position: sm?.position || '',
          qualification: sm?.qualification || '',
          resignation_received_date: data.resignationReceivedDate,
          last_day: data.lastDay,
          days_notice: daysNotice,
          termination_type: data.terminationType,
          reason_for_leaving: data.reason,
          notes: data.notes,
          hr_checklist_status: 'Pending',
          status: 'New',
        });
      } catch {
        // non-fatal — offboarding table may not exist yet
      }

      showToast(`🟧 ${staffName} marked as resigned. Card highlighted until ${formattedDate}.`);
      loadData(centreId);
      loadPositions(centreId);
    } catch (err) {
      showToast((err as Error).message || 'Failed to process resignation', 'error');
    } finally {
      setResignationPending(null);
    }
  }

  async function handlePositionStatusChange(posId: string, status: string) {
    try {
      await apiPatch(`open-positions?id=${posId}`, { status });
      setOpenPositions(prev => prev.map(p => p.id === posId ? { ...p, status } : p));
    } catch (err) {
      showToast((err as Error).message || 'Failed to update', 'error');
    }
  }

  async function handleDeletePosition(posId: string) {
    try {
      await apiDelete(`open-positions?id=${posId}`);
      setOpenPositions(prev => prev.filter(p => p.id !== posId));
      showToast('Position deleted');
    } catch (err) {
      showToast((err as Error).message || 'Failed to delete', 'error');
    }
  }

  async function handleCreateRoom(title: string, color: string) {
    try {
      await apiPost(`staffing-structure?centreId=${centreId}`, { action: 'create_room', centreId, title, color });
      showToast('Room created');
      loadData(centreId);
    } catch (err) {
      showToast((err as Error).message || 'Failed to create room', 'error');
    }
  }

  async function handleUpdateRoom(groupId: string, title: string, color: string, ageMin?: number | null, ageMax?: number | null, capacity?: number | null) {
    try {
      const payload: Record<string, unknown> = { action: 'update_room', centreId, groupId, title, color };
      if (ageMin !== undefined) payload.ageMin = ageMin;
      if (ageMax !== undefined) payload.ageMax = ageMax;
      if (capacity !== undefined) payload.capacity = capacity;
      await apiPost(`staffing-structure?centreId=${centreId}`, payload);
      showToast('Room updated');
      loadData(centreId);
    } catch (err) {
      showToast((err as Error).message || 'Failed to update room', 'error');
    }
  }

  async function handleDeleteRoom(groupId: string) {
    try {
      await apiPost(`staffing-structure?centreId=${centreId}`, { action: 'delete_room', centreId, groupId });
      showToast('Room deleted');
      loadData(centreId);
    } catch (err) {
      showToast((err as Error).message || 'Failed to delete room', 'error');
    }
  }

  async function handleDeleteStaff(staffId: string, staffName: string) {
    if (!confirm(`Delete ${staffName}? This cannot be undone.`)) return;
    try {
      await apiPost(`staffing-structure?centreId=${centreId}`, { action: 'delete_staff', staffId });
      loadData(centreId);
      showToast('Staff member deleted');
    } catch (err) {
      showToast((err as Error).message || 'Failed to delete', 'error');
    }
  }

  const centreName = CENTRES.find(c => c.id === centreId)?.name ?? '';

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5FAF3]">
        <p className="text-gray-500">Please log in.</p>
      </div>
    );
  }

  return (
    <Layout>
    <div className="space-y-6 pb-10" style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Modals */}
      {resignationPending && (
        <ResignationModal
          staffName={resignationPending.staffName}
          onConfirm={handleResignationConfirm}
          onCancel={() => setResignationPending(null)}
        />
      )}
      {addStaffTarget !== null && data && (
        <AddStaffModal
          centreId={centreId}
          groups={activeGroups.map(g => ({ id: g.id, title: g.title, isActive: g.isActive }))}
          prefilledGroupId={addStaffTarget.groupId}
          onClose={() => setAddStaffTarget(null)}
          onSaved={() => loadData(centreId)}
        />
      )}
      {positionModal !== null && (
        <OpenPositionModal
          centreId={centreId}
          groups={activeGroups.map(g => ({ id: g.id, title: g.title }))}
          existing={positionModal.existing}
          onClose={() => setPositionModal(null)}
          onSaved={() => loadPositions(centreId)}
        />
      )}
      {profileTarget && (
        <StaffProfileDrawer
          staff={profileTarget.staff}
          centreId={centreId}
          groups={activeGroups.map(g => ({ id: g.id, title: g.title, isActive: g.isActive }))}
          initialTab={profileTarget.tab}
          onClose={() => setProfileTarget(null)}
          onSaved={() => loadData(centreId)}
        />
      )}
      {addRoomOpen && (
        <AddRoomModal
          onClose={() => setAddRoomOpen(false)}
          onSave={handleCreateRoom}
        />
      )}
      {editRoomTarget && (
        <EditRoomModal
          groupId={editRoomTarget.groupId}
          initialTitle={editRoomTarget.title}
          initialColor={editRoomTarget.color}
          initialAgeMin={editRoomTarget.age_min}
          initialAgeMax={editRoomTarget.age_max}
          initialCapacity={editRoomTarget.capacity}
          onClose={() => setEditRoomTarget(null)}
          onSave={(title, color, ageMin, ageMax, capacity) => { handleUpdateRoom(editRoomTarget.groupId, title, color, ageMin, ageMax, capacity); setEditRoomTarget(null); }}
        />
      )}
      {deleteRoomTarget && (
        <DeleteRoomModal
          title={deleteRoomTarget.title}
          staffCount={deleteRoomTarget.staffCount}
          onClose={() => setDeleteRoomTarget(null)}
          onConfirm={() => { handleDeleteRoom(deleteRoomTarget.groupId); setDeleteRoomTarget(null); }}
        />
      )}

      {/* Header */}
      <div className="mb-2">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#050505' }}>Staffing Structure</h1>
            <p className="text-sm mt-1" style={{ color: '#596570' }}>
              Manage staff, rooms, compliance and HR records
              {data?.fetchedAt && (
                <span className="ml-2" style={{ color: '#596570' }}>
                  · {new Date(data.fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}<button onClick={() => loadData(centreId)} className="underline hover:no-underline">Refresh</button>
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {centreId !== ALL && multiAccess && (
              <button
                onClick={() => { setCentreId(ALL); setCollapsedRooms(new Set()); setSearch(''); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}
              >
                ← All Centres
              </button>
            )}
            {centreId !== ALL && data && (
              <>
                <button
                  onClick={() => setAddRoomOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
                  style={{ backgroundColor: '#F5FAF3', color: '#2d5c18', border: '1px solid #D0E8B8' }}
                >
                  <Plus size={14} />
                  Add Room
                </button>
                <button
                  onClick={() => setAddStaffTarget({})}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
                  style={{ backgroundColor: '#2d5c18', color: '#fff' }}
                >
                  <Plus size={14} />
                  Add Staff
                </button>
              </>
            )}
            {multiAccess && (
              <select
                value={centreId}
                onChange={e => { setCentreId(e.target.value); setCollapsedRooms(new Set()); setSearch(''); }}
                className="text-sm rounded-lg px-3 py-2 focus:outline-none"
                style={{ border: '1px solid #E2F1DA', backgroundColor: '#ffffff', color: '#050505' }}
              >
                <option value={ALL}>All Centres</option>
                {accessible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {!multiAccess && accessible.length === 1 && (
              <div className="flex items-center px-3 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: '#e8f5e0', color: '#2d5c18', border: '1px solid #E2F1DA' }}>
                {accessible[0].name}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="rounded-2xl p-10 text-center" style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="text-sm animate-pulse" style={{ color: '#596570' }}>Loading {centreName}...</div>
        </div>
      )}
      {error && (
        <div className="rounded-2xl p-4 text-sm" style={{ backgroundColor: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 12, color: '#dc2626' }}>
          <strong>Failed to load:</strong> {error}
        </div>
      )}

      {/* All centres view */}
      {centreId === ALL && (
        <>
          {/* All Centres Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold" style={{ color: '#050505' }}>All Centres Overview</h2>
              <p className="text-xs mt-0.5" style={{ color: '#596570' }}>Select a centre to view its staffing structure</p>
            </div>
            <button
              onClick={loadAllCentresSummary}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}
            >
              Refresh All
            </button>
          </div>

          {/* Summary bar */}
          {(() => {
            const loaded = centreSummaries.filter(s => !s.loading && !s.error);
            if (loaded.length === 0) return null;
            const totalStaff = loaded.reduce((sum, s) => sum + s.activeStaff, 0);
            const totalOpen = loaded.reduce((sum, s) => sum + s.openPositions, 0);
            const totalCompliant = loaded.reduce((sum, s) => sum + s.compliantStaff, 0);
            const overallPct = totalStaff > 0 ? Math.round((totalCompliant / totalStaff) * 100) : 0;
            const overallColor = complianceColor(overallPct);
            return (
              <div className="flex flex-wrap items-center gap-4 px-5 py-3 rounded-xl" style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA' }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: '#596570' }}>Total Staff</span>
                  <span className="text-sm font-bold" style={{ color: '#050505' }}>{totalStaff}</span>
                </div>
                <div className="w-px h-4" style={{ backgroundColor: '#E2F1DA' }} />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: '#596570' }}>Open Positions</span>
                  <span className="text-sm font-bold" style={{ color: totalOpen > 0 ? '#d97706' : '#050505' }}>{totalOpen}</span>
                </div>
                <div className="w-px h-4" style={{ backgroundColor: '#E2F1DA' }} />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: '#596570' }}>Compliance</span>
                  <span className="text-sm font-bold" style={{ color: overallColor }}>{totalCompliant}/{totalStaff} — {overallPct}%</span>
                </div>
              </div>
            );
          })()}

          {/* Centre cards — use accessible list so cards always appear even before summary data loads */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {accessible.map(centre => {
              const summary = centreSummaries.find(s => s.centreId === centre.id);
              return (
                <div
                  key={centre.id}
                  onClick={() => { setCentreId(centre.id); setCollapsedRooms(new Set()); setSearch(''); }}
                  className="flex flex-col justify-between p-5 transition-all cursor-pointer hover:shadow-lg"
                  style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
                >
                  <div className="mb-4">
                    <h3 className="text-lg font-bold" style={{ color: '#050505' }}>{centre.name}</h3>
                    {summary && !summary.loading && !summary.error && (
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div className="text-center px-2 py-2 rounded-lg" style={{ backgroundColor: '#F5FAF3' }}>
                          <div className="text-sm font-bold" style={{ color: '#2d5c18' }}>{summary.activeStaff}</div>
                          <div className="text-[10px] font-medium" style={{ color: '#596570' }}>staff</div>
                        </div>
                        <div className="text-center px-2 py-2 rounded-lg" style={{ backgroundColor: summary.openPositions > 0 ? '#fffbeb' : '#F5FAF3' }}>
                          <div className="text-sm font-bold" style={{ color: summary.openPositions > 0 ? '#d97706' : '#596570' }}>{summary.openPositions}</div>
                          <div className="text-[10px] font-medium" style={{ color: '#596570' }}>open</div>
                        </div>
                        <div className="text-center px-2 py-2 rounded-lg" style={{ backgroundColor: complianceBg(summary.compliancePct) }}>
                          <div className="text-sm font-bold" style={{ color: complianceColor(summary.compliancePct) }}>
                            {summary.activeStaff > 0 ? `${summary.compliantStaff}/${summary.activeStaff}` : '—'}
                          </div>
                          <div className="text-[10px] font-medium" style={{ color: '#596570' }}>compliant</div>
                        </div>
                      </div>
                    )}
                    {summary?.loading && (
                      <div className="mt-3 h-12 bg-gray-100 rounded animate-pulse w-full" />
                    )}
                  </div>
                  <div
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg"
                    style={{ backgroundColor: '#2d5c18', color: '#ffffff' }}
                  >
                    View Staffing →
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Single centre view */}
      {centreId !== ALL && data && !loading && (
        <>
          {/* Staffing Overview Chart */}
          <StaffingOverviewChart groups={data.groups} openPositions={openPositions} />

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Active Staff', value: allActive.length, valueColor: '#2d5c18' },
              { label: 'Rooms', value: activeGroups.length, valueColor: '#050505' },
              { label: 'Open Positions', value: openPositionCount, valueColor: openPositionCount > 0 ? '#16a34a' : '#050505' },
              { label: 'Cert Alerts', value: certAlerts, valueColor: certAlerts > 0 ? '#d97706' : '#050505' },
            ].map(s => (
              <div key={s.label} className="px-5 py-4" style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div className="text-2xl font-bold" style={{ color: s.valueColor }}>{s.value}</div>
                <div className="text-xs font-medium mt-0.5" style={{ color: '#596570' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Compliance legend */}
          <div className="flex items-center gap-4 text-xs" style={{ color: '#596570' }}>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#dc2626' }} /><span>Expired or &lt;30d</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#d97706' }} /><span>Expiring 30–90d</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#16a34a' }} /><span>Current (&gt;90d)</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#d1d5db' }} /><span>Not recorded</span></div>
          </div>

          {/* Search + Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#596570' }} />
              <input
                type="text"
                placeholder="Search staff by name, position or qualification..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg focus:outline-none"
                style={{ border: '1px solid #E2F1DA', backgroundColor: '#ffffff', color: '#050505' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('card')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={viewMode === 'card' ? { backgroundColor: '#2d5c18', color: '#fff' } : { backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}
              >
                <LayoutGrid size={15} /> Cards
              </button>
              <button
                onClick={() => setViewMode('list')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={viewMode === 'list' ? { backgroundColor: '#2d5c18', color: '#fff' } : { backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}
              >
                <List size={15} /> List
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={expandAll}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}
              >
                <ChevronsDown size={15} /> Expand All
              </button>
              <button
                onClick={collapseAll}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}
              >
                <ChevronsUp size={15} /> Collapse All
              </button>
            </div>
          </div>

          {/* Open Positions Section */}
          {(openPositions.length > 0 || true) && (
            <div className="overflow-hidden" style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <button
                onClick={() => setPositionsCollapsed(c => !c)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors"
                style={{ backgroundColor: positionsCollapsed ? '#ffffff' : '#F5FAF3' }}
              >
                {positionsCollapsed ? <ChevronRight size={16} style={{ color: '#596570' }} /> : <ChevronDown size={16} style={{ color: '#596570' }} />}
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#e8f5e0' }}>
                  <Briefcase size={16} style={{ color: '#2d5c18' }} />
                </div>
                <div className="flex-1 flex items-center gap-3">
                  <span className="text-sm font-semibold" style={{ color: '#050505' }}>Open Positions</span>
                  {openPositionCount > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#e8f5e0', color: '#2d5c18' }}>{openPositionCount} active</span>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setPositionModal({}); }}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ backgroundColor: '#e8f5e0', color: '#2d5c18', border: '1px solid #D0E8B8' }}
                >
                  <Plus size={13} />
                  Add Position
                </button>
              </button>

              {!positionsCollapsed && (
                <div className="px-5 pb-5">
                  {openPositions.length === 0 ? (
                    <p className="text-sm py-4 text-center" style={{ color: '#596570' }}>No open positions recorded</p>
                  ) : (
                    <div className="space-y-2">
                      {openPositions.map(pos => {
                        const room = activeGroups.find(g => g.id === pos.room_id);
                        return (
                          <div
                            key={pos.id}
                            className="flex items-center gap-3 p-3 rounded-xl transition-all"
                            style={pos.status === 'Filled'
                              ? { backgroundColor: '#F5FAF3', border: '1px solid #E2F1DA', opacity: 0.6 }
                              : { backgroundColor: '#ffffff', border: '1px solid #E2F1DA' }
                            }
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold" style={{ color: '#050505' }}>{pos.title}</span>
                                {room && <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#e8f5e0', color: '#2d5c18' }}>{room.title}</span>}
                              </div>
                              {pos.qualification_required && (
                                <div className="text-xs mt-0.5" style={{ color: '#596570' }}>{pos.qualification_required}</div>
                              )}
                              {pos.notes && <div className="text-xs italic mt-0.5" style={{ color: '#596570' }}>{pos.notes}</div>}
                            </div>
                            <InlineSelect
                              value={pos.status}
                              options={['Open', 'On Hold', 'Offered', 'Filled']}
                              onChange={v => handlePositionStatusChange(pos.id, v)}
                              getColor={v => POSITION_STATUS_COLORS[v] || 'bg-gray-100 text-gray-600'}
                            />
                            <button
                              onClick={() => setPositionModal({ existing: pos })}
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: '#596570' }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => handleDeletePosition(pos.id)}
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: '#596570' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Room Groups */}
          <div className="space-y-4">
            {filteredGroups.map(group => {
              const isCollapsed = collapsedRooms.has(group.id) && !searchLower;
              const staffCount = group.staff.length;
              const dragOver = dragOverGroupId === group.id;

              return (
                <div
                  key={group.id}
                  className="overflow-hidden transition-all"
                  style={{
                    backgroundColor: '#ffffff',
                    border: dragOver ? '2px dashed #2d5c18' : '1px solid #E2F1DA',
                    borderRadius: 12,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverGroupId(group.id);
                  }}
                  onDragLeave={e => {
                    // Only clear if leaving the room container itself, not a child element
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverGroupId(null);
                    }
                  }}
                  onDrop={async e => {
                    e.preventDefault();
                    setDragOverGroupId(null);
                    const raw = e.dataTransfer.getData('application/json');
                    if (!raw) return;
                    try {
                      const { staffId, sourceGroupId } = JSON.parse(raw) as { staffId: string; sourceGroupId: string };
                      if (sourceGroupId === group.id) return;
                      
                      // Optimistic UI update — move staff locally first
                      setData(prev => {
                        if (!prev) return prev;
                        const sourceGroup = prev.groups.find(g => g.id === sourceGroupId);
                        const targetGroup = prev.groups.find(g => g.id === group.id);
                        if (!sourceGroup || !targetGroup) return prev;
                        const staffIndex = sourceGroup.staff.findIndex(s => s.id === staffId);
                        if (staffIndex === -1) return prev;
                        const staff = sourceGroup.staff[staffIndex];
                        // Update staff's group references
                        const updatedStaff = { ...staff, group_id: group.id, group_title: targetGroup.title, group_color: targetGroup.color };
                        return {
                          ...prev,
                          groups: prev.groups.map(g => {
                            if (g.id === sourceGroupId) return { ...g, staff: g.staff.filter(s => s.id !== staffId) };
                            if (g.id === group.id) return { ...g, staff: [...g.staff, updatedStaff] };
                            return g;
                          })
                        };
                      });
                      showToast('Staff moved to ' + group.title);
                      
                      // API call in background
                      await apiPost(`staffing-structure?centreId=${centreId}`, { action: 'move_staff', staffId, groupId: group.id, centreId });
                    } catch (err) {
                      showToast((err as Error).message || 'Failed to move staff', 'error');
                      // Revert on error
                      loadData(centreId);
                    }
                  }}
                >
                  {/* Room header */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer transition-opacity"
                    style={{ backgroundColor: '#F5FAF3', borderBottom: '1px solid #E2F1DA', borderLeft: `4px solid ${group.color || '#2d5c18'}` }}
                    onClick={() => !searchLower && toggleRoom(group.id)}
                  >
                    <div className="flex items-center gap-3">
                      {!searchLower && (isCollapsed ? <ChevronRight size={14} style={{ color: '#596570' }} /> : <ChevronDown size={14} style={{ color: '#596570' }} />)}
                      <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', backgroundColor: group.color || '#2d5c18', flexShrink: 0 }} />
                      <button
                        onClick={e => { e.stopPropagation(); setEditRoomTarget({ groupId: group.id, title: group.title, color: group.color || '#808080', age_min: group.age_min, age_max: group.age_max, capacity: group.capacity }); }}
                        className="text-sm font-bold hover:underline"
                        style={{ color: '#050505' }}
                        title="Click to rename"
                      >
                        {group.title}
                      </button>
                      <span className="text-xs font-semibold" style={{ color: '#596570' }}>{staffCount} staff</span>
                      {(group.age_min !== null || group.age_max !== null) && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
                          {group.age_min !== null ? `${group.age_min}m` : '0m'} - {group.age_max !== null ? `${group.age_max}m` : '?'}
                        </span>
                      )}
                      {group.capacity !== null && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#f3e8ff', color: '#7e22ce', border: '1px solid #d8b4fe' }}>
                          Cap: {group.capacity}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteRoomTarget({ groupId: group.id, title: group.title, staffCount }); }}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors font-medium"
                        style={{ color: staffCount === 0 ? '#596570' : '#d1d5db', backgroundColor: staffCount === 0 ? '#F5FAF3' : 'transparent', border: staffCount === 0 ? '1px solid #E2F1DA' : 'none', cursor: staffCount === 0 ? 'pointer' : 'not-allowed' }}
                        title={staffCount === 0 ? 'Delete room' : 'Move all staff out of this room before deleting'}
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setAddStaffTarget({ groupId: group.id }); }}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors font-medium"
                        style={{ color: '#2d5c18', backgroundColor: '#e8f5e0', border: '1px solid #D0E8B8' }}
                      >
                        <Plus size={12} />
                        Add Staff
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="p-3">
                      {group.staff.length === 0 ? (
                        <p className="text-xs py-2 pl-1" style={{ color: '#596570' }}>No staff in this room</p>
                      ) : viewMode === 'list' ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs font-semibold" style={{ backgroundColor: '#F5FAF3', color: '#596570' }}>
                              <th className="px-3 py-2">Name</th>
                              <th className="px-3 py-2">Position</th>
                              <th className="px-3 py-2">Qualification</th>
                              <th className="px-3 py-2">WWCC</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.staff.map(sm => (
                              <tr key={sm.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                                <td className="px-3 py-2 font-medium text-gray-900">{sm.name}</td>
                                <td className="px-3 py-2 text-gray-600">{sm.position || '—'}</td>
                                <td className="px-3 py-2 text-gray-600">{sm.qualification || '—'}</td>
                                <td className="px-3 py-2">
                                  <CertDot expiry={sm.wwcc_expiry} />
                                  {sm.wwcc_expiry && (
                                    <span className={`ml-1 text-xs ${certDays(sm.wwcc_expiry) < 0 ? 'text-red-600' : certDays(sm.wwcc_expiry) < 90 ? 'text-amber-600' : 'text-green-600'}`}>
                                      {new Date(sm.wwcc_expiry).toLocaleDateString('en-AU')}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[sm.employment_status || 'Active'] || 'bg-gray-100 text-gray-600'}`}>
                                    {sm.employment_status || 'Active'}
                                  </span>
                                </td>
                                <td className="px-3 py-2">

                                  <div className="flex items-center gap-1">
                                    <button onClick={() => setProfileTarget({ staff: sm, tab: 'profile' })} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Pencil size={13} /></button>
                                    <button onClick={() => setProfileTarget({ staff: sm, tab: 'accidents' })} className="p-1 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg"><Stethoscope size={13} /></button>
                                    <button onClick={() => setProfileTarget({ staff: sm, tab: 'issues' })} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><AlertCircle size={13} /></button>
                                    <button onClick={() => handleDeleteStaff(sm.id, sm.name)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {group.staff.map(sm => (
                            <StaffCard
                              key={sm.id}
                              staff={sm}
                              groupId={group.id}
                              onSelect={tab => setProfileTarget({ staff: sm, tab })}
                              onStatusChange={handleStatusChange}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Exited Staff */}
          {exitedGroup && exitedGroup.staff.length > 0 && (
            <div className="overflow-hidden" style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <button
                onClick={() => setExitedCollapsed(c => !c)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left transition-colors"
              >
                {exitedCollapsed ? <ChevronRight size={16} style={{ color: '#596570' }} /> : <ChevronDown size={16} style={{ color: '#596570' }} />}
                <span className="text-sm font-semibold" style={{ color: '#596570' }}>Exited Staff</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F5FAF3', color: '#596570', border: '1px solid #E2F1DA' }}>{exitedGroup.staff.length}</span>
              </button>
              {!exitedCollapsed && (
                <div className="px-5 pb-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-70">
                    {exitedGroup.staff.map(sm => (
                      <StaffCard
                        key={sm.id}
                        staff={sm}
                        groupId={exitedGroup.id}
                        onSelect={tab => setProfileTarget({ staff: sm, tab })}
                        onStatusChange={handleStatusChange}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
    </Layout>
  );
}