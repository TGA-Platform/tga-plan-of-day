/**
 * import-missing-files.cjs
 *
 * Targeted file import only. Assumes staff_members already exist.
 * For each Monday item, finds matching Supabase staff by monday_id
 * and imports only files that are missing from staff_documents.
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const MONDAY_URL = 'https://api.monday.com/v2';

function extractKey(filePath, keyName) {
  const src = fs.readFileSync(path.join(__dirname, '..', filePath), 'utf8');
  const idx = src.indexOf(keyName);
  const line = src.slice(idx, idx + 600);
  const m = line.match(/'([^']+)'/);
  if (!m) throw new Error(`Could not extract ${keyName}`);
  return m[1];
}

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || extractKey('api/staffing-structure.js', 'SERVICE_KEY');
const MONDAY_TOKEN = extractKey('scripts/migrate-monday-to-supabase.cjs', 'MONDAY_TOKEN');

const BOARD_IDS = {
  'oatley': 1419063930,
  'wollongong': 983834623,
  'mount-annan': 980348329,
  'spring-farm': 6513027863,
  'denham-court': 6247438158,
  'ed-park-1': 983840576,
  'ed-park-2': 3448154419,
  'wilton': 8719103624,
  'dapto-1': 1841109563,
  'dapto-2': 3349576958,
  'north-wollongong': 6248473627,
  'shell-cove': 8347556299,
  'bexley': 983830380,
  'belfield': 9133300009,
  'bankstown': 9133302478,
  'glendale': 18406250043,
  'edgeworth': 9060612097,
};

const INACTIVE_GROUPS = /^(open positions?|on hold|offered|exited staff|resigned|maternity leave|maintenance|ppl)$/i;

const FILE_TITLE_MAP = {
  'qualification': 'Qualification Certificate',
  'qualification certificate': 'Qualification Certificate',
  'transcript': 'Transcripts',
  'transcripts': 'Transcripts',
  'additional certifications': 'Additional Certifications',
  'induction checklist': 'Induction Checklist',
  'upskilling plan': 'Upskilling Plan',
  'policy kit': 'Policy Kit',
  'employment kit': 'Employment Kit',
  'staff record': 'Staff Record',
  'key responsibilities': 'Key Responsibilities',
  'rp/ns/el consent': 'RP/NS/EL Consent',
  'rp/ ns/ el consent': 'RP/NS/EL Consent',
  'fire warden': 'Fire Warden',
  'wwc': 'WWC',
  'qualifications': 'Qualifications',
  'transcript & cp': 'Transcript & CP',
  'first aid': 'First Aid',
  'cpr': 'CPR',
  'anaphylaxis': 'Anaphylaxis',
  'child safety': 'Child Safety',
  'child protection refresher': 'Child Protection Refresher',
  'food handling certificate': 'Food Handling Certificate',
  'position description': 'Position Description',
  'additional responsibilities': 'Additional Responsibilities',
  'client report': 'Client Report',
  'training contract': 'Training Contract',
  'training plan': 'Training Plan',
  'working towards ect': 'Working Towards ECT',
};

const SB = `${SUPABASE_URL}/rest/v1`;
const SB_HEADERS = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' };

async function sbGet(p) {
  const r = await fetch(SB + p, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function sbPost(p, body) {
  const r = await fetch(SB + p, { method: 'POST', headers: { ...SB_HEADERS, Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

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

async function fetchBoardItems(boardId) {
  const data = await mondayQuery(`{
    boards(ids: [${boardId}]) {
      groups { id title
        items_page(limit: 500) {
          items { id name
            column_values { id text column { title type } }
            subitems { id name column_values { id text column { title type } } }
          }
        }
      }
    }
  }`);
  return data?.boards?.[0]?.groups || [];
}

function canonicalLabel(title) {
  if (!title) return null;
  return FILE_TITLE_MAP[title.trim().toLowerCase()] || null;
}

async function getExistingDocs() {
  const rows = await sbGet('/staff_documents?select=staff_id,monday_url');
  const set = new Set();
  for (const row of rows) set.add(`${row.staff_id}|${row.monday_url}`);
  return set;
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const targetCentre = args[0];
  const centres = targetCentre ? [targetCentre] : Object.keys(BOARD_IDS);

  const staff = await sbGet('/staff_members?select=id,monday_id,centre_id');
  const staffByMonday = Object.fromEntries(staff.map(s => [s.monday_id, s]));
  const existingDocs = await getExistingDocs();

  let totalImported = 0;
  let totalSkipped = 0;

  for (const centre of centres) {
    const boardId = BOARD_IDS[centre];
    if (!boardId) continue;

    try {
      console.log(`\n[${centre}] Fetching Monday board ${boardId}...`);
      const groups = await fetchBoardItems(boardId);
      let imported = 0;
      let skipped = 0;

      for (const g of groups) {
        if (INACTIVE_GROUPS.test(g.title)) continue;
        for (const item of g.items_page?.items || []) {
          const s = staffByMonday[item.id];
          if (!s) continue;

          const docs = [];
          for (const c of item.column_values || []) {
            if (c.column?.type !== 'file') continue;
            const url = (c.text || '').trim();
            const label = canonicalLabel(c.column.title);
            if (url && label) docs.push({ staff_id: s.id, label, doc_type: 'main', monday_url: url });
          }
          for (const sub of item.subitems || []) {
            for (const c of sub.column_values || []) {
              if (c.column?.type !== 'file') continue;
              const url = (c.text || '').trim();
              const label = canonicalLabel(c.column.title);
              if (url && label) docs.push({ staff_id: s.id, label, doc_type: 'subitem', monday_url: url });
            }
          }

          for (const doc of docs) {
            const key = `${doc.staff_id}|${doc.monday_url}`;
            if (existingDocs.has(key)) { skipped++; continue; }
            await sbPost('/staff_documents', doc);
            existingDocs.add(key);
            imported++;
          }
        }
      }

      console.log(`[${centre}] Imported ${imported}, skipped ${skipped}`);
      totalImported += imported;
      totalSkipped += skipped;
    } catch (e) {
      console.error(`[${centre}] FAILED:`, e.message);
    }
  }

  console.log(`\nDone. Total imported: ${totalImported}, skipped: ${totalSkipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
