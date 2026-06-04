/**
 * /api/forecast
 * GET /api/forecast?centre=oatley&date=2026-05-18
 * Returns: { [room_name]: { [slot_start]: avg_count } }
 * Also queries pod_trends as fallback.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

// 0=Sun, 1=Mon, ..., 6=Sat
function getDayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { centre, date } = req.query;
  
  if (!centre || !date) {
    return res.status(400).json({ error: 'Missing centre or date parameter' });
  }

  const dayOfWeek = getDayOfWeek(date);

  try {
    // Query pod_interval_forecast
    const forecastUrl = `${SUPABASE_URL}/rest/v1/pod_interval_forecast?centre_id=eq.${centre}&day_of_week=eq.${dayOfWeek}&order=room_name,slot_start`;
    const forecastRes = await fetch(forecastUrl, { headers: HEADERS });
    
    if (!forecastRes.ok) {
      const text = await forecastRes.text();
      // Table might not exist yet
      if (text.includes('does not exist') || forecastRes.status === 404) {
        return res.status(200).json({ forecast: {}, hasForecast: false });
      }
      throw new Error(`Supabase error ${forecastRes.status}: ${text}`);
    }
    
    const forecastData = await forecastRes.json();
    
    // Build response: { room_name: { slot_start: avg_count } }
    const result = {};
    for (const row of forecastData) {
      if (!result[row.room_name]) result[row.room_name] = {};
      result[row.room_name][row.slot_start] = parseFloat(row.avg_count);
    }
    
    return res.status(200).json({
      forecast: result,
      hasForecast: forecastData.length > 0,
      dayOfWeek,
      centre,
      date,
    });
  } catch (err) {
    console.error('Forecast API error:', err);
    return res.status(500).json({ error: err.message, forecast: {}, hasForecast: false });
  }
}
