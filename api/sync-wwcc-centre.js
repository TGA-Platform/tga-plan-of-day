/**
 * /api/sync-wwcc-centre
 * On-demand WWCC sync for a single centre's staffing board.
 * Mirrors sync-wwcc-staffing-boards.js exactly — same columns, same name
 * normalisation, same upsert logic. Never deletes existing records.
 *
 * POST { centre: "Edmondson Park 2" }
 * Returns { ok: true, upserted: N, centre: "..." }
 */

const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjk1MjUwNjI1LCJhYWkiOjExLCJ1aWQiOjE3OTA3NTg3LCJpYWQiOiIyMDIxLTAxLTA4VDA1OjQxOjQxLjAwMFoiLCJwZXIiOiJtZTp3cml0ZSIsImFjdGlkIjo3ODUyNTc4LCJyZ24iOiJ1c2UxIn0.wTlMofuNFVvUvV98p8HBDarGqoURjO-rHdg7Ck9mXq4';
const SUPABASE_URL   = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

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
  'Glendale':          '9682706972',
  'Charlestown':       '9682706973',
};

const FAKE_WWCC = /^(n\/a|na|none|nil|tba|tbd|-|wwc0+|0+)$/i;
const ROLE_KEYWORDS = /^(room leader|educational leader|director|assistant director|ect|educator|replacement|mat leave|maternity leave|leave|relief|casual|part time|full time|on hold|copy|\d)$/i;

function isUnder18(dobStr) {
  if (!dobStr) return false;
  const dob = new Date(dobStr);
  if (isNaN(dob)) return false;
  const cutoff = new Date(dob);
  cutoff.setFullYear(cutoff.getFullYear() + 18);
  return new Date() < cutoff;
}

// Mirror normaliseForMatching from name-utils.js
function normaliseForMatching(name) {
  return (name || '')
    .replace(/\s*[\(\[{][^\)\]{}]*[\)\]{}]\s*/g, ' ')
    .replace(/\s*-\s*(room leader|educational leader|centre director|assistant director|ect|2ic|hod|hoe|rn|don)[\s,]*/gi, ' ')
    .replace(/\s*-\s*(copy|contracted role|replacement|mat leave|on hold|archived)[\s,]*/gi, ' ')
    .replace(/\b(room leader|educational leader|centre director|assistant director|early childhood teacher)\b/gi, ' ')
    .replace(/\b(RL|EL|CD|AD|ECT|2IC|HOD|HOE)\b/g, ' ')
    .replace(/[-']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripRoleSuffix(name) {
  return name
    // Strip leading placeholder prefixes
    .replace(/^(NIL|N\/A|TBA|TBD):\s*/i, '')
    // Strip anything in (brackets) or [brackets]
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ')
    // Strip trailing role abbreviations
    .replace(/\s+\b(RL|EL|CD|AD|ECT|2IC|HOD|HOE)\b\s*$/i, '')
    // Strip ALL trailing " - <anything>" suffixes — schedules, nicknames, notes, roles
    // e.g. "- Mamma Bear 9-2:15", "- Split Shift", "- ISS", "- Room Leader", "- Monday"
    .replace(/\s+-\s+.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPreferredName(rawName) {
  const match = rawName.match(/\(([^)]+)\)/);
  if (!match) return null;
  const content = match[1].trim();
  if (ROLE_KEYWORDS.test(content)) return null;
  if (/\d/.test(content)) return null;
  if (content.split(/\s+/).length > 3) return null;
  if (!/^[A-Za-z\s'\-]+$/.test(content)) return null;
  return content;
}

async function gqlRequest(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Monday API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbUpsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff_wwcc`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      // merge-duplicates = upsert on primary key, never deletes other rows
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert: ${res.status} ${await res.text()}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { centre } = req.body || {};
  if (!centre) return res.status(400).json({ error: 'centre is required' });

  const boardId = STAFFING_BOARDS[centre];
  if (!boardId) return res.status(404).json({ error: `No staffing board found for centre: ${centre}` });

  try {
    // Fetch all items from the staffing board
    const items = [];
    let cursor = null;
    do {
      const cursorArg = cursor ? `, cursor: "${cursor}"` : '';
      const data = await gqlRequest(`{
        boards(ids: [${boardId}]) {
          items_page(limit: 200${cursorArg}) {
            cursor
            items {
              id name
              column_values(ids: ["wwccnum20","wwccexp20","dob20"]) { id text }
            }
          }
        }
      }`);
      const page = data?.data?.boards?.[0]?.items_page;
      if (!page) break;
      items.push(...(page.items || []));
      cursor = page.cursor || null;
    } while (cursor);

    // Build upsert rows — same logic as sync-wwcc-staffing-boards.js
    const rows = [];
    for (const item of items) {
      const rawWwcc    = item.column_values.find(c => c.id === 'wwccnum20')?.text?.trim() || '';
      const wwccExpiry = item.column_values.find(c => c.id === 'wwccexp20')?.text?.trim() || null;
      const dob        = item.column_values.find(c => c.id === 'dob20')?.text?.trim() || null;

      const cleanWwcc = FAKE_WWCC.test(rawWwcc) ? '' : rawWwcc.replace(/[,\s]+$/, '').trim();
      const under18   = !cleanWwcc && isUnder18(dob);

      // Skip if no WWCC and not under 18
      if (!cleanWwcc && !under18) continue;

      const cleanName = stripRoleSuffix(item.name);
      // Normalise from the STRIPPED name so schedule/nickname suffixes
      // (e.g. "Mamma Bear 9-2:15") don't end up in the lookup key.
      const norm      = normaliseForMatching(cleanName);
      const nameParts = cleanName.split(' ').filter(Boolean);

      // Alias record for preferred names in brackets (e.g. "Xue Yang (Cherise)" → also store "Cherise Yang")
      const preferredName = extractPreferredName(item.name);
      if (preferredName) {
        const lastName  = nameParts[nameParts.length - 1] ?? '';
        const aliasName = `${preferredName} ${lastName}`.trim();
        const aliasNorm = normaliseForMatching(aliasName);
        if (aliasNorm !== norm) {
          rows.push({
            monday_item_id: `alias_sb_${boardId}_${item.id}`,
            full_name:      aliasName,
            full_name_norm: aliasNorm,
            first_name:     null,
            last_name:      null,
            wwcc_number:    cleanWwcc || null,
            wwcc_expiry:    cleanWwcc ? wwccExpiry : null,
            under_18:       under18,
            centre,
            updated_at:     new Date().toISOString(),
          });
        }
      }

      rows.push({
        monday_item_id: `sb_${boardId}_${item.id}`,
        full_name:      cleanName,
        full_name_norm: norm,
        first_name:     nameParts[0] || '',
        last_name:      nameParts[nameParts.length - 1] || '',
        wwcc_number:    cleanWwcc || null,
        wwcc_expiry:    cleanWwcc ? wwccExpiry : null,
        under_18:       under18,
        centre,
        updated_at:     new Date().toISOString(),
      });
    }

    if (rows.length > 0) {
      await sbUpsert(rows);
    }

    return res.status(200).json({ ok: true, centre, scanned: items.length, upserted: rows.length });
  } catch (err) {
    console.error('sync-wwcc-centre error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
