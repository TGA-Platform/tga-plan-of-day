/**
 * /api/staffing-structure
 *
 * GET  ?centreId=bexley                     → all groups + staff for a centre
 * POST body { action, ...params }           → CRUD operations
 *
 * Actions:
 *   create_staff    { centreId, groupId, name, ...fields }
 *   update_staff    { staffId, fields: { col: val, ... } }
 *   delete_staff    { staffId }
 *   move_staff      { staffId, groupId }
 *   create_room     { centreId, title, color }
 *   update_room     { centreId, groupId, title?, color?, isActive? }
 *   delete_room     { centreId, groupId }  -- only if no staff
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const SB = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function sbGet(path) {
  const r = await fetch(`${SB}${path}`, { headers: HEADERS });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase GET ${r.status}: ${t}`); }
  return r.json();
}

async function sbPost(path, body) {
  const r = await fetch(`${SB}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase POST ${r.status}: ${t}`); }
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SB}${path}`, { method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase PATCH ${r.status}: ${t}`); }
  return r.json();
}

async function sbDelete(path) {
  const r = await fetch(`${SB}${path}`, { method: 'DELETE', headers: HEADERS });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase DELETE ${r.status}: ${t}`); }
  return r.status === 204 ? null : r.json();
}

// Map staff_member row → frontend StaffMember shape
function mapRow(row, docs) {
  const rowDocs = docs.filter(d => d.staff_id === row.id);
  return {
    id: row.id,
    mondayId: row.monday_id,
    name: row.name,
    qualification: row.qualification || '',
    ratio50: row.ratio_50,
    position: row.position,
    positionCategory: row.position_category,
    campus: row.centre_id,
    startDate: row.start_date,
    endDate: row.end_date,
    dob: row.dob,
    daysPerWeek: row.days_per_week,
    minHoursPerWeek: row.min_hours_pw,
    probationaryDate: row.probationary_date,
    email: row.email,
    mobile: row.mobile,
    seekUrl: row.seek_url,
    action: row.action,
    employmentStatus: row.employment_status || 'Active',
    compliance: {
      wwccNumber: row.wwcc_number,
      wwccExpiry: row.wwcc_expiry,
      firstAidCode: row.first_aid_code,
      firstAidExpiry: row.first_aid_expiry,
      cprCode: row.cpr_code,
      cprExpiry: row.cpr_expiry,
      anaphylaxisCode: row.anaphylaxis_code,
      anaphylaxisExpiry: row.anaphylaxis_expiry,
      childProtectionRenewal: row.child_protection_renewal,
    },
    docs:     rowDocs.filter(d => d.doc_type === 'main').map(d => ({ id: d.id, label: d.label, url: d.storage_path ? `/api/staffing-file?path=${encodeURIComponent(d.storage_path)}` : d.monday_url || '' })),
    certDocs: rowDocs.filter(d => d.doc_type === 'subitem').map(d => ({ id: d.id, label: d.label, url: d.storage_path ? `/api/staffing-file?path=${encodeURIComponent(d.storage_path)}` : d.monday_url || '' })),
  };
}

// Editable columns exposed to frontend
const EDITABLE_COLUMNS = [
  { id: 'employment_status', label: 'Employment Status',        type: 'status', options: ['Active','Inactive','PPL','Long Service','Probation','Casual','Resigned'] },
  { id: 'position',          label: 'Position',                 type: 'status', options: ['Centre Director','Assistant Director','Educational Leader','Room Leader','Early Childhood Teacher','Early Childhood Teacher Room Leader','Educator','Mama Bear Educator','Mama Bear','Childcare Trainee','Trainee','Casual Educator','Internal Casual Educator','ISS Support Worker','Diploma Educator','Centre Support','Chef'] },
  { id: 'position_category', label: 'Position Category',        type: 'status', options: ['Full Time','Part Time','Casual','As Required'] },
  { id: 'qualification',     label: 'Qualification',            type: 'status', options: ['ECT','WT ECT','Diploma','Certificate 3','Trainee','ISS','Chef','PPL','WT Diploma','No Qualification','Resigned'] },
  { id: 'ratio_50',          label: '50% Ratio',                type: 'status', options: ['Diploma & Above','Cert 3 & Below'] },
  { id: 'action',            label: 'Action',                   type: 'status', options: ['','Send Onboarding Kit','Renew Contract','Follow Up'] },
  { id: 'start_date',        label: 'Start Date',               type: 'date' },
  { id: 'end_date',          label: 'End Date',                 type: 'text' },
  { id: 'email',             label: 'Email',                    type: 'text' },
  { id: 'mobile',            label: 'Mobile',                   type: 'text' },
  { id: 'days_per_week',     label: 'Days Per Week',            type: 'text' },
  { id: 'min_hours_pw',      label: 'Min Hours Per Week',       type: 'text' },
  { id: 'wwcc_number',       label: 'WWCC Number',              type: 'text' },
  { id: 'wwcc_expiry',       label: 'WWCC Expiry',              type: 'date' },
  { id: 'first_aid_code',    label: 'First Aid Code',           type: 'text' },
  { id: 'first_aid_expiry',  label: 'First Aid Expiry',         type: 'date' },
  { id: 'cpr_code',          label: 'CPR Code',                 type: 'text' },
  { id: 'cpr_expiry',        label: 'CPR Expiry',               type: 'date' },
  { id: 'anaphylaxis_code',  label: 'Anaphylaxis Code',         type: 'text' },
  { id: 'anaphylaxis_expiry',label: 'Anaphylaxis Expiry',       type: 'date' },
  { id: 'child_protection_renewal', label: 'Child Protection Renewal', type: 'date' },
];

// ── Main handler ───────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { centreId } = req.query;
    if (!centreId) return res.status(400).json({ error: 'centreId required' });

    try {
      // Fetch rooms
      const rooms = await sbGet(`/staff_rooms?centre_id=eq.${centreId}&order=sort_order.asc,title.asc`);

      // Fetch staff
      const staff = await sbGet(`/staff_members?centre_id=eq.${centreId}&order=sort_order.asc,name.asc`);

      // Fetch docs for all staff
      const staffIds = staff.map(s => s.id);
      let docs = [];
      if (staffIds.length > 0) {
        docs = await sbGet(`/staff_documents?staff_id=in.(${staffIds.join(',')})&order=uploaded_at.asc`);
      }

      // If no rooms in DB yet, derive from staff (handles migrated data)
      let roomList = rooms;
      if (roomList.length === 0 && staff.length > 0) {
        const seen = new Map();
        for (const s of staff) {
          if (!seen.has(s.group_id)) {
            seen.set(s.group_id, {
              id: s.group_id,
              centre_id: s.centre_id,
              group_id: s.group_id,
              title: s.group_title,
              color: s.group_color || '#808080',
              is_active: s.is_active_group,
              sort_order: 0,
            });
          }
        }
        roomList = Array.from(seen.values());
      }

      // Build groups
      const groups = roomList.map(room => ({
        id: room.group_id,
        title: room.title,
        color: room.color || '#808080',
        isActive: room.is_active,
        staff: staff.filter(s => s.group_id === room.group_id).map(s => mapRow(s, docs)),
      }));

      return res.json({
        centreId,
        groups,
        editableColumns: EDITABLE_COLUMNS,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('staffing GET error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const { action } = body;

    try {
      switch (action) {

        // Create staff member
        case 'create_staff': {
          const { centreId, groupId, name, qualification, ...rest } = body;
          // Get room info
          const rooms = await sbGet(`/staff_rooms?centre_id=eq.${centreId}&group_id=eq.${groupId}`);
          const room = rooms[0];
          const row = {
            centre_id: centreId,
            group_id: groupId,
            group_title: room?.title || groupId,
            group_color: room?.color || '#808080',
            is_active_group: room?.is_active ?? true,
            name,
            qualification: qualification || null,
            position: rest.position || null,
            position_category: rest.positionCategory || null,
            start_date: rest.startDate || null,
            email: rest.email || null,
            mobile: rest.mobile || null,
          };
          const [created] = await sbPost('/staff_members', row);
          return res.json({ ok: true, staff: created });
        }

        // Update staff fields
        case 'update_staff': {
          const { staffId, fields } = body;
          if (!staffId || !fields) return res.status(400).json({ error: 'staffId and fields required' });
          const [updated] = await sbPatch(`/staff_members?id=eq.${staffId}`, fields);
          return res.json({ ok: true, staff: updated });
        }

        // Delete staff member
        case 'delete_staff': {
          const { staffId } = body;
          if (!staffId) return res.status(400).json({ error: 'staffId required' });
          await sbDelete(`/staff_members?id=eq.${staffId}`);
          return res.json({ ok: true });
        }

        // Move staff to different room
        case 'move_staff': {
          const { staffId, groupId, centreId } = body;
          if (!staffId || !groupId) return res.status(400).json({ error: 'staffId and groupId required' });
          const rooms = await sbGet(`/staff_rooms?centre_id=eq.${centreId}&group_id=eq.${groupId}`);
          const room = rooms[0];
          await sbPatch(`/staff_members?id=eq.${staffId}`, {
            group_id: groupId,
            group_title: room?.title || groupId,
            group_color: room?.color || '#808080',
            is_active_group: room?.is_active ?? true,
          });
          return res.json({ ok: true });
        }

        // Create room
        case 'create_room': {
          const { centreId, title, color } = body;
          if (!centreId || !title) return res.status(400).json({ error: 'centreId and title required' });
          const groupId = `room_${Date.now()}`;
          const [room] = await sbPost('/staff_rooms', {
            centre_id: centreId, group_id: groupId, title, color: color || '#808080', is_active: true,
          });
          return res.json({ ok: true, room });
        }

        // Update room (rename, recolor, toggle active)
        case 'update_room': {
          const { centreId, groupId, title, color, isActive } = body;
          if (!centreId || !groupId) return res.status(400).json({ error: 'centreId and groupId required' });
          const patch = {};
          if (title    !== undefined) patch.title     = title;
          if (color    !== undefined) patch.color     = color;
          if (isActive !== undefined) patch.is_active = isActive;
          // Update room record
          await sbPatch(`/staff_rooms?centre_id=eq.${centreId}&group_id=eq.${groupId}`, patch);
          // Sync group_title/color on all staff in this room
          if (title !== undefined) await sbPatch(`/staff_members?centre_id=eq.${centreId}&group_id=eq.${groupId}`, { group_title: title });
          if (color !== undefined) await sbPatch(`/staff_members?centre_id=eq.${centreId}&group_id=eq.${groupId}`, { group_color: color });
          if (isActive !== undefined) await sbPatch(`/staff_members?centre_id=eq.${centreId}&group_id=eq.${groupId}`, { is_active_group: isActive });
          return res.json({ ok: true });
        }

        // Delete room (only if empty)
        case 'delete_room': {
          const { centreId, groupId } = body;
          if (!centreId || !groupId) return res.status(400).json({ error: 'centreId and groupId required' });
          const staff = await sbGet(`/staff_members?centre_id=eq.${centreId}&group_id=eq.${groupId}&select=id&limit=1`);
          if (staff.length > 0) return res.status(400).json({ error: 'Cannot delete room with staff. Move or delete staff first.' });
          await sbDelete(`/staff_rooms?centre_id=eq.${centreId}&group_id=eq.${groupId}`);
          return res.json({ ok: true });
        }

        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }
    } catch (err) {
      console.error('staffing POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
