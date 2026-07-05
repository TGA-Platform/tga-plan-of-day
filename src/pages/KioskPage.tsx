import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { LogOut, Clock, Coffee, Utensils, DoorOpen, CheckCircle, AlertCircle, Megaphone } from 'lucide-react';
import type { KioskEventType, KioskSession } from '../types';

const CENTRE_ID = new URLSearchParams(window.location.search).get('centre') || '';
const IDLE_RESET_MS = 30_000;
const CONFIRM_MS = 3_000;

interface KioskNewsItem {
  id: string;
  title: string;
  body: string;
  target_type: 'centre' | 'room' | 'person';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  posted_by: string;
  created_at: string;
}

type Screen = 'mobile' | 'pin' | 'shift' | 'confirm' | 'endShiftConfirm' | 'endShiftEdit' | 'error';

export default function KioskPage() {
  const [screen, setScreen] = useState<Screen>('mobile');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [session, setSession] = useState<KioskSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [verifiedPin, setVerifiedPin] = useState('');
  const [adjustedEndTime, setAdjustedEndTime] = useState('');
  const [adjustedStartTime, setAdjustedStartTime] = useState('');
  const [editMode, setEditMode] = useState<'start' | 'end'>('end');
  const [news, setNews] = useState<KioskNewsItem[]>([]);

  const idleTimer = useRef<number | null>(null);
  const confirmTimer = useRef<number | null>(null);

  function resetIdleTimer() {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    if (screen === 'confirm') return;
    idleTimer.current = window.setTimeout(() => {
      resetToWelcome();
    }, IDLE_RESET_MS);
  }

  function resetToWelcome() {
    setScreen('mobile');
    setMobile('');
    setPin('');
    setSession(null);
    setError('');
    setConfirmText('');
    setVerifiedPin('');
    setAdjustedEndTime('');
    setAdjustedStartTime('');
    setEditMode('end');
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
  }

  useEffect(() => {
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  useEffect(() => {
    resetIdleTimer();
  }, [screen, mobile, pin]);

  useEffect(() => {
    if (screen === 'shift' && session) {
      loadNews();
    }
  }, [screen, session?.staff_id, session?.shift?.room_id]);

  async function verifyPin(pinValue: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/kiosk-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, pin: pinValue, centreId: CENTRE_ID }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Login failed');

      setSession(data);
      setVerifiedPin(pinValue);
      setScreen('shift');
      setPin('');
    } catch (e: any) {
      setError(e.message || 'Could not sign in');
      setScreen('error');
      setPin('');
    }
    setLoading(false);
  }

  async function clockEvent(eventType: KioskEventType, options?: { confirmed?: boolean; adjustedStartTime?: string; adjustedEndTime?: string }) {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/kiosk-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobile,
          pin: verifiedPin,
          centreId: CENTRE_ID,
          eventType,
          ...options,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not record');

      const updated = await fetch('/api/kiosk-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, pin: verifiedPin, centreId: CENTRE_ID }),
      });
      const updatedData = await updated.json();
      if (updated.ok && updatedData.ok) setSession(updatedData);

      const label = eventLabel(eventType);
      const time = format(new Date(), 'h:mm a');
      const autoApproved = data.timesheet?.status === 'approved';
      setConfirmText(`${label} recorded at ${time}${autoApproved ? '\nTimesheet pre-approved' : ''}`);
      setScreen('confirm');
      setAdjustedEndTime('');
      setAdjustedStartTime('');
      setEditMode('end');
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => {
        setScreen('shift');
      }, CONFIRM_MS);
    } catch (e: any) {
      setError(e.message || 'Could not record');
      setScreen('error');
    }
    setLoading(false);
  }

  function handleEndShift() {
    if (!session?.shift) {
      clockEvent('end_shift');
      return;
    }
    // Always ask the employee whether they finished on time
    setScreen('endShiftConfirm');
  }

  function handleEndShiftConfirm(yes: boolean) {
    if (yes) {
      clockEvent('end_shift', { confirmed: true });
    } else {
      const startEvent = session?.events.find(e => e.event_type === 'start_shift');
      setAdjustedStartTime(startEvent ? startEvent.event_time.slice(11, 16) : session?.shift?.start_time || '');
      setAdjustedEndTime(format(new Date(), 'HH:mm'));
      setEditMode('start');
      setScreen('endShiftEdit');
    }
  }

  function submitAdjustedShift() {
    const start = adjustedStartTime || session?.shift?.start_time || '';
    const end = adjustedEndTime || session?.shift?.end_time || '';
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      setError('Please enter valid start and finish times');
      setScreen('error');
      return;
    }
    clockEvent('end_shift', { confirmed: false, adjustedStartTime: start, adjustedEndTime: end });
  }

  async function loadNews() {
    if (!session) return;
    try {
      const roomId = session.shift?.room_id || '';
      const url = `/api/kiosk-news?centreId=${encodeURIComponent(CENTRE_ID)}&staffId=${encodeURIComponent(session.staff_id)}${roomId ? `&roomId=${encodeURIComponent(roomId)}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && data.ok) setNews(data.news || []);
    } catch {
      setNews([]);
    }
  }

  function eventLabel(type: KioskEventType): string {
    switch (type) {
      case 'start_shift': return 'Shift started';
      case 'start_lunch': return 'Lunch started';
      case 'end_lunch': return 'Lunch ended';
      case 'end_shift': return 'Shift ended';
    }
  }

  function latestEvent(type: KioskEventType) {
    const events = session?.events || [];
    return events.filter(e => e.event_type === type).pop();
  }

  function currentStatus(): { label: string; color: string; bg: string } | null {
    const events = session?.events || [];
    if (!events.length) return null;
    const last = events[events.length - 1].event_type;
    switch (last) {
      case 'start_shift': return { label: 'On shift', color: '#166534', bg: '#dcfce7' };
      case 'start_lunch': return { label: 'On lunch break', color: '#92400e', bg: '#fef3c7' };
      case 'end_lunch': return { label: 'On shift', color: '#166534', bg: '#dcfce7' };
      case 'end_shift': return { label: 'Shift finished', color: '#596570', bg: '#f3f4f6' };
      default: return null;
    }
  }

  function formatEventTime(iso?: string) {
    if (!iso) return null;
    try {
      return format(new Date(iso), 'h:mm a');
    } catch {
      return null;
    }
  }

  function handleNumpad(key: string) {
    if (screen === 'mobile') {
      if (key === 'clear') { setMobile(''); return; }
      if (key === 'back') { setMobile(m => m.slice(0, -1)); return; }
      if (/^\d$/.test(key) && mobile.length < 10) {
        const next = mobile + key;
        setMobile(next);
        if (next.length >= 10) setTimeout(() => setScreen('pin'), 200);
      }
      return;
    }

    if (screen === 'pin') {
      if (key === 'clear') { setPin(''); return; }
      if (key === 'back') { setPin(p => p.slice(0, -1)); return; }
      if (/^\d$/.test(key) && pin.length < 4) {
        const next = pin + key;
        setPin(next);
        if (next.length === 4) {
          setTimeout(() => verifyPin(next), 150);
        }
      }
      return;
    }
  }

  function nextAvailableEvent(): KioskEventType | null {
    const events = session?.events || [];
    if (!events.length) return 'start_shift';
    const last = events[events.length - 1].event_type;
    switch (last) {
      case 'start_shift': return 'start_lunch';
      case 'start_lunch': return 'end_lunch';
      case 'end_lunch': return 'end_shift';
      case 'end_shift': return 'start_shift';
      default: return 'start_shift';
    }
  }

  function isEventAvailable(type: KioskEventType): boolean {
    const next = nextAvailableEvent();
    if (next === type) return true;
    // Also allow end_shift after start_shift (skip lunch)
    const events = session?.events || [];
    const last = events.length ? events[events.length - 1].event_type : null;
    if (type === 'end_shift' && last === 'start_shift') return true;
    return false;
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center select-none"
      style={{ backgroundColor: '#F5FAF3' }}
      onClick={resetIdleTimer}
    >
      {/* Header / logo */}
      <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src="/tga-logo.jpg" alt="The Grove Academy" className="h-16 w-auto object-contain rounded" />
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#2d5c18' }}>Staff Kiosk</h1>
            <p className="text-sm" style={{ color: '#596570' }}>{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
          </div>
        </div>
        <button
          onClick={resetToWelcome}
          className="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-white active:scale-95 transition-transform"
          style={{ backgroundColor: '#5a9228' }}
        >
          <LogOut size={22} />
          Reset
        </button>
      </div>

      {/* Main card */}
      <div className="w-full max-w-2xl px-6">
        {(screen === 'mobile' || screen === 'pin') && (
          <div className="bg-white rounded-3xl shadow-xl p-8 border" style={{ borderColor: '#E2F1DA' }}>
            <div className="text-center mb-8">
              {screen === 'mobile' && (
                <div className="mb-4">
                  <h2 className="text-3xl font-bold mb-2" style={{ color: '#2d5c18' }}>Welcome to The Grove Academy</h2>
                  <p className="text-lg" style={{ color: '#596570' }}>Enter your mobile number</p>
                </div>
              )}
              {screen === 'pin' && (
                <h2 className="text-2xl font-bold mb-2" style={{ color: '#2d5c18' }}>Enter your 4-digit PIN</h2>
              )}
              <div className="h-16 flex items-center justify-center gap-2">
                {screen === 'mobile' ? (
                  <span className="text-4xl font-mono tracking-widest" style={{ color: '#050505' }}>
                    {mobile || '\u00A0'}
                  </span>
                ) : (
                  <span className="text-4xl font-mono tracking-widest" style={{ color: '#050505' }}>
                    {pin.replace(/./g, '●') || '\u00A0'}
                  </span>
                )}
              </div>
              {loading && <p className="text-sm" style={{ color: '#596570' }}>Checking…</p>}
            </div>

            <Numpad onKey={handleNumpad} />

            <div className="mt-6 flex justify-center">
              {screen === 'mobile' ? (
                <button
                  onClick={() => mobile.length >= 10 && setScreen('pin')}
                  disabled={mobile.length < 10 || loading}
                  className="w-full max-w-xs py-4 rounded-2xl text-xl font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                  style={{ backgroundColor: '#5a9228' }}
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={() => pin.length === 4 && verifyPin(pin)}
                  disabled={pin.length < 4 || loading}
                  className="w-full max-w-xs py-4 rounded-2xl text-xl font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                  style={{ backgroundColor: '#5a9228' }}
                >
                  Login
                </button>
              )}
            </div>
          </div>
        )}

        {screen === 'shift' && session && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl shadow-xl p-8 border text-center" style={{ borderColor: '#E2F1DA' }}>
              <h2 className="text-3xl font-bold mb-1" style={{ color: '#050505' }}>{session.staff_name}</h2>
              {session.role && <p className="text-lg mb-4" style={{ color: '#596570' }}>{session.role}</p>}
              {(() => {
                const status = currentStatus();
                return status ? (
                  <div className="mb-4">
                    <span
                      className="inline-block px-4 py-1.5 rounded-full text-sm font-bold"
                      style={{ backgroundColor: status.bg, color: status.color }}
                    >
                      {status.label}
                    </span>
                  </div>
                ) : null;
              })()}
              {session.shift ? (
                <div className="inline-block rounded-2xl px-8 py-4" style={{ backgroundColor: '#E2F1DA' }}>
                  <p className="text-sm font-semibold uppercase tracking-wide mb-1" style={{ color: '#2d5c18' }}>Rostered shift</p>
                  <p className="text-4xl font-bold" style={{ color: '#2d5c18' }}>
                    {session.shift.start_time} – {session.shift.end_time}
                  </p>
                  <p className="text-lg mt-1" style={{ color: '#596570' }}>
                    {session.shift.room_name || 'Unassigned'}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl px-8 py-6" style={{ backgroundColor: '#fef3c7' }}>
                  <p className="text-xl font-semibold" style={{ color: '#92400e' }}>No rostered shift today</p>
                </div>
              )}

              {(session.events || []).length > 0 && (
                <div className="mt-6 inline-block rounded-2xl px-8 py-4 text-left" style={{ backgroundColor: '#F5FAF3', border: '2px solid #E2F1DA' }}>
                  <p className="text-sm font-semibold uppercase tracking-wide mb-2 text-center" style={{ color: '#2d5c18' }}>Actual times</p>
                  <div className="space-y-1">
                    {(['start_shift', 'start_lunch', 'end_lunch', 'end_shift'] as KioskEventType[]).map(type => {
                      const ev = latestEvent(type);
                      if (!ev) return null;
                      return (
                        <p key={type} className="text-lg" style={{ color: '#050505' }}>
                          <span style={{ color: '#596570' }}>{eventLabel(type)}:</span>{' '}
                          <span className="font-bold">{formatEventTime(ev.event_time)}</span>
                        </p>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ActionButton
                icon={<Clock size={36} />}
                label="Start Shift"
                active={isEventAvailable('start_shift')}
                color="#2d5c18"
                onClick={() => clockEvent('start_shift')}
                loading={loading}
              />
              <ActionButton
                icon={<Utensils size={36} />}
                label="Start Lunch"
                active={isEventAvailable('start_lunch')}
                color="#c2410c"
                onClick={() => clockEvent('start_lunch')}
                loading={loading}
              />
              <ActionButton
                icon={<Coffee size={36} />}
                label="End Lunch"
                active={isEventAvailable('end_lunch')}
                color="#b45309"
                onClick={() => clockEvent('end_lunch')}
                loading={loading}
              />
              <ActionButton
                icon={<DoorOpen size={36} />}
                label="End Shift"
                active={isEventAvailable('end_shift')}
                color="#1e40af"
                onClick={handleEndShift}
                loading={loading}
              />
            </div>

            {news.length > 0 && (
              <div className="bg-white rounded-3xl shadow-xl p-6 border" style={{ borderColor: '#E2F1DA' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Megaphone size={22} style={{ color: '#2d5c18' }} />
                  <h3 className="text-lg font-bold" style={{ color: '#2d5c18' }}>Latest News</h3>
                </div>
                <div className="space-y-3">
                  {news.map(item => (
                    <div key={item.id} className="rounded-xl p-4 border" style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}>
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="font-bold" style={{ color: '#050505' }}>{item.title}</h4>
                        {item.priority !== 'normal' && (
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                            style={{
                              backgroundColor: item.priority === 'urgent' ? '#fee2e2' : item.priority === 'high' ? '#fef3c7' : '#f3f4f6',
                              color: item.priority === 'urgent' ? '#dc2626' : item.priority === 'high' ? '#92400e' : '#4b5563',
                            }}
                          >
                            {item.priority}
                          </span>
                        )}
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: '#596570' }}>{item.body}</p>
                      <p className="text-xs mt-2" style={{ color: '#9ca3af' }}>
                        Posted by {item.posted_by} on {format(new Date(item.created_at), 'd MMM yyyy')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {screen === 'confirm' && (
          <div className="bg-white rounded-3xl shadow-xl p-10 border text-center" style={{ borderColor: '#E2F1DA' }}>
            <div className="flex justify-center mb-6">
              <div className="rounded-full p-4" style={{ backgroundColor: '#dcfce7' }}>
                <CheckCircle size={64} style={{ color: '#16a34a' }} />
              </div>
            </div>
            <h2 className="text-3xl font-bold mb-2" style={{ color: '#16a34a' }}>Done</h2>
            <p className="text-2xl" style={{ color: '#050505' }}>{confirmText}</p>
          </div>
        )}

        {screen === 'endShiftConfirm' && session?.shift && (
          <div className="bg-white rounded-3xl shadow-xl p-10 border text-center" style={{ borderColor: '#E2F1DA' }}>
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#2d5c18' }}>Finish shift</h2>
            <p className="text-xl mb-8" style={{ color: '#596570' }}>
              Did you complete your rostered shift today?
            </p>
            <div className="inline-block rounded-2xl px-8 py-4 mb-8" style={{ backgroundColor: '#E2F1DA' }}>
              <p className="text-3xl font-bold" style={{ color: '#2d5c18' }}>
                {session.shift.start_time} – {session.shift.end_time}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
              <button
                onClick={() => handleEndShiftConfirm(true)}
                disabled={loading}
                className="py-5 rounded-2xl text-xl font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                style={{ backgroundColor: '#16a34a' }}
              >
                Yes
              </button>
              <button
                onClick={() => handleEndShiftConfirm(false)}
                disabled={loading}
                className="py-5 rounded-2xl text-xl font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                style={{ backgroundColor: '#dc2626' }}
              >
                No, overtime
              </button>
            </div>
          </div>
        )}

        {screen === 'endShiftEdit' && (
          <div className="bg-white rounded-3xl shadow-xl p-8 border" style={{ borderColor: '#E2F1DA' }}>
            <div className="text-center mb-6">
              <h2 className="text-3xl font-bold mb-2" style={{ color: '#2d5c18' }}>Adjust your times</h2>
              <p className="text-lg" style={{ color: '#596570' }}>Tap Start or Finish to edit</p>

              <div className="flex items-center justify-center gap-4 mt-4">
                <button
                  onClick={() => setEditMode('start')}
                  className={`px-4 py-3 rounded-xl border-2 text-left min-w-[120px] ${editMode === 'start' ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}
                >
                  <div className="text-xs" style={{ color: '#596570' }}>Start</div>
                  <div className="text-2xl font-mono" style={{ color: '#050505' }}>{adjustedStartTime || '—'}</div>
                </button>
                <span style={{ color: '#596570' }}>–</span>
                <button
                  onClick={() => setEditMode('end')}
                  className={`px-4 py-3 rounded-xl border-2 text-left min-w-[120px] ${editMode === 'end' ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}
                >
                  <div className="text-xs" style={{ color: '#596570' }}>Finish</div>
                  <div className="text-2xl font-mono" style={{ color: '#050505' }}>{adjustedEndTime || '—'}</div>
                </button>
              </div>
            </div>

            <Numpad
              onKey={(key) => {
                const setter = editMode === 'start' ? setAdjustedStartTime : setAdjustedEndTime;
                if (key === 'clear') { setter(''); return; }
                if (key === 'back') { setter(t => t.slice(0, -1)); return; }
                if (/^\d$/.test(key)) {
                  setter(t => {
                    const raw = t.replace(/:/g, '') + key;
                    if (raw.length >= 4) {
                      const hours = Math.min(23, parseInt(raw.slice(0, 2), 10));
                      const mins = Math.min(59, parseInt(raw.slice(2, 4), 10));
                      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
                    }
                    if (raw.length === 3) {
                      const hours = parseInt(raw.slice(0, 1), 10);
                      const mins = Math.min(59, parseInt(raw.slice(1, 3), 10));
                      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
                    }
                    return raw;
                  });
                }
              }}
            />

            <div className="mt-6 flex justify-center">
              <button
                onClick={submitAdjustedShift}
                disabled={loading || adjustedStartTime.length < 5 || adjustedEndTime.length < 5}
                className="w-full max-w-xs py-4 rounded-2xl text-xl font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                style={{ backgroundColor: '#1e40af' }}
              >
                Record times
              </button>
            </div>
          </div>
        )}

        {screen === 'error' && (
          <div className="bg-white rounded-3xl shadow-xl p-10 border text-center" style={{ borderColor: '#fecaca' }}>
            <div className="flex justify-center mb-6">
              <div className="rounded-full p-4" style={{ backgroundColor: '#fee2e2' }}>
                <AlertCircle size={64} style={{ color: '#dc2626' }} />
              </div>
            </div>
            <h2 className="text-3xl font-bold mb-2" style={{ color: '#dc2626' }}>Something went wrong</h2>
            <p className="text-xl mb-8" style={{ color: '#050505' }}>{error}</p>
            <button
              onClick={resetToWelcome}
              className="px-8 py-4 rounded-xl text-white text-xl font-semibold active:scale-95 transition-transform"
              style={{ backgroundColor: '#5a9228' }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Numpad({ onKey }: { onKey: (key: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return (
    <div className="grid grid-cols-3 gap-4">
      {keys.map(key => (
        <button
          key={key}
          onClick={() => onKey(key)}
          className={`h-20 rounded-2xl text-3xl font-bold active:scale-95 transition-transform ${
            key === 'clear' || key === 'back' ? 'text-xl' : ''
          }`}
          style={{
            backgroundColor: key === 'clear' ? '#fee2e2' : key === 'back' ? '#fef3c7' : '#ffffff',
            color: key === 'clear' ? '#dc2626' : key === 'back' ? '#92400e' : '#050505',
            border: '2px solid #E2F1DA',
          }}
        >
          {key === 'back' ? '←' : key === 'clear' ? 'Clear' : key}
        </button>
      ))}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  active,
  color,
  onClick,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!active || loading}
      className="flex flex-col items-center justify-center gap-3 h-40 rounded-3xl text-white text-2xl font-bold active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ backgroundColor: active ? color : '#9ca3af' }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
