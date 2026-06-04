/** GET/POST lunch schedule for a centre+date → Supabase lunch_schedules table */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.3f6e6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { centre, date } = req.method === 'GET' ? req.query : (req.body ?? {});

  if (req.method === 'GET') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/lunch_schedules?centre_id=eq.${encodeURIComponent(centre)}&date=eq.${date}&select=schedule&limit=1`,
      { headers: HEADERS }
    );
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist')) return res.status(200).json([]);
      return res.status(500).json({ error: txt });
    }
    return res.status(200).json(await r.json());
  }

  if (req.method === 'POST') {
    const { schedule } = req.body ?? {};
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lunch_schedules`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ centre_id: centre, date, schedule }),
    });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist')) return res.status(404).json({ error: 'table_not_found' });
      return res.status(500).json({ error: txt });
    }
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
