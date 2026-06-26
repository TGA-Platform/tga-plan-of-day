/**
 * /api/staffing-structure
 * GET  ?centreId=bexley               → full board (groups + staff)
 * POST ?centreId=bexley               → update a staff item or move between groups
 *
 * POST body:
 *   { action: 'update_item', itemId, columnId, value }   → update a column value
 *   { action: 'move_item',   itemId, groupId }            → move to different group (room)
 *
 * 5-min in-memory cache per centre (GET only). POST clears cache.
 */

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const MONDAY_API_URL = 'https://api.monday.com/v2';

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

// Groups that are NOT active rooms — staff in these are excluded from active view
const INACTIVE_GROUP_PATTERNS = [
  /^open positions?$/i,
  /^on hold$/i,
  /^offered$/i,
  /^new$/i,
  /^exited staff$/i,
  /^resigned$/i,
];

function isInactiveGroup(title) {
  return INACTIVE_GROUP_PATTERNS.some(p => p.test(title.trim()));
}

// 5-min in-memory cache
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// File column IDs on the main item
const MAIN_FILE_COLS = [
  { id: 'files0',              label: 'Qualification Certificate' },
  { id: 'files20',             label: 'Transcripts' },
  { id: 'certifications20',    label: 'Additional Certifications' },
  { id: 'files4',              label: 'Induction Checklist' },
  { id: 'files7__1',           label: 'Policy Kit' },
  { id: 'files4__1',           label: 'Employment Kit' },
  { id: 'dup__of_files121__1', label: 'Staff Record' },
  { id: 'resp',                label: 'Key Responsibilities' },
];

// Subitem file column IDs
const SUBITEM_FILE_COLS = [
  { id: 'files__1',       label: 'Staff Record' },
  { id: 'files5__1',      label: 'RP/NS/EL Consent' },
  { id: 'files0__1',      label: 'Fire Warden' },
  { id: 'files3__1',      label: 'WWC' },
  { id: 'files04__1',     label: 'Qualifications' },
  { id: 'files34__1',     label: 'Transcript & CP' },
  { id: 'files8__1',      label: 'First Aid' },
  { id: 'files9__1',      label: 'CPR' },
  { id: 'files02__1',     label: 'Anaphylaxis' },
  { id: 'file_mm3xjn0z',  label: 'Child Safety' },
  { id: 'files7__1',      label: 'Child Protection Refresher' },
  { id: 'files1__1',      label: 'Food Handling Certificate' },
  { id: 'files93__1',     label: 'Position Description' },
  { id: 'files14__1',     label: 'Additional Responsibilities' },
  { id: 'files2__1',      label: 'Client Report' },
  { id: 'files30__1',     label: 'Training Contract' },
  { id: 'files29__1',     label: 'Training Plan' },
  { id: 'files77__1',     label: 'Working Towards ECT' },
];

// Editable column IDs and their Monday column types
const EDITABLE_COLUMNS = [
  { id: 'dropdown',                  label: 'Position',                type: 'dropdown' },
  { id: 'text_mm2xj3x9',            label: 'Position Category',       type: 'text' },
  { id: 'date',                      label: 'Start Date',              type: 'date' },
  { id: 'text9',                     label: 'End Date',                type: 'text' },
  { id: 'email20',                   label: 'Email',                   type: 'text' },
  { id: 'mobile20',                  label: 'Mobile',                  type: 'text' },
  { id: 'text',                      label: 'Days Per Week',           type: 'text' },
  { id: 'dup__of_days_per_week__1',  label: 'Min Hours Per Week',      type: 'text' },
  { id: 'wwccnum20',                 label: 'WWCC Number',             type: 'text' },
  { id: 'wwccexp20',                 label: 'WWCC Expiry',             type: 'date' },
  { id: 'first_aid_code',            label: 'First Aid Code',          type: 'text' },
  { id: 'date92',                    label: 'First Aid Expiry',        type: 'date' },
  { id: 'cpr_code',                  label: 'CPR Code',                type: 'text' },
  { id: 'dup__of_cpr_code',          label: 'CPR Expiry',             type: 'date' },
  { id: 'anaphylaxis_code',          label: 'Anaphylaxis Code',        type: 'text' },
  { id: 'date35',                    label: 'Anaphylaxis Expiry',      type: 'date' },
  { id: 'date__1',                   label: 'Child Protection Renewal',type: 'date' },
];

function colVal(columnValues, id) {
  return (columnValues.find(c => c.id === id)?.text || '').trim() || undefined;
}

function parseDate(val) {
  if (!val) return undefined;
  return val.length === 10 ? val : undefined;
}

function mapItem(item) {
  const cv = item.column_values;

  const docs = MAIN_FILE_COLS
    .map(col => { const url = colVal(cv, col.id); return url ? { label: col.label, url } : null; })
    .filter(Boolean);

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
    qualification: colVal(cv, 'status') || '',
    ratio50: colVal(cv, 'status2'),
    position: colVal(cv, 'dropdown'),
    positionCategory: colVal(cv, 'text_mm2xj3x9'),
    campus: colVal(cv, 'status8'),
    startDate: parseDate(colVal(cv, 'date')),
    endDate: colVal(cv, 'text9'),
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
  };
}

async function mondayQuery(query) {
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
  return json.data;
}

async function fetchBoard(boardId) {
  // Fetch groups with their items (paginated within each group up to 500)
  const data = await mondayQuery(`{
    boards(ids: [${boardId}]) {
      groups {
        id title color
        items_page(limit: 500) {
          items {
            id name
            column_values { id text }
            subitems { id name column_values { id text } }
          }
        }
      }
    }
  }`);

  const board = data?.boards?.[0];
  if (!board) throw new Error('Board not found');

  const groups = board.groups.map(g => ({
    id: g.id,
    title: g.title,
    color: g.color,
    isActive: !isInactiveGroup(g.title),
    staff: g.items_page.items.map(mapItem),
  }));

  return groups;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { centreId } = req.query;
  if (!centreId) return res.status(400).json({ error: 'centreId required' });

  const boardId = BOARD_IDS[centreId];
  if (!boardId) return res.status(404).json({ error: `No staffing board for: ${centreId}` });

  if (!MONDAY_API_KEY) return res.status(500).json({ error: 'MONDAY_API_KEY not configured' });

  // ── POST: update item or move between groups ────────────────────────────
  if (req.method === 'POST') {
    const { action, itemId, groupId, columnId, value } = req.body || {};

    try {
      if (action === 'move_item') {
        await mondayQuery(`mutation {
          move_item_to_group(item_id: ${itemId}, group_id: "${groupId}") { id }
        }`);
        cache.delete(centreId);
        return res.json({ ok: true });
      }

      if (action === 'update_item') {
        // value must be JSON string per Monday's column_values format
        const valueJson = JSON.stringify(value);
        await mondayQuery(`mutation {
          change_column_value(
            board_id: ${boardId},
            item_id: ${itemId},
            column_id: "${columnId}",
            value: ${JSON.stringify(valueJson)}
          ) { id }
        }`);
        cache.delete(centreId);
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err) {
      console.error('staffing-structure POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET: fetch board ────────────────────────────────────────────────────
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cached = cache.get(centreId);
  if (cached && Date.now() < cached.expiresAt) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached.data);
  }

  try {
    const groups = await fetchBoard(boardId);
    const data = {
      centreId,
      boardId,
      groups,
      editableColumns: EDITABLE_COLUMNS,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(centreId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    res.setHeader('X-Cache', 'MISS');
    return res.json(data);
  } catch (err) {
    console.error('staffing-structure GET error:', err);
    return res.status(500).json({ error: err.message });
  }
}
