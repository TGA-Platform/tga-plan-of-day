import { readFileSync } from 'fs';
const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];

// Check 'children' table
const r = await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/children?select=*&limit=5`, {
  headers: { apikey: SK, Authorization: `Bearer ${SK}` }
});
const rows = await r.json();
console.log('children table sample:', JSON.stringify(rows, null, 2));
