/**
 * /api/grouping-sessions
 * GET  ?centre=xxx&date=yyy          → fetch sessions for centre+date
 * POST { sessions: GroupingSession[] } → upsert sessions
 * PATCH { id, ...patch }             → update single session (confirm/modify)
 *
 * Supabase table:
 *   CREATE TABLE IF NOT EXISTS grouping_sessions (
 *     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     centre_id TEXT NOT NULL,
 *     date DATE NOT NULL,
 *     session_start TEXT NOT NULL,
 *     session_end TEXT NOT NULL,
 *     group_label TEXT NOT NULL,
 *     rooms_included JSONB DEFAULT '[]',
 *     staff_ids JSONB DEFAULT '[]',
 *     staff_names JSONB DEFAULT '[]',
 *     children_count INTEGER DEFAULT 0,
 *     confirmation_status TEXT DEFAULT 'suggested',
 *     confirmed_by TEXT,
 *     notes TEXT,
 *     created_at TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at TIMESTAMPTZ DEFAULT NOW()
 *   );
 *   ALTER TABLE grouping_sessions ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "service_role all" ON grouping_sessions FOR ALL USING (true);
 *   CREATE INDEX ON grouping_sessions (centre_id, date);
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const HDRS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const base = `${SUPABASE_URL}/rest/v1/grouping_sessions`;

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { centre, date } = req.query;
    if (!centre || !date) return res.status(400).json({ error: 'centre and date required' });

    const r = await fetch(
      `${base}?centre_id=eq.${encodeURIComponent(centre)}&date=eq.${date}&order=session_start.asc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist')) return res.status(200).json([]);
      return res.status(500).json({ error: txt });
    }
    return res.status(200).json(await r.json());
  }

  // ── POST — upsert sessions ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { sessions, centre, date } = req.body ?? {};
    if (!sessions?.length) return res.status(400).json({ error: 'sessions array required' });

    // Delete existing suggested/reconstructed sessions for this centre+date first
    // (keeps confirmed/modified ones intact)
    if (centre && date) {
      await fetch(
        `${base}?centre_id=eq.${encodeURIComponent(centre)}&date=eq.${date}&confirmation_status=in.(suggested,reconstructed)`,
        { method: 'DELETE', headers: HDRS }
      ).catch(() => {});
    }

    const rows = sessions.map(s => ({
      centre_id:            s.centreId,
      date:                 s.date,
      session_start:        s.sessionStart,
      session_end:          s.sessionEnd,
      group_label:          s.groupLabel,
      rooms_included:       s.roomsIncluded ?? [],
      staff_ids:            s.staffIds ?? [],
      staff_names:          s.staffNames ?? [],
      staff_rooms:          s.staffRooms ?? [],
      held_in_room:         s.heldInRoom ?? null,
      children_count:       s.childrenCount ?? 0,
      confirmation_status:  s.confirmationStatus ?? 'suggested',
      confirmed_by:         s.confirmedBy ?? null,
      notes:                s.notes ?? null,
      updated_at:           new Date().toISOString(),
    }));

    const r = await fetch(base, {
      method: 'POST',
      headers: { ...HDRS, Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('does not exist')) return res.status(404).json({ error: 'table_not_found', sql: CREATE_SQL });
      return res.status(500).json({ error: txt });
    }
    return res.status(200).json(await r.json());
  }

  // ── PATCH — confirm / modify a single session ──────────────────────────────
  if (req.method === 'PATCH') {
    const { id, ...patch } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const update = {
      ...(patch.confirmationStatus && { confirmation_status: patch.confirmationStatus }),
      ...(patch.confirmedBy        && { confirmed_by: patch.confirmedBy }),
      ...(patch.sessionStart       && { session_start: patch.sessionStart }),
      ...(patch.sessionEnd         && { session_end: patch.sessionEnd }),
      ...(patch.staffIds           && { staff_ids: patch.staffIds }),
      ...(patch.staffNames         && { staff_names: patch.staffNames }),
      ...(patch.staffRooms         && { staff_rooms: patch.staffRooms }),
      ...(patch.heldInRoom !== undefined && { held_in_room: patch.heldInRoom }),
      ...(patch.notes              !== undefined && { notes: patch.notes }),
      updated_at: new Date().toISOString(),
    };

    const r = await fetch(`${base}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...HDRS, Prefer: 'return=representation' },
      body: JSON.stringify(update),
    });
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(200).json(await r.json());
  }

  // ── DELETE ────────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    await fetch(`${base}?id=eq.${id}`, { method: 'DELETE', headers: HDRS });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS grouping_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  centre_id TEXT NOT NULL, date DATE NOT NULL,
  session_start TEXT NOT NULL, session_end TEXT NOT NULL,
  group_label TEXT NOT NULL,
  rooms_included JSONB DEFAULT '[]', staff_ids JSONB DEFAULT '[]', staff_names JSONB DEFAULT '[]',
  children_count INTEGER DEFAULT 0, confirmation_status TEXT DEFAULT 'suggested',
  confirmed_by TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE grouping_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role all" ON grouping_sessions FOR ALL USING (true);
CREATE INDEX ON grouping_sessions (centre_id, date);`;
