// Inspect a staffing board's columns and sample items to find WWCC fields
const https = require('https');
const API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';

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
  const boardId = process.argv[2] || '980348329'; // default: Mount Annan
  
  // Get columns
  const r = await gql(`{ boards(ids:[${boardId}]) { name columns { id title type } } }`);
  const board = r.data.boards[0];
  console.log(`\nBoard: ${board.name} (${boardId})`);
  console.log('\nAll columns:');
  for (const col of board.columns) {
    if (col.title.toLowerCase().includes('wwcc') || col.title.toLowerCase().includes('working with') || col.title.toLowerCase().includes('check') || col.title.toLowerCase().includes('expir') || col.id.includes('wwcc') || col.id.includes('354') || col.id.includes('date')) {
      console.log(`  *** ${col.id.padEnd(20)} ${col.title} (${col.type})`);
    } else {
      console.log(`      ${col.id.padEnd(20)} ${col.title} (${col.type})`);
    }
  }

  // Sample 3 items
  const s = await gql(`{ boards(ids:[${boardId}]) { items_page(limit:3) { items { name column_values { id text } } } } }`);
  console.log('\nSample items:');
  for (const item of s.data.boards[0].items_page.items) {
    console.log(`\n  ${item.name}`);
    for (const col of item.column_values) {
      if (col.text) console.log(`    ${col.id}: ${col.text}`);
    }
  }
}
main().catch(console.error);
