/**
 * /api/deputy-timesheets-actual
 *
 * Fetches actual Deputy timesheet data (clock-in/out + meal breaks) for a centre + date.
 * Used by RatioCheckPanel to overlay actual times over rostered times.
 *
 * This endpoint now also persists results to Supabase (`deputy_actual_timesheets`)
 * so historical reporting can read actuals without re-querying Deputy. The live
 * response is still returned immediately — callers never receive stale cached data.
 *
 * Query params:
 *   unitIds  - comma-separated Deputy operational unit IDs for the centre
 *   date     - YYYY-MM-DD
 *
 * Response: array of ActualTimesheet:
 * {
 *   employeeId:    number,
 *   employeeName:  string,
 *   unitId:        number,
 *   unitName:      string,
 *   actualStart:   string | null,   // HH:MM actual clock-in (null if not clocked in yet)
 *   actualEnd:     string | null,   // HH:MM actual clock-out (null if still in progress)
 *   isInProgress:  boolean,
 *   isRealTime:    boolean,         // true = actual clock, false = auto-generated
 *   breaks: [{
 *     breakStart:  string | null,   // HH:MM
 *     breakEnd:    string | null,   // HH:MM
 *     type:        'meal' | 'other',
 *     status:      'finished' | 'in_progress' | 'scheduled',
 *   }]
 * }
 */

import { fetchActualTimesheets } from './_actual-timesheets.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { unitIds, date } = req.query;
  if (!unitIds || !date) return res.status(400).json({ error: 'unitIds and date required' });

  const unitIdList = unitIds.split(',').map(Number).filter(Boolean);
  if (unitIdList.length === 0) return res.status(400).json({ error: 'no valid unitIds' });

  try {
    const results = await fetchActualTimesheets(unitIdList, date, { persist: true });

    // Don't cache actual timesheets in HTTP caches — stale clock-in/out data breaks ratio checks.
    // Supabase persistence is only for historical reporting; live callers always get fresh Deputy data.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(results);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
