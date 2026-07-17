/**
 * /api/ratio-check-sync
 *
 * Called by RatioCheckPanel after a staffMoves change to sync the correct
 * coverType into float_schedules — making the ratio check the source of
 * truth for programming vs ratio cover assignments.
 *
 * POST {
 *   centre_id: string,
 *   date:      string,       // YYYY-MM-DD
 *   staffMoves: Record<string, string>  // "${empId}:${slot}" -> roomId | "__programming__" | "__lunch__" | "__additional__" | ...
 *   rosters:   Array<{ employeeId: number, employeeName: string, startTime: string, endTime: string }>
 *   staffTimeOverrides: Record<string, { start?: string; end?: string; lunchStart?: string; lunchEnd?: string; ... }>
 *   floatEmployeeIds: number[]  // employees who are float/ISS (only these get new float_schedules rows created)
 * }
 *
 * For each empId in staffMoves:
 *   - If moved to "__programming__" -> set coverType = "programming"
 *   - If moved to a roomId          -> set coverType = "ratio"
 *   - Other moves (__lunch__, etc.) -> leave float_schedules unchanged (handled by float panel)
 *
 * If a float/ISS employee does not have an existing float_schedules row, one is
 * created from their ratio-check moves so the float panel loads the ratio-check
 * assignment instead of auto-generating a conflicting schedule.
 *
 * Safe to call multiple times — idempotent.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const HDRS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

const ACTIVITY_MOVES = new Set(['__programming__', '__lunch__', '__cleaning__', '__additional__', '__float__', '__removed__', 'none']);

const MORNING_SLOTS = [
  '06:30','06:45',
  '07:00','07:15','07:30','07:45',
  '08:00','08:15','08:30','08:45',
  '09:00','09:15','09:30','09:45',
];
const MIDDAY_SLOTS = [
  '10:00','10:30','11:00','11:30',
  '12:00','12:30','13:00','13:30',
];
const AFTERNOON_SLOTS = [
  '14:00','14:15','14:30','14:45',
  '15:00','15:15','15:30','15:45',
  '16:00','16:15','16:30','16:45',
  '17:00','17:15','17:30','17:45','18:00',
];
const ALL_SLOTS = [...MORNING_SLOTS, ...MIDDAY_SLOTS, ...AFTERNOON_SLOTS];
const SLOT_INDEX = new Map(ALL_SLOTS.map((s, i) => [s, i]));

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function hhmmToMins(t) {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minsToHhmm(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nextSlotEndMins(slot) {
  const idx = SLOT_INDEX.get(slot);
  if (idx === undefined) return hhmmToMins(slot) + 15;
  // End of last slot
  if (idx === ALL_SLOTS.length - 1) return hhmmToMins(slot) + 15;
  return hhmmToMins(ALL_SLOTS[idx + 1]);
}

function getShiftBounds(empIdStr, rosters, overrides) {
  const empIdNum = Number(empIdStr);
  const override = overrides?.[empIdStr];
  const roster = rosters?.find(r => r.employeeId === empIdNum);

  let start = override?.start || roster?.startTime || null;
  let end = override?.end || roster?.endTime || null;

  // Fallback to first/last move times if no roster/override
  return { start, end, employeeName: roster?.employeeName || '' };
}

function buildBlocksForEmployee(empIdStr, moves, rosters, overrides) {
  // Only activity/ratio moves become float blocks
  const activityMoves = moves.filter(m =>
    m.target === '__programming__' ||
    m.target === '__lunch__' ||
    m.target === '__cleaning__' ||
    m.target === '__additional__' ||
    (!ACTIVITY_MOVES.has(m.target) && m.target)
  );
  if (activityMoves.length === 0) return null;

  activityMoves.sort((a, b) => (SLOT_INDEX.get(a.slot) ?? 999) - (SLOT_INDEX.get(b.slot) ?? 999));

  const { start, end, employeeName } = getShiftBounds(empIdStr, rosters, overrides);
  const firstMoveStart = hhmmToMins(activityMoves[0].slot);
  const lastMoveEnd = nextSlotEndMins(activityMoves[activityMoves.length - 1].slot);

  const shiftStartMins = start ? hhmmToMins(start) : firstMoveStart;
  const shiftEndMins = end ? hhmmToMins(end) : lastMoveEnd;

  // Group contiguous slots with the same target
  const groups = [];
  let current = null;
  for (const m of activityMoves) {
    const idx = SLOT_INDEX.get(m.slot);
    const startMins = hhmmToMins(m.slot);
    const endMins = nextSlotEndMins(m.slot);
    if (!current || m.target !== current.target || idx !== current.lastIdx + 1) {
      if (current) groups.push(current);
      current = { target: m.target, startMins, endMins, lastIdx: idx };
    } else {
      current.endMins = endMins;
      current.lastIdx = idx;
    }
  }
  if (current) groups.push(current);

  const blocks = [];
  let prevEndMins = shiftStartMins;

  for (const g of groups) {
    if (g.startMins > prevEndMins) {
      blocks.push({
        id: uid(), type: 'start',
        startTime: minsToHhmm(prevEndMins),
        endTime: minsToHhmm(g.startMins),
        roomId: '', roomName: '',
        coveringEmployeeId: null, coveringEmployeeName: '', coveringEmployeeRoom: '',
        notes: '',
      });
    }
    blocks.push(buildBreakBlock(minsToHhmm(g.startMins), minsToHhmm(g.endMins), g.target));
    prevEndMins = g.endMins;
  }

  if (prevEndMins < shiftEndMins) {
    blocks.push({
      id: uid(), type: 'end',
      startTime: minsToHhmm(prevEndMins),
      endTime: minsToHhmm(shiftEndMins),
      roomId: '', roomName: '',
      coveringEmployeeId: null, coveringEmployeeName: '', coveringEmployeeRoom: '',
      notes: '',
    });
  }

  return { employeeName, blocks };
}

function buildBreakBlock(startTime, endTime, target) {
  let roomId = '';
  let roomName = '';
  let coverType = '';
  let notes = '';

  if (target === '__programming__') {
    coverType = 'programming';
    roomId = 'director';
    roomName = 'Off Floor Team';
    notes = 'Programming cover';
  } else if (target === '__lunch__') {
    coverType = 'lunch';
    notes = 'Lunch cover';
  } else if (target === '__cleaning__') {
    coverType = 'cleaning';
    roomId = 'other';
    roomName = 'Cleaning';
    notes = 'Cleaning duties';
  } else if (target === '__additional__') {
    coverType = 'programming';
    roomId = 'other';
    roomName = 'Additional Duties';
    notes = 'Additional duties';
  } else {
    // roomId = ratio cover
    coverType = 'ratio';
    roomId = target;
    roomName = target;
    notes = 'Ratio cover';
  }

  return {
    id: uid(), type: 'break',
    startTime, endTime,
    roomId, roomName,
    coveringEmployeeId: null, coveringEmployeeName: '', coveringEmployeeRoom: '',
    coverType, notes,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { centre_id, date, staffMoves, rosters, staffTimeOverrides, floatEmployeeIds = [] } = req.body;
  if (!centre_id || !date || !staffMoves) return res.status(400).json({ error: 'centre_id, date, staffMoves required' });

  const floatEmpSet = new Set(floatEmployeeIds.map(Number));

  // Group moves by employee
  const movesByEmp = {};
  for (const [key, target] of Object.entries(staffMoves)) {
    const [empIdStr, slot] = key.split(':');
    if (!empIdStr || !slot) continue;
    movesByEmp[empIdStr] = movesByEmp[empIdStr] || [];
    movesByEmp[empIdStr].push({ slot, target });
  }

  // Build map: empId -> new coverType (only for programming/ratio moves)
  // These employees will have existing rows patched.
  const coverTypeByEmp = {};
  for (const [empIdStr, moves] of Object.entries(movesByEmp)) {
    for (const m of moves) {
      if (m.target === '__programming__') {
        coverTypeByEmp[empIdStr] = 'programming';
      } else if (!ACTIVITY_MOVES.has(m.target) && m.target) {
        coverTypeByEmp[empIdStr] = 'ratio';
      }
    }
  }

  const relevantEmpIds = Object.keys(movesByEmp);
  if (relevantEmpIds.length === 0) {
    return res.status(200).json({ ok: true, patched: 0, created: 0 });
  }

  // Fetch existing float_schedules for this centre+date
  const base = `${SUPABASE_URL}/rest/v1/float_schedules`;
  const empIds = relevantEmpIds.join(',');
  const fetchUrl = `${base}?centre_id=eq.${encodeURIComponent(centre_id)}&date=eq.${date}&employee_id=in.(${empIds})&select=*`;
  const fetchR = await fetch(fetchUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!fetchR.ok) return res.status(500).json({ error: 'Failed to fetch float_schedules: ' + await fetchR.text() });

  const existing = await fetchR.json();
  const existingByEmp = new Map((Array.isArray(existing) ? existing : []).map(r => [String(r.employee_id), r]));

  let patched = 0;
  let created = 0;
  const errors = [];

  // 1. Patch existing rows
  for (const [empIdStr, newCoverType] of Object.entries(coverTypeByEmp)) {
    const row = existingByEmp.get(empIdStr);
    if (!row) continue;

    const schedule = Array.isArray(row.schedule) ? row.schedule : [];
    const hasBreakBlocks = schedule.some(b => b.type === 'break');
    if (!hasBreakBlocks) continue;

    const patchedSchedule = schedule.map(block => {
      if (block.type !== 'break') return block;
      return { ...block, coverType: newCoverType };
    });

    const patchR = await fetch(
      `${base}?centre_id=eq.${encodeURIComponent(centre_id)}&date=eq.${date}&employee_id=eq.${row.employee_id}`,
      {
        method: 'PATCH',
        headers: HDRS,
        body: JSON.stringify({ schedule: patchedSchedule, saved_at: new Date().toISOString() }),
      }
    );

    if (patchR.status >= 300) {
      errors.push(`patch emp ${row.employee_id}: ${await patchR.text()}`);
    } else {
      patched++;
    }
  }

  // 2. Create missing rows for float/ISS employees
  for (const empIdStr of relevantEmpIds) {
    if (existingByEmp.has(empIdStr)) continue;
    const empIdNum = Number(empIdStr);
    if (!floatEmpSet.has(empIdNum)) continue;

    const built = buildBlocksForEmployee(empIdStr, movesByEmp[empIdStr], rosters, staffTimeOverrides);
    if (!built || built.blocks.length === 0) continue;

    const insertR = await fetch(`${base}?on_conflict=centre_id,date,employee_id`, {
      method: 'POST',
      headers: HDRS,
      body: JSON.stringify({
        centre_id,
        date,
        employee_id: empIdNum,
        employee_name: built.employeeName || '',
        schedule: built.blocks,
        saved_at: new Date().toISOString(),
      }),
    });

    if (insertR.status >= 300) {
      errors.push(`create emp ${empIdNum}: ${await insertR.text()}`);
    } else {
      created++;
    }
  }

  if (errors.length) return res.status(207).json({ ok: false, patched, created, errors });
  return res.status(200).json({ ok: true, patched, created });
}
