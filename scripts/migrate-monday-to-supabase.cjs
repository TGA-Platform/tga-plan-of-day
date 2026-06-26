/**
 * migrate-monday-to-supabase.cjs
 *
 * Pulls all staffing structure data from Monday.com and migrates it to Supabase.
 * - Staff members → staff_members table
 * - Rooms/groups  → staff_rooms table
 * - Documents     → downloaded and uploaded to Supabase Storage → staff_documents table
 *
 * Safe to re-run: uses upsert on monday_id. Already-migrated staff are skipped.
 * Files already in storage are also skipped.
 *
 * Run: node scripts/migrate-monday-to-supabase.cjs [centreId]
 * e.g. node scripts/migrate-monday-to-supabase.cjs bexley
 *      node scripts/migrate-monday-to-supabase.cjs           (all centres)
 */

const fs   = require('fs');
const path = require('path');

const MONDAY_TOKEN  = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const MONDAY_URL    = 'https://api.monday.com/v2';

const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const BUCKET        = 'staff-documents';
const SB            = `${SUPABASE_URL}/rest/v1`;
const SB_HEADERS    = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };

const BOARD_IDS = {
  'oatley':           1419063930,
  'wollongong':       983834623,
  'mount-annan':      980348329,
  'spring-farm':      6513027863,
  'denham-court':     6247438158,
  'ed-park-1':        983840576,
  'ed-park-2':        3448154419,
  'wilton':           8719103624,
  'dapto-1':          1841109563,
  'dapto-2':          3349576958,
  'north-wollongong': 6248473627,
  'shell-cove':       8347556299,
  'bexley':           983830380,
  'belfield':         9133300009,
  'bankstown':        9133302478,
  'glendale':         18406250043,
  'edgeworth':        9060612097,
};

const INACTIVE_GROUPS = /^(open positions?|on hold|offered|exited staff|resigned)$/i;

const MAIN_FILE_COLS = [
  { id: 'files0',              label: 'Qualification Certificate', type: 'main' },
  { id: 'files20',             label: 'Transcripts',              type: 'main' },
  { id: 'certifications20',    label: 'Additional Certifications',type: 'main' },
  { id: 'files4',              label: 'Induction Checklist',      type: 'main' },
  { id: 'files7__1',           label: 'Policy Kit',               type: 'main' },
  { id: 'files4__1',           label: 'Employment Kit',           type: 'main' },
  { id: 'dup__of_files121__1', label: 'Staff Record',             type: 'main' },
  { id: 'resp',                label: 'Key Responsibilities',      type: 'main' },
];

const SUBITEM_FILE_COLS = [
  { id: 'files__1',      label: 'Staff Record',               type: 'subitem' },
  { id: 'files5__1',     label: 'RP/NS/EL Consent',           type: 'subitem' },
  { id: 'files0__1',     label: 'Fire Warden',                type: 'subitem' },
  { id: 'files3__1',     label: 'WWC',                        type: 'subitem' },
  { id: 'files04__1',    label: 'Qualifications',             type: 'subitem' },
  { id: 'files34__1',    label: 'Transcript & CP',            type: 'subitem' },
  { id: 'files8__1',     label: 'First Aid',                  type: 'subitem' },
  { id: 'files9__1',     label: 'CPR',                        type: 'subitem' },
  { id: 'files02__1',    label: 'Anaphylaxis',                type: 'subitem' },
  { id: 'file_mm3xjn0z', label: 'Child Safety',               type: 'subitem' },
  { id: 'files7__1',     label: 'Child Protection Refresher', type: 'subitem' },
  { id: 'files1__1',     label: 'Food Handling Certificate',  type: 'subitem' },
  { id: 'files93__1',    label: 'Position Description',       type: 'subitem' },
  { id: 'files14__1',    label: 'Additional Responsibilities',type: 'subitem' },
  { id: 'files2__1',     label: 'Client Report',              type: 'subitem' },
  { id: 'files30__1',    label: 'Training Contract',          type: 'subitem' },
  { id: 'files29__1',    label: 'Training Plan',              type: 'subitem' },
  { id: 'files77__1',    label: 'Working Towards ECT',        type: 'subitem' },
];

function col(cv, id) { return (cv.find(c => c.id === id)?.text || '').trim() || null; }
function parseDate(v) { return v && v.length === 10 ? v : null; }

// ── Monday API ─────────────────────────────────────────────────────────────

async function mondayQuery(query) {
  const r = await fetch(MONDAY_URL, {
    method: 'POST',
    headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-01' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`Monday API ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0]?.message);
  return j.data;
}

async function fetchBoard(boardId) {
  const data = await mondayQuery(`{
    boards(ids: [${boardId}]) {
      groups { id title color
        items_page(limit: 500) {
          items { id name
            column_values { id text }
            subitems { id name column_values { id text } }
          }
        }
      }
    }
  }`);
  return data?.boards?.[0]?.groups || [];
}

// ── Supabase helpers ───────────────────────────────────────────────────────

async function sbUpsert(table, rows, conflictCol) {
  const r = await fetch(`${SB}/${table}?on_conflict=${conflictCol}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Upsert ${table} failed: ${t}`); }
  return r.json();
}

async function sbGet(path) {
  const r = await fetch(`${SB}${path}`, { headers: SB_HEADERS });
  if (!r.ok) { const t = await r.text(); throw new Error(`SB GET failed: ${t}`); }
  return r.json();
}

// Upload file buffer to Supabase Storage
async function uploadToStorage(storagePath, buffer, mimeType) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'false', // don't overwrite existing
    },
    body: buffer,
  });
  const text = await r.text();
  if (!r.ok && !text.includes('already exists') && !text.includes('Duplicate')) {
    throw new Error(`Storage upload failed (${r.status}): ${text}`);
  }
  return storagePath;
}

// Download a Monday file server-side
async function downloadFile(url) {
  const r = await fetch(url, { headers: { Authorization: MONDAY_TOKEN } });
  if (!r.ok) throw new Error(`Download failed ${r.status}: ${url}`);
  const buffer = await r.arrayBuffer();
  const mime = r.headers.get('content-type') || 'application/octet-stream';
  return { buffer: Buffer.from(buffer), mime };
}

function safeName(str) {
  return str.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

// ── Migration ──────────────────────────────────────────────────────────────

async function migrateCentre(centreId) {
  const boardId = BOARD_IDS[centreId];
  if (!boardId) { console.log(`  No board for ${centreId}, skipping`); return; }

  console.log(`\n[${centreId}] Fetching Monday board ${boardId}...`);
  const groups = await fetchBoard(boardId);
  console.log(`  ${groups.length} groups found`);

  let staffMigrated = 0, docsMigrated = 0, docsSkipped = 0, errors = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const isActive = !INACTIVE_GROUPS.test(group.title.trim());

    // Upsert room
    await sbUpsert('staff_rooms', [{
      centre_id: centreId,
      group_id: group.id,
      title: group.title,
      color: group.color || '#808080',
      is_active: isActive,
      sort_order: gi,
    }], 'centre_id,group_id');

    for (const item of group.items_page.items) {
      const cv = item.column_values;

      const staffRow = {
        monday_id:               String(item.id),
        centre_id:               centreId,
        group_id:                group.id,
        group_title:             group.title,
        group_color:             group.color || '#808080',
        is_active_group:         isActive,
        name:                    item.name,
        qualification:           col(cv, 'status'),
        position:                col(cv, 'dropdown'),
        position_category:       col(cv, 'text_mm2xj3x9'),
        ratio_50:                col(cv, 'status2'),
        start_date:              parseDate(col(cv, 'date')),
        end_date:                col(cv, 'text9'),
        dob:                     parseDate(col(cv, 'dob20')),
        days_per_week:           col(cv, 'text'),
        min_hours_pw:            col(cv, 'dup__of_days_per_week__1'),
        probationary_date:       parseDate(col(cv, 'date40')),
        email:                   col(cv, 'email20'),
        mobile:                  col(cv, 'mobile20'),
        seek_url:                col(cv, 'text_mm2xjkez'),
        action:                  col(cv, 'color_mkv9yjjd'),
        wwcc_number:             col(cv, 'wwccnum20'),
        wwcc_expiry:             parseDate(col(cv, 'wwccexp20')),
        first_aid_code:          col(cv, 'first_aid_code'),
        first_aid_expiry:        parseDate(col(cv, 'date92')),
        cpr_code:                col(cv, 'cpr_code'),
        cpr_expiry:              parseDate(col(cv, 'dup__of_cpr_code')),
        anaphylaxis_code:        col(cv, 'anaphylaxis_code'),
        anaphylaxis_expiry:      parseDate(col(cv, 'date35')),
        child_protection_renewal:parseDate(col(cv, 'date__1')),
      };

      const [upserted] = await sbUpsert('staff_members', [staffRow], 'monday_id');
      const staffId = upserted?.id;
      if (!staffId) { errors++; continue; }
      staffMigrated++;

      // Collect all document URLs for this staff member
      const docEntries = [];

      // Main item docs
      for (const colDef of MAIN_FILE_COLS) {
        const url = (cv.find(c => c.id === colDef.id)?.text || '').trim();
        if (url) docEntries.push({ label: colDef.label, type: colDef.type, url });
      }

      // Subitem docs
      for (const sub of (item.subitems || [])) {
        for (const colDef of SUBITEM_FILE_COLS) {
          const url = (sub.column_values?.find(c => c.id === colDef.id)?.text || '').trim();
          if (url) docEntries.push({ label: colDef.label, type: colDef.type, url });
        }
      }

      // Download + upload each doc
      for (const doc of docEntries) {
        try {
          // Derive filename from URL
          const urlPath = new URL(doc.url).pathname;
          const origName = decodeURIComponent(urlPath.split('/').pop() || 'file');
          const ext = path.extname(origName) || '';
          const storagePath = `${centreId}/${staffId}/${safeName(doc.label)}${ext ? '' : ''}${safeName(origName)}`;

          // Check if already exists in staff_documents
          const existing = await sbGet(`/staff_documents?staff_id=eq.${staffId}&monday_url=eq.${encodeURIComponent(doc.url)}&limit=1`);
          if (existing.length > 0) { docsSkipped++; continue; }

          // Download
          const { buffer, mime } = await downloadFile(doc.url);

          // Upload to storage
          const uploaded = await uploadToStorage(storagePath, buffer, mime);

          // Insert doc record
          await fetch(`${SB}/staff_documents`, {
            method: 'POST',
            headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
            body: JSON.stringify({
              staff_id: staffId,
              label: doc.label,
              doc_type: doc.type,
              storage_path: uploaded,
              file_name: path.basename(storagePath),
              mime_type: mime,
              monday_url: doc.url,
            }),
          });

          docsMigrated++;
        } catch (e) {
          console.warn(`    [WARN] Doc failed for ${item.name} - ${doc.label}: ${e.message}`);
          // Still store the monday_url as fallback
          await fetch(`${SB}/staff_documents`, {
            method: 'POST',
            headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
            body: JSON.stringify({
              staff_id: staffId,
              label: doc.label,
              doc_type: doc.type,
              monday_url: doc.url,
            }),
          }).catch(() => {});
          errors++;
        }
      }
    }

    process.stdout.write(`  Group ${gi+1}/${groups.length}: ${group.title} (${group.items_page.items.length} staff)\n`);
  }

  console.log(`  Done: ${staffMigrated} staff, ${docsMigrated} docs migrated, ${docsSkipped} skipped, ${errors} errors`);
}

async function main() {
  const targetCentre = process.argv[2];
  const centres = targetCentre ? [targetCentre] : Object.keys(BOARD_IDS);

  console.log(`Migrating ${centres.length} centre(s): ${centres.join(', ')}`);
  console.log('Storage bucket: staff-documents');
  console.log('');

  for (const centreId of centres) {
    try {
      await migrateCentre(centreId);
    } catch (e) {
      console.error(`[${centreId}] FAILED:`, e.message);
    }
    // Small delay between centres to avoid rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nMigration complete.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
