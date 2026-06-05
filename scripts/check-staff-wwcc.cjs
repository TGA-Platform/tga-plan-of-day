const https = require('https');
const API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const name = process.argv[2] || 'Sayen';
const first = name.split(' ')[0];

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

  // 1. Supabase
  const r = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc?full_name_norm=ilike.*${encodeURIComponent(first.toLowerCase())}*&select=*`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const rows = await r.json();
  console.log('── Supabase ──');
  if (!rows.length) console.log('  (not found)');
  rows.forEach(r => console.log(`  ${r.full_name} | wwcc: ${r.wwcc_number ?? 'none'} | exp: ${r.wwcc_expiry ?? 'n/a'} | under_18: ${r.under_18} | centre: ${r.centre}`));

  // 2. Onboarding board
  console.log('\n── Onboarding board (977112282) ──');
  const ob = await gql(`{ boards(ids:[977112282]) { items_page(limit:500, query_params:{rules:[{column_id:"name", compare_value:["${first}"], operator:contains_text}]}) { items { id name group { title } column_values(ids:["text00","text02","date3","wwcc_number8","date354","status_1","status"]) { id text } } } } }`);
  const items = ob.data?.boards?.[0]?.items_page?.items || [];
  if (!items.length) console.log('  (not found)');
  items.forEach(i => {
    const cols = Object.fromEntries(i.column_values.map(c => [c.id, c.text]));
    console.log(`  [${i.group?.title}] ${i.name}`);
    console.log(`    DOB: ${cols.date3 || '(not set)'} | WWCC: ${cols.wwcc_number8 || '(none)'} | Exp: ${cols.date354 || 'n/a'} | Centre: ${cols.status_1 || '?'} | Status: ${cols.status || '?'}`);
  });

  // 3. All staffing boards — search by name
  const BOARDS = { 'Mount Annan':'980348329','Bexley':'983830380','Wollongong':'983834623','Edmondson Park 1':'983840576','Edmondson Park 2':'3448154419','Oatley':'1419063930','Dapto 1':'1841109563','Dapto 2':'3349576958','Spring Farm':'6513027863','Denham Court':'6247438158','North Wollongong':'6248473627','Shell Cove':'8347556299','Belfield':'9133300009','Bankstown':'9133302478','Edgeworth':'9060612097','Wilton':'8719103624' };
  console.log('\n── Staffing boards ──');
  for (const [centre, boardId] of Object.entries(BOARDS)) {
    const res = await gql(`{ boards(ids:[${boardId}]) { items_page(limit:500, query_params:{rules:[{column_id:"name", compare_value:["${first}"], operator:contains_text}]}) { items { id name column_values(ids:["wwccnum20","wwccexp20","dob20"]) { id text } } } } }`);
    const found = res.data?.boards?.[0]?.items_page?.items || [];
    if (!found.length) continue;
    found.forEach(i => {
      const cols = Object.fromEntries(i.column_values.map(c => [c.id, c.text]));
      console.log(`  [${centre}] ${i.name} | DOB: ${cols.dob20 || '(not set)'} | WWCC: ${cols.wwccnum20 || '(none)'} | Exp: ${cols.wwccexp20 || 'n/a'}`);
    });
  }
}
main().catch(console.error);
