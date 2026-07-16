/**
 * RosterPage.tsx
 *
 * Roster builder — staging only.
 * - Week grid: staff rows × Mon–Fri columns
 * - Click any cell to set start time, end time, room/float/leave assignment
 * - Templates: create Week A / Week B etc, apply to any week
 * - Publish: locks the week so it feeds into the ratio dashboard
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfWeek, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Save, Trash2, X, Copy, CheckCircle } from 'lucide-react';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { getUser, getAllowedCentres } from '../auth';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';
const HDR          = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

// ── Types ─────────────────────────────────────────────────────────────────────

interface StaffMember {
  id: string;
  name: string;
  position: string;
  qualification: string;
  employment_status: string;
}

interface Shift {
  id?: string;
  staff_id: string;
  date?: string;           // for published shifts
  day_of_week?: number;    // for template shifts (1=Mon)
  start_time: string | null;
  end_time: string | null;
  assignment: string | null; // room name, 'Float', 'Leave', 'RDO'
  roster_week_id?: string;
  centre_id?: string;
  template_id?: string;
}

interface RosterWeek {
  id: string;
  centre_id: string;
  week_start: string;
  status: 'draft' | 'published';
  published_at?: string;
}

interface Template {
  id: string;
  centre_id: string;
  name: string;
  created_at: string;
  shifts?: Shift[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const ASSIGNMENT_OPTIONS = [
  'Float',
  'Leave',
  'RDO',
  'Office',
];

function timeOptions(): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 15) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}
const TIME_OPTIONS = timeOptions();

// ── Colours ──────────────────────────────────────────────────────────────────

const ASSIGNMENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Float':  { bg: '#e0f2fe', text: '#0369a1', border: '#7dd3fc' },
  'Leave':  { bg: '#fee2e2', text: '#dc2626', border: '#fca5a5' },
  'RDO':    { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
  'Office': { bg: '#fef9c3', text: '#a16207', border: '#fde047' },
};

function roomColor(idx: number) {
  const bgs = ['#dcfce7','#dbeafe','#ffedd5','#f3e8ff','#fce7f3','#fef9c3','#d1fae5','#e0f2fe','#fde68a','#fecaca'];
  const texts = ['#166534','#1d4ed8','#c2410c','#6d28d9','#be185d','#a16207','#065f46','#0c4a6e','#92400e','#991b1b'];
  const borders = ['#86efac','#93c5fd','#fdba74','#d8b4fe','#f9a8d4','#fde047','#6ee7b7','#7dd3fc','#fcd34d','#fca5a5'];
  return { bg: bgs[idx % bgs.length], text: texts[idx % texts.length], border: borders[idx % borders.length] };
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet(path: string) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPost(path: string, body: object) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function sbGet(table: string, query: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function sbPost(table: string, body: object) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: HDR, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function sbPatch(table: string, query: string, body: object) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: HDR, body: JSON.stringify(body) });
  return r.ok;
}

async function sbDelete(table: string, query: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: { ...HDR, Prefer: 'return=minimal' } });
  return r.ok;
}

// ── Cell editor ───────────────────────────────────────────────────────────────

interface CellEditorProps {
  shift: Shift | null;
  staffName: string;
  dayLabel: string;
  rooms: string[];
  onSave: (shift: Partial<Shift>) => void;
  onDelete: () => void;
  onClose: () => void;
}

function CellEditor({ shift, staffName, dayLabel, rooms, onSave, onDelete, onClose }: CellEditorProps) {
  const [start, setStart]      = useState(shift?.start_time ?? '07:00');
  const [end, setEnd]          = useState(shift?.end_time   ?? '15:30');
  const [assignment, setAssignment] = useState(shift?.assignment ?? rooms[0] ?? 'Float');

  const allOptions = [...rooms, ...ASSIGNMENT_OPTIONS.filter(o => !rooms.includes(o))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-bold text-sm" style={{ color: '#1a2e1a' }}>{staffName}</div>
            <div className="text-xs" style={{ color: '#596570' }}>{dayLabel}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: '#596570' }}>Assignment</label>
            <select
              value={assignment}
              onChange={e => setAssignment(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: '#c0d0c0' }}
            >
              {allOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          {assignment !== 'RDO' && assignment !== 'Leave' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: '#596570' }}>Start</label>
                  <select value={start} onChange={e => setStart(e.target.value)} className="w-full border rounded-lg px-2 py-2 text-sm" style={{ borderColor: '#c0d0c0' }}>
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: '#596570' }}>End</label>
                  <select value={end} onChange={e => setEnd(e.target.value)} className="w-full border rounded-lg px-2 py-2 text-sm" style={{ borderColor: '#c0d0c0' }}>
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => onSave({ start_time: assignment === 'RDO' || assignment === 'Leave' ? null : start, end_time: assignment === 'RDO' || assignment === 'Leave' ? null : end, assignment })}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#2d5c18' }}
          >Save</button>
          {shift?.id && (
            <button onClick={onDelete} className="px-3 py-2 rounded-xl border text-sm" style={{ borderColor: '#fca5a5', color: '#dc2626' }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Template manager ──────────────────────────────────────────────────────────

interface TemplateManagerProps {
  centreId: string;
  staff: StaffMember[];
  rooms: string[];
  weekStart: string;
  onApply: (templateId: string, templateName: string) => void;
  onClose: () => void;
}

function TemplateManager({ centreId, staff, rooms, weekStart, onApply, onClose }: TemplateManagerProps) {
  const [templates, setTemplates]         = useState<Template[]>([]);
  const [selected, setSelected]           = useState<Template | null>(null);
  const [templateShifts, setTemplateShifts] = useState<Shift[]>([]);
  const [newName, setNewName]             = useState('');
  const [creating, setCreating]           = useState(false);
  const [saving, setSaving]               = useState(false);
  const [editCell, setEditCell]           = useState<{ staffId: string; day: number } | null>(null);
  const [toast, setToast]                 = useState('');

  useEffect(() => { loadTemplates(); }, [centreId]);

  async function loadTemplates() {
    const data = await apiGet(`/api/roster-templates?centreId=${centreId}`).catch(() => []);
    setTemplates(Array.isArray(data) ? data : []);
  }

  async function selectTemplate(tpl: Template) {
    const data = await apiGet(`/api/roster-templates?centreId=${centreId}&id=${tpl.id}`).catch(() => null);
    setSelected(tpl);
    setTemplateShifts(data?.shifts || []);
  }

  async function createTemplate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const tpl = await apiPost('/api/roster-templates', { centre_id: centreId, name: newName.trim() });
      setTemplates(prev => [...prev, tpl]);
      setNewName('');
      await selectTemplate(tpl);
    } finally { setCreating(false); }
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/roster-templates?id=${id}`, { method: 'DELETE' });
    setTemplates(prev => prev.filter(t => t.id !== id));
    if (selected?.id === id) { setSelected(null); setTemplateShifts([]); }
  }

  function getShift(staffId: string, day: number): Shift | undefined {
    return templateShifts.find(s => s.staff_id === staffId && s.day_of_week === day);
  }

  async function saveCell(staffId: string, day: number, patch: Partial<Shift>) {
    if (!selected) return;
    setTemplateShifts(prev => {
      const existing = prev.find(s => s.staff_id === staffId && s.day_of_week === day);
      if (existing) return prev.map(s => s.staff_id === staffId && s.day_of_week === day ? { ...s, ...patch } : s);
      return [...prev, { staff_id: staffId, day_of_week: day, template_id: selected.id, ...patch } as Shift];
    });
    setEditCell(null);
  }

  function deleteCell(staffId: string, day: number) {
    setTemplateShifts(prev => prev.filter(s => !(s.staff_id === staffId && s.day_of_week === day)));
    setEditCell(null);
  }

  async function saveTemplate() {
    if (!selected) return;
    setSaving(true);
    try {
      await apiPost(`/api/roster-templates?id=${selected.id}&action=save-shifts`, { shifts: templateShifts });
      setToast('Template saved ✓');
      setTimeout(() => setToast(''), 2000);
    } finally { setSaving(false); }
  }

  async function applyToWeek() {
    if (!selected) return;
    if (!confirm(`Apply "${selected.name}" to week of ${weekStart}? This will overwrite existing shifts for those days.`)) return;
    setSaving(true);
    try {
      await apiPost(`/api/roster-templates?id=${selected.id}&action=apply`, { centreId, weekStart });
      onApply(selected.id, selected.name);
    } finally { setSaving(false); }
  }

  const roomColorMap = useMemo(() => {
    const m: Record<string, ReturnType<typeof roomColor>> = {};
    rooms.forEach((r, i) => { m[r] = roomColor(i); });
    return m;
  }, [rooms]);

  function cellStyle(shift?: Shift) {
    if (!shift?.assignment) return { bg: '#f9fafb', text: '#9ca3af', border: '#e5e7eb' };
    if (shift.assignment === 'RDO') return { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' };
    return ASSIGNMENT_COLORS[shift.assignment] || roomColorMap[shift.assignment] || roomColor(0);
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="flex-1 overflow-auto bg-white m-4 rounded-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#E2F1DA' }}>
          <h2 className="text-lg font-bold" style={{ color: '#1a2e1a' }}>📋 Roster Templates</h2>
          <div className="flex items-center gap-3">
            {toast && <span className="text-sm font-semibold" style={{ color: '#2d5c18' }}>{toast}</span>}
            {selected && (
              <>
                <button onClick={saveTemplate} disabled={saving} className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: '#2d5c18' }}>
                  <Save size={14} /> {saving ? 'Saving…' : 'Save Template'}
                </button>
                <button onClick={applyToWeek} disabled={saving} className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: '#5a9228' }}>
                  <Copy size={14} /> Apply to Week
                </button>
              </>
            )}
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100"><X size={18} /></button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — template list */}
          <div className="w-56 border-r flex flex-col" style={{ borderColor: '#E2F1DA' }}>
            <div className="p-3 border-b" style={{ borderColor: '#E2F1DA' }}>
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createTemplate()}
                  placeholder="Template name…"
                  className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                  style={{ borderColor: '#c0d0c0' }}
                />
                <button onClick={createTemplate} disabled={creating || !newName.trim()} className="px-2 py-1.5 rounded-lg text-white text-sm" style={{ backgroundColor: '#2d5c18' }}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {templates.length === 0 && (
                <div className="p-4 text-xs text-center" style={{ color: '#9ca3af' }}>No templates yet.<br />Create one above.</div>
              )}
              {templates.map(tpl => (
                <div
                  key={tpl.id}
                  onClick={() => selectTemplate(tpl)}
                  className="flex items-center justify-between px-3 py-2.5 cursor-pointer text-sm transition-colors"
                  style={{
                    backgroundColor: selected?.id === tpl.id ? '#f0f7eb' : 'white',
                    borderLeft: selected?.id === tpl.id ? '3px solid #2d5c18' : '3px solid transparent',
                    fontWeight: selected?.id === tpl.id ? 600 : 400,
                    color: '#1a2e1a',
                  }}
                >
                  <span className="truncate">{tpl.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); deleteTemplate(tpl.id); }}
                    className="opacity-30 hover:opacity-80 ml-1 flex-shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Main — template week grid */}
          <div className="flex-1 overflow-auto p-4">
            {!selected ? (
              <div className="flex items-center justify-center h-full text-sm" style={{ color: '#9ca3af' }}>
                Select or create a template on the left
              </div>
            ) : (
              <>
                <div className="text-sm font-semibold mb-3" style={{ color: '#596570' }}>
                  Editing: <span style={{ color: '#1a2e1a' }}>{selected.name}</span>
                  <span className="ml-2 font-normal text-xs">— click any cell to set shift</span>
                </div>

                {/* Grid */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm" style={{ minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold text-xs" style={{ color: '#596570', width: 160 }}>Staff Member</th>
                        {DAYS.map(d => (
                          <th key={d} className="text-center py-2 px-1 font-semibold text-xs" style={{ color: '#596570' }}>{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map(s => (
                        <tr key={s.id} className="border-t" style={{ borderColor: '#E2F1DA' }}>
                          <td className="py-1.5 px-3">
                            <div className="font-semibold text-xs" style={{ color: '#1a2e1a' }}>{s.name}</div>
                            <div className="text-xs" style={{ color: '#9ca3af' }}>{s.position}</div>
                          </td>
                          {DAYS.map((_, i) => {
                            const day = i + 1;
                            const shift = getShift(s.id, day);
                            const cs = cellStyle(shift);
                            return (
                              <td key={day} className="py-1 px-1">
                                <div
                                  onClick={() => setEditCell({ staffId: s.id, day })}
                                  className="rounded-lg cursor-pointer text-center py-1.5 px-1 transition-all hover:opacity-80 border"
                                  style={{ backgroundColor: cs.bg, color: cs.text, borderColor: cs.border, minHeight: 44 }}
                                >
                                  {shift?.assignment ? (
                                    <>
                                      <div className="font-semibold text-xs">{shift.assignment}</div>
                                      {shift.start_time && <div className="text-xs opacity-75">{shift.start_time.slice(0,5)}–{shift.end_time?.slice(0,5)}</div>}
                                    </>
                                  ) : (
                                    <span className="text-xs opacity-40">+</span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Cell editor modal */}
      {editCell && (
        <CellEditor
          shift={getShift(editCell.staffId, editCell.day) || null}
          staffName={staff.find(s => s.id === editCell.staffId)?.name || ''}
          dayLabel={DAYS[editCell.day - 1]}
          rooms={rooms}
          onSave={patch => saveCell(editCell.staffId, editCell.day, patch)}
          onDelete={() => deleteCell(editCell.staffId, editCell.day)}
          onClose={() => setEditCell(null)}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RosterPage() {
  const user          = getUser();
  const allowedCentres = user ? getAllowedCentres(user) : CENTRES;
  const [centreId, setCentreId]     = useState(user?.centreId || allowedCentres[0]?.id || CENTRES[0].id);
  const [weekDate, setWeekDate]     = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [staff, setStaff]           = useState<StaffMember[]>([]);
  const [shifts, setShifts]         = useState<Shift[]>([]);
  const [weekRecord, setWeekRecord] = useState<RosterWeek | null>(null);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editCell, setEditCell]     = useState<{ staffId: string; date: string } | null>(null);
  const [toast, setToast]           = useState('');

  const centre      = CENTRES.find(c => c.id === centreId);
  const rooms: string[] = useMemo(() => (centre?.rooms || []).map((r: any) => r.ownaRoomName || r.name), [centre]);
  const weekStart   = format(weekDate, 'yyyy-MM-dd');
  const weekDates   = Array.from({ length: 5 }, (_, i) => format(addDays(weekDate, i), 'yyyy-MM-dd'));

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  // ── Load staff ──────────────────────────────────────────────────────────
  useEffect(() => {
    setStaff([]);
    fetch(`/api/staff-members?centreId=${centreId}`)
      .then(r => r.json())
      .then(d => setStaff(d.staff || []))
      .catch(() => setStaff([]));
  }, [centreId]);

  // ── Load week + shifts ──────────────────────────────────────────────────
  const loadWeek = useCallback(async () => {
    setLoading(true);
    try {
      // Get or create roster_week
      let week: RosterWeek | null = null;
      const existing = await sbGet('roster_weeks', `centre_id=eq.${centreId}&week_start=eq.${weekStart}&select=*&limit=1`).catch(() => []);
      if (existing?.length) {
        week = existing[0];
      } else {
        const created = await sbPost('roster_weeks', { centre_id: centreId, week_start: weekStart, status: 'draft' }).catch(() => null);
        week = Array.isArray(created) ? created[0] : created;
      }
      setWeekRecord(week);
      if (!week) return;

      const weekShifts = await sbGet('roster_shifts', `roster_week_id=eq.${week.id}&select=*&order=date.asc,start_time.asc&limit=500`).catch(() => []);
      setShifts(weekShifts || []);
    } finally {
      setLoading(false);
    }
  }, [centreId, weekStart]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // ── Shift helpers ───────────────────────────────────────────────────────
  function getShift(staffId: string, date: string): Shift | undefined {
    return shifts.find(s => s.staff_id === staffId && s.date === date);
  }

  async function saveShift(staffId: string, date: string, patch: Partial<Shift>) {
    if (!weekRecord) return;
    setSaving(true);
    try {
      const existing = getShift(staffId, date);
      if (existing?.id) {
        await sbPatch('roster_shifts', `id=eq.${existing.id}`, { ...patch });
        setShifts(prev => prev.map(s => s.id === existing.id ? { ...s, ...patch } : s));
      } else {
        const row = { roster_week_id: weekRecord.id, centre_id: centreId, staff_id: staffId, date, ...patch };
        const created = await sbPost('roster_shifts', row);
        const newShift = Array.isArray(created) ? created[0] : created;
        setShifts(prev => [...prev, newShift]);
      }
      setEditCell(null);
    } finally { setSaving(false); }
  }

  async function deleteShift(staffId: string, date: string) {
    const existing = getShift(staffId, date);
    if (!existing?.id) return;
    setSaving(true);
    await sbDelete('roster_shifts', `id=eq.${existing.id}`);
    setShifts(prev => prev.filter(s => s.id !== existing.id));
    setEditCell(null);
    setSaving(false);
  }

  async function publishWeek() {
    if (!weekRecord) return;
    if (!confirm('Publish this roster? It will be locked and visible to the ratio dashboard.')) return;
    setSaving(true);
    await sbPatch('roster_weeks', `id=eq.${weekRecord.id}`, { status: 'published', published_at: new Date().toISOString() });
    setWeekRecord(prev => prev ? { ...prev, status: 'published' } : prev);
    showToast('Roster published ✓');
    setSaving(false);
  }

  function cellStyle(shift?: Shift) {
    if (!shift?.assignment) return { bg: '#f9fafb', text: '#9ca3af', border: '#e5e7eb' };
    if (ASSIGNMENT_COLORS[shift.assignment]) return ASSIGNMENT_COLORS[shift.assignment];
    const idx = rooms.indexOf(shift.assignment);
    return idx >= 0 ? roomColor(idx) : roomColor(0);
  }

  const isPublished = weekRecord?.status === 'published';

  return (
    <Layout>
      <div className="p-4 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#1a2e1a' }}>Roster Builder</h1>
            <p className="text-sm" style={{ color: '#596570' }}>Build and publish weekly rosters — staging only</p>
          </div>

          {/* Centre selector */}
          <select
            value={centreId}
            onChange={e => setCentreId(e.target.value)}
            className="border rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ borderColor: '#c0d0c0', color: '#1a2e1a' }}
          >
            {allowedCentres.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          {/* Week nav */}
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekDate(d => addDays(d, -7))} className="p-2 rounded-xl border hover:bg-gray-50" style={{ borderColor: '#c0d0c0' }}>
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold px-2" style={{ color: '#1a2e1a' }}>
              Week of {format(weekDate, 'dd MMM yyyy')}
            </span>
            <button onClick={() => setWeekDate(d => addDays(d, 7))} className="p-2 rounded-xl border hover:bg-gray-50" style={{ borderColor: '#c0d0c0' }}>
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {toast && <span className="text-sm font-semibold" style={{ color: '#2d5c18' }}>{toast}</span>}

            {isPublished && (
              <span className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                <CheckCircle size={12} /> Published
              </span>
            )}

            <button
              onClick={() => setShowTemplates(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border"
              style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
            >
              📋 Templates
            </button>

            {!isPublished && (
              <button
                onClick={publishWeek}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: '#2d5c18' }}
              >
                <CheckCircle size={14} /> Publish Week
              </button>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {rooms.slice(0, 6).map((r, i) => {
            const c = roomColor(i);
            return <span key={r} className="px-2 py-0.5 rounded text-xs font-semibold border" style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}>{r}</span>;
          })}
          {Object.entries(ASSIGNMENT_COLORS).map(([k, c]) => (
            <span key={k} className="px-2 py-0.5 rounded text-xs font-semibold border" style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}>{k}</span>
          ))}
        </div>

        {/* Week grid */}
        {loading ? (
          <div className="text-center py-16 text-sm" style={{ color: '#9ca3af' }}>Loading roster…</div>
        ) : (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" style={{ minWidth: 700 }}>
                <thead>
                  <tr style={{ backgroundColor: '#f0f7eb' }}>
                    <th className="text-left py-3 px-4 font-semibold text-xs sticky left-0 z-10" style={{ color: '#596570', backgroundColor: '#f0f7eb', width: 180, minWidth: 180 }}>
                      Staff Member
                    </th>
                    {weekDates.map((date, i) => (
                      <th key={date} className="text-center py-3 px-2 font-semibold text-xs" style={{ color: '#596570', minWidth: 120 }}>
                        <div>{DAYS[i]}</div>
                        <div className="font-normal" style={{ color: '#9ca3af' }}>{format(new Date(date + 'T12:00:00'), 'd MMM')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-12 text-sm" style={{ color: '#9ca3af' }}>No staff found for this centre</td></tr>
                  )}
                  {staff.map((s, si) => (
                    <tr key={s.id} className="border-t" style={{ borderColor: '#E2F1DA', backgroundColor: si % 2 === 0 ? 'white' : '#fafcf8' }}>
                      <td className="py-2 px-4 sticky left-0 z-10" style={{ backgroundColor: si % 2 === 0 ? 'white' : '#fafcf8', minWidth: 180 }}>
                        <div className="font-semibold text-xs truncate" style={{ color: '#1a2e1a', maxWidth: 160 }}>{s.name}</div>
                        <div className="text-xs truncate" style={{ color: '#9ca3af' }}>{s.position}</div>
                      </td>
                      {weekDates.map(date => {
                        const shift = getShift(s.id, date);
                        const cs = cellStyle(shift);
                        return (
                          <td key={date} className="py-2 px-1">
                            <div
                              onClick={() => !isPublished && setEditCell({ staffId: s.id, date })}
                              className="rounded-xl text-center py-2 px-1 border transition-all"
                              style={{
                                backgroundColor: cs.bg,
                                color: cs.text,
                                borderColor: cs.border,
                                minHeight: 52,
                                cursor: isPublished ? 'default' : 'pointer',
                                opacity: isPublished ? 0.85 : 1,
                              }}
                            >
                              {shift?.assignment ? (
                                <>
                                  <div className="font-semibold text-xs">{shift.assignment}</div>
                                  {shift.start_time && (
                                    <div className="text-xs opacity-75 mt-0.5">
                                      {shift.start_time.slice(0,5)}–{shift.end_time?.slice(0,5)}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs opacity-30">{isPublished ? '—' : '+'}</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Cell editor */}
      {editCell && (
        <CellEditor
          shift={getShift(editCell.staffId, editCell.date) || null}
          staffName={staff.find(s => s.id === editCell.staffId)?.name || ''}
          dayLabel={format(new Date(editCell.date + 'T12:00:00'), 'EEEE d MMM')}
          rooms={rooms}
          onSave={patch => saveShift(editCell.staffId, editCell.date, patch)}
          onDelete={() => deleteShift(editCell.staffId, editCell.date)}
          onClose={() => setEditCell(null)}
        />
      )}

      {/* Template manager */}
      {showTemplates && (
        <TemplateManager
          centreId={centreId}
          staff={staff}
          rooms={rooms}
          weekStart={weekStart}
          onApply={(_id, name) => { setShowTemplates(false); loadWeek(); showToast(`"${name}" applied ✓`); }}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </Layout>
  );
}
