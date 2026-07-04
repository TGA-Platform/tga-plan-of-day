import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { LogOut, Clock, Coffee, Utensils, DoorOpen, CheckCircle, AlertCircle } from 'lucide-react';
import type { KioskEventType, KioskSession } from '../types';

const CENTRE_ID = new URLSearchParams(window.location.search).get('centre') || '';
const IDLE_RESET_MS = 30_000;
const CONFIRM_MS = 3_000;

type Screen = 'welcome' | 'mobile' | 'pin' | 'shift' | 'confirm' | 'error';

export default function KioskPage() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [session, setSession] = useState<KioskSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [verifiedPin, setVerifiedPin] = useState('');

  const idleTimer = useRef<number | null>(null);
  const confirmTimer = useRef<number | null>(null);

  function resetIdleTimer() {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    if (screen === 'welcome' || screen === 'confirm') return;
    idleTimer.current = window.setTimeout(() => {
      resetToWelcome();
    }, IDLE_RESET_MS);
  }

  function resetToWelcome() {
    setScreen('welcome');
    setMobile('');
    setPin('');
    setSession(null);
    setError('');
    setConfirmText('');
    setVerifiedPin('');
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

  async function clockEvent(eventType: KioskEventType) {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/kiosk-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, pin: verifiedPin, centreId: CENTRE_ID, eventType }),
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
      setConfirmText(`${label} recorded at ${time}`);
      setScreen('confirm');
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

  function eventLabel(type: KioskEventType): string {
    switch (type) {
      case 'start_shift': return 'Shift started';
      case 'start_lunch': return 'Lunch started';
      case 'end_lunch': return 'Lunch ended';
      case 'end_shift': return 'Shift ended';
    }
  }

  function handleNumpad(key: string) {
    if (screen === 'welcome') setScreen('mobile');

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
        {screen === 'welcome' && (
          <div className="text-center space-y-8">
            <div className="text-6xl mb-4">👋</div>
            <h2 className="text-3xl font-bold" style={{ color: '#050505' }}>Tap anywhere to start</h2>
            <p className="text-xl" style={{ color: '#596570' }}>Enter your mobile number and 4-digit PIN to clock in or out.</p>
          </div>
        )}

        {(screen === 'mobile' || screen === 'pin') && (
          <div className="bg-white rounded-3xl shadow-xl p-8 border" style={{ borderColor: '#E2F1DA' }}>
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2" style={{ color: '#2d5c18' }}>
                {screen === 'mobile' ? 'Enter your mobile number' : 'Enter your 4-digit PIN'}
              </h2>
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
          </div>
        )}

        {screen === 'shift' && session && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl shadow-xl p-8 border text-center" style={{ borderColor: '#E2F1DA' }}>
              <h2 className="text-3xl font-bold mb-1" style={{ color: '#050505' }}>{session.staff_name}</h2>
              {session.role && <p className="text-lg mb-4" style={{ color: '#596570' }}>{session.role}</p>}
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
                onClick={() => clockEvent('end_shift')}
                loading={loading}
              />
            </div>
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
