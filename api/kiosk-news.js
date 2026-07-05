/**
 * GET  /api/kiosk-news?centreId=...&staffId=...&roomId=...
 *      Returns announcements visible to the logged-in educator.
 *      Centre-wide announcements + room-specific (if roomId matches) +
 *      person-specific (if staffId matches).
 *
 * POST /api/kiosk-news
 *      { centreId, title, body, targetType: 'centre'|'room'|'person',
 *        targetRoomId?, targetStaffId?, priority? }
 *      Creates a new kiosk announcement. Directors/admins only.
 *
 * DELETE /api/kiosk-news?id=...
 *      Deletes an announcement. Directors/admins only.
 */
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Prefer: 'return=representation',
};

export default async function handler(req, res) {
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    return res.status(405).end();
  } catch (e) {
    console.error('kiosk-news error:', e);
    return res.status(500).json({ error: e.message || 'server error' });
  }
}

async function handleGet(req, res) {
  const { centreId, staffId, roomId } = req.query;
  if (!centreId || !staffId) {
    return res.status(400).json({ error: 'centreId and staffId required' });
  }

  const roomClause = roomId
    ? `,and(target_type.eq.room,target_room_id.eq.${encodeURIComponent(roomId)})`
    : '';
  const orFilter = `target_type.eq.centre${roomClause},and(target_type.eq.person,target_staff_id.eq.${encodeURIComponent(staffId)})`;
  const url = `${SUPABASE_URL}/rest/v1/kiosk_news?centre_id=eq.${encodeURIComponent(centreId)}&or=(${orFilter})&order=created_at.desc&select=*`;

  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error('news lookup failed');
  const rows = await r.json();

  // Filter out expired announcements client-side (low volume)
  const now = Date.now();
  const visible = (rows || []).filter(n => !n.expires_at || new Date(n.expires_at).getTime() >= now);
  return res.status(200).json({ ok: true, news: visible });
}

async function handlePost(req, res) {
  const body = req.body || {};
  const { centreId, title, body: newsBody, targetType, targetRoomId, targetStaffId, priority } = body;

  if (!centreId || !title || !newsBody || !targetType) {
    return res.status(400).json({ error: 'centreId, title, body, targetType required' });
  }
  if (!['centre', 'room', 'person'].includes(targetType)) {
    return res.status(400).json({ error: 'targetType must be centre, room or person' });
  }
  if (targetType === 'room' && !targetRoomId) {
    return res.status(400).json({ error: 'targetRoomId required for room announcements' });
  }
  if (targetType === 'person' && !targetStaffId) {
    return res.status(400).json({ error: 'targetStaffId required for person announcements' });
  }

  const insert = {
    centre_id: centreId,
    title,
    body: newsBody,
    target_type: targetType,
    target_room_id: targetType === 'room' ? targetRoomId : null,
    target_staff_id: targetType === 'person' ? targetStaffId : null,
    priority: ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
    posted_by: body.postedBy || 'Director',
    created_at: new Date().toISOString(),
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_news`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(insert),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`news insert failed: ${txt}`);
  }
  const rows = await r.json().catch(() => null);
  return res.status(200).json({ ok: true, news: Array.isArray(rows) ? rows[0] : rows });
}

async function handleDelete(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/kiosk_news?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error('news delete failed');
  return res.status(200).json({ ok: true });
}
