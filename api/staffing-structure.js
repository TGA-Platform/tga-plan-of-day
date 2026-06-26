/**
 * /api/staffing-structure
 * GET ?centreId=bexley
 *
 * Returns all staff members for a centre from the Monday.com staffing structure board.
 * Reads Monday API key from MONDAY_API_KEY env var.
 * 5-minute in-memory cache per centre to avoid hammering Monday on every page load.
 */

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const MONDAY_API_URL = 'https://api.monday.com/v2';

// Board ID per centre — mirrors src/config.ts STAFFING_BOARD_IDS
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

// 5-min in-memory cache
const cache = new Map(); // centreId -> { data, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

// File column IDs on the main item
const MAIN_FILE_COLS = [
  { id: 'files0',               label: 'Qualification Certificate' },
  { id: 'files20',              label: 'Transcripts' },
  { id: 'certifications20',     label: 'Additional Certifications' },
  { id: 'files4',               label: 'Induction Checklist' },
  { id: 'files7__1',            label: 'Policy Kit' },
  { id: 'files4__1',            label: 'Employment Kit' },
  { id: 'dup__of_files121__1',  label: 'Staff Record' },
  { id: 'resp',                 label: 'Key Responsibilities' },
];

// Subitem file column IDs
const SUBITEM_FILE_COLS = [
  { id: 'files__1',        label: 'Staff Record' },
  { id: 'files5__1',       label: 'RP/NS/EL Consent' },
  { id: 'files0__1',       label: 'Fire Warden' },
  { id: 'files3__1',       label: 'WWC' },
  { id: 'files04__1',      label: 'Qualifications' },
  { id: 'files34__1',      label: 'Transcript & CP' },
  { id: 'files8__1',       label: 'First Aid' },
  { id: 'files9__1',       label: 'CPR' },
  { id: 'files02__1',      label: 'Anaphylaxis' },
  { id: 'file_mm3xjn0z',   label: 'Child Safety' },
  { id: 'files7__1',       label: 'Child Protection Refresher' },
  { id: 'files1__1',       label: 'Food Handling Certificate' },
  { id: 'files93__1',      label: 'Position Description' },
  { id: 'files14__1',      label: 'Additional Responsibilities' },
  { id: 'files2__1',       label: 'Client Report' },
  { id: 'files30__1',      label: 'Training Contract' },
  { id: 'files29__1',      label: 'Training Plan' },
  { id: 'files77__1',      label: 'Working Towards ECT' },
];

function colVal(columnValues, id) {
  return (columnValues.find(c => c.id === id)?.text || '').trim() || undefined;
}

function parseDate(val) {
  if (!val) return undefined;
  // Monday returns ISO dates like "2026-06-15"
  return val.length === 10 ? val : undefined;
}

function isRealEndDate(val) {
  if (!val) return false;
  if (val === 'Not Applicable') return false;
  // If it looks like a real date or sentence date ("May 24, 2027", "17 August, 2025", "2025-08-17")
  return true;
}

function isVacancyName(name) {
  const lower = name.toLowerCase();
  return lower.includes('replace') || lower.includes('replacement') ||
    lower.includes('vacancy') || lower.includes('tba') ||
    lower.includes('interviewing') || lower.includes('trial') ||
    lower.includes('- tbc') || /^[A-Z\s?/]+$/.test(name.trim()); // ALL CAPS placeholders
}

function mapItem(item) {
  const cv = item.column_values;
  const qual = colVal(cv, 'status');
  const endDate = colVal(cv, 'text9');
  const isResigned = qual === 'Resigned';
  const isVacancy = isVacancyName(item.name) && !colVal(cv, 'email20');
  const hasPosition = !!colVal(cv, 'dropdown');
  const hasStartDate = !!parseDate(colVal(cv, 'date'));
  const isActive = !isResigned && !isVacancy && (hasPosition || hasStartDate) && !isRealEndDate(endDate);

  // Main item docs
  const docs = MAIN_FILE_COLS
    .map(col => {
      const url = colVal(cv, col.id);
      return url ? { label: col.label, url } : null;
    })
    .filter(Boolean);

  // Subitem docs
  const certDocs = [];
  for (const sub of (item.subitems || [])) {
    for (const col of SUBITEM_FILE_COLS) {
      const url = (sub.column_values?.find(c => c.id === col.id)?.text || '').trim();
      if (url) certDocs.push({ label: col.label, url });
    }
  }

  return {
    mondayId: String(item.id),
    name: item.name,
    qualification: qual || '',
    ratio50: colVal(cv, 'status2'),
    position: colVal(cv, 'dropdown'),
    positionCategory: colVal(cv, 'text_mm2xj3x9'),
    campus: colVal(cv, 'status8'),
    startDate: parseDate(colVal(cv, 'date')),
    endDate: endDate || undefined,
    dob: parseDate(colVal(cv, 'dob20')),
    daysPerWeek: colVal(cv, 'text'),
    minHoursPerWeek: colVal(cv, 'dup__of_days_per_week__1'),
    probationaryDate: parseDate(colVal(cv, 'date40')),
    email: colVal(cv, 'email20'),
    mobile: colVal(cv, 'mobile20'),
    seekUrl: colVal(cv, 'text_mm2xjkez'),
    action: colVal(cv, 'color_mkv9yjjd'),
    compliance: {
      wwccNumber: colVal(cv, 'wwccnum20'),
      wwccExpiry: parseDate(colVal(cv, 'wwccexp20')),
      firstAidCode: colVal(cv, 'first_aid_code'),
      firstAidExpiry: parseDate(colVal(cv, 'date92')),
      cprCode: colVal(cv, 'cpr_code'),
      cprExpiry: parseDate(colVal(cv, 'dup__of_cpr_code')),
      anaphylaxisCode: colVal(cv, 'anaphylaxis_code'),
      anaphylaxisExpiry: parseDate(colVal(cv, 'date35')),
      childProtectionRenewal: parseDate(colVal(cv, 'date__1')),
    },
    docs,
    certDocs,
    isActive,
    isResigned,
    isVacancy,
  };
}

async function fetchBoardItems(boardId) {
  const allItems = [];
  let cursor = null;

  do {
    const cursorArg = cursor ? `, cursor: "${cursor}"` : '';
    const query = `{
      boards(ids: [${boardId}]) {
        items_page(limit: 500${cursorArg}) {
          cursor
          items {
            id name
            column_values {
              id text
            }
            subitems {
              id name
              column_values { id text }
            }
          }
        }
      }
    }`;

    const res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: MONDAY_API_KEY,
        'Content-Type': 'application/json',
        'API-Version': '2024-01',
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) throw new Error(`Monday API ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'Monday API error');

    const page = json.data?.boards?.[0]?.items_page;
    if (!page) break;

    allItems.push(...(page.items || []));
    cursor = page.cursor || null;
  } while (cursor);

  return allItems;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { centreId } = req.query;
  if (!centreId) return res.status(400).json({ error: 'centreId required' });

  const boardId = BOARD_IDS[centreId];
  if (!boardId) return res.status(404).json({ error: `No staffing board configured for centre: ${centreId}` });

  if (!MONDAY_API_KEY) return res.status(500).json({ error: 'MONDAY_API_KEY not configured' });

  // Check cache
  const cached = cache.get(centreId);
  if (cached && Date.now() < cached.expiresAt) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }

  try {
    const items = await fetchBoardItems(boardId);
    const staff = items.map(mapItem);

    const data = {
      centreId,
      boardId,
      staff,
      fetchedAt: new Date().toISOString(),
    };

    cache.set(centreId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    res.setHeader('X-Cache', 'MISS');
    return res.json(data);
  } catch (err) {
    console.error('staffing-structure error:', err);
    return res.status(500).json({ error: err.message });
  }
}
