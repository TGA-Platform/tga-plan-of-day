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
 * }
 *
 * For each empId in staffMoves:
 *   - If moved to "__programming__" -> set coverType = "programming" on all break blocks
 *   - If moved to a roomId          -> set coverType = "ratio" on all break blocks
 *   - Other moves (__lunch__, etc.) -> leave float_schedules unchanged (handled by float panel)
 *
 * Only patches existing float_schedules rows (does not create them).
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { centre_id, date, staffMoves, rosters } = req.body;
  if (!centre_id || !date || !staffMoves) return res.status(400).json({ error: 'centre_id, date, staffMoves required' });

  // Build map: empId -> new coverType (only for programming/ratio moves)
  // Key: empId (string), Value: 'programming' | 'ratio' | null (null = skip)
  const coverTypeByEmp = {};
  for (const [key, target] of Object.entries(staffMoves)) {
    const [empIdStr] = key.split(':');
    const empId = empIdStr;
    if (target === '__programming__') {
      coverTypeByEmp[empId] = 'programming';
    } else if (!ACTIVITY_MOVES.has(target) && target) {
      // Moved to a specific room = ratio cover
      coverTypeByEmp[empId] = 'ratio';
    }
  }

  if (Object.keys(coverTypeByEmp).length === 0) {
    return res.status(200).json({ ok: true, patched: 0, skipped: 'no programming/ratio moves' });
  }

  // Fetch existing float_schedules for this centre+date
  const base = `${SUPABASE_URL}/rest/v1/float_schedules`;
  const empIds = Object.keys(coverTypeByEmp).join(',');
  const fetchUrl = `${base}?centre_id=eq.${encodeURIComponent(centre_id)}&date=eq.${date}&employee_id=in.(${empIds})&select=*`;
  const fetchR = await fetch(fetchUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!fetchR.ok) return res.status(500).json({ error: 'Failed to fetch float_schedules: ' + await fetchR.text() });

  const existing = await fetchR.json();
  if (!Array.isArray(existing) || existing.length === 0) {
    return res.status(200).json({ ok: true, patched: 0, note: 'No float_schedules rows found for these staff — float panel has not saved yet' });
  }

  let patched = 0;
  const errors = [];

  for (const row of existing) {
    const empId = String(row.employee_id);
    const newCoverType = coverTypeByEmp[empId];
    if (!newCoverType) continue;

    // Patch all 'break' blocks in the schedule to have the new coverType
    const schedule = Array.isArray(row.schedule) ? row.schedule : [];
    const hasBreakBlocks = schedule.some(b => b.type === 'break');
    if (!hasBreakBlocks) continue; // nothing to patch

    const patchedSchedule = schedule.map(block => {
      if (block.type !== 'break') return block;
      return { ...block, coverType: newCoverType };
    });

    // Write back
    const patchR = await fetch(
      `${base}?centre_id=eq.${encodeURIComponent(centre_id)}&date=eq.${date}&employee_id=eq.${row.employee_id}`,
      {
        method: 'PATCH',
        headers: HDRS,
        body: JSON.stringify({ schedule: patchedSchedule, saved_at: new Date().toISOString() }),
      }
    );

    if (patchR.status >= 300) {
      errors.push(`emp ${row.employee_id}: ${await patchR.text()}`);
    } else {
      patched++;
    }
  }

  if (errors.length) return res.status(207).json({ ok: false, patched, errors });
  return res.status(200).json({ ok: true, patched });
}
