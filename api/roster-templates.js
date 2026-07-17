/**
 * /api/roster-templates
 *
 * CRUD for roster templates (Week A, Week B, etc.) and their shifts.
 *
 * GET  ?centreId=oatley                     → list templates for centre
 * GET  ?centreId=oatley&id=<uuid>           → single template with shifts
 * POST { centre_id, name }                  → create template
 * PATCH ?id=<uuid> { name }                 → rename template
 * DELETE ?id=<uuid>                         → delete template (cascades shifts)
 *
 * Template shifts (nested under a template):
 * POST ?id=<uuid>&action=save-shifts  { shifts: [...] }  → upsert all shifts for template
 *
 * Apply template to a week:
 * POST ?id=<uuid>&action=apply { centreId, weekStart }
 *   → writes roster_shifts rows for Mon–Fri of that week
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const H = {
  apikey:        SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer:        'return=representation',
};

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, data: text }; }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { centreId, id, action } = req.query;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!centreId) return res.status(400).json({ error: 'centreId required' });

    if (id) {
      // Single template with its shifts
      const [tpl, shifts] = await Promise.all([
        sb(`roster_templates?id=eq.${id}&centre_id=eq.${centreId}&select=*&limit=1`),
        sb(`roster_template_shifts?template_id=eq.${id}&select=*&order=day_of_week.asc,start_time.asc&limit=500`),
      ]);
      if (!tpl.ok || !tpl.data?.length) return res.status(404).json({ error: 'Template not found' });
      return res.status(200).json({ ...tpl.data[0], shifts: shifts.data || [] });
    }

    // List all templates for centre
    const { ok, data } = await sb(`roster_templates?centre_id=eq.${encodeURIComponent(centreId)}&select=*&order=created_at.asc`);
    if (!ok) return res.status(500).json({ error: 'Failed to load templates' });
    return res.status(200).json(data || []);
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // Apply template to a week → writes roster_shifts
    if (action === 'apply' && id) {
      const { weekStart } = body;
      if (!weekStart) return res.status(400).json({ error: 'weekStart required' });

      // Load template shifts
      const { ok, data: templateShifts } = await sb(
        `roster_template_shifts?template_id=eq.${id}&select=*&limit=500`
      );
      if (!ok) return res.status(500).json({ error: 'Failed to load template shifts' });
      if (!templateShifts?.length) return res.status(200).json({ ok: true, written: 0 });

      // Get or create roster_week
      const weekRes = await sb(
        `roster_weeks?centre_id=eq.${encodeURIComponent(body.centreId)}&week_start=eq.${weekStart}&select=id&limit=1`
      );
      let weekId;
      if (weekRes.ok && weekRes.data?.length) {
        weekId = weekRes.data[0].id;
      } else {
        const created = await sb('roster_weeks', {
          method: 'POST',
          body: JSON.stringify({ centre_id: body.centreId, week_start: weekStart, status: 'draft' }),
        });
        if (!created.ok) return res.status(500).json({ error: 'Failed to create roster week' });
        weekId = Array.isArray(created.data) ? created.data[0]?.id : created.data?.id;
      }

      // Map day_of_week (1=Mon) to actual dates for that week
      const dayToDate = {};
      for (let i = 0; i < 5; i++) {
        dayToDate[i + 1] = addDays(weekStart, i);
      }

      // Build roster_shifts rows — upsert (staff_id + date unique)
      const rows = templateShifts
        .filter(s => s.day_of_week >= 1 && s.day_of_week <= 5)
        .map(s => ({
          roster_week_id: weekId,
          centre_id:      body.centreId,
          staff_id:       s.staff_id,
          staff_name:     s.staff_name,
          date:           dayToDate[s.day_of_week],
          start_time:     s.start_time,
          end_time:       s.end_time,
          room_id:        s.room_id || s.assignment || null,
          room_name:      s.room_name || s.assignment || null,
          lunch_start:    s.lunch_start || null,
          lunch_duration: s.lunch_duration || 30,
          notes:          s.notes || null,
          is_casual:      false,
        }));

      if (!rows.length) return res.status(200).json({ ok: true, written: 0 });

      const upsert = await sb('roster_shifts?on_conflict=staff_id,date', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
      if (!upsert.ok) return res.status(500).json({ error: 'Failed to write shifts', detail: upsert.data });

      return res.status(200).json({ ok: true, written: rows.length, weekId });
    }

    // Save shifts for a template
    if (action === 'save-shifts' && id) {
      const { shifts } = body;
      if (!Array.isArray(shifts)) return res.status(400).json({ error: 'shifts array required' });

      // Delete existing then re-insert (clean replace)
      await sb(`roster_template_shifts?template_id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

      if (shifts.length === 0) return res.status(200).json({ ok: true });

      const rows = shifts.map(s => ({
        template_id:    id,
        centre_id:      body.centre_id || body.centreId || '',
        staff_id:       s.staff_id,
        staff_name:     s.staff_name || '',
        day_of_week:    s.day_of_week,
        start_time:     s.start_time || null,
        end_time:       s.end_time   || null,
        room_id:        s.room_id || s.assignment || null,
        room_name:      s.room_name || s.assignment || null,
        lunch_start:    s.lunch_start || null,
        lunch_duration: s.lunch_duration || 30,
        notes:          s.notes || null,
      }));

      const { ok, data } = await sb('roster_template_shifts', {
        method: 'POST',
        body: JSON.stringify(rows),
      });
      if (!ok) return res.status(500).json({ error: 'Failed to save shifts', detail: data });
      return res.status(200).json({ ok: true, saved: rows.length });
    }

    // Create new template
    const { centre_id, name } = body;
    if (!centre_id || !name) return res.status(400).json({ error: 'centre_id and name required' });

    const { ok, data } = await sb('roster_templates', {
      method: 'POST',
      body: JSON.stringify({ centre_id, name }),
    });
    if (!ok) return res.status(500).json({ error: 'Failed to create template', detail: data });
    return res.status(201).json(Array.isArray(data) ? data[0] : data);
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const { ok, data } = await sb(`roster_templates?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    if (!ok) return res.status(500).json({ error: 'Failed to update template' });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const { ok } = await sb(`roster_templates?id=eq.${id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (!ok) return res.status(500).json({ error: 'Failed to delete template' });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
