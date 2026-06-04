/**
 * sync-wwcc.js
 *
 * Pulls WWCC numbers + expiry dates for all active staff from Monday.com
 * board 977112282 (Employee Onboarding Board) and upserts them into the
 * Supabase `staff_wwcc` table.
 *
 * Scheduled: every Monday at 6:00 AM AEST via OpenClaw cron.
 * Manual run: node scripts/sync-wwcc.js [--all] [--dry-run]
 *
 *   --all      Include all statuses (default: skip Exited Staff group)
 *   --dry-run  Print records without writing to Supabase
 */

import https from 'https';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const BOARD_ID       = '977112282';
const SUPABASE_URL   = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const DRY_RUN = process.argv.includes('--dry-run');

// Groups to skip entirely
const SKIP_GROUPS = ['new_group86437']; // Exited Staff

// ── Monday GQL ───────────────────────────────────────────────────────────────

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
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Paginate through all items on a board, yielding batches */
async function* paginateBoard(boardId, cols) {
  let cursor = null;
  const colStr = cols.map(c => `"${c}"`).join(',');
  while (true) {
    const cursorArg = cursor ? `, cursor:"${cursor}"` : '';
    const q = `{
      boards(ids:[${boardId}]) {
        items_page(limit:200${cursorArg}) {
          cursor
          items {
            id name
            group { id }
            column_values(ids:[${colStr}]) { id text }
          }
        }
      }
    }`;
    const res = await gql(q);
    const page = res.data?.boards?.[0]?.items_page;
    if (!page) break;
    yield page.items;
    cursor = page.cursor;
    if (!cursor) break;
  }
}

function col(item, id) {
  return item.column_values.find(c => c.id === id)?.text?.trim() || '';
}

/** Normalise a name for fuzzy matching: "John Smith" → "john smith" */
export function normaliseName(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function supabaseUpsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc`, {
    method: 'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed (${res.status}): ${await res.text()}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🪪  Syncing WWCC data from Monday board ${BOARD_ID}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const rows   = [];
  let total    = 0;
  let withWwcc = 0;
  let skipped  = 0;

  for await (const batch of paginateBoard(BOARD_ID, ['text00','text02','wwcc_number8','date354','status_1','status'])) {
    for (const item of batch) {
      total++;
      if (SKIP_GROUPS.includes(item.group?.id)) { skipped++; continue; }

      const firstName  = col(item, 'text00');
      const lastName   = col(item, 'text02');
      const wwccNumber = col(item, 'wwcc_number8').replace(/,\s*$/, '').trim(); // strip trailing commas
      const wwccExpiry = col(item, 'date354') || null; // YYYY-MM-DD or null
      const centre     = col(item, 'status_1');

      // Use item name as fallback if first/last aren't filled in
      const fullName = firstName && lastName
        ? `${firstName} ${lastName}`
        : item.name;

      if (!wwccNumber) continue; // no WWCC → nothing to store
      withWwcc++;

      rows.push({
        monday_item_id: item.id,
        full_name:      fullName,
        full_name_norm: normaliseName(fullName),
        first_name:     firstName,
        last_name:      lastName,
        wwcc_number:    wwccNumber,
        wwcc_expiry:    wwccExpiry,
        centre,
        updated_at:     new Date().toISOString(),
      });
    }
  }

  console.log(`  Scanned ${total} items · ${skipped} skipped (Exited Staff) · ${withWwcc} have WWCC data`);

  if (DRY_RUN) {
    console.log('\nDry run — first 5 rows:');
    rows.slice(0, 5).forEach(r =>
      console.log(`  ${r.full_name.padEnd(28)} ${r.wwcc_number.padEnd(16)} exp:${r.wwcc_expiry ?? 'n/a'} [${r.centre}]`)
    );
    return;
  }

  // Upsert in batches of 200
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    process.stdout.write(`  Upserting ${i + 1}–${Math.min(i + BATCH, rows.length)} / ${rows.length} …`);
    await supabaseUpsert(rows.slice(i, i + BATCH));
    console.log(' ✓');
  }

  console.log(`\n✅  Done — ${rows.length} WWCC records synced to Supabase.\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
