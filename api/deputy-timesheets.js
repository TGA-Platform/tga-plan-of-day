export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date } = req.body;
  const response = await fetch('https://thegroveacademy.au.deputy.com/api/v1/resource/Timesheet/QUERY', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer cf73b1628a5e3498d713879bcf07a974',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      max: 200,
      search: {
        s1: { field: 'Date', type: 'eq', data: date },
        s2: { field: 'IsLeave', type: 'eq', data: true },
      }
    })
  });
  const data = await response.json();
  res.status(200).json(data);
}
