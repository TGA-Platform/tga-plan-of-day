const https = require('https');
const API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const name = process.argv[2] || 'Paris-Renee Stewart';

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
  console.log(`\nLooking up: "${name}"\n`);

  // 1. Check Supabase
  const norm = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc?full_name_norm=ilike.*${encodeURIComponent(norm.replace(/-/g,'*'))}*&select=*`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const rows = await r.json();
  console.log('── Supabase records ──');
  if (!rows.length) console.log('  (none found)');
  rows.forEach(r => console.log(`  name: ${r.full_name}\n  norm: ${r.full_name_norm}\n  wwcc: ${r.wwcc_number}\n  exp:  ${r.wwcc_expiry}\n  centre: ${r.centre}\n  id: ${r.monday_item_id}\n`));

  // 2. Search onboarding board
  console.log('── Onboarding board (977112282) ──');
  const ob = await gql(`{ boards(ids:[977112282]) { items_page(limit:500, query_params:{rules:[{column_id:"text00", compare_value:["${name.split(' ')[0]}"], operator:contains_text}]}) { items { id name column_values(ids:["wwcc_number8","date354","status_1","status"]) { id text } } } } }`);
  const obItems = ob.data?.boards?.[0]?.items_page?.items || [];
  const nameNorm = name.toLowerCase();
  const matches = obItems.filter(i => i.name.toLowerCase().includes(nameNorm.split(' ')[0]) || nameNorm.includes(i.name.toLowerCase().split(' ')[0]));
  if (!matches.length) console.log('  (not found)');
  matches.forEach(i => {
    const wwcc = i.column_values.find(c => c.id === 'wwcc_number8')?.text || '';
    const exp  = i.column_values.find(c => c.id === 'date354')?.text || '';
    const centre = i.column_values.find(c => c.id === 'status_1')?.text || '';
    const status = i.column_values.find(c => c.id === 'status')?.text || '';
    console.log(`  ${i.name} | WWCC: ${wwcc} | Exp: ${exp} | Centre: ${centre} | Status: ${status}`);
  });

  // 3. Search Oatley staffing board
  console.log('\n── Oatley staffing board (1419063930) ──');
  const ob2 = await gql(`{ boards(ids:[1419063930]) { items_page(limit:500) { items { id name column_values(ids:["wwccnum20","wwccexp20"]) { id text } } } } }`);
  const staffItems = ob2.data?.boards?.[0]?.items_page?.items || [];
  const staffMatches = staffItems.filter(i => i.name.toLowerCase().includes('paris') || i.name.toLowerCase().includes('stewart'));
  if (!staffMatches.length) console.log('  (not found)');
  staffMatches.forEach(i => {
    const wwcc = i.column_values.find(c => c.id === 'wwccnum20')?.text || '';
    const exp  = i.column_values.find(c => c.id === 'wwccexp20')?.text || '';
    console.log(`  ${i.name} | WWCC: ${wwcc} | Exp: ${exp}`);
  });
}
main().catch(console.error);
