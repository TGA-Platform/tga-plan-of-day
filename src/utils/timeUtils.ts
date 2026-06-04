/** Convert a time value (HH:MM string, unix timestamp, or number) to minutes since midnight (Sydney). */
export function toMins(t: string | number | null | undefined): number | null {
  if (!t) return null;
  const num = typeof t === 'number' ? t : parseInt(String(t));
  if (!isNaN(num) && num > 100000) {
    const syd = new Date(new Date(num * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return syd.getHours() * 60 + syd.getMinutes();
  }
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  return null;
}

export function minsToAmPm(m: number): string {
  const h    = Math.floor(m / 60);
  const min  = m % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(min).padStart(2, '0')}${ampm}`;
}

/** Format minutes as HH:MM (24h) for input[type=time] */
export function minsToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Parse HH:MM string to minutes since midnight */
export function hhmmToMins(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
