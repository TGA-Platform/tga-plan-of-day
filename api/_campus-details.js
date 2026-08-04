/**
 * Shared helper for the Monday.com Campus Details board (6211208646).
 *
 * Fetches the latest Director Email and AM Email for every centre.
 * Returns a map keyed by normalized centre name, plus the raw items.
 *
 * The board is the source of truth for these emails. This function is
 * called at email-generation time so every send uses the freshest data.
 */

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const CAMPUS_DETAILS_BOARD_ID = '6211208646';

const COLUMN_IDS = {
  directorEmail: 'text',          // Director Email
  areaManagerName: 'text_mkwj4em2', // Area Manager
  areaManagerEmail: 'text7',      // AM Email
};

function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/the\s+grove\s+academy\s*/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function isTgaEmail(email) {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith('@tga.edu.au');
}

export async function fetchCampusDetails() {
  const query = `{
    boards(ids: ${CAMPUS_DETAILS_BOARD_ID}) {
      items_page(limit: 100) {
        items {
          id
          name
          column_values(ids: ["${COLUMN_IDS.directorEmail}","${COLUMN_IDS.areaManagerName}","${COLUMN_IDS.areaManagerEmail}"]) {
            id
            text
          }
        }
      }
    }
  }`;

  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Monday.com Campus Details API ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  const items = json?.data?.boards?.[0]?.items_page?.items || [];

  const details = {};
  const raw = [];

  for (const item of items) {
    const directorEmail = item.column_values.find(c => c.id === COLUMN_IDS.directorEmail)?.text || '';
    const areaManagerName = item.column_values.find(c => c.id === COLUMN_IDS.areaManagerName)?.text || '';
    const areaManagerEmail = item.column_values.find(c => c.id === COLUMN_IDS.areaManagerEmail)?.text || '';

    const entry = {
      boardItemId: item.id,
      centreName: item.name.trim(),
      directorEmail: isTgaEmail(directorEmail) ? directorEmail.trim().toLowerCase() : '',
      areaManagerName: areaManagerName.trim(),
      areaManagerEmail: isTgaEmail(areaManagerEmail) ? areaManagerEmail.trim().toLowerCase() : '',
    };

    raw.push(entry);
    details[normName(item.name)] = entry;
  }

  return { details, raw };
}

export function matchCentreToDetails(centre, details) {
  if (!centre || !details) return null;

  const keys = [
    normName(centre.name),
    normName(centre.ownaName),
    normName(centre.name).replace(/\s+/g, ''),
    normName(centre.ownaName).replace(/\s+/g, ''),
  ].filter(Boolean);

  for (const key of keys) {
    if (details[key]) return details[key];
  }

  // Fuzzy fallback: check if any board name is contained in or contains the centre name
  const centreNorm = normName(centre.name);
  for (const key of Object.keys(details)) {
    if (centreNorm.includes(key) || key.includes(centreNorm)) {
      return details[key];
    }
  }

  return null;
}
