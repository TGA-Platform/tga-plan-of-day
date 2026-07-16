/**
 * Directors manage kiosk PINs.
 * GET  ?centreId=...           → list PINs for centre
 * POST { centreId, staffId, staffName, mobile, pin, role?, createdBy } → create/update PIN
 * DELETE ?id=...               → delete PIN
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Prefer: 'return=representation',
};

function validatePin(pin) {
  return /^\d{4}$/.test(String(pin));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const centreId = req.query.centreId;
      if (!centreId) return res.status(400).json({ error: 'centreId required' });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/kiosk_staff_pins?centre_id=eq.${encodeURIComponent(centreId)}&order=staff_name.asc&select=*`,
        { headers: HEADERS }
      );
      if (!r.ok) throw new Error('list failed');
      const rows = await r.json();
      return res.status(200).json({ ok: true, pins: rows });
    }

    if (req.method === 'POST') {
      const { centreId, staffId, staffName, mobile, pin, role, createdBy } = req.body || {};
      if (!centreId || !staffId || !staffName || !mobile || !pin) {
        return res.status(400).json({ error: 'centreId, staffId, staffName, mobile, pin required' });
      }
      if (!validatePin(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

      // Upsert by (centre_id, staff_id)
      const body = {
        centre_id: centreId,
        staff_id: staffId,
        staff_name: staffName,
        mobile: String(mobile).replace(/\s/g, ''),
        pin: String(pin),
        role: role || null,
        created_by: createdBy || null,
        updated_at: new Date().toISOString(),
      };

      const r = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_staff_pins`, {
        method: 'POST',
        headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`upsert failed: ${txt}`);
      }
      const rows = await r.json().catch(() => null);
      return res.status(200).json({ ok: true, pin: Array.isArray(rows) ? rows[0] : rows });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_staff_pins?id=eq.${id}`, {
        method: 'DELETE',
        headers: HEADERS,
      });
      if (!r.ok) throw new Error('delete failed');
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (e) {
    console.error('kiosk-pins error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
