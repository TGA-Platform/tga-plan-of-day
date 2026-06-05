/**
 * sync-wwcc-staffing-boards.js
 *
 * Scans all centre staffing structure boards for WWCC data and upserts
 * into staff_wwcc. Focuses on:
 *   1. Staff with no existing WWCC record (missing from main onboarding board)
 *   2. Staff with expired WWCC — checks if staffing board has a newer one
 *
 * Run: node scripts/sync-wwcc-staffing-boards.js [--dry-run]
 */

import https from 'https';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const SUPABASE_URL   = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DRY_RUN        = process.argv.includes('--dry-run');

const STAFFING_BOARDS = {
  'Mount Annan':       '980348329',
  'Bexley':            '983830380',
  'Wollongong':        '983834623',
  'Edmondson Park 1':  '983840576',
  'Edmondson Park 2':  '3448154419',
  'Oatley':            '1419063930',
  'Dapto 1':           '1841109563',
  'Dapto 2':           '3349576958',
  'Spring Farm':       '6513027863',
  'Denham Court':      '6247438158',
  'North Wollongong':  '6248473627',
  'Shell Cove':        '8347556299',
  'Belfield':          '9133300009',
  'Bankstown':         '9133302478',
  'Edgeworth':         '9060612097',
  'Wilton':            '8719103624',
};

// ── Monday helpers ────────────────────────────────────────────────────────────

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com', path: '/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY, 'API-Version': '2024-01' },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

/**
 * Staffing board item names often include role/status suffixes in brackets,
 * e.g. "Paris-Renee Stewart (Room Leader)" or "Jane Smith (Mat Leave)".
 * Strip these so the normalised name matches the plain name used everywhere else.
 */
function stripRoleSuffix(name) {
  return name
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // remove anything in (brackets)
    .replace(/\s*-\s*(Room Leader|Educational Leader|Director|Assistant Director|ECT|Educator|Replacement|Mat Leave|Maternity Leave|Leave|Relief|Casual|Part Time|Full Time|On Hold)[^$]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchBoardWwcc(boardId, centreName) {
  const results = [];
  let cursor = null;
  while (true) {
    const cursorArg = cursor ? `, cursor:"${cursor}"` : '';
    const r = await gql(`{
      boards(ids:[${boardId}]) {
        items_page(limit:200${cursorArg}) {
          cursor
          items {
            id name
            column_values(ids:["wwccnum20","wwccexp20"]) { id text }
          }
        }
      }
    }`);
    const page = r.data?.boards?.[0]?.items_page;
    if (!page) break;
    for (const item of page.items) {
      const wwccNumber = item.column_values.find(c => c.id === 'wwccnum20')?.text?.trim() || '';
      const wwccExpiry = item.column_values.find(c => c.id === 'wwccexp20')?.text?.trim() || null;
      if (!wwccNumber) continue;
      // Strip trailing punctuation from WWCC number
      const cleanWwcc = wwccNumber.replace(/[,\s]+$/, '').trim();
      if (!cleanWwcc) continue;
      // Use clean name (without role suffix) for matching
      const cleanName = stripRoleSuffix(item.name);
      results.push({
        monday_item_id: `sb_${boardId}_${item.id}`, // prefix to distinguish from onboarding board
        full_name:      cleanName,
        full_name_norm: cleanName.toLowerCase().replace(/\s+/g, ' ').trim(),
        wwcc_number:    cleanWwcc,
        wwcc_expiry:    wwccExpiry,
        centre:         centreName,
        updated_at:     new Date().toISOString(),
      });
    }
    cursor = page.cursor;
    if (!cursor) break;
  }
  return results;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function getExistingWwcc() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc?select=full_name_norm,wwcc_number,wwcc_expiry&limit=2000`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase fetch failed: ${r.status}`);
  const rows = await r.json();
  // Map: normalised name → { wwcc_number, wwcc_expiry }
  const map = {};
  for (const row of rows) map[row.full_name_norm] = row;
  return map;
}

async function supabaseUpsert(rows) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Supabase upsert failed (${r.status}): ${await r.text()}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const today = new Date();

function isExpired(expiryStr) {
  if (!expiryStr) return false;
  return new Date(expiryStr) < today;
}

async function main() {
  console.log(`\n🏫  Scanning ${Object.keys(STAFFING_BOARDS).length} centre staffing boards for WWCC data${DRY_RUN ? ' [DRY RUN]' : ''}...\n`);

  // Load existing WWCC data
  console.log('  Loading existing Supabase records...');
  const existing = await getExistingWwcc();
  console.log(`  ${Object.keys(existing).length} existing records loaded.\n`);

  const toUpsert  = [];
  let newCount    = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const [centreName, boardId] of Object.entries(STAFFING_BOARDS)) {
    process.stdout.write(`  ${centreName.padEnd(22)} …`);
    let boardRecords;
    try {
      boardRecords = await fetchBoardWwcc(boardId, centreName);
    } catch (err) {
      console.log(` ✗ ${err.message}`);
      continue;
    }

    let centreNew = 0, centreUpdated = 0, centreSkipped = 0;

    for (const rec of boardRecords) {
      const norm = rec.full_name_norm;
      const ex   = existing[norm];

      if (!ex) {
        // Completely new — not in onboarding board at all
        toUpsert.push(rec);
        centreNew++;
        newCount++;
      } else if (isExpired(ex.wwcc_expiry) && rec.wwcc_expiry && !isExpired(rec.wwcc_expiry)) {
        // Existing record is expired — staffing board has a newer one
        // Keep the onboarding board's monday_item_id if it exists
        toUpsert.push({ ...rec, monday_item_id: ex.monday_item_id ?? rec.monday_item_id });
        centreUpdated++;
        updatedCount++;
      } else if (rec.wwcc_expiry && ex.wwcc_expiry && rec.wwcc_expiry > ex.wwcc_expiry) {
        // Staffing board has a later expiry date — use it
        toUpsert.push({ ...rec, monday_item_id: ex.monday_item_id ?? rec.monday_item_id });
        centreUpdated++;
        updatedCount++;
      } else {
        centreSkipped++;
        skippedCount++;
      }
    }

    console.log(` ${boardRecords.length} found · ${centreNew} new · ${centreUpdated} updated · ${centreSkipped} unchanged`);
  }

  console.log(`\n  Summary: ${newCount} new · ${updatedCount} updated (expired→valid or later expiry) · ${skippedCount} unchanged`);

  if (toUpsert.length === 0) {
    console.log('\n✅  Nothing to upsert — all staffing board data already captured.\n');
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDry run — would upsert ${toUpsert.length} records. First 10:`);
    toUpsert.slice(0, 10).forEach(r =>
      console.log(`  [${r.centre.padEnd(18)}] ${r.full_name.padEnd(30)} ${r.wwcc_number.padEnd(16)} exp:${r.wwcc_expiry ?? 'n/a'} ${!existing[r.full_name_norm] ? '(NEW)' : '(UPDATED)'}`)
    );
    return;
  }

  // Upsert in batches
  const BATCH = 200;
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const slice = toUpsert.slice(i, i + BATCH);
    process.stdout.write(`  Upserting ${i + 1}–${Math.min(i + BATCH, toUpsert.length)} / ${toUpsert.length} …`);
    await supabaseUpsert(slice);
    console.log(' ✓');
  }

  console.log(`\n✅  Done — ${toUpsert.length} records upserted (${newCount} new, ${updatedCount} updated).\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
