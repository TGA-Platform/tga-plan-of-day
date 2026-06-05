/**
 * sync-wwcc.js
 *
 * Pulls WWCC numbers + expiry dates for all active staff from Monday.com
 * board 977112282 (Employee Onboarding Board) and upserts them into the
 * Supabase `staff_wwcc` table.
 *
 * Also identifies staff who have no WWCC because they are under 18
 * (exempt by law) and marks them with under_18 = true.
 *
 * Scheduled: every Monday at 6:00 AM AEST via OpenClaw cron.
 * Run AFTER sync-wwcc-staffing-boards.js — staffing boards are authoritative.
 * This script only fills gaps and adds under-18 records.
 *
 * Manual run: node scripts/sync-wwcc.js [--dry-run]
 */

import https from 'https';

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const BOARD_ID     = '977112282';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const DRY_RUN      = process.argv.includes('--dry-run');
const SKIP_GROUPS  = ['new_group86437']; // Exited Staff

// ── Helpers ───────────────────────────────────────────────────────────────────

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com', path: '/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY, 'API-Version': '2024-01' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

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

export function normaliseName(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isUnder18(dobStr) {
  if (!dobStr) return false;
  const dob = new Date(dobStr);
  if (isNaN(dob)) return false;
  const today = new Date();
  const age18 = new Date(dob);
  age18.setFullYear(age18.getFullYear() + 18);
  return today < age18;
}

// ── Supabase ──────────────────────────────────────────────────────────────────

async function supabaseUpsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed (${res.status}): ${await res.text()}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🪪  Syncing WWCC + under-18 data from onboarding board ${BOARD_ID}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
  console.log('  (Staffing boards take priority — this script fills gaps and marks under-18 staff)\n');

  // Load existing records — staffing boards already ran and are authoritative
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/staff_wwcc?select=full_name_norm,wwcc_expiry,under_18&limit=3000`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const existingRows = existingRes.ok ? await existingRes.json() : [];
  const existingMap = {};
  for (const r of existingRows) existingMap[r.full_name_norm] = r;

  const rows    = [];
  let total     = 0, withWwcc = 0, under18Count = 0, skipped = 0;

  for await (const batch of paginateBoard(BOARD_ID, ['text00','text02','wwcc_number8','date354','status_1','status','date3'])) {
    for (const item of batch) {
      total++;
      if (SKIP_GROUPS.includes(item.group?.id)) { skipped++; continue; }

      const firstName  = col(item, 'text00');
      const lastName   = col(item, 'text02');
      const wwccNumber = col(item, 'wwcc_number8').replace(/,\s*$/, '').trim();
      const wwccExpiry = col(item, 'date354') || null;
      const centre     = col(item, 'status_1');
      const dob        = col(item, 'date3') || null; // YYYY-MM-DD

      const fullName = firstName && lastName ? `${firstName} ${lastName}` : item.name;
      const nameNorm = normaliseName(fullName);
      const existing = existingMap[nameNorm];

      if (wwccNumber) {
        withWwcc++;
        // Skip if staffing board already has a better or equal record
        if (existing?.wwcc_expiry && wwccExpiry && existing.wwcc_expiry >= wwccExpiry) continue;

        rows.push({
          monday_item_id: item.id,
          full_name:      fullName,
          full_name_norm: nameNorm,
          first_name:     firstName || null,
          last_name:      lastName || null,
          wwcc_number:    wwccNumber,
          wwcc_expiry:    wwccExpiry,
          under_18:       false,
          centre,
          updated_at:     new Date().toISOString(),
        });
      } else if (isUnder18(dob)) {
        under18Count++;
        // Only insert/update if not already marked correctly
        if (existing?.under_18 === true) continue;

        rows.push({
          monday_item_id: item.id,
          full_name:      fullName,
          full_name_norm: nameNorm,
          first_name:     firstName || null,
          last_name:      lastName || null,
          wwcc_number:    null,
          wwcc_expiry:    null,
          under_18:       true,
          centre,
          updated_at:     new Date().toISOString(),
        });
      }
      // else: no WWCC, not under 18 — nothing to store
    }
  }

  console.log(`  Scanned ${total} · ${skipped} skipped (Exited) · ${withWwcc} have WWCC · ${under18Count} under 18 (no WWCC required)`);

  if (rows.length === 0) {
    console.log('\n✅  Nothing to upsert — all data already up to date.\n');
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDry run — ${rows.length} rows would be upserted. First 5:`);
    rows.slice(0, 5).forEach(r =>
      console.log(`  ${r.full_name.padEnd(30)} ${r.under_18 ? 'UNDER 18' : (r.wwcc_number + ' exp:' + (r.wwcc_expiry ?? 'n/a'))}`)
    );
    return;
  }

  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    process.stdout.write(`  Upserting ${i + 1}–${Math.min(i + BATCH, rows.length)} / ${rows.length} …`);
    await supabaseUpsert(rows.slice(i, i + BATCH));
    console.log(' ✓');
  }

  console.log(`\n✅  Done — ${rows.length} records upserted (${under18Count} under-18 marked).\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
