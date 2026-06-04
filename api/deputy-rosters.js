export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date, unitIds } = req.body;
  const unitSet = new Set(Array.isArray(unitIds) ? unitIds : []);
  const PAGE = 500;
  const all  = [];
  let   start = 1;

  // NOTE: Deputy's OperationalUnit 'in' filter silently drops some results when
  // given a large list of IDs (known API quirk). We query by date only and
  // filter to the requested unit IDs on our side — this is reliable.
  while (true) {
    const response = await fetch('https://thegroveacademy.au.deputy.com/api/v1/resource/Roster/QUERY', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer cf73b1628a5e3498d713879bcf07a974',
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        max:    PAGE,
        start,
        search: {
          s1: { field: 'Date', type: 'eq', data: date },
        },
      }),
    });

    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;
    // Filter to requested units client-side (avoids Deputy 'in' filter bug)
    const filtered = unitSet.size > 0 ? page.filter(r => unitSet.has(r.OperationalUnit)) : page;
    all.push(...filtered);
    if (page.length < PAGE) break;
    start += PAGE;
  }

  res.status(200).json(all);
}
