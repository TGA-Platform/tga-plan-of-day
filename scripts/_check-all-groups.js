// Check group IDs on all boards to find the correct internal casuals group
import https from 'https';
import { readFileSync } from 'fs';

// Read API key from the sync script
const syncSrc = readFileSync(new URL('./sync-wwcc-staffing-boards.js', import.meta.url), 'utf8');
const KEY = syncSrc.match(/MONDAY_API_KEY\s*=\s*'([^']+)'/)[1];

const BOARDS = {
  'Edmondson Park 1': '983840576', 'Edmondson Park 2': '3448154419',
  'Oatley': '1419063930', 'Dapto 1': '1841109563', 'Dapto 2': '3349576958',
  'Spring Farm': '6513027863', 'Belfield': '9133300009', 'Edgeworth': '9060612097', 'Wilton': '8719103624',
};

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com', path: '/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: KEY, 'API-Version': '2024-01' },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject); req.write(body); req.end();
  });
}

for (const [name, id] of Object.entries(BOARDS)) {
  const r = await gql(`{ boards(ids:[${id}]) { groups { id title } } }`);
  const groups = r.data?.boards?.[0]?.groups ?? [];
  const casual = groups.find(g => g.title.toLowerCase().includes('internal casual'));
  console.log(`${name}: ${casual ? `✅ [${casual.id}] "${casual.title}"` : `❌ no match — groups: ${groups.map(g=>`[${g.id}]${g.title}`).join(', ')}`}`);
}
