/**
 * deputy-units.js
 * Returns all Deputy operational units, classified by type.
 * Used by the summary page to discover room/float/leave/support units for ALL centres.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Units rarely change — cache for 10 minutes
  res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const response = await fetch('https://thegroveacademy.au.deputy.com/api/v1/resource/OperationalUnit/QUERY', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer cf73b1628a5e3498d713879bcf07a974',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ max: 1000 }),
  });

  const units = await response.json();
  if (!Array.isArray(units)) return res.status(500).json({ error: 'Deputy error' });

  // Classify each unit by name
  const classified = units
    .filter(u => u.CompanyName?.includes('The Grove Academy'))
    .map(u => ({
      id:       u.Id,
      name:     u.OperationalUnitName,
      company:  u.CompanyName,
      centre:   u.CompanyName?.replace('The Grove Academy - ', '').trim(),
      type:     classifyUnit(u.OperationalUnitName),
      ratio:    getRatio(u.OperationalUnitName),
    }));

  res.status(200).json(classified);
}

function classifyUnit(name) {
  if (!name) return 'support';
  const n = name.toLowerCase();

  // Leave / non-working
  if (/leave|holiday|time off/.test(n)) return 'leave';

  // Float / relief / ISS (inclusion support staff — also floats)
  if (/float|relief|iss|inclusion/.test(n)) return 'float';

  // Non-ratio support (don't count toward ratio)
  if (/study|meeting|events|admin|training/.test(n)) return 'support';

  // Room — name starts with age range like "0-1", "0-2", "1-2", "2-3", "2.5", "3-", "4-", "5-"
  if (/^\d[\d.]*[-–]\d/.test(n)) return 'room';

  // Everything else: directors, ed leaders, chefs, admin etc.
  return 'support';
}

function getRatio(name) {
  if (!name) return null;
  const n = name.toLowerCase();

  // Under 2 years (0-1, 0-2, 1-2)
  if (/^0[-–]1|^0[-–]2|^1[-–]2/.test(n)) return 4;

  // 2–3 years
  if (/^2[-–.]/.test(n)) return 5;

  // 3+ years
  if (/^3[-–.]|^4[-–.]|^5[-–.]/.test(n)) return 10;

  return null;
}
