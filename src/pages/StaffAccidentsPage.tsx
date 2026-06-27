import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { getUser, getAllowedCentres } from '../auth';
import { CENTRES } from '../config';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface StaffAccident {
  id: string;
  centre_id: string;
  staff_name: string;
  staff_dob?: string;
  phone?: string;
  email?: string;
  incident_date: string;
  time_of_injury: string;
  specific_location: string;
  circumstances: string;
  products_structures_involved?: string;
  location_on_body: string;
  first_aid_provided: string;
  medical_attention: boolean;
  injury_type: string;
  worker_comp_claim: boolean;
  return_to_work_date?: string;
  status: string;
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

const STATUS_OPTIONS = ['New', 'Notification Only', 'Medical Treatment', 'Light Duties', 'Active Certificate', 'Case Closed', 'Not Reporting'];
const INJURY_OPTIONS = ['Sprain/Strain', 'Cut/Laceration', 'Bruise', 'Fracture', 'Burn', 'Eye Injury', 'Back Injury', 'Other'];

const emptyForm = {
  centre_id: '',
  staff_name: '',
  staff_dob: '',
  phone: '',
  email: '',
  incident_date: '',
  time_of_injury: '',
  specific_location: '',
  circumstances: '',
  products_structures_involved: '',
  location_on_body: '',
  first_aid_provided: '',
  medical_attention: false,
  injury_type: 'Sprain/Strain',
  worker_comp_claim: false,
  return_to_work_date: '',
  status: 'New',
};

type FormState = typeof emptyForm;

// â”€â”€ Inline Status Select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        <div
          className="absolute z-50 top-full left-0 mt-1 bg-white rounded-xl shadow-xl border overflow-hidden min-w-max"
          style={{ borderColor: B.border }}
        >
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

// â”€â”€ Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AccidentModal({
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
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: B.border }}>
          <h2 className="font-bold text-gray-900">{editId ? 'Edit Accident Record' : 'Record Staff Accident'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 font-bold text-lg">Ã—</button>
        </div>

        <form onSubmit={onSubmit} className="px-5 py-4 space-y-5">
          {/* Staff Details */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">Staff Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Centre *</label>
                <select
                  required
                  value={form.centre_id}
                  onChange={f('centre_id')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                >
                  <option value="">Select centre</option>
                  {centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Staff Name *</label>
                <input
                  required
                  value={form.staff_name}
                  onChange={f('staff_name')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Date of Birth</label>
                <input type="date" value={form.staff_dob} onChange={f('staff_dob')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
                <input value={form.phone} onChange={f('phone')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                  placeholder="Contact number" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={f('email')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                  placeholder="Email address" />
              </div>
            </div>
          </div>

          {/* Incident Details */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">Incident Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Incident Date *</label>
                <input required type="date" value={form.incident_date} onChange={f('incident_date')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Time of Injury</label>
                <input type="time" value={form.time_of_injury} onChange={f('time_of_injury')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Specific Location *</label>
                <input required value={form.specific_location} onChange={f('specific_location')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                  placeholder="Where exactly did it occur?" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Circumstances *</label>
              <textarea required value={form.circumstances} onChange={f('circumstances')} rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a] resize-none"
                placeholder="Describe how the injury occurred..." />
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Products/Structures Involved</label>
              <textarea value={form.products_structures_involved} onChange={f('products_structures_involved')} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a] resize-none"
                placeholder="Any equipment or structures involved..." />
            </div>
          </div>

          {/* Injury & Treatment */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-100">Injury & Treatment</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Injury Type *</label>
                <select required value={form.injury_type} onChange={f('injury_type')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]">
                  {INJURY_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Location on Body *</label>
                <input required value={form.location_on_body} onChange={f('location_on_body')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]"
                  placeholder="e.g. Left wrist" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                <select value={form.status} onChange={f('status')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]">
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Return to Work Date</label>
                <input type="date" value={form.return_to_work_date} onChange={f('return_to_work_date')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">First Aid Provided</label>
              <textarea value={form.first_aid_provided} onChange={f('first_aid_provided')} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4a7a3a] resize-none"
                placeholder="Describe first aid given..." />
            </div>
            <div className="mt-3 flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.medical_attention}
                  onChange={e => setForm(f => ({ ...f, medical_attention: e.target.checked }))}
                  className="w-4 h-4 rounded" style={{ accentColor: B.green }} />
                <span className="text-sm text-gray-700">Medical Attention Required</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.worker_comp_claim}
                  onChange={e => setForm(f => ({ ...f, worker_comp_claim: e.target.checked }))}
                  className="w-4 h-4 rounded" style={{ accentColor: B.green }} />
                <span className="text-sm text-gray-700">Worker's Comp Claim</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t" style={{ borderColor: B.border }}>
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-5 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
              style={{ backgroundColor: B.green }}>
              {editId ? 'Save Changes' : 'Record Accident'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function StaffAccidentsPage() {
  const user = getUser();
  const accessibleCentres = user ? getAllowedCentres(user) : CENTRES;
  const allowedCentreIds = accessibleCentres.map(c => c.id);
  const isMultiCentre = user?.role === 'admin' || user?.role === 'area_manager' || user?.role === 'ceo';

  const [accidents, setAccidents] = useState<StaffAccident[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedCentre, setSelectedCentre] = useState<string>('all');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/staff-accidents?all=true');
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      // Filter by accessible centres
      const filtered = allowedCentreIds.length === 0
        ? data
        : data.filter((a: StaffAccident) => allowedCentreIds.includes(a.centre_id));
      setAccidents(filtered);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [allowedCentreIds.join(',')]);

  useEffect(() => { load(); }, [load]);

  const filtered = accidents
    .filter(a => selectedCentre === 'all' || a.centre_id === selectedCentre)
    .sort((a, b) => b.incident_date.localeCompare(a.incident_date));

  const openCases = accidents.filter(a => a.status !== 'Case Closed' && a.status !== 'Not Reporting').length;
  const workerCompCases = accidents.filter(a => a.worker_comp_claim).length;
  const medicalAttentionCases = accidents.filter(a => a.medical_attention).length;

  function openAdd() {
    setForm({ ...emptyForm, centre_id: accessibleCentres[0]?.id || '' });
    setEditId(null);
    setModalOpen(true);
  }

  function openEdit(a: StaffAccident) {
    setForm({
      centre_id: a.centre_id,
      staff_name: a.staff_name,
      staff_dob: a.staff_dob || '',
      phone: a.phone || '',
      email: a.email || '',
      incident_date: a.incident_date,
      time_of_injury: a.time_of_injury || '',
      specific_location: a.specific_location,
      circumstances: a.circumstances,
      products_structures_involved: a.products_structures_involved || '',
      location_on_body: a.location_on_body,
      first_aid_provided: a.first_aid_provided || '',
      medical_attention: a.medical_attention,
      injury_type: a.injury_type,
      worker_comp_claim: a.worker_comp_claim,
      return_to_work_date: a.return_to_work_date || '',
      status: a.status,
    });
    setEditId(a.id);
    setModalOpen(true);
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await fetch('/api/staff-accidents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id, status }),
      });
      setAccidents(prev => prev.map(a => a.id === id ? { ...a, status } : a));
      showToast('Status updated');
    } catch (e) { console.error(e); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this accident record? This cannot be undone.')) return;
    try {
      await fetch('/api/staff-accidents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      setAccidents(prev => prev.filter(a => a.id !== id));
      showToast('Record deleted');
    } catch (e) { console.error(e); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.staff_name || !form.centre_id) return;
    
    try {
      const payload = {
        ...form,
        staff_dob: form.staff_dob || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        products_structures_involved: form.products_structures_involved || undefined,
        return_to_work_date: form.return_to_work_date || undefined,
      };
      if (editId) {
        await fetch('/api/staff-accidents', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', id: editId, ...payload }),
        });
        showToast('Record updated');
      } else {
        await fetch('/api/staff-accidents', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create', ...payload }),
        });
        showToast('Accident recorded');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      
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
            <h1 className="text-xl font-bold text-gray-900">Staff Accidents</h1>
            <p className="text-sm text-gray-500 mt-0.5">Workplace injury and accident records</p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ backgroundColor: B.green }}
          >
            +
            Record Accident
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Records', value: accidents.length, icon: "⚠️", color: 'text-gray-600', bg: 'bg-gray-50' },
            { label: 'Open Cases', value: openCases, icon: "⚠️", color: openCases > 0 ? 'text-orange-600' : 'text-green-600', bg: openCases > 0 ? 'bg-orange-50' : 'bg-green-50' },
            { label: 'Medical Attention', value: medicalAttentionCases, icon: "🩺", color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: "Workers' Comp", value: workerCompCases, icon: "⚠️", color: workerCompCases > 0 ? 'text-red-600' : 'text-green-600', bg: workerCompCases > 0 ? 'bg-red-50' : 'bg-green-50' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                <span className={`text-xl ${s.color}`}>{s.icon}</span>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{s.value}</div>
                <div className="text-xs text-gray-500 font-medium">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filter */}
        {isMultiCentre && (
          <div className="flex items-center gap-3">
            <select
              value={selectedCentre}
              onChange={e => setSelectedCentre(e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#4a7a3a]/20"
            >
              <option value="all">All Centres</option>
              {accessibleCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Injury Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Body Location</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Medical</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">W/C</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(accident => {
                    const isExpanded = expanded === accident.id;
                    return (
                      <React.Fragment key={accident.id}>
                        <tr
                          className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => setExpanded(isExpanded ? null : accident.id)}
                        >
                          <td className="px-4 py-3 text-gray-600">
                            <div>{new Date(accident.incident_date).toLocaleDateString('en-AU')}</div>
                            {accident.time_of_injury && <div className="text-xs text-gray-400">{accident.time_of_injury}</div>}
                          </td>
                          {isMultiCentre && <td className="px-4 py-3 text-gray-600">{centreName(accident.centre_id)}</td>}
                          <td className="px-4 py-3 font-medium text-gray-900">{accident.staff_name}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${INJURY_COLORS[accident.injury_type] || 'bg-gray-100 text-gray-700'}`}>
                              {accident.injury_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{accident.location_on_body}</td>
                          <td className="px-4 py-3">
                            {accident.medical_attention
                              ? <span className="text-orange-500">✓</span>
                              : <span className="text-gray-300">✗</span>}
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <InlineStatusSelect
                              value={accident.status}
                              options={STATUS_OPTIONS}
                              onChange={v => handleStatusChange(accident.id, v)}
                              getColor={s => STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'}
                            />
                          </td>
                          <td className="px-4 py-3">
                            {accident.worker_comp_claim
                              ? <span className="text-red-500">✓</span>
                              : <span className="text-gray-300">✗</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={e => { e.stopPropagation(); openEdit(accident); }}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-[#4a7a3a] hover:bg-[#4a7a3a]/10 transition-colors"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); handleDelete(accident.id); }}
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
                                  <div className="font-semibold text-gray-700 mb-1">Location</div>
                                  <p className="text-gray-600">{accident.specific_location}</p>
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-700 mb-1">Circumstances</div>
                                  <p className="text-gray-600">{accident.circumstances}</p>
                                </div>
                                {accident.first_aid_provided && (
                                  <div>
                                    <div className="font-semibold text-gray-700 mb-1">First Aid Provided</div>
                                    <p className="text-gray-600">{accident.first_aid_provided}</p>
                                  </div>
                                )}
                                {accident.products_structures_involved && (
                                  <div>
                                    <div className="font-semibold text-gray-700 mb-1">Products/Structures Involved</div>
                                    <p className="text-gray-600">{accident.products_structures_involved}</p>
                                  </div>
                                )}
                                {accident.return_to_work_date && (
                                  <div>
                                    <div className="font-semibold text-gray-700 mb-1">Return to Work</div>
                                    <p className="text-gray-600">{new Date(accident.return_to_work_date).toLocaleDateString('en-AU')}</p>
                                  </div>
                                )}
                                {(accident.phone || accident.email) && (
                                  <div>
                                    <div className="font-semibold text-gray-700 mb-1">Contact</div>
                                    {accident.phone && <p className="text-gray-600">{accident.phone}</p>}
                                    {accident.email && <p className="text-gray-600">{accident.email}</p>}
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
                  <span className="text-4xl block mb-2">⚠️</span>
                  <p className="text-sm text-gray-400">No accident records found</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <AccidentModal
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


