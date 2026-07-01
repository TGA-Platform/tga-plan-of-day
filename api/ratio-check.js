const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer:         'return=minimal',
};

// Ensure table exists (idempotent — uses Supabase REST + rpc or just catches errors gracefully)
async function ensureTable() {
  // We rely on the table being created via migration; if it doesn't exist the POST will fail
  // with a clear error. Table DDL is in the task spec.
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { centre_id, date, session } = req.method === 'GET' ? req.query : req.body ?? {};

  if (!date) {
    return res.status(400).json({ error: 'date is required' });
  }

  if (req.method === 'GET') {
    // Fetch saved data for a date (all sessions or specific session)
    // If centre_id is omitted or 'all', return all centres for the date (bulk mode)
    let url;
    if (!centre_id || centre_id === 'all') {
      url = `${SUPABASE_URL}/rest/v1/ratio_check_data?date=eq.${date}&select=centre_id,session,data,updated_at`;
    } else {
      url = `${SUPABASE_URL}/rest/v1/ratio_check_data?centre_id=eq.${encodeURIComponent(centre_id)}&date=eq.${date}&select=session,data,updated_at`;
    }
    if (session) url += `&session=eq.${encodeURIComponent(session)}`;

    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }
    const rows = await r.json();
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { data } = req.body ?? {};
    if (!session || !data) {
      return res.status(400).json({ error: 'session and data are required for POST' });
    }

    // Safety guard: if incoming familyGroupings is empty, check whether the DB already
    // has non-empty FGs for this record. If so, preserve them — never overwrite real FG
    // data with an empty array. This protects against client-side race conditions.
    const incomingFGs = data.familyGroupings ?? [];
    if (incomingFGs.length === 0) {
      try {
        const checkUrl = `${SUPABASE_URL}/rest/v1/ratio_check_data?centre_id=eq.${encodeURIComponent(centre_id)}&date=eq.${date}&session=eq.${encodeURIComponent(session)}&select=data->>familyGroupings`;
        const checkR = await fetch(checkUrl, { headers: HEADERS });
        if (checkR.ok) {
          const rows = await checkR.json();
          const existing = rows?.[0]?.familyGroupings;
          if (existing && existing !== '[]') {
            // Preserve existing FGs — incoming save has none, DB has real data
            data.familyGroupings = JSON.parse(existing);
          }
        }
      } catch { /* non-fatal — proceed with save as-is */ }
    }

    // Upsert — must specify on_conflict columns so PostgREST resolves the UNIQUE constraint
    const url = `${SUPABASE_URL}/rest/v1/ratio_check_data?on_conflict=centre_id,date,session`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        ...HEADERS,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        centre_id,
        date,
        session,
        data,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
