/**
 * migrate-staff-categories.cjs
 *
 * Data migration to clean up staff category values after the category cleanup.
 * Run with --dry-run to preview changes (default).
 * Run with --apply to actually update Supabase.
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const apiPath = path.join(__dirname, '..', 'api', 'staffing-structure.js');
const apiSrc = fs.readFileSync(apiPath, 'utf8');
const keyMatch = apiSrc.match(/\|\|\s*'([^']+)'/);
const SERVICE_KEY = keyMatch ? keyMatch[1] : process.env.SUPABASE_SERVICE_KEY;

const SB = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
  'Content-Type': 'application/json',
};

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

// ── Mapping rules ──────────────────────────────────────────────────────────

const POSITION_MAP = {
  // casual variants → Educator + Casual category
  'Casual Educator': { position: 'Educator', position_category: 'Casual' },
  'Internal Casual Educator': { position: 'Educator', position_category: 'Casual' },
  'Internal Casual': { position: 'Educator', position_category: 'Casual' },
  'Educator, Internal Casual Educator': { position: 'Educator', position_category: 'Casual' },

  // trainee variants
  'Childcare Trainee': { position: 'Trainee', position_category: null },
  'Traineeship': { position: 'Trainee', position_category: null },
  'Split Shift Childcare Trainee': { position: 'Trainee', position_category: null },
  'Educator, Traineeship': { position: 'Trainee', position_category: null },
  'trainee': { position: 'Trainee', position_category: null },

  // educator variants / combined roles
  'Diploma Educator': { position: 'Educator', position_category: null },
  'Certificate III Educator': { position: 'Educator', position_category: null },
  'Float Educator': { position: 'Educator', position_category: null },
  'Permanent Float Educator': { position: 'Educator', position_category: null },
  'educator, Educator': { position: 'Educator', position_category: null },

  // Mama Bear
  'Mama Bear Educator': { position: 'Mama Bear', position_category: null },
  'Mama Bear/ Educator': { position: 'Mama Bear', position_category: null },
  'Educator, Mama Bear': { position: 'Mama Bear', position_category: null },

  // ECT Room Leader combos
  'Early Childhood Teacher, Room Leader': { position: 'Early Childhood Teacher Room Leader', position_category: null },
  'Room Leader, Early Childhood Teacher': { position: 'Early Childhood Teacher Room Leader', position_category: null },
  'Early Childhood Teacher Room Leader, Room Leader': { position: 'Early Childhood Teacher Room Leader', position_category: null },
  'Diploma Room Leader': { position: 'Room Leader', position_category: null },
  'Co-Room Leader': { position: 'Room Leader', position_category: null },
  'Room leader': { position: 'Room Leader', position_category: null },

  // leadership
  'Director': { position: 'Centre Director', position_category: null },
  'Nominated Supervisor': { position: 'Centre Director', position_category: null },
  'ed leader': { position: 'Educational Leader', position_category: null },

  // admin / support
  'Admin': { position: 'Centre Support', position_category: null },
  'WHS': { position: 'Centre Support', position_category: null },
  'Additional Duties': { position: 'Centre Support', position_category: null },
  'Admin, Assistant Director, Casual Educator': { position: 'Assistant Director', position_category: 'Casual' },
  'Educator, Assistant Director': { position: 'Assistant Director', position_category: null },

  // kitchen
  'Cook': { position: 'Chef', position_category: null },
  'Childcare Chef': { position: 'Chef', position_category: null },
  'Centre Chef': { position: 'Chef', position_category: null },
  'Chef/Kitchen Hand': { position: 'Chef', position_category: null },
  'Kitchen Hand': { position: 'Chef', position_category: null },
};

const QUALIFICATION_MAP = {
  'Kitchen Hand': null,
  'Cook': null,
  'Centre Chef': null,
  'Chef/Kitchen Hand': null,
  'Certificate 3 - WT ECT': 'Certificate 3',
  'Diploma - Working towards ECT': 'Diploma',
  'Diploma working towards Bachelor of Early Childhood': 'Diploma',
};

const MATERNITY_LEAVE_POSITIONS = {
  'Maternity Leave Admin': { position: 'Centre Support', employment_status: 'PPL' },
  'Maternity Leave Room Leader': { position: 'Room Leader', employment_status: 'PPL' },
  'Maternity Leave Assistant Director': { position: 'Assistant Director', employment_status: 'PPL' },
};

async function sbGet(path) {
  const r = await fetch(`${SB}${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SB}${path}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${r.status}: ${await r.text()}`);
  return r.json();
}

const NON_DATE_ENDS = new Set(['not applicable', 'n/a', 'na', 'tbc', '']);

function looksLikeDate(v) {
  if (!v || typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  if (NON_DATE_ENDS.has(s.toLowerCase())) return false;
  if (/^HLTAID|^SITX|^TAFE|^Cert|^Certificate|^Diploma|^ECT|^First Aid|^CPR|^WWC|^Anaphylaxis/i.test(s)) return false;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return true;
  // Try DD-MM-YYYY
  const parts = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (parts) {
    const [_, d, m, y] = parts;
    const dt = new Date(`${y}-${m}-${d}`);
    return !isNaN(dt.getTime());
  }
  return false;
}

function computeChanges(row) {
  const changes = {};

  // Position / position_category
  const pos = row.position?.trim();
  if (pos) {
    if (MATERNITY_LEAVE_POSITIONS[pos]) {
      const m = MATERNITY_LEAVE_POSITIONS[pos];
      if (m.position) changes.position = m.position;
      if (m.employment_status) changes.employment_status = m.employment_status;
    } else if (POSITION_MAP[pos]) {
      const m = POSITION_MAP[pos];
      if (m.position) changes.position = m.position;
      if (m.position_category !== undefined && row.position_category !== m.position_category) {
        changes.position_category = m.position_category;
      }
    }
  }

  // Qualification
  const qual = row.qualification?.trim();
  if (qual === 'PPL') {
    changes.qualification = null;
    if (row.employment_status === 'Active') changes.employment_status = 'PPL';
  } else if (QUALIFICATION_MAP[qual] !== undefined) {
    changes.qualification = QUALIFICATION_MAP[qual];
  }

  // Employment status for staff with a real end_date
  if (looksLikeDate(row.end_date) && row.employment_status === 'Active') {
    changes.employment_status = 'Resigned';
  }

  return changes;
}

async function main() {
  const rows = await sbGet('/staff_members?select=*');
  console.log(`Found ${rows.length} staff members\n`);

  let toUpdate = 0;
  const summaries = [];

  for (const row of rows) {
    const changes = computeChanges(row);
    if (Object.keys(changes).length === 0) continue;

    toUpdate++;
    summaries.push({
      id: row.id,
      name: row.name,
      old: {
        position: row.position,
        position_category: row.position_category,
        qualification: row.qualification,
        employment_status: row.employment_status,
        end_date: row.end_date,
      },
      new: changes,
    });

    if (DRY) {
      console.log(`${row.name} (${row.id}):`);
      console.log('  old:', JSON.stringify(summaries.at(-1).old));
      console.log('  new:', JSON.stringify(changes));
    }

    if (APPLY) {
      await sbPatch(`/staff_members?id=eq.${row.id}`, changes);
      console.log(`Updated ${row.name}`);
    }
  }

  console.log(`\n${toUpdate} staff members would be updated.`);
  if (DRY) {
    console.log('This was a dry run. Pass --apply to execute.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
