/**
 * compare-monday-supabase-docs.cjs
 *
 * Compares Monday.com file counts per board with Supabase staff_documents counts.
 */

const fs = require('fs');
const path = require('path');

const MONDAY_URL = 'https://api.monday.com/v2';
const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';

function getMondayToken() {
  const migratePath = path.join(__dirname, '..', 'scripts', 'migrate-monday-to-supabase.cjs');
  const src = fs.readFileSync(migratePath, 'utf8');
  const idx = src.indexOf('MONDAY_TOKEN');
  const line = src.slice(idx, idx + 600);
  const m = line.match(/'([^']+)'/);
  if (!m) throw new Error('Could not extract Monday token');
  return m[1];
}

function getSupabaseKey() {
  const apiPath = path.join(__dirname, '..', 'api', 'staffing-structure.js');
  const src = fs.readFileSync(apiPath, 'utf8');
  const idx = src.indexOf('SERVICE_KEY');
  const line = src.slice(idx, idx + 600);
  const m = line.match(/'([^']+)'/);
  if (!m) throw new Error('Could not extract Supabase key');
  return m[1];
}

const MONDAY_TOKEN = getMondayToken();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || getSupabaseKey();

const BOARDS = {
  oatley: 1419063930,
  wollongong: 983834623,
  'mount-annan': 980348329,
  'spring-farm': 6513027863,
  'denham-court': 6247438158,
  'ed-park-1': 983840576,
  'ed-park-2': 3448154419,
  wilton: 8719103624,
  'dapto-1': 1841109563,
  'dapto-2': 3349576958,
  'north-wollongong': 6248473627,
  'shell-cove': 8347556299,
  bexley: 983830380,
  belfield: 9133300009,
  bankstown: 9133302478,
  glendale: 18406250043,
  edgeworth: 9060612097,
};

const SB = `${SUPABASE_URL}/rest/v1`;
const SB_HEADERS = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  'Content-Type': 'application/json',
};

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

async function fetchBoardCounts(boardId) {
  const data = await mondayQuery(`{
    boards(ids: [${boardId}]) {
      groups { id title
        items_page(limit: 500) {
          items { id name
            column_values { id text }
            subitems { id name column_values { id text } }
          }
        }
      }
    }
  }`);

  const FILE_COL_PATTERNS = /files|certifications|resp/;

  let mainItems = 0;
  let subItems = 0;
  let mainFiles = 0;
  let subFiles = 0;

  for (const group of data?.boards?.[0]?.groups || []) {
    for (const item of group.items_page?.items || []) {
      mainItems++;
      for (const cv of item.column_values || []) {
        if (FILE_COL_PATTERNS.test(cv.id) && cv.text && cv.text.trim().length > 0) {
          mainFiles++;
          break; // count item once if it has any file
        }
      }
      for (const sub of item.subitems || []) {
        subItems++;
        for (const cv of sub.column_values || []) {
          if (FILE_COL_PATTERNS.test(cv.id) && cv.text && cv.text.trim().length > 0) {
            subFiles++;
            break;
          }
        }
      }
    }
  }

  return { mainItems, subItems, mainFiles, subFiles };
}

async function sbGet(path) {
  const r = await fetch(`${SB}${path}`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log('Fetching Supabase doc counts by centre...');
  const docs = await sbGet('/staff_documents?select=staff_id,doc_type');
  const staff = await sbGet('/staff_members?select=id,centre_id');
  const staffCentre = Object.fromEntries(staff.map(s => [s.id, s.centre_id]));

  const sbByCentre = {};
  for (const d of docs) {
    const centre = staffCentre[d.staff_id];
    if (!centre) continue;
    if (!sbByCentre[centre]) sbByCentre[centre] = { main: 0, subitem: 0, total: 0 };
    sbByCentre[centre].total++;
    if (d.doc_type === 'main') sbByCentre[centre].main++;
    else if (d.doc_type === 'subitem') sbByCentre[centre].subitem++;
  }

  console.log('\nComparing Monday.com vs Supabase document counts...\n');
  console.log('Centre                 | Mon Items | Mon w/ Main | Mon Subs | Mon w/ Sub | SB Main | SB Sub | SB Total | Main % | Sub % | Total %');
  console.log('-'.repeat(140));

  for (const [centre, boardId] of Object.entries(BOARDS)) {
    try {
      const mon = await fetchBoardCounts(boardId);
      const sb = sbByCentre[centre] || { main: 0, subitem: 0, total: 0 };
      const mainPct = mon.mainFiles ? Math.round((sb.main / mon.mainFiles) * 100) : 0;
      const subPct = mon.subFiles ? Math.round((sb.subitem / mon.subFiles) * 100) : 0;
      const totalMon = mon.mainFiles + mon.subFiles;
      const totalPct = totalMon ? Math.round((sb.total / totalMon) * 100) : 0;
      console.log(
        `${centre.padEnd(22)} | ${String(mon.mainItems).padStart(9)} | ${String(mon.mainFiles).padStart(11)} | ${String(mon.subItems).padStart(8)} | ${String(mon.subFiles).padStart(10)} | ${String(sb.main).padStart(7)} | ${String(sb.subitem).padStart(6)} | ${String(sb.total).padStart(8)} | ${String(mainPct).padStart(6)}% | ${String(subPct).padStart(5)}% | ${String(totalPct).padStart(7)}%`
      );
    } catch (err) {
      console.log(`${centre.padEnd(22)} | ERROR: ${err.message}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
