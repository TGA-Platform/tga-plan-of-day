const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'apply-schema-changes.cjs'), 'utf8');
const key = src.slice(src.indexOf('SERVICE_KEY'), src.indexOf('SERVICE_KEY') + 600).match(/'([^']+)'/)[1];
const SB = 'https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1';

async function get(urlPath) {
  const r = await fetch(SB + urlPath, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  if (!r.ok) throw new Error(`${urlPath}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function count(table) {
  try {
    const rows = await get(`/${table}?select=count&limit=1`);
    return rows[0]?.count ?? '?';
  } catch (e) {
    return `ERR: ${e.message}`;
  }
}

async function main() {
  // List all tables via introspection
  const openapi = await get('/');
  const paths = Object.keys(openapi.paths).filter(p => p.startsWith('/') && p.split('/').length === 2 && !p.startsWith('/rpc/')).sort();

  console.log('All tables/views in public schema:\n');
  for (const p of paths) {
    const table = p.slice(1);
    const cnt = await count(table);
    console.log(`${table.padEnd(40)} ${cnt}`);
  }

  // Check storage buckets
  console.log('\nStorage buckets:\n');
  try {
    const buckets = await fetch('https://tgxpvzlibquqnldgmwho.supabase.co/storage/v1/bucket', { headers: { Authorization: `Bearer ${key}`, apikey: key } }).then(r => r.json());
    console.log(buckets);
  } catch (e) {
    console.log('ERR:', e.message);
  }
}

main().catch(console.error);
