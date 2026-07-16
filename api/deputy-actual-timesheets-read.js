/**
 * /api/deputy-actual-timesheets-read
 *
 * Reads persisted Deputy actual timesheets from Supabase (deputy_actual_timesheets).
 * Returns the same shape as /api/deputy-timesheets-actual so callers can swap
 * live Deputy for the frozen/cached copy stored in Supabase.
 */

import { readActualTimesheets } from './_actual-timesheets.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { unitIds, date } = req.query;
  if (!unitIds || !date) {
    return res.status(400).json({ error: 'unitIds and date required' });
  }

  const unitIdList = String(unitIds)
    .split(',')
    .map(id => Number(id.trim()))
    .filter(Boolean);

  if (unitIdList.length === 0) {
    return res.status(400).json({ error: 'no valid unitIds' });
  }

  try {
    const rows = await readActualTimesheets(unitIdList, date);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('[deputy-actual-timesheets-read] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
