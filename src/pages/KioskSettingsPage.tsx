import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Megaphone, KeyRound, MonitorPlay, AlertCircle, ChevronRight, Pin } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Layout from '../components/Layout';
import RosterTabs from '../components/RosterTabs';
import { isStagingOrPreview } from '../lib/env';
import { getUser, getAllowedCentres } from '../auth';
import { CENTRES } from '../config';

interface KioskNewsItem {
  id: string;
  title: string;
  body: string;
  target_type: 'centre' | 'room' | 'person';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  posted_by: string;
  created_at: string;
}

interface KioskPin {
  id: string;
  staff_name: string;
  mobile: string;
  pin: string;
  role?: string;
}

const PRIORITY_COLORS: Record<KioskNewsItem['priority'], { bg: string; text: string }> = {
  low:    { bg: '#f3f4f6', text: '#4b5563' },
  normal: { bg: '#E2F1DA', text: '#2d5c18' },
  high:   { bg: '#fef3c7', text: '#92400e' },
  urgent: { bg: '#fee2e2', text: '#dc2626' },
};

export default function KioskSettingsPage() {
  const navigate = useNavigate();
  const user = getUser();
  const allowedCentres = user ? getAllowedCentres(user) : [];
  const [centreId, setCentreId] = useState(allowedCentres[0]?.id || CENTRES[0]?.id);
  const [news, setNews] = useState<KioskNewsItem[]>([]);
  const [pins, setPins] = useState<KioskPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const centre = CENTRES.find(c => c.id === centreId);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadData();
  }, [centreId]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [newsRes, pinsRes] = await Promise.all([
        fetch(`/api/kiosk-news?centreId=${encodeURIComponent(centreId)}&staffId=all&limit=5`),
        fetch(`/api/kiosk-pins?centreId=${encodeURIComponent(centreId)}`),
      ]);
      const newsData = await newsRes.json();
      const pinsData = await pinsRes.json();
      if (newsRes.ok && newsData.ok) setNews(newsData.news || []);
      if (pinsRes.ok && pinsData.ok) setPins(pinsData.pins || []);
    } catch {
      setError('Failed to load kiosk data');
    }
    setLoading(false);
  }

  return (
    <Layout>
      <div className="space-y-4">
        {isStagingOrPreview() && <RosterTabs centreId={centreId} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ color: '#2d5c18' }}>Kiosk Settings</h1>
            <select
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
              value={centreId}
              onChange={e => setCentreId(e.target.value)}
            >
              {allowedCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3 text-sm flex items-center gap-2" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {/* Launch kiosk */}
        <div className="rounded-2xl border p-6 flex flex-col md:flex-row items-center justify-between gap-4" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#2d5c18' }}>Launch staff kiosk</h2>
            <p className="text-sm" style={{ color: '#596570' }}>Open the clock-in/out kiosk for {centre?.name || centreId}.</p>
          </div>
          <a
            href={`/kiosk?centre=${encodeURIComponent(centreId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-semibold active:scale-95 transition-transform"
            style={{ backgroundColor: '#5a9228' }}
          >
            <MonitorPlay size={20} />
            Launch Kiosk
          </a>
        </div>

        {/* Settings cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            to="/kiosk-news"
            className="rounded-2xl border p-5 hover:shadow-md transition-shadow"
            style={{ borderColor: '#E2F1DA', backgroundColor: 'white' }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ backgroundColor: '#E2F1DA' }}>
                  <Megaphone size={22} style={{ color: '#2d5c18' }} />
                </div>
                <div>
                  <h3 className="font-bold" style={{ color: '#050505' }}>Announcements</h3>
                  <p className="text-xs" style={{ color: '#596570' }}>Post and manage kiosk news</p>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: '#596570' }} />
            </div>
            <div className="mt-4 text-sm" style={{ color: '#596570' }}>
              {news.length} recent post{news.length !== 1 ? 's' : ''}
            </div>
          </Link>

          <Link
            to="/kiosk-pins"
            className="rounded-2xl border p-5 hover:shadow-md transition-shadow"
            style={{ borderColor: '#E2F1DA', backgroundColor: 'white' }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ backgroundColor: '#E2F1DA' }}>
                  <KeyRound size={22} style={{ color: '#2d5c18' }} />
                </div>
                <div>
                  <h3 className="font-bold" style={{ color: '#050505' }}>Kiosk PINs</h3>
                  <p className="text-xs" style={{ color: '#596570' }}>Manage staff sign-in PINs</p>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: '#596570' }} />
            </div>
            <div className="mt-4 text-sm" style={{ color: '#596570' }}>
              {pins.length} PIN{pins.length !== 1 ? 's' : ''} set
            </div>
          </Link>
        </div>

        {/* Latest news */}
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
            <div className="flex items-center gap-2">
              <Pin size={18} style={{ color: '#2d5c18' }} />
              <h2 className="font-bold" style={{ color: '#2d5c18' }}>Latest News</h2>
            </div>
            <Link to="/kiosk-news" className="text-xs font-semibold" style={{ color: '#5a9228' }}>View all</Link>
          </div>
          {loading ? (
            <div className="p-6 text-sm" style={{ color: '#596570' }}>Loading…</div>
          ) : news.length === 0 ? (
            <div className="p-6 text-sm" style={{ color: '#596570' }}>No announcements yet.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: '#E2F1DA' }}>
              {news.map(item => (
                <div key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-sm" style={{ color: '#050505' }}>{item.title}</div>
                      <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: '#596570' }}>{item.body}</p>
                      <div className="text-[10px] mt-2" style={{ color: '#9ca3af' }}>
                        Posted by {item.posted_by} on {format(parseISO(item.created_at), 'd MMM yyyy h:mm a')}
                      </div>
                    </div>
                    {item.priority !== 'normal' && (
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap"
                        style={{ backgroundColor: PRIORITY_COLORS[item.priority].bg, color: PRIORITY_COLORS[item.priority].text }}
                      >
                        {item.priority}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
