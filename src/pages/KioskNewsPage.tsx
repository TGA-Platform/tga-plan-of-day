import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Layout from '../components/Layout';
import { getUser, getAllowedCentres } from '../auth';
import { CENTRES } from '../config';

type TargetType = 'centre' | 'room' | 'person';
type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface KioskNewsItem {
  id: string;
  centre_id: string;
  title: string;
  body: string;
  target_type: TargetType;
  target_room_id: string | null;
  target_staff_id: string | null;
  priority: Priority;
  posted_by: string;
  created_at: string;
  expires_at: string | null;
}

interface StaffMember {
  id: string;
  name: string;
}

const PRIORITY_COLORS: Record<Priority, { bg: string; text: string; label: string }> = {
  low:    { bg: '#f3f4f6', text: '#4b5563', label: 'Low' },
  normal: { bg: '#E2F1DA', text: '#2d5c18', label: 'Normal' },
  high:   { bg: '#fef3c7', text: '#92400e', label: 'High' },
  urgent: { bg: '#fee2e2', text: '#dc2626', label: 'Urgent' },
};

export default function KioskNewsPage() {
  const navigate = useNavigate();
  const user = getUser();
  const allowedCentres = user ? getAllowedCentres(user) : [];
  const [centreId, setCentreId] = useState(allowedCentres[0]?.id || CENTRES[0]?.id);

  const [items, setItems] = useState<KioskNewsItem[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('centre');
  const [targetRoomId, setTargetRoomId] = useState('');
  const [targetStaffId, setTargetStaffId] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [expiresAt, setExpiresAt] = useState('');

  const centre = CENTRES.find(c => c.id === centreId);
  const rooms = centre?.rooms || [];

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadNews();
    loadStaff();
  }, [centreId]);

  async function loadNews() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/kiosk-news?centreId=${encodeURIComponent(centreId)}&staffId=all&limit=100`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load news');
      setItems(data.news || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load news');
    }
    setLoading(false);
  }

  async function loadStaff() {
    try {
      const res = await fetch(`/api/staff-members?centreId=${encodeURIComponent(centreId)}`);
      const data = await res.json();
      if (res.ok && data.ok) setStaff(data.staff || []);
    } catch {
      setStaff([]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required');
      return;
    }
    if (targetType === 'room' && !targetRoomId) {
      setError('Please select a room');
      return;
    }
    if (targetType === 'person' && !targetStaffId) {
      setError('Please select a staff member');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload: any = {
        centreId,
        title: title.trim(),
        body: body.trim(),
        targetType,
        priority,
        postedBy: user?.name || user?.email || 'Director',
      };
      if (targetType === 'room') payload.targetRoomId = targetRoomId;
      if (targetType === 'person') payload.targetStaffId = targetStaffId;
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();

      const res = await fetch('/api/kiosk-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to post news');

      setTitle('');
      setBody('');
      setTargetType('centre');
      setTargetRoomId('');
      setTargetStaffId('');
      setPriority('normal');
      setExpiresAt('');
      setShowForm(false);
      setSuccess('Announcement posted');
      await loadNews();
    } catch (e: any) {
      setError(e.message || 'Failed to post news');
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return;
    setError('');
    try {
      const res = await fetch(`/api/kiosk-news?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setSuccess('Announcement deleted');
      await loadNews();
    } catch (e: any) {
      setError(e.message || 'Failed to delete');
    }
  }

  function targetLabel(item: KioskNewsItem) {
    if (item.target_type === 'centre') return 'Centre-wide';
    if (item.target_type === 'room') {
      const room = rooms.find(r => r.id === item.target_room_id);
      return `Room: ${room?.name || item.target_room_id}`;
    }
    const person = staff.find(s => s.id === item.target_staff_id);
    return `Person: ${person?.name || item.target_staff_id}`;
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ color: '#2d5c18' }}>Kiosk News</h1>
            <select
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
              value={centreId}
              onChange={e => setCentreId(e.target.value)}
            >
              {allowedCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button
            onClick={() => setShowForm(s => !s)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white active:scale-95 transition-transform"
            style={{ backgroundColor: '#5a9228' }}
          >
            {showForm ? null : <Plus size={18} />}
            {showForm ? 'Cancel' : 'Post announcement'}
          </button>
        </div>

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

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border p-6 space-y-4" style={{ borderColor: '#E2F1DA' }}>
            <h2 className="text-lg font-bold" style={{ color: '#2d5c18' }}>New announcement</h2>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#596570' }}>Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
                placeholder="e.g. Staff meeting tomorrow"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#596570' }}>Message</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
                placeholder="Announcement details..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#596570' }}>Send to</label>
                <select
                  value={targetType}
                  onChange={e => setTargetType(e.target.value as TargetType)}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
                >
                  <option value="centre">Whole centre</option>
                  <option value="room">Specific room</option>
                  <option value="person">Specific person</option>
                </select>
              </div>
              {targetType === 'room' && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: '#596570' }}>Room</label>
                  <select
                    value={targetRoomId}
                    onChange={e => setTargetRoomId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
                  >
                    <option value="">Select room</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              )}
              {targetType === 'person' && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: '#596570' }}>Staff member</label>
                  <select
                    value={targetStaffId}
                    onChange={e => setTargetStaffId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
                  >
                    <option value="">Select staff</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#596570' }}>Priority</label>
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value as Priority)}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#596570' }}>Expires (optional)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              />
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 rounded-lg text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50"
                style={{ backgroundColor: '#5a9228' }}
              >
                {saving ? 'Posting...' : 'Post announcement'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-center py-12" style={{ color: '#596570' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border" style={{ borderColor: '#E2F1DA', color: '#596570' }}>
            No announcements yet.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: '#F5FAF3' }}>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Announcement</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Target</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Priority</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Posted</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Expires</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: '#596570' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="border-t" style={{ borderColor: '#E2F1DA' }}>
                      <td className="px-4 py-3">
                        <div className="font-semibold" style={{ color: '#050505' }}>{item.title}</div>
                        <div className="text-xs whitespace-pre-wrap" style={{ color: '#596570' }}>{item.body}</div>
                      </td>
                      <td className="px-4 py-3" style={{ color: '#596570' }}>{targetLabel(item)}</td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: PRIORITY_COLORS[item.priority].bg, color: PRIORITY_COLORS[item.priority].text }}
                        >
                          {PRIORITY_COLORS[item.priority].label}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: '#596570' }}>
                        <div>{format(parseISO(item.created_at), 'd MMM yyyy')}</div>
                        <div className="text-xs">{format(parseISO(item.created_at), 'h:mm a')}</div>
                      </td>
                      <td className="px-4 py-3" style={{ color: '#596570' }}>
                        {item.expires_at ? format(parseISO(item.expires_at), 'd MMM h:mm a') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-2 rounded-lg active:scale-95 transition-transform"
                          style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
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
