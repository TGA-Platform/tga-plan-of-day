/**
 * ownaData.ts
 * Fetches Owna-scraped data from Supabase (pod_attendance, pod_daily_stats, pod_trends)
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.Yf5jHkWvE9bVn_LKd_kbG3ZxBPAFGnl_Z9rA0ZeC0xc';

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
  sign_in: string | null;
  sign_out: string | null;
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
