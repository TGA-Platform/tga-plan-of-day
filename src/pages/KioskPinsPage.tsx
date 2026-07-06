import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, AlertCircle, CheckCircle, KeyRound } from 'lucide-react';
import Layout from '../components/Layout';
import { getUser, getAllowedCentres } from '../auth';
import { CENTRES } from '../config';

interface KioskPin {
  id: string;
  staff_id: string;
  staff_name: string;
  mobile: string;
  pin: string;
  role?: string;
}

interface StaffMember {
  id: string;
  name: string;
  mobile?: string;
  position?: string;
  roleType?: string;
}

export default function KioskPinsPage() {
  const navigate = useNavigate();
  const user = getUser();
  const allowedCentres = user ? getAllowedCentres(user) : [];
  const [centreId, setCentreId] = useState(allowedCentres[0]?.id || CENTRES[0]?.id);
  const [pins, setPins] = useState<KioskPin[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Record<string, { mobile: string; pin: string; role?: string }>>({});

  const centre = CENTRES.find(c => c.id === centreId);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadData();
  }, [centreId]);

  async function loadData() {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const [pinsRes, staffRes] = await Promise.all([
        fetch(`/api/kiosk-pins?centreId=${encodeURIComponent(centreId)}`),
        fetch(`/api/staff-members?centreId=${encodeURIComponent(centreId)}`),
      ]);
      const pinsData = await pinsRes.json();
      const staffData = await staffRes.json();
      if (pinsRes.ok && pinsData.ok) setPins(pinsData.pins || []);
      if (staffRes.ok && staffData.ok) {
        const list: StaffMember[] = (staffData.staff || []).map((r: any) => ({
          id: String(r.id),
          name: r.name || 'Unknown',
          mobile: r.mobile || '',
          position: r.position || '',
          roleType: r.position_category || '',
        }));
        const seen = new Set<string>();
        setStaff(list.filter(s => {
          if (seen.has(s.name.toLowerCase())) return false;
          seen.add(s.name.toLowerCase());
          return true;
        }));
      }
    } catch {
      setError('Failed to load data');
    }
    setLoading(false);
  }

  async function savePin(staffId: string, staffName: string, mobile: string, pin: string, role?: string) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/kiosk-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centreId,
          staffId,
          staffName,
          mobile,
          pin,
          role,
          createdBy: user?.email,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save PIN');
      setPins(prev => {
        const idx = prev.findIndex(p => p.staff_id === staffId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = data.pin;
          return copy;
        }
        return [...prev, data.pin];
      });
      setDraft(prev => { const next = { ...prev }; delete next[staffId]; return next; });
      setSuccess('PIN saved');
    } catch (e: any) {
      setError(e.message || 'Failed to save PIN');
    }
    setSaving(false);
  }

  async function deletePin(id: string) {
    if (!confirm('Delete this PIN?')) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/kiosk-pins?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setPins(prev => prev.filter(p => p.id !== id));
        setSuccess('PIN deleted');
      } else {
        throw new Error('Failed to delete PIN');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to delete PIN');
    }
    setSaving(false);
  }

  const filteredPins = pins.filter(p => !search || p.staff_name?.toLowerCase().includes(search.toLowerCase()));
  const staffWithoutPin = staff.filter(s => !pins.some(p => p.staff_id === s.id));

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ color: '#2d5c18' }}>Kiosk PINs</h1>
            <select
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
              value={centreId}
              onChange={e => setCentreId(e.target.value)}
            >
              {allowedCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <a
            href={`/kiosk?centre=${encodeURIComponent(centreId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white active:scale-95 transition-transform"
            style={{ backgroundColor: '#5a9228' }}
          >
            <KeyRound size={18} />
            Launch Kiosk
          </a>
        </div>

        <p className="text-sm" style={{ color: '#596570' }}>
          Staff use their mobile number and 4-digit PIN to clock in/out at the kiosk for {centre?.name || centreId}.
        </p>

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm flex items-center gap-2" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
            <AlertCircle size={18} />
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl px-4 py-3 text-sm flex items-center gap-2" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
            <CheckCircle size={18} />
            {success}
          </div>
        )}

        <input
          type="text"
          placeholder="Search staff..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 rounded-lg border text-sm"
          style={{ borderColor: '#D0E8B8' }}
        />

        {loading ? (
          <div className="text-center py-12" style={{ color: '#596570' }}>Loading…</div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
                <h2 className="font-bold text-sm" style={{ color: '#2d5c18' }}>Existing PINs ({filteredPins.length})</h2>
              </div>
              {filteredPins.length === 0 ? (
                <div className="p-4 text-sm" style={{ color: '#596570' }}>No PINs set.</div>
              ) : (
                <div className="divide-y" style={{ borderColor: '#E2F1DA' }}>
                  {filteredPins.map(p => (
                    <div key={p.id} className="flex items-center gap-3 p-4">
                      <div className="flex-1">
                        <div className="font-medium text-sm" style={{ color: '#050505' }}>{p.staff_name}</div>
                        <div className="text-xs" style={{ color: '#596570' }}>
                          {p.mobile} • PIN {p.pin}{p.role ? ` • ${p.role}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => deletePin(p.id)}
                        disabled={saving}
                        className="p-2 rounded-lg text-white active:scale-95 transition-transform disabled:opacity-50"
                        style={{ backgroundColor: '#dc2626' }}
                        title="Delete PIN"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
                <h2 className="font-bold text-sm" style={{ color: '#2d5c18' }}>Set PIN for staff</h2>
              </div>
              {staffWithoutPin.length === 0 ? (
                <div className="p-4 text-sm" style={{ color: '#596570' }}>All staff have PINs.</div>
              ) : (
                <div className="divide-y" style={{ borderColor: '#E2F1DA' }}>
                  {staffWithoutPin.slice(0, 50).map(s => {
                    const d = draft[s.id] || { mobile: s.mobile || '', pin: '', role: s.position || s.roleType || '' };
                    return (
                      <div key={s.id} className="flex flex-wrap items-end gap-2 p-4">
                        <div className="flex-1 min-w-[140px]">
                          <div className="font-medium text-sm" style={{ color: '#050505' }}>{s.name}</div>
                          <div className="text-xs" style={{ color: '#596570' }}>{s.position || s.roleType}</div>
                        </div>
                        <input
                          type="tel"
                          placeholder="Mobile"
                          value={d.mobile}
                          onChange={e => setDraft(prev => ({ ...prev, [s.id]: { ...d, mobile: e.target.value } }))}
                          className="w-32 px-2 py-1.5 rounded-lg border text-sm"
                          style={{ borderColor: '#D0E8B8' }}
                        />
                        <input
                          type="text"
                          placeholder="4-digit PIN"
                          maxLength={4}
                          value={d.pin}
                          onChange={e => setDraft(prev => ({ ...prev, [s.id]: { ...d, pin: e.target.value.replace(/\D/g, '').slice(0, 4) } }))}
                          className="w-28 px-2 py-1.5 rounded-lg border text-sm"
                          style={{ borderColor: '#D0E8B8' }}
                        />
                        <button
                          onClick={() => savePin(s.id, s.name, d.mobile, d.pin, d.role)}
                          disabled={!d.mobile || d.pin.length !== 4 || saving}
                          className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 active:scale-95 transition-transform"
                          style={{ backgroundColor: '#2d5c18' }}
                        >
                          Save
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
