// Count internal casuals across all boards, with and without WWCC
import https from 'https';

const KEY = 'eyJhbG…mXq4';
const INTERNAL_CASUAL_GROUP_ID = 'new_group__1';

const STAFFING_BOARDS = {
  'Mount Annan': '980348329', 'Bexley': '983830380', 'Wollongong': '983834623',
  'Edmondson Park 1': '983840576', 'Edmondson Park 2': '3448154419', 'Oatley': '1419063930',
  'Dapto 1': '1841109563', 'Dapto 2': '3349576958', 'Spring Farm': '6513027863',
  'Denham Court': '6247438158', 'North Wollongong': '6248473627', 'Shell Cove': '8347556299',
  'Belfield': '9133300009', 'Bankstown': '9133302478', 'Edgeworth': '9060612097', 'Wilton': '8719103624',
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

const FAKE_WWCC = /^(n\/a|na|none|nil|tba|tbd|-|wwc0+|0+)$/i;

let totalCasuals = 0, withWwcc = 0, withoutWwcc = 0;

for (const [centre, boardId] of Object.entries(STAFFING_BOARDS)) {
  const r = await gql(`{
    boards(ids:[${boardId}]) {
      groups(ids:["${INTERNAL_CASUAL_GROUP_ID}"]) {
        title
        items_page(limit:500) {
          items {
            id name
            column_values(ids:["wwccnum20"]) { id text }
          }
        }
      }
    }
  }`);
  const group = r.data?.boards?.[0]?.groups?.[0];
  if (!group) continue;
  const items = group.items_page?.items ?? [];
  let centreWith = 0, centreWithout = 0;
  for (const item of items) {
    const rawWwcc = item.column_values.find(c => c.id === 'wwccnum20')?.text?.trim() || '';
    const hasWwcc = rawWwcc && !FAKE_WWCC.test(rawWwcc);
    if (hasWwcc) centreWith++; else centreWithout++;
  }
  if (items.length > 0) {
    console.log(`${centre}: ${items.length} casuals (${centreWith} with WWCC, ${centreWithout} without)`);
    totalCasuals += items.length; withWwcc += centreWith; withoutWwcc += centreWithout;
  }
}

console.log(`\nTotal: ${totalCasuals} internal casuals (${withWwcc} with WWCC, ${withoutWwcc} without WWCC)`);
