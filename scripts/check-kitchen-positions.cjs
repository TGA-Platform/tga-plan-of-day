const https = require('https');
const API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';

const BOARDS = {
  'Oatley':'1419063930','Mount Annan':'980348329','Wollongong':'983834623',
  'Dapto 1':'1841109563','Dapto 2':'3349576958','Bexley':'983830380',
  'Spring Farm':'6513027863','Denham Court':'6247438158','North Wollongong':'6248473627',
  'Shell Cove':'8347556299','Belfield':'9133300009','Bankstown':'9133302478',
  'Edgeworth':'9060612097','Wilton':'8719103624',
  'Edmondson Park 1':'983840576','Edmondson Park 2':'3448154419',
};

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com', path: '/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY, 'API-Version': '2024-01' }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function main() {
  const KITCHEN_KEYWORDS = /chef|kitchen|cook|catering|food|kitchen hand/i;
  const results = [];

  for (const [centre, boardId] of Object.entries(BOARDS)) {
    let cursor = null;
    while (true) {
      const cursorArg = cursor ? `, cursor:"${cursor}"` : '';
      const r = await gql(`{
        boards(ids:[${boardId}]) {
          items_page(limit:200${cursorArg}) {
            cursor
            items {
              name
              column_values(ids:["dropdown","wwccnum20","wwccexp20"]) { id text }
            }
          }
        }
      }`);
      const page = r.data?.boards?.[0]?.items_page;
      if (!page) break;
      for (const item of page.items) {
        const position = item.column_values.find(c => c.id === 'dropdown')?.text || '';
        const wwcc     = item.column_values.find(c => c.id === 'wwccnum20')?.text || '';
        const exp      = item.column_values.find(c => c.id === 'wwccexp20')?.text || '';
        if (KITCHEN_KEYWORDS.test(position) || KITCHEN_KEYWORDS.test(item.name)) {
          results.push({ centre, name: item.name, position, wwcc: wwcc || '(none)', exp: exp || 'n/a' });
        }
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
  }

  // Show unique positions
  const positions = [...new Set(results.map(r => r.position).filter(Boolean))];
  console.log('\nUnique kitchen-related positions found:');
  positions.forEach(p => console.log(' ', p));

  console.log('\nAll kitchen staff across centres:');
  results.forEach(r =>
    console.log(`  [${r.centre.padEnd(18)}] ${r.name.padEnd(35)} | pos: ${r.position.padEnd(20)} | WWCC: ${r.wwcc}`)
  );
}
main().catch(console.error);
