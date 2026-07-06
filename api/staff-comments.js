/**
 * /api/staff-comments
 * GET  ?staffId=...&centreId=...  -> list comments for a staff member
 * POST { centreId, staffId, userName, comment } -> add comment
 * DELETE ?id=... -> delete comment
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbG…6f1c';

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Prefer: 'return=representation',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { staffId, centreId } = req.query;
      if (!staffId || !centreId) {
        return res.status(400).json({ error: 'staffId and centreId required' });
      }
      const url = `${SUPABASE_URL}/rest/v1/staff_comments?centre_id=eq.${encodeURIComponent(centreId)}&staff_id=eq.${encodeURIComponent(staffId)}&select=*&order=created_at.desc`;
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return res.status(200).json({ ok: true, comments: rows || [] });
    }

    if (req.method === 'POST') {
      const { centreId, staffId, userName, comment } = req.body || {};
      if (!centreId || !staffId || !comment?.trim()) {
        return res.status(400).json({ error: 'centreId, staffId and comment required' });
      }
      const url = `${SUPABASE_URL}/rest/v1/staff_comments`;
      const r = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          centre_id: centreId,
          staff_id: staffId,
          user_name: userName || 'Unknown',
          comment: comment.trim(),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return res.status(200).json({ ok: true, comment: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const url = `${SUPABASE_URL}/rest/v1/staff_comments?id=eq.${encodeURIComponent(id)}`;
      const r = await fetch(url, { method: 'DELETE', headers: HEADERS });
      if (!r.ok) throw new Error(await r.text());
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[staff-comments] error:', e.message);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
