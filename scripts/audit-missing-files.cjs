/**
 * audit-missing-files.cjs
 *
 * Efficient audit: fetch each Monday board once, count file URLs per item,
 * and compare with Supabase staff_documents by monday_id.
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

const SERVICE_KEY = extractKey('api/staffing-structure.js', 'SERVICE_KEY');
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

const SB = `${SUPABASE_URL}/rest/v1`;
const SB_HEADERS = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' };

async function sbGet(p) {
  const r = await fetch(SB + p, { headers: SB_HEADERS });
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

function countFiles(item) {
  let n = 0;
  for (const c of item.column_values || []) {
    if (c.column?.type === 'file' && c.text?.trim()) n++;
  }
  for (const sub of item.subitems || []) {
    for (const c of sub.column_values || []) {
      if (c.column?.type === 'file' && c.text?.trim()) n++;
    }
  }
  return n;
}

async function main() {
  const staff = await sbGet('/staff_members?select=id,name,centre_id,monday_id,employment_status');
  const docs = await sbGet('/staff_documents?select=staff_id');
  const staffWithDocs = new Set(docs.map(d => d.staff_id));
  const staffByMonday = Object.fromEntries(staff.map(s => [s.monday_id, s]));

  console.log(`Total staff: ${staff.length}`);
  console.log(`Staff with docs: ${staffWithDocs.size}`);
  console.log(`Staff without docs: ${staff.length - staffWithDocs.size}\n`);

  console.log('Centre                 | Active Staff | Active w/ Monday Files | Active w/o Docs | Monday Files Missing | Monday Files Present');
  console.log('-'.repeat(115));

  let totalMissingFiles = 0;
  let totalPresentFiles = 0;
  let activeStaffWithMondayFiles = 0;
  let activeStaffWithoutDocs = 0;

  for (const [centre, boardId] of Object.entries(BOARD_IDS)) {
    try {
      const groups = await fetchBoardItems(boardId);
      let centreActive = 0;
      let centreWithMondayFiles = 0;
      let centreWithoutDocs = 0;
      let centreMissingFiles = 0;
      let centrePresentFiles = 0;

      for (const g of groups) {
        const active = !INACTIVE_GROUPS.test(g.title);
        for (const item of g.items_page?.items || []) {
          const s = staffByMonday[item.id];
          if (!s) continue; // not in Supabase
          if (s.employment_status !== 'Active') continue;
          centreActive++;
          const fileCount = countFiles(item);
          if (fileCount > 0) {
            centreWithMondayFiles++;
            if (staffWithDocs.has(s.id)) {
              centrePresentFiles += fileCount;
            } else {
              centreWithoutDocs++;
              centreMissingFiles += fileCount;
            }
          } else {
            if (!staffWithDocs.has(s.id)) centreWithoutDocs++;
          }
        }
      }

      totalMissingFiles += centreMissingFiles;
      totalPresentFiles += centrePresentFiles;
      activeStaffWithMondayFiles += centreWithMondayFiles;
      activeStaffWithoutDocs += centreWithoutDocs;

      console.log(
        `${centre.padEnd(22)} | ${String(centreActive).padStart(12)} | ${String(centreWithMondayFiles).padStart(22)} | ${String(centreWithoutDocs).padStart(15)} | ${String(centreMissingFiles).padStart(20)} | ${String(centrePresentFiles).padStart(21)}`
      );
    } catch (e) {
      console.log(`${centre.padEnd(22)} | ERROR: ${e.message}`);
    }
  }

  console.log('-'.repeat(115));
  console.log(`TOTAL                  |              | ${String(activeStaffWithMondayFiles).padStart(22)} | ${String(activeStaffWithoutDocs).padStart(15)} | ${String(totalMissingFiles).padStart(20)} | ${String(totalPresentFiles).padStart(21)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
