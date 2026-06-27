import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { StaffMember } from '../types';
import { CENTRES, STAFFING_BOARD_IDS } from '../config';
import { getUser } from '../auth';
import {
  QUALIFICATION_OPTIONS, EMPLOYMENT_STATUS_OPTIONS, POSITION_OPTIONS,
  POSITION_CATEGORY_OPTIONS, RATIO_50_OPTIONS, ACTION_OPTIONS,
  findOption, type StatusOption,
} from '../staffingConfig';

// ── Types ──────────────────────────────────────────────────────────────────

interface StaffGroup {
  id: string; title: string; color: string; isActive: boolean; staff: StaffMember[];
}
interface BoardData {
  centreId: string; groups: StaffGroup[];
  editableColumns: { id: string; label: string; type: string; options?: string[] }[];
  fetchedAt: string;
}
interface CentreSummary {
  centreId: string; centreName: string; status: 'loading' | 'ok' | 'error'; error?: string;
  totalActive: number; rooms: number; floats: number; casuals: number;
  expiredCount: number; warningCount: number; byQual: Record<string, number>;
}

// ── Brand ──────────────────────────────────────────────────────────────────
const B = {
  green: '#2d5c18', greenLight: '#5a9228', bg: '#F5FAF3',
  border: '#E2F1DA', white: '#ffffff', text: '#050505', muted: '#596570',
};

// ── HR Sub-Navigation ─────────────────────────────────────────────────────
function HrSubNav() {
  const location = useLocation();
  const tabs = [
    { to: '/staffing', label: '👥 Staffing Structure' },
    { to: '/staff-accidents', label: '🩹 Accidents' },
    { to: '/staff-issues', label: '⚠️ HR Issues' },
  ];
  return (
    <div className="flex items-center gap-1">
      {tabs.map(t => (
        <Link
          key={t.to}
          to={t.to}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          style={{
            backgroundColor: location.pathname === t.to ? B.green : 'transparent',
            color: location.pathname === t.to ? '#fff' : B.muted,
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

// ── Open Positions ─────────────────────────────────────────────────────────
interface OpenPosition {
  id: string;
  centre_id: string;
  room_id?: string;
  title: string;
  qualification_required: string;
  status: string;
  notes?: string;
}

const POSITION_STATUS_COLORS: Record<string, string> = {
  'Open': 'bg-emerald-100 text-emerald-700',
  'On Hold': 'bg-yellow-100 text-yellow-700',
  'Offered': 'bg-blue-100 text-blue-700',
  'Filled': 'bg-gray-100 text-gray-500',
};

function OpenPositionsSection({ centreId, rooms }: { centreId: string; rooms: { id: string; title: string }[] }) {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editPos, setEditPos] = useState<OpenPosition | null>(null);
  const [form, setForm] = useState({ title: '', qualification_required: '', room_id: '', status: 'Open', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/open-positions?centreId=${centreId}`);
      if (r.ok) setPositions(await r.json());
    } catch { /* table may not exist yet */ }
  }, [centreId]);

  useEffect(() => { load(); }, [load]);

  const openCount = positions.filter(p => p.status === 'Open' || p.status === 'On Hold').length;

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editPos) {
        await fetch('/api/open-positions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', id: editPos.id, ...form }),
        });
      } else {
        await fetch('/api/open-positions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create', centre_id: centreId, ...form }),
        });
      }
      setAdding(false); setEditPos(null); setForm({ title: '', qualification_required: '', room_id: '', status: 'Open', notes: '' });
      load();
    } finally { setSaving(false); }
  }

  async function handleStatusChange(id: string, status: string) {
    await fetch('/api/open-positions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, status }),
    });
    setPositions(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  }

  async function handleDelete(id: string) {
    await fetch('/api/open-positions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    setPositions(prev => prev.filter(p => p.id !== id));
  }

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ borderColor: '#d1fae5', backgroundColor: B.white }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:opacity-90 transition-opacity"
      >
        <span className="text-base">{collapsed ? '▶' : '▼'}</span>
        <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
          <span className="text-base">📋</span>
        </div>
        <div className="flex-1 flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">Open Positions</span>
          {openCount > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">{openCount} active</span>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); setAdding(true); setEditPos(null); setForm({ title: '', qualification_required: '', room_id: '', status: 'Open', notes: '' }); }}
          className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          + Add Position
        </button>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5">
          {(adding || editPos) && (
            <div className="mb-4 p-4 rounded-xl border" style={{ borderColor: B.border, backgroundColor: B.bg }}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Position Title *</label>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}
                    placeholder="e.g. Diploma Educator, Room Leader" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Qualification Required</label>
                  <input value={form.qualification_required} onChange={e => setForm(f => ({ ...f, qualification_required: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}
                    placeholder="e.g. Diploma ECE" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Room (optional)</label>
                  <select value={form.room_id} onChange={e => setForm(f => ({ ...f, room_id: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}>
                    <option value="">Any room</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}>
                    <option>Open</option><option>On Hold</option><option>Offered</option><option>Filled</option>
                  </select>
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" style={{ borderColor: B.border }} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setAdding(false); setEditPos(null); }} className="px-3 py-1.5 text-sm border rounded-lg hover:opacity-80" style={{ borderColor: B.border, color: B.muted }}>Cancel</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-sm font-semibold text-white rounded-lg hover:opacity-90" style={{ backgroundColor: saving ? '#9ca3af' : B.green }}>{saving ? 'Saving...' : editPos ? 'Update' : 'Add Position'}</button>
              </div>
            </div>
          )}
          {positions.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No open positions recorded</p>
          ) : (
            <div className="space-y-2">
              {positions.map(pos => {
                const room = rooms.find(r => r.id === pos.room_id);
                return (
                  <div key={pos.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${pos.status === 'Filled' ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{pos.title}</span>
                        {room && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{room.title}</span>}
                      </div>
                      {pos.qualification_required && <div className="text-xs text-gray-500 mt-0.5">{pos.qualification_required}</div>}
                      {pos.notes && <div className="text-xs text-gray-400 italic mt-0.5">{pos.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={pos.status}
                        onChange={e => handleStatusChange(pos.id, e.target.value)}
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer ${POSITION_STATUS_COLORS[pos.status] || 'bg-gray-100 text-gray-500'}`}
                      >
                        {['Open', 'On Hold', 'Offered', 'Filled'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => { setEditPos(pos); setAdding(false); setForm({ title: pos.title, qualification_required: pos.qualification_required, room_id: pos.room_id || '', status: pos.status, notes: pos.notes || '' }); }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                        ✏️
                      </button>
                      <button onClick={() => handleDelete(pos.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso); if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}
function complianceLevel(days: number | null) {
  if (days === null) return 'missing';
  if (days < 0) return 'expired'; if (days <= 90) return 'warning'; return 'ok';
}
function worstCompliance(s: StaffMember) {
  const c = s.compliance;
  const lvls = [c.wwccExpiry,c.firstAidExpiry,c.cprExpiry,c.anaphylaxisExpiry,c.childProtectionRenewal].map(d => complianceLevel(daysUntil(d)));
  if (lvls.includes('expired')) return 'expired';
  if (lvls.includes('warning')) return 'warning';
  if (lvls.every(l => l === 'missing')) return 'missing'; return 'ok';
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Status Badge (clickable) ───────────────────────────────────────────────
function StatusBadge({ value, options, onChange, size = 'sm' }: {
  value?: string | null; options: StatusOption[]; onChange?: (v: string) => void; size?: 'xs' | 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opt = findOption(options, value);
  const bg = opt?.color || '#f1f5f9'; const col = opt?.border || '#64748b';
  const label = opt?.label || value || 'Not set';
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-xs' : size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!onChange) return (
    <span className={`inline-block rounded-full font-semibold leading-tight ${pad}`} style={{ backgroundColor: bg, color: col }}>{label}</span>
  );

  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 rounded-full font-semibold leading-tight cursor-pointer hover:opacity-80 transition-opacity ${pad}`}
        style={{ backgroundColor: bg, color: col }}>
        {label}
        <span style={{ fontSize: 8, opacity: 0.7 }}>v</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white rounded-xl shadow-xl border overflow-hidden min-w-max"
          style={{ borderColor: B.border }}>
          {options.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:opacity-80 transition-opacity text-left"
              style={{ backgroundColor: o.value === value ? o.color + '44' : 'transparent' }}>
              <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: o.color, border: `1px solid ${o.border}` }} />
              <span className="font-semibold" style={{ color: o.border }}>{o.label || o.value || 'None'}</span>
              {o.value === value && <span className="ml-auto text-gray-400">c</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Compliance dot ─────────────────────────────────────────────────────────
function ComplianceDot({ staff }: { staff: StaffMember }) {
  const level = worstCompliance(staff);
  const c: Record<string, string> = { expired: '#ef4444', warning: '#f59e0b', ok: '#22c55e' };
  if (level === 'missing') return null;
  return <span title={`Compliance ${level}`} style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', backgroundColor: c[level]||'#e5e7eb', flexShrink:0 }} />;
}

// ── Document preview ───────────────────────────────────────────────────────
function DocPreviewModal({ doc, onClose }: { doc: { label: string; url: string }; onClose: () => void }) {
  const isPdf = doc.url.includes('.pdf') || doc.url.includes('staffing-file');
  const isImage = /\.(jpg|jpeg|png|gif|webp)/i.test(doc.url);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col" style={{ width:'90vw', maxWidth:900, height:'90vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: B.border }}>
          <span className="font-semibold text-sm" style={{ color: B.text }}>{doc.label}</span>
          <div className="flex gap-2">
            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-80" style={{ borderColor: B.border, color: B.muted }}>Open in new tab</a>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 font-bold">x</button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden rounded-b-2xl">
          {(isPdf || (!isImage)) && <iframe src={doc.url} className="w-full h-full border-0" title={doc.label} />}
          {isImage && !isPdf && <div className="w-full h-full flex items-center justify-center bg-gray-50 p-4"><img src={doc.url} alt={doc.label} className="max-w-full max-h-full object-contain rounded-lg" /></div>}
        </div>
      </div>
    </div>
  );
}

// ── Staff Card ─────────────────────────────────────────────────────────────
function StaffCard({ staff, centreId, groups, onClose, onRefresh }: {
  staff: StaffMember; centreId: string; groups: StaffGroup[];
  onClose: () => void; onRefresh: () => void;
}) {
  const [previewDoc, setPreviewDoc] = useState<{ label: string; url: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [localStaff, setLocalStaff] = useState<StaffMember>(staff);

  async function updateField(fieldId: string, value: string) {
    setSaving(fieldId);
    try {
      await fetch(`/api/staffing-structure?centreId=${centreId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_staff', staffId: localStaff.id || localStaff.mondayId, fields: { [fieldId]: value || null } }),
      });
      setLocalStaff(prev => ({ ...prev, [fieldId === 'employment_status' ? 'employmentStatus' : fieldId === 'position_category' ? 'positionCategory' : fieldId === 'ratio_50' ? 'ratio50' : fieldId]: value }));
    } finally { setSaving(null); }
  }

  async function moveToRoom(groupId: string) {
    setSaving('group');
    try {
      await fetch(`/api/staffing-structure?centreId=${centreId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move_staff', staffId: localStaff.id || localStaff.mondayId, groupId, centreId }),
      });
      onRefresh(); onClose();
    } finally { setSaving(null); }
  }

  async function deleteStaff() {
    if (!confirm(`Delete ${localStaff.name}? This cannot be undone.`)) return;
    await fetch(`/api/staffing-structure?centreId=${centreId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_staff', staffId: localStaff.id || localStaff.mondayId }),
    });
    onRefresh(); onClose();
  }

  const comp = localStaff.compliance;
  const compItems = [
    { label: 'WWCC',             expiry: comp.wwccExpiry,            code: comp.wwccNumber },
    { label: 'First Aid',        expiry: comp.firstAidExpiry,        code: comp.firstAidCode },
    { label: 'CPR',              expiry: comp.cprExpiry,             code: comp.cprCode },
    { label: 'Anaphylaxis',      expiry: comp.anaphylaxisExpiry,     code: comp.anaphylaxisCode },
    { label: 'Child Protection', expiry: comp.childProtectionRenewal },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl flex flex-col"
          style={{ borderLeft: `1px solid ${B.border}` }} onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="sticky top-0 z-10 bg-white px-5 pt-4 pb-3 border-b" style={{ borderColor: B.border }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold" style={{ color: B.text }}>{localStaff.name}</h2>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <StatusBadge value={localStaff.employmentStatus || 'Active'} options={EMPLOYMENT_STATUS_OPTIONS}
                    onChange={v => updateField('employment_status', v)} />
                  <StatusBadge value={localStaff.qualification} options={QUALIFICATION_OPTIONS}
                    onChange={v => updateField('qualification', v)} />
                  <StatusBadge value={localStaff.position} options={POSITION_OPTIONS}
                    onChange={v => updateField('position', v)} />
                  {localStaff.positionCategory && (
                    <StatusBadge value={localStaff.positionCategory} options={POSITION_CATEGORY_OPTIONS}
                      onChange={v => updateField('position_category', v)} />
                  )}
                  {saving && <span className="text-xs animate-pulse" style={{ color: B.muted }}>Saving...</span>}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={deleteStaff} className="px-2 py-1.5 rounded-xl text-xs font-semibold border hover:opacity-80" style={{ borderColor: '#fca5a5', color: '#ef4444' }}>Delete</button>
                <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 font-bold">x</button>
              </div>
            </div>
          </div>

          <div className="flex-1 px-5 py-4 space-y-5">

            {/* Move to room */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: B.muted }}>Room / Group</h3>
              <select onChange={e => { if (e.target.value) moveToRoom(e.target.value); }}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}
                defaultValue="">
                <option value="">Move to room...</option>
                {groups.filter(g => g.isActive).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </section>

            {/* Additional status fields */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: B.muted }}>Status Fields</h3>
              <div className="flex flex-wrap gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: B.muted }}>50% Ratio</span>
                  <StatusBadge value={localStaff.ratio50} options={RATIO_50_OPTIONS} onChange={v => updateField('ratio_50', v)} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: B.muted }}>Action</span>
                  <StatusBadge value={localStaff.action} options={ACTION_OPTIONS} onChange={v => updateField('action', v)} />
                </div>
                {!localStaff.positionCategory && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs" style={{ color: B.muted }}>Category</span>
                    <StatusBadge value={localStaff.positionCategory} options={POSITION_CATEGORY_OPTIONS} onChange={v => updateField('position_category', v)} />
                  </div>
                )}
              </div>
            </section>

            {/* Employment details */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: B.muted }}>Employment</h3>
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: B.border }}>
                {[
                  { label: 'Start Date', value: fmtDate(localStaff.startDate) },
                  { label: 'End Date', value: localStaff.endDate || '—' },
                  { label: 'Days / Hours', value: localStaff.daysPerWeek || '—' },
                  { label: 'Min Hours/wk', value: localStaff.minHoursPerWeek || '—' },
                  { label: 'Probation End', value: fmtDate(localStaff.probationaryDate) },
                  { label: 'DOB', value: fmtDate(localStaff.dob) },
                ].filter(r => r.value && r.value !== '—').map((row, i, arr) => (
                  <div key={row.label} className={`flex items-center justify-between px-3 py-2 text-sm ${i < arr.length-1 ? 'border-b' : ''}`} style={{ borderColor: B.border }}>
                    <span style={{ color: B.muted }}>{row.label}</span>
                    <span className="font-medium" style={{ color: B.text }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Contact */}
            {(localStaff.email || localStaff.mobile) && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: B.muted }}>Contact</h3>
                <div className="space-y-1">
                  {localStaff.email  && <a href={`mailto:${localStaff.email}`}  className="block text-sm hover:underline" style={{ color: B.greenLight }}>{localStaff.email}</a>}
                  {localStaff.mobile && <a href={`tel:0${localStaff.mobile}`} className="block text-sm hover:underline" style={{ color: B.greenLight }}>0{localStaff.mobile}</a>}
                </div>
              </section>
            )}

            {/* Compliance */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: B.muted }}>Compliance</h3>
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: B.border }}>
                {compItems.map((item, i) => {
                  const days = daysUntil(item.expiry);
                  const level = complianceLevel(days);
                  const dotColor = level === 'expired' ? '#ef4444' : level === 'warning' ? '#f59e0b' : level === 'ok' ? '#22c55e' : '#d1d5db';
                  const dateStr = item.expiry ? fmtDate(item.expiry) : null;
                  const dayStr = days !== null ? (days < 0 ? `Expired ${Math.abs(days)}d ago` : days <= 90 ? `${days}d remaining` : '') : '';
                  return (
                    <div key={item.label} className={`flex items-start gap-3 px-3 py-2.5 text-sm ${i < compItems.length-1 ? 'border-b' : ''}`}
                      style={{ borderColor: B.border, backgroundColor: level==='expired'?'#fff5f5':level==='warning'?'#fffbeb':B.white }}>
                      <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', backgroundColor:dotColor, flexShrink:0, marginTop:4 }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-xs" style={{ color: B.text }}>{item.label}</div>
                        {item.code && <div className="text-xs" style={{ color: B.muted }}>{item.code}</div>}
                        {dateStr ? <div className="text-xs font-medium" style={{ color: level==='expired'?'#991b1b':level==='warning'?'#92400e':B.green }}>{dateStr}{dayStr ? ` · ${dayStr}` : ''}</div>
                          : <div className="text-xs text-gray-400">Not recorded</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Documents */}
            {(localStaff.docs.length > 0 || localStaff.certDocs.length > 0) && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: B.muted }}>Documents ({localStaff.docs.length + localStaff.certDocs.length})</h3>
                <div className="space-y-1.5">
                  {[...localStaff.docs, ...localStaff.certDocs].map((doc, i) => (
                    <button key={i} onClick={() => setPreviewDoc(doc)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border text-left hover:opacity-80"
                      style={{ borderColor: B.border, backgroundColor: B.bg }}>
                      <span className="flex-1 truncate" style={{ color: B.text }}>{doc.label}</span>
                      <span style={{ color: B.muted }}>Preview</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
      {previewDoc && <DocPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </>
  );
}

// ── Create Staff Modal ─────────────────────────────────────────────────────
function CreateStaffModal({ centreId, groups, onSave, onClose }: {
  centreId: string; groups: StaffGroup[];
  onSave: () => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(groups.filter(g=>g.isActive)[0]?.id || '');
  const [qual, setQual] = useState('');
  const [pos, setPos] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('Active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/staffing-structure?centreId=${centreId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_staff', centreId, groupId, name: name.trim(), qualification: qual, position: pos, positionCategory: cat, employment_status: status }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      onSave(); onClose();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-2xl shadow-2xl" style={{ width:'100%', maxWidth:480 }} onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: B.border }}>
          <h2 className="font-bold" style={{ color: B.text }}>Add Staff Member</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 font-bold">x</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Name *</label>
            <input autoFocus value={name} onChange={e=>setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Room</label>
            <select value={groupId} onChange={e=>setGroupId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}>
              {groups.filter(g=>g.isActive).map(g=><option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Employment Status</label>
              <select value={status} onChange={e=>setStatus(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}>
                {EMPLOYMENT_STATUS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Qualification</label>
              <select value={qual} onChange={e=>setQual(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}>
                <option value="">Select...</option>
                {QUALIFICATION_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Position</label>
              <select value={pos} onChange={e=>setPos(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}>
                <option value="">Select...</option>
                {POSITION_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: B.muted }}>Category</label>
              <select value={cat} onChange={e=>setCat(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor: B.border }}>
                <option value="">Select...</option>
                {POSITION_CATEGORY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor:'#fee2e2', color:'#991b1b' }}>{error}</div>}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: B.border }}>
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border hover:opacity-80" style={{ borderColor: B.border, color: B.muted }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: saving?'#9ca3af':B.green }}>
            {saving?'Adding...':'Add Staff'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Room Group Card ────────────────────────────────────────────────────────
function RoomGroup({ group, centreId, onSelect, onRoomUpdated, onDrop }: {
  group: StaffGroup; centreId: string; onSelect: (s: StaffMember) => void; onRoomUpdated: () => void;
  onDrop: (staffId: string, fromGroupId: string, toGroupId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(group.title);
  const [saving, setSaving] = useState(false);

  async function saveTitle() {
    if (!title.trim() || title === group.title) { setEditing(false); setTitle(group.title); return; }
    setSaving(true);
    await fetch(`/api/staffing-structure?centreId=${centreId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_room', centreId, groupId: group.id, title: title.trim() }),
    });
    setSaving(false); setEditing(false); onRoomUpdated();
  }

  async function deleteRoom() {
    if (group.staff.length > 0) { alert(`Move or delete all ${group.staff.length} staff first.`); return; }
    if (!confirm(`Delete room "${group.title}"?`)) return;
    await fetch(`/api/staffing-structure?centreId=${centreId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_room', centreId, groupId: group.id }),
    });
    onRoomUpdated();
  }

  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className="rounded-2xl overflow-hidden border"
      style={{ borderColor: dragOver ? B.green : B.border, backgroundColor: B.white, transition: 'border-color 0.15s' }}
      onDragOver={e=>{ e.preventDefault(); setDragOver(true); }}
      onDragLeave={()=>setDragOver(false)}
      onDrop={e=>{
        e.preventDefault(); setDragOver(false);
        const staffId = e.dataTransfer.getData('staffId');
        const fromGroupId = e.dataTransfer.getData('fromGroupId');
        if (staffId && fromGroupId && fromGroupId !== group.id) onDrop(staffId, fromGroupId, group.id);
      }}
    >
      <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: group.color+'22', borderBottom: `1px solid ${B.border}` }}>
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
        {editing ? (
          <input autoFocus value={title} onChange={e=>setTitle(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') saveTitle(); if(e.key==='Escape'){setEditing(false);setTitle(group.title);} }}
            onBlur={saveTitle}
            className="flex-1 text-sm font-bold bg-transparent border-b focus:outline-none" style={{ color: B.text, borderColor: B.green }} />
        ) : (
          <h3 className="font-bold text-sm flex-1 truncate" style={{ color: B.text }}>{group.title}</h3>
        )}
        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0" style={{ backgroundColor: B.white, color: B.muted, border: `1px solid ${B.border}` }}>{group.staff.length}</span>
        {!editing && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={()=>setEditing(true)} className="text-xs px-1.5 py-0.5 rounded hover:opacity-80" style={{ color: B.muted }}>rename</button>
            {group.staff.length === 0 && <button onClick={deleteRoom} className="text-xs px-1.5 py-0.5 rounded hover:opacity-80" style={{ color:'#ef4444' }}>delete</button>}
          </div>
        )}
        {saving && <span className="text-xs animate-pulse" style={{ color: B.muted }}>...</span>}
      </div>
      <div className="divide-y divide-gray-100">
        {group.staff.length === 0
          ? <div className="px-4 py-3 text-xs" style={{ color: B.muted }}>No staff.</div>
          : group.staff.map(s => (
            <button key={s.mondayId || s.id} onClick={()=>onSelect(s)}
              draggable
              onDragStart={e=>{ e.dataTransfer.setData('staffId', s.id || s.mondayId || ''); e.dataTransfer.setData('fromGroupId', group.id); e.dataTransfer.effectAllowed='move'; }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-80 text-left group cursor-grab active:cursor-grabbing">
              <div className="flex-shrink-0">
                <StatusBadge value={s.qualification} options={QUALIFICATION_OPTIONS} size="xs" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate group-hover:underline" style={{ color: B.text }}>{s.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {s.employmentStatus && s.employmentStatus !== 'Active' && (
                    <StatusBadge value={s.employmentStatus} options={EMPLOYMENT_STATUS_OPTIONS} size="xs" />
                  )}
                  {s.position && <span className="text-xs truncate" style={{ color: B.muted }}>{s.position}</span>}
                </div>
              </div>
              <ComplianceDot staff={s} />
              <span className="text-gray-300 group-hover:text-gray-500">›</span>
            </button>
          ))
        }
      </div>
    </div>
  );
}

// ── Dashboard Stats ────────────────────────────────────────────────────────
function DashboardStats({ groups }: { groups: StaffGroup[] }) {
  const active = groups.filter(g=>g.isActive).flatMap(g=>g.staff);
  const total = active.length;
  const byQual: Record<string,number> = {};
  let expired=0, warning=0;
  for (const s of active) {
    const q = s.qualification||'Unknown'; byQual[q]=(byQual[q]||0)+1;
    const l = worstCompliance(s); if(l==='expired') expired++; else if(l==='warning') warning++;
  }
  const byStatus: Record<string,number> = {};
  for (const s of active) { const st = s.employmentStatus||'Active'; byStatus[st]=(byStatus[st]||0)+1; }
  const rooms   = groups.filter(g=>g.isActive && !/(float|casual|hero|mat leave)/i.test(g.title)).length;
  const floats  = groups.filter(g=>g.isActive && /float/i.test(g.title)).flatMap(g=>g.staff).length;
  const casuals = groups.filter(g=>g.isActive && /casual/i.test(g.title)).flatMap(g=>g.staff).length;

  function Card({ value, label, bg, accent }: { value: string|number; label: string; bg: string; accent?: string }) {
    return (
      <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ backgroundColor: bg, border: `1px solid ${B.border}` }}>
        <div className="text-2xl font-bold" style={{ color: accent||B.text }}>{value}</div>
        <div className="text-xs font-medium" style={{ color: B.muted }}>{label}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card value={total}   label="Active Staff"       bg={B.white} accent={B.green} />
        <Card value={rooms}   label="Rooms"              bg={B.bg} />
        <Card value={expired} label="Expired Compliance" bg={expired>0?'#fee2e2':B.bg} accent={expired>0?'#991b1b':undefined} />
        <Card value={warning} label="Expiring <= 90d"    bg={warning>0?'#fef9c3':B.bg} accent={warning>0?'#92400e':undefined} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card value={floats}  label="Float Staff"        bg={B.bg} />
        <Card value={casuals} label="Internal Casuals"   bg={B.bg} />
        <div className="rounded-2xl p-4" style={{ backgroundColor: B.white, border: `1px solid ${B.border}` }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: B.muted }}>By Qualification</div>
          <div className="flex flex-wrap gap-1">
            {QUALIFICATION_OPTIONS.filter(o=>byQual[o.value]).map(o=>(
              <div key={o.value} className="flex items-center gap-1">
                <StatusBadge value={o.value} options={QUALIFICATION_OPTIONS} size="xs" />
                <span className="text-xs font-bold" style={{ color: B.text }}>{byQual[o.value]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── All Centres view ───────────────────────────────────────────────────────
function AllCentresView({ centreIds, onSelectCentre }: { centreIds: string[], onSelectCentre: (id: string) => void }) {
  const [summaries, setSummaries] = useState<CentreSummary[]>(() =>
    centreIds.map(id => ({ centreId:id, centreName: CENTRES.find(c=>c.id===id)?.name??id, status:'loading' as const, totalActive:0,rooms:0,floats:0,casuals:0,expiredCount:0,warningCount:0,byQual:{} }))
  );

  useEffect(() => {
    centreIds.forEach(id => {
      fetch(`/api/staffing-structure?centreId=${id}`)
        .then(r=>r.ok?r.json():r.json().then((j:{error?:string})=>{throw new Error(j.error||'Error');}))
        .then((data: BoardData) => {
          const ag = data.groups.filter(g=>g.isActive);
          const all = ag.flatMap(g=>g.staff);
          const byQual: Record<string,number>={};
          let expiredCount=0,warningCount=0;
          for(const s of all){const q=s.qualification||'Unknown';byQual[q]=(byQual[q]||0)+1;const l=worstCompliance(s);if(l==='expired')expiredCount++;else if(l==='warning')warningCount++;}
          setSummaries(prev=>prev.map(s=>s.centreId===id?{centreId:id,centreName:CENTRES.find(c=>c.id===id)?.name??id,status:'ok',totalActive:all.length,rooms:ag.filter(g=>!/(float|casual|hero|mat leave)/i.test(g.title)).length,floats:ag.filter(g=>/float/i.test(g.title)).flatMap(g=>g.staff).length,casuals:ag.filter(g=>/casual/i.test(g.title)).flatMap(g=>g.staff).length,expiredCount,warningCount,byQual}:s));
        })
        .catch((e:Error)=>setSummaries(prev=>prev.map(s=>s.centreId===id?{...s,status:'error',error:e.message}:s)));
    });
  }, [centreIds.join(',')]);

  const loaded = summaries.filter(s=>s.status==='ok');
  const tot = { staff:loaded.reduce((n,s)=>n+s.totalActive,0), expired:loaded.reduce((n,s)=>n+s.expiredCount,0), warning:loaded.reduce((n,s)=>n+s.warningCount,0), floats:loaded.reduce((n,s)=>n+s.floats,0), casuals:loaded.reduce((n,s)=>n+s.casuals,0) };
  const loading = summaries.filter(s=>s.status==='loading').length;

  return (
    <div className="space-y-5">
      {loading>0 && <div className="text-xs px-3 py-2 rounded-xl animate-pulse" style={{ backgroundColor:B.bg,color:B.muted }}>Loading {loading}/{centreIds.length} centres...</div>}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: B.muted }}>Network Total</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            {v:loaded.length,l:'Centres Loaded',accent:B.green},
            {v:tot.staff,l:'Total Active Staff',accent:B.green},
            {v:tot.expired,l:'Expired Compliance',accent:tot.expired>0?'#991b1b':undefined,bg:tot.expired>0?'#fee2e2':B.bg},
            {v:tot.warning,l:'Expiring <= 90d',accent:tot.warning>0?'#92400e':undefined,bg:tot.warning>0?'#fef9c3':B.bg},
            {v:tot.floats+tot.casuals,l:'Float + Casual'},
          ].map(({v,l,accent,bg})=>(
            <div key={l} className="rounded-2xl p-4 flex flex-col gap-1" style={{ backgroundColor:bg||B.white, border:`1px solid ${B.border}` }}>
              <div className="text-2xl font-bold" style={{ color:accent||B.text }}>{v}</div>
              <div className="text-xs" style={{ color: B.muted }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: B.muted }}>By Centre</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {summaries.map(s=>(
            <div key={s.centreId} className="rounded-2xl border overflow-hidden cursor-pointer hover:shadow-md transition-shadow" style={{ borderColor:B.border, backgroundColor:B.white }} onClick={()=>onSelectCentre(s.centreId)}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor:B.border, backgroundColor:B.bg }}>
                <h3 className="font-bold text-sm" style={{ color:B.text }}>{s.centreName}</h3>
                <div className="flex gap-1">
                  {s.status==='loading' && <span className="text-xs animate-pulse" style={{ color:B.muted }}>Loading...</span>}
                  {s.expiredCount>0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor:'#fee2e2',color:'#991b1b' }}>{s.expiredCount} expired</span>}
                  {s.warningCount>0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor:'#fef9c3',color:'#92400e' }}>{s.warningCount} expiring</span>}
                </div>
              </div>
              {s.status==='ok' && (
                <div className="px-4 py-3 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-xl font-bold" style={{ color:B.green }}>{s.totalActive}</div><div className="text-xs" style={{ color:B.muted }}>Staff</div></div>
                    <div><div className="text-xl font-bold" style={{ color:B.text }}>{s.rooms}</div><div className="text-xs" style={{ color:B.muted }}>Rooms</div></div>
                    <div><div className="text-xl font-bold" style={{ color:B.text }}>{s.floats+s.casuals}</div><div className="text-xs" style={{ color:B.muted }}>Float/Cas</div></div>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1 border-t" style={{ borderColor:B.border }}>
                    {QUALIFICATION_OPTIONS.filter(o=>s.byQual[o.value]).map(o=>(
                      <div key={o.value} className="flex items-center gap-1">
                        <StatusBadge value={o.value} options={QUALIFICATION_OPTIONS} size="xs" />
                        <span className="text-xs font-bold" style={{ color:B.text }}>{s.byQual[o.value]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {s.status==='loading' && <div className="px-4 py-3 space-y-2">{[1,2].map(i=><div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor:B.border }} />)}</div>}
              {s.status==='error' && <div className="px-4 py-3 text-xs" style={{ color:'#ef4444' }}>{s.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
const ALL = '__all__';

export default function StaffingStructurePage() {
  const user = getUser();
  const accessible = useMemo(() => {
    if (!user) return [];
    if (user.role==='admin'||user.role==='ceo') return CENTRES.filter(c=>STAFFING_BOARD_IDS[c.id]);
    if (user.role==='area_manager') return CENTRES.filter(c=>STAFFING_BOARD_IDS[c.id]);
    return CENTRES.filter(c=>c.id===user.centreId&&STAFFING_BOARD_IDS[c.id]);
  }, [user]);

  const multiAccess = accessible.length > 1;
  const [centreId, setCentreId] = useState('');
  useEffect(() => { if (accessible.length>0&&!centreId) setCentreId(multiAccess?ALL:accessible[0].id); }, [accessible]);

  const [data, setData] = useState<BoardData|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [qualFilter, setQualFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showExited, setShowExited] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember|null>(null);
  const [creating, setCreating] = useState(false);

  function loadData(id: string) {
    if (id===ALL) { setData(null); return; }
    setLoading(true); setError(null); setData(null);
    fetch(`/api/staffing-structure?centreId=${id}`)
      .then(r=>r.ok?r.json():r.json().then((j:{error?:string})=>{throw new Error(j.error||r.statusText);}))
      .then((d:BoardData)=>{ setData(d); setLoading(false); })
      .catch((e:Error)=>{ setError(e.message); setLoading(false); });
  }

  useEffect(()=>{ if(centreId) loadData(centreId); },[centreId]);

  const activeGroups   = useMemo(()=>data?.groups.filter(g=>g.isActive)??[], [data]);
  const inactiveGroups = useMemo(()=>data?.groups.filter(g=>!g.isActive)??[], [data]);
  const exitedGroup    = useMemo(()=>inactiveGroups.find(g=>/exited/i.test(g.title)), [inactiveGroups]);
  const pendingGroups  = useMemo(()=>inactiveGroups.filter(g=>!(/exited/i.test(g.title))&&g.staff.length>0), [inactiveGroups]);

  const filteredGroups = useMemo(()=>
    activeGroups
      .filter(g=>roomFilter==='all'||g.id===roomFilter)
      .map(g=>({...g, staff: g.staff.filter(s=>{
        if (qualFilter!=='all'&&s.qualification!==qualFilter) return false;
        if (statusFilter!=='all'&&(s.employmentStatus||'Active')!==statusFilter) return false;
        if (search.trim()) { const q=search.toLowerCase(); if(!s.name.toLowerCase().includes(q)&&!s.position?.toLowerCase().includes(q)) return false; }
        return true;
      })}))
      .filter(g=>g.staff.length>0||roomFilter==='all'||roomFilter===g.id)
  , [activeGroups, roomFilter, qualFilter, statusFilter, search]);

  const centreName = CENTRES.find(c=>c.id===centreId)?.name??'';

  if (!user) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor:B.bg }}><p style={{ color:B.muted }}>Please log in.</p></div>;

  return (
    <div className="min-h-screen" style={{ backgroundColor:B.bg }}>
      {/* HR Sub-Navigation */}
      <div className="px-4 py-2 border-b" style={{ backgroundColor:B.white, borderColor:B.border }}>
        <div className="max-w-6xl mx-auto flex items-center gap-1">
          <HrSubNav />
        </div>
      </div>

      {/* Header */}
      <div className="sticky top-0 z-40 px-4 py-3 border-b" style={{ backgroundColor:B.white, borderColor:B.border, boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color:B.text }}>
              Staffing Structure{centreId!==ALL&&centreName?` — ${centreName}`:centreId===ALL?' — All Centres':''}
            </h1>
            {data?.fetchedAt && <p className="text-xs mt-0.5" style={{ color:B.muted }}>
              Supabase · {new Date(data.fetchedAt).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}
              {' · '}<button onClick={()=>loadData(centreId)} className="underline hover:no-underline">Refresh</button>
            </p>}
          </div>
          <div className="flex items-center gap-2">
            {centreId!==ALL && data && (
              <button onClick={()=>setCreating(true)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90"
                style={{ backgroundColor:B.green }}>+ Add Staff</button>
            )}
            {multiAccess && (
              <select value={centreId} onChange={e=>{setCentreId(e.target.value);setRoomFilter('all');setQualFilter('all');setStatusFilter('all');setSearch('');}}
                className="border rounded-xl px-3 py-2 text-sm font-medium focus:outline-none" style={{ borderColor:B.border,backgroundColor:B.white,color:B.text }}>
                <option value={ALL}>All Centres</option>
                {accessible.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {centreId===ALL && <AllCentresView centreIds={accessible.map(c=>c.id)} onSelectCentre={id=>{setCentreId(id);setRoomFilter('all');setQualFilter('all');setStatusFilter('all');setSearch('');}} />}

        {centreId!==ALL && (
          <>
            {loading && <div className="rounded-2xl p-10 text-center" style={{ backgroundColor:B.white }}><div className="text-sm animate-pulse" style={{ color:B.muted }}>Loading {centreName}...</div></div>}
            {error && <div className="rounded-2xl p-5 text-sm border" style={{ backgroundColor:'#fff5f5',borderColor:'#fca5a5',color:'#991b1b' }}><strong>Failed:</strong> {error}</div>}

            {data && !loading && (
              <>
                <DashboardStats groups={data.groups} />

                {/* Open Positions */}
                <OpenPositionsSection centreId={centreId} rooms={activeGroups.map(g => ({ id: g.id, title: g.title }))} />

                {/* Filters */}
                <div className="flex flex-wrap gap-2">
                  <input type="text" placeholder="Search staff..." value={search} onChange={e=>setSearch(e.target.value)}
                    className="border rounded-xl px-3 py-2 text-sm flex-1 min-w-40 focus:outline-none" style={{ borderColor:B.border }} />
                  <select value={roomFilter} onChange={e=>setRoomFilter(e.target.value)}
                    className="border rounded-xl px-3 py-2 text-sm focus:outline-none" style={{ borderColor:B.border }}>
                    <option value="all">All Rooms</option>
                    {activeGroups.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}
                  </select>
                  <select value={qualFilter} onChange={e=>setQualFilter(e.target.value)}
                    className="border rounded-xl px-3 py-2 text-sm focus:outline-none" style={{ borderColor:B.border }}>
                    <option value="all">All Qualifications</option>
                    {QUALIFICATION_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
                    className="border rounded-xl px-3 py-2 text-sm focus:outline-none" style={{ borderColor:B.border }}>
                    <option value="all">All Statuses</option>
                    {EMPLOYMENT_STATUS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {/* Rooms grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredGroups.map(g=>(
                    <RoomGroup key={g.id} group={g} centreId={centreId} onSelect={setSelectedStaff} onRoomUpdated={()=>loadData(centreId)}
                      onDrop={async (staffId, _fromGroupId, toGroupId)=>{
                        await fetch(`/api/staffing-structure?centreId=${centreId}`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'move_staff', staffId, groupId: toGroupId, centreId }),
                        });
                        loadData(centreId);
                      }}
                    />
                  ))}
                </div>

                {/* Add room */}
                <AddRoomButton centreId={centreId} onAdded={()=>loadData(centreId)} />

                {/* Pending */}
                {pendingGroups.length>0 && (
                  <div className="rounded-2xl overflow-hidden border" style={{ borderColor:B.border,backgroundColor:B.white }}>
                    <div className="px-4 py-3 border-b" style={{ borderColor:B.border }}>
                      <h3 className="text-sm font-bold" style={{ color:B.muted }}>Pending / Onboarding</h3>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {pendingGroups.flatMap(g=>g.staff.map(s=>(
                        <button key={s.mondayId||s.id} onClick={()=>setSelectedStaff(s)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-80 text-left">
                          <StatusBadge value={s.qualification} options={QUALIFICATION_OPTIONS} size="xs" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color:B.text }}>{s.name}</div>
                            <div className="text-xs" style={{ color:B.muted }}>{s.position||'—'}</div>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor:B.bg,color:B.muted,border:`1px solid ${B.border}` }}>{g.title}</span>
                        </button>
                      )))}
                    </div>
                  </div>
                )}

                {/* Exited */}
                {exitedGroup&&exitedGroup.staff.length>0 && (
                  <div className="rounded-2xl overflow-hidden border" style={{ borderColor:B.border,backgroundColor:B.white }}>
                    <button onClick={()=>setShowExited(o=>!o)} className="w-full flex items-center justify-between px-4 py-3 hover:opacity-80">
                      <h3 className="text-sm font-bold" style={{ color:B.muted }}>Exited Staff ({exitedGroup.staff.length})</h3>
                      <span style={{ color:B.muted }}>{showExited?'Hide':'Show'}</span>
                    </button>
                    {showExited && (
                      <div className="border-t divide-y divide-gray-100" style={{ borderColor:B.border }}>
                        {exitedGroup.staff.map(s=>(
                          <button key={s.mondayId||s.id} onClick={()=>setSelectedStaff(s)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-80 text-left opacity-60">
                            <StatusBadge value={s.qualification} options={QUALIFICATION_OPTIONS} size="xs" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate" style={{ color:B.muted }}>{s.name}</div>
                              <div className="text-xs" style={{ color:B.muted }}>{[s.position,s.endDate&&s.endDate!=='Not Applicable'?`ended ${s.endDate}`:undefined].filter(Boolean).join(' · ')}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {selectedStaff && data && (
        <StaffCard staff={selectedStaff} centreId={centreId} groups={data.groups}
          onClose={()=>setSelectedStaff(null)}
          onRefresh={()=>{ loadData(centreId); setSelectedStaff(null); }} />
      )}
      {creating && data && (
        <CreateStaffModal centreId={centreId} groups={data.groups}
          onSave={()=>loadData(centreId)} onClose={()=>setCreating(false)} />
      )}
    </div>
  );
}

// ── Add Room Button ────────────────────────────────────────────────────────
function AddRoomButton({ centreId, onAdded }: { centreId: string; onAdded: () => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!title.trim()) return;
    setSaving(true);
    await fetch(`/api/staffing-structure?centreId=${centreId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_room', centreId, title: title.trim() }),
    });
    setSaving(false); setAdding(false); setTitle(''); onAdded();
  }

  if (!adding) return (
    <button onClick={()=>setAdding(true)}
      className="w-full py-3 rounded-2xl border-2 border-dashed text-sm font-medium hover:opacity-80 transition-opacity"
      style={{ borderColor:B.border, color:B.muted }}>+ Add Room</button>
  );

  return (
    <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ borderColor:B.border,backgroundColor:B.white }}>
      <input autoFocus value={title} onChange={e=>setTitle(e.target.value)}
        onKeyDown={e=>{ if(e.key==='Enter') handleAdd(); if(e.key==='Escape'){setAdding(false);setTitle('');} }}
        placeholder="Room name..." className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ borderColor:B.border }} />
      <button onClick={handleAdd} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor:saving?'#9ca3af':B.green }}>
        {saving?'Adding...':'Add'}
      </button>
      <button onClick={()=>{setAdding(false);setTitle('');}} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80" style={{ borderColor:B.border,color:B.muted }}>Cancel</button>
    </div>
  );
}
