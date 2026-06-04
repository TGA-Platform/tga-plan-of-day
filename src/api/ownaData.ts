/**
 * ownaData.ts
 * Fetches Owna-scraped data from Supabase (pod_attendance, pod_daily_stats, pod_trends)
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
// Service role key used (internal-only app — no public users)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

export interface AttendanceRecord {
  id: string;
  centre_id: string;
  date: string;
  child_name: string | null;
  room_name: string | null;
  sign_in: string | null;           // confirmed actual sign-in time
  sign_out: string | null;          // confirmed actual sign-out time
  predicted_sign_in: string | null; // from booked session window
  predicted_sign_out: string | null;
  session: string | null;
  scraped_at: string;
}

export interface DailyStats {
  id: string;
  centre_id: string;
  date: string;
  approved_places: number;
  attendances: number;
  absences: number;
  attendance_pct: number;
  scraped_at: string;
}

export interface TrendRecord {
  id: string;
  centre_id: string;
  room_name: string;
  day_of_week: number;
  avg_attendance_rate: number;
  sample_days: number;
  updated_at: string;
}

async function supabaseGet<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
    if (!res.ok) {
      // Tables might not exist yet
      const text = await res.text();
      if (text.includes('does not exist') || text.includes('PGRST205') || res.status === 404) {
        console.warn('Supabase table not found:', path, '— tables may not be set up yet');
        return [];
      }
      console.error('Supabase error:', res.status, text);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error('Supabase fetch error:', err);
    return [];
  }
}

export async function fetchAttendanceForDate(centreId: string, date: string): Promise<AttendanceRecord[]> {
  return supabaseGet<AttendanceRecord>(
    `pod_attendance?centre_id=eq.${centreId}&date=eq.${date}&order=room_name,sign_in`
  );
}

export async function fetchDailyStats(centreId: string, fromDate: string, toDate: string): Promise<DailyStats[]> {
  return supabaseGet<DailyStats>(
    `pod_daily_stats?centre_id=eq.${centreId}&date=gte.${fromDate}&date=lte.${toDate}&order=date`
  );
}

export async function fetchTrends(centreId: string): Promise<TrendRecord[]> {
  return supabaseGet<TrendRecord>(
    `pod_trends?centre_id=eq.${centreId}&order=room_name,day_of_week`
  );
}

export function getTrendRate(
  trends: TrendRecord[],
  roomName: string,
  dayOfWeek: number,
  defaultRate = 0.90
): number {
  const t = trends.find(t => t.room_name === roomName && t.day_of_week === dayOfWeek);
  return t ? t.avg_attendance_rate : defaultRate;
}

export function groupAttendanceByRoom(records: AttendanceRecord[]): Record<string, AttendanceRecord[]> {
  const grouped: Record<string, AttendanceRecord[]> = {};
  for (const r of records) {
    const key = r.room_name || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
  return grouped;
}

/** Count children currently signed in at a given time slot */
export function countSignedIn(records: AttendanceRecord[], slotStart: Date, slotEnd: Date): number {
  return records.filter(r => {
    if (!r.sign_in) return false;
    const signIn = new Date(r.sign_in);
    const signOut = r.sign_out ? new Date(r.sign_out) : null;
    return signIn <= slotStart && (signOut === null || signOut >= slotEnd);
  }).length;
}

export interface ForecastData {
  // { room_name: { slot_start: avg_count } }
  [roomName: string]: { [slotStart: string]: number };
}

/**
 * Fetch interval forecast for a centre on a given date.
 * Returns a map of room_name → slot_start → avg_count.
 * Falls back to empty object if forecast not available.
 */
export async function fetchForecast(centreId: string, date: string): Promise<ForecastData> {
  try {
    const res = await fetch(`/api/forecast?centre=${encodeURIComponent(centreId)}&date=${encodeURIComponent(date)}`);
    if (!res.ok) return {};
    const json = await res.json();
    return json.forecast || {};
  } catch (err) {
    console.warn('fetchForecast error:', err);
    return {};
  }
}

/**
 * Get peak forecast count for a room on a given day.
 * Returns the maximum avg_count across all 15-min slots.
 */
export function getForecastPeak(forecast: ForecastData, roomName: string): number {
  const roomForecast = forecast[roomName];
  if (!roomForecast) return 0;
  const values = Object.values(roomForecast);
  if (values.length === 0) return 0;
  return Math.max(...values);
}

/**
 * Get forecast count for a specific slot.
 */
export function getForecastForSlot(forecast: ForecastData, roomName: string, slotStart: string): number {
  return forecast[roomName]?.[slotStart] ?? 0;
}
