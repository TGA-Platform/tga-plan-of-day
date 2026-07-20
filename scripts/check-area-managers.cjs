/**
 * Weekly area-manager consistency check.
 * Compares AM names/emails from Monday campus details board 6211208646
 * against the hardcoded values in api/staffing-forecast-email.js.
 * Exit code 0 if consistent, 1 if a difference is detected.
 */
const fs = require('fs');
const path = require('path');

const SRC_SCRIPT = path.join(__dirname, 'sync-wwcc-staffing-boards.js');
const src = fs.readFileSync(SRC_SCRIPT, 'utf8');
const m = src.match(/MONDAY_API_KEY\s*=\s*'([^']+)'/);
if (!m) {
  console.error('Could not extract Monday API key');
  process.exit(1);
}
const MONDAY_API_KEY = m[1];
const MONDAY_URL = 'https://api.monday.com/v2';
const BOARD_ID = 6211208646;

const EXPECTED = {
  'South West':   { am: 'Lilian Slaibi', email: 'lilian@tga.edu.au' },
  'South Coast':  { am: 'Rebecca Sapienza', email: 'rebeccasapienza@tga.edu.au' },
  'South Sydney': { am: 'Olivia Al Askar', email: 'olivia@tga.edu.au' },
  'North Coast':  { am: 'Carley Matthews', email: 'carleye@tga.edu.au' },
};

const CENTRE_TO_REGION = {
  'Mount Annan': 'South West',
  'Spring Farm': 'South West',
  'Denham Court': 'South West',
  'Edmondson Park 1': 'South West',
  'Edmondson Park 2': 'South West',
  'Wilton': 'South West',
  'Wollongong': 'South Coast',
  'Dapto 1': 'South Coast',
  'Dapto 2': 'South Coast',
  'North Wollongong': 'South Coast',
  'Shell Cove': 'South Coast',
  'South Nowra': 'South Coast',
  'Bomaderry': 'South Coast',
  'Bexley': 'South Sydney',
  'Oatley': 'South Sydney',
  'Belfield': 'South Sydney',
  'Bankstown': 'South Sydney',
  'Moorebank': 'South Sydney',
  'Glendale': 'North Coast',
  'Edgeworth': 'North Coast',
  'Charlestown': 'North Coast',
  'Aberglasslyn': 'North Coast',
  'Tuggerah': 'North Coast',
};

async function mondayQuery(query) {
  const r = await fetch(MONDAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: MONDAY_API_KEY,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`Monday ${r.status}: ${await r.text()}`);
  const json = await r.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

function normaliseEmail(e) {
  return (e || '').toLowerCase().trim();
}

function normaliseName(n) {
  return (n || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function main() {
  const data = await mondayQuery(`{
    boards(ids: [${BOARD_ID}]) {
      items_page {
        items {
          id
          name
          column_values(ids: ["status","text_mkwj4em2","text7"]) {
            id
            text
          }
        }
      }
    }
  }`);

  const items = data.boards[0].items_page.items;
  const actual = {};

  for (const item of items) {
    const campusCv = item.column_values.find(c => c.id === 'status');
    const amNameCv = item.column_values.find(c => c.id === 'text_mkwj4em2');
    const amEmailCv = item.column_values.find(c => c.id === 'text7');

    const campus = (campusCv?.text || item.name).trim();
    const amName = (amNameCv?.text || '').trim();
    const amEmail = normaliseEmail(amEmailCv?.text);
    const region = CENTRE_TO_REGION[campus];

    if (!region || !amName || !amEmail) continue;

    if (!actual[region]) {
      actual[region] = { am: amName, email: amEmail, campuses: [] };
    }
    actual[region].campuses.push(campus);
  }

  let mismatch = false;
  for (const [region, expected] of Object.entries(EXPECTED)) {
    const act = actual[region];
    if (!act) {
      console.log(`MISSING region ${region}: no centres matched`);
      mismatch = true;
      continue;
    }
    const nameOk = normaliseName(act.am) === normaliseName(expected.am);
    const emailOk = act.email === expected.email;
    if (!nameOk || !emailOk) {
      console.log(`MISMATCH ${region}:`);
      console.log(`  Expected: ${expected.am} <${expected.email}>`);
      console.log(`  Actual:   ${act.am} <${act.email}>`);
      console.log(`  Campuses: ${act.campuses.join(', ')}`);
      mismatch = true;
    }
  }

  if (mismatch) {
    console.log('\nAction needed: update api/staffing-forecast-email.js and MEMORY.md');
    process.exit(1);
  }

  console.log('Area managers match campus details board.');
  for (const [region, info] of Object.entries(actual)) {
    console.log(`  ${region}: ${info.am} <${info.email}>`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
