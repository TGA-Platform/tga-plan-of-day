/**
 * /api/cron-forecast-cache
 *
 * Runs at 2:45pm Sydney time (Mon–Fri). Calculates tomorrow's staffing
 * forecast for every centre using the same logic as morning-briefing.js
 * and upserts results into staffing_analysis_cache in Supabase.
 *
 * The 3pm forecast email (send-forecast-email.cjs) then reads directly
 * from that table — guaranteeing the email shows the same numbers the
 * Plan of Day dashboard would show.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const CRON_SECRET  = process.env.CRON_SECRET || '';

const CENTRES = [
  { id:'oatley',           name:'Oatley',           ownaName:'Oatley',           floatUnitIds:[224], issUnitIds:[230], leaveUnitIds:[134,142,139], nonRatioUnitIds:[130,131,197,165,141,235,324,337], rooms:[{id:213,ownaRoomName:'Explorers',ratio:4},{id:132,ownaRoomName:'Adventurers',ratio:4},{id:133,ownaRoomName:'Pioneers',ratio:5},{id:196,ownaRoomName:'Voyagers',ratio:5},{id:159,ownaRoomName:'Creators',ratio:10},{id:223,ownaRoomName:'Achievers',ratio:10}] },
  { id:'wollongong',       name:'Wollongong',        ownaName:'Wollongong',       floatUnitIds:[126], issUnitIds:[231], leaveUnitIds:[128,460,127], nonRatioUnitIds:[116,117,124,166,202,312,326,339], rooms:[{id:118,ownaRoomName:'0-2 Room',ratio:4},{id:119,ownaRoomName:'2-3 Room',ratio:5},{id:201,ownaRoomName:'3-5 Room',ratio:10}] },
  { id:'mount-annan',      name:'Mount Annan',       ownaName:'Mount Annan',      floatUnitIds:[222], issUnitIds:[225], leaveUnitIds:[108,456,109], nonRatioUnitIds:[72,73,101,162,234,323,335,79],    rooms:[{id:74,ownaRoomName:'0-1 Room',ratio:4},{id:76,ownaRoomName:'1-2 Room',ratio:4},{id:221,ownaRoomName:'2-3 Room',ratio:5},{id:78,ownaRoomName:'3-4 Room',ratio:10},{id:193,ownaRoomName:'4-5 Room',ratio:10}] },
  { id:'spring-farm',      name:'Spring Farm',       ownaName:'Spring Farm',      floatUnitIds:[270], issUnitIds:[278], leaveUnitIds:[272,273,275], nonRatioUnitIds:[263,264,277,271,311,325,338,279], rooms:[{id:265,ownaRoomName:'Explorers',ratio:4},{id:266,ownaRoomName:'Adventurers',ratio:4},{id:267,ownaRoomName:'Voyagers',ratio:5},{id:269,ownaRoomName:'Achievers',ratio:10}] },
  { id:'denham-court',     name:'Denham Court',      ownaName:'Denham Court',     floatUnitIds:[252], issUnitIds:[260], leaveUnitIds:[254,448,257], nonRatioUnitIds:[245,246,259,253,301,320,333,261], rooms:[{id:247,ownaRoomName:'Explorers',ratio:4},{id:248,ownaRoomName:'Adventurers',ratio:4},{id:300,ownaRoomName:'Pioneers',ratio:5},{id:249,ownaRoomName:'Voyagers',ratio:5},{id:250,ownaRoomName:'Creators',ratio:10},{id:251,ownaRoomName:'Achievers',ratio:10}] },
  { id:'ed-park-1',        name:'Edmondson Park 1',  ownaName:'Ed Park 1',        floatUnitIds:[207], issUnitIds:[228], leaveUnitIds:[102,454,100], nonRatioUnitIds:[89,90,94,163,308,321,340,104],   rooms:[{id:91,ownaRoomName:'0-1 Room',ratio:4},{id:92,ownaRoomName:'1-2 Room',ratio:4},{id:93,ownaRoomName:'2-3 Room',ratio:5},{id:103,ownaRoomName:'3-4 Room',ratio:10},{id:204,ownaRoomName:'4-5 Room',ratio:10}] },
  { id:'ed-park-2',        name:'Edmondson Park 2',  ownaName:'Ed Park 2',        floatUnitIds:[220], issUnitIds:[229], leaveUnitIds:[188,455,194], nonRatioUnitIds:[172,173,190,191,309,322,334,177], rooms:[{id:174,ownaRoomName:'0-1 Room',ratio:4},{id:175,ownaRoomName:'1-2 Room',ratio:4},{id:187,ownaRoomName:'2-3 Room',ratio:5},{id:218,ownaRoomName:'3-4 Room',ratio:10},{id:219,ownaRoomName:'4-5 Room',ratio:10}] },
  { id:'wilton',           name:'Wilton',            ownaName:'Wilton',           floatUnitIds:[372], issUnitIds:[365], leaveUnitIds:[442,459,376], nonRatioUnitIds:[360,361,362,363,364,374,375,373], rooms:[{id:366,ownaRoomName:'Explorers 0-1',ratio:4},{id:367,ownaRoomName:'Adventurers 1-2',ratio:4},{id:428,ownaRoomName:'Wonderers 1-2',ratio:4},{id:368,ownaRoomName:'Voyagers 2-3',ratio:5},{id:369,ownaRoomName:'Creators 3-4',ratio:5},{id:370,ownaRoomName:'Achievers 4-5',ratio:10},{id:371,ownaRoomName:'Achievers 4-5',ratio:10}] },
  { id:'dapto-1',          name:'Dapto 1',           ownaName:'Dapto 1',          floatUnitIds:[205], issUnitIds:[233], leaveUnitIds:[144,452,145], nonRatioUnitIds:[135,136,143,167,306,331,146],    rooms:[{id:137,ownaRoomName:'0-1 Room CS',ratio:4},{id:138,ownaRoomName:'1-2 Room CS',ratio:4},{id:182,ownaRoomName:'2-3 Room CS',ratio:5},{id:183,ownaRoomName:'3-4 Room CS',ratio:10},{id:170,ownaRoomName:'4-5 Room CS',ratio:10}] },
  { id:'dapto-2',          name:'Dapto 2',           ownaName:'Dapto 2',          floatUnitIds:[206], issUnitIds:[227], leaveUnitIds:[185,211,160], nonRatioUnitIds:[153,154,217,168,307,319,332,161], rooms:[{id:155,ownaRoomName:'Explorers',ratio:4},{id:186,ownaRoomName:'Adventurers',ratio:4},{id:157,ownaRoomName:'Voyagers',ratio:5},{id:203,ownaRoomName:'Pioneers',ratio:10},{id:184,ownaRoomName:'Creators',ratio:10},{id:156,ownaRoomName:'Achievers',ratio:10}] },
  { id:'north-wollongong', name:'North Wollongong',  ownaName:'North Wollongong', floatUnitIds:[288], issUnitIds:[296], leaveUnitIds:[290,457,293], nonRatioUnitIds:[281,282,287,289,429,297,313,336], rooms:[{id:283,ownaRoomName:'Explorers',ratio:4},{id:284,ownaRoomName:'Adventurers',ratio:4},{id:285,ownaRoomName:'Voyagers',ratio:5},{id:286,ownaRoomName:'Creators',ratio:5},{id:327,ownaRoomName:'Achievers',ratio:10}] },
  { id:'shell-cove',       name:'Shell Cove',        ownaName:'Shell Cove',       floatUnitIds:[355], issUnitIds:[348], leaveUnitIds:[440,458,359], nonRatioUnitIds:[343,344,345,346,347,357,358,356], rooms:[{id:349,ownaRoomName:'Explorers 0-1',ratio:4},{id:350,ownaRoomName:'1 Pioneers 2-3',ratio:4},{id:351,ownaRoomName:'2 Voyagers 2-3',ratio:5},{id:352,ownaRoomName:'Creators 3-4',ratio:5},{id:353,ownaRoomName:'Achievers 4-5',ratio:10},{id:430,ownaRoomName:'Achievers 4-5',ratio:10},{id:354,ownaRoomName:'Achievers 4-5',ratio:10},{id:431,ownaRoomName:'Achievers 4-5',ratio:10}] },
  { id:'bexley',           name:'Bexley',            ownaName:'Bexley',           floatUnitIds:[181], issUnitIds:[226], leaveUnitIds:[446,451,195], nonRatioUnitIds:[111,112,216,164,305,318,330,232], rooms:[{id:113,ownaRoomName:'0-2 Room',ratio:4},{id:125,ownaRoomName:'2-3 Room',ratio:5},{id:115,ownaRoomName:'3-4 Room 1',ratio:10},{id:121,ownaRoomName:'3-4 Room 2',ratio:10},{id:114,ownaRoomName:'4-5 Room',ratio:10}] },
  { id:'belfield',         name:'Belfield',          ownaName:'Belfield',         floatUnitIds:[389], issUnitIds:[382], leaveUnitIds:[445,450,393], nonRatioUnitIds:[377,378,379,380,381,390,391,392], rooms:[{id:383,ownaRoomName:'0-1 Explorers',ratio:4},{id:384,ownaRoomName:'1-2 Adventurers',ratio:4},{id:385,ownaRoomName:'2-3 Pioneers',ratio:5},{id:386,ownaRoomName:'2-3 Voyagers',ratio:5},{id:387,ownaRoomName:'3-4 Creators',ratio:10},{id:388,ownaRoomName:'4-5 Achievers',ratio:10},{id:439,ownaRoomName:'4-5 Inventors',ratio:10}] },
  { id:'bankstown',        name:'Bankstown',         ownaName:'Bankstown',        floatUnitIds:[423], issUnitIds:[416], leaveUnitIds:[444,449,427], nonRatioUnitIds:[411,412,413,414,415,425,424],     rooms:[{id:417,ownaRoomName:'0-2 Explorers',ratio:4},{id:420,ownaRoomName:'2-3 Voyagers',ratio:5},{id:422,ownaRoomName:'3-5 Achievers',ratio:10}] },
  { id:'glendale',         name:'Glendale',          ownaName:'Glendale',         floatUnitIds:[473], issUnitIds:[465], leaveUnitIds:[476,477,475], nonRatioUnitIds:[461,462,463,464,479,478,474],     rooms:[{id:466,ownaRoomName:'Explorers',ratio:4},{id:467,ownaRoomName:'Adventurers',ratio:4},{id:468,ownaRoomName:'Voyagers',ratio:5},{id:469,ownaRoomName:'Pioneers',ratio:5},{id:470,ownaRoomName:'Creators',ratio:10},{id:471,ownaRoomName:'Achievers',ratio:10}] },
  { id:'edgeworth',        name:'Edgeworth',         ownaName:'Edgeworth',        floatUnitIds:[406], issUnitIds:[399], leaveUnitIds:[447,453,410], nonRatioUnitIds:[394,395,396,397,398,407,408,409], rooms:[{id:400,ownaRoomName:'0-1 Explorers',ratio:4},{id:401,ownaRoomName:'1-2 Adventurers',ratio:4},{id:403,ownaRoomName:'2-3 Voyagers',ratio:5},{id:435,ownaRoomName:'2-3 Wonderlings',ratio:5},{id:404,ownaRoomName:'3-4 Creators',ratio:10},{id:436,ownaRoomName:'3-4 Dreamers',ratio:10},{id:402,ownaRoomName:'4-5 Achievers',ratio:10},{id:405,ownaRoomName:'4-5 Inventors',ratio:10}] },
  { id:'charlestown',      name:'Charlestown',       ownaName:'Charlestown',      floatUnitIds:[496], issUnitIds:[488], leaveUnitIds:[501,502,500], nonRatioUnitIds:[483,484,485,486,487,497,498,499], rooms:[{id:489,ownaRoomName:'Explorers',ratio:4},{id:490,ownaRoomName:'Adventurers',ratio:4},{id:491,ownaRoomName:'Voyagers',ratio:5},{id:492,ownaRoomName:'Pioneers',ratio:5},{id:493,ownaRoomName:'Creators',ratio:10},{id:495,ownaRoomName:'Inventors',ratio:10},{id:494,ownaRoomName:'Achievers',ratio:10}] },
];

function sydneyNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
}

function forecastDate(base) {
  if (base) return base;
  const now = sydneyNow();
  const addDays = now.getDay() === 5 ? 3 : 1; // Friday → Monday
  const d = new Date(now);
  d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
}

function parseAgeMonths(ageStr) {
  if (!ageStr) return 48;
  const m = String(ageStr).match(/(\d+)\s*yr.*?(\d+)?\s*m/i);
  if (m) return parseInt(m[1]) * 12 + (parseInt(m[2]) || 0);
  const yr = String(ageStr).match(/^(\d+)/);
  if (yr) return parseInt(yr[1]) * 12;
  return 48;
}

function calcRequired(ageMonthsArr) {
  const sorted = [...ageMonthsArr].sort((a, b) => a - b);
  let staff = 0, i = 0;
  while (i < sorted.length) {
    const age = sorted[i];
    let ratio, groupEnd;
    if (age < 24)      { ratio = 4;  groupEnd = 24; }
    else if (age < 36) { ratio = 5;  groupEnd = 36; }
    else               { ratio = 10; groupEnd = Infinity; }
    let count = 0;
    while (i < sorted.length && sorted[i] < groupEnd) { count++; i++; }
    staff += Math.ceil(count / ratio);
  }
  return staff;
}

function calcFloatPool({ roomData, floatCount, adCount, childCount }) {
  const totalRatioShortage      = roomData.reduce((s, r) => s + Math.max(0, r.required - r.staffCount), 0);
  const totalSurplus            = roomData.reduce((s, r) => s + Math.max(0, r.staffCount - r.required), 0);
  const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);
  const totalFloorStaff         = roomData.reduce((s, r) => s + r.staffCount, 0);
  const bufferRequired          = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;
  const roomNetSurplus          = Math.max(0, totalSurplus - totalRatioShortage);
  const effectiveFloatCount     = floatCount + roomNetSurplus;
  const adAvailable             = (childCount > 0 && childCount < 100) ? adCount : 0;
  const totalFloatersNeeded     = Math.max(0, netShortageAfterRealloc + bufferRequired);
  const casualsNeeded           = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);
  const floatSurplus            = casualsNeeded <= 0 ? (effectiveFloatCount + adAvailable - totalFloatersNeeded) : 0;
  const surplusVal              = casualsNeeded > 0 ? -casualsNeeded : floatSurplus;
  return { totalRequired: roomData.reduce((s, r) => s + r.required, 0), totalFloorStaff, totalFloatersNeeded, casualsNeeded, floatSurplus, surplusVal, adAvailable };
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function sbJson(path) {
  const r = await sb(path);
  return r.ok ? r.json() : [];
}

export default async function handler(req, res) {
  // Auth: Vercel cron secret or manual trigger with ?secret=
  const auth  = (req.headers.authorization || '').replace('Bearer ', '');
  const query = req.query.secret || '';
  if (CRON_SECRET && auth !== CRON_SECRET && query !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Guard: only run Mon–Fri (cron fires at 04:45 UTC = 14:45 Sydney standard / 15:45 DST — we check both)
  if (req.headers['x-vercel-cron']) {
    const now = sydneyNow();
    const day = now.getDay();
    if (day === 0 || day === 6) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Weekend' });
    }
  }

  const date = forecastDate(req.query.date || null);
  const host  = req.headers.host || 'plan.tga.edu.au';
  const proto = req.headers['x-forwarded-proto'] || 'https';

  console.log(`[cron-forecast-cache] Caching forecast for ${date}`);

  // Fetch all unit IDs so we can pull rosters in one request
  const allUnitIds = [...new Set(CENTRES.flatMap(c => [
    ...c.rooms.map(r => r.id),
    ...(c.floatUnitIds ?? []),
    ...(c.leaveUnitIds ?? []),
    ...(c.nonRatioUnitIds ?? []),
    ...(c.issUnitIds ?? []),
  ]))];

  // Fetch rosters for tomorrow from Deputy (via POD cache)
  const rosterRes = await fetch(`${proto}://${host}/api/deputy-rosters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, unitIds: allUnitIds }),
  });
  const rosters = rosterRes.ok ? await rosterRes.json() : [];

  // Fetch expected attendance (last week same weekday) from Supabase
  const targetDate = new Date(date + 'T12:00:00Z');
  const lastWeek   = new Date(targetDate);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const lastWeekStr = lastWeek.toISOString().slice(0, 10);

  const attendance = await sbJson(
    `attendance_daily?date=eq.${lastWeekStr}&select=campus,room,age&limit=5000`
  );

  // Z casuals for tomorrow
  const zCasualRows = await sbJson(`z_casuals?date=eq.${date}&select=centre,start_time,end_time`);
  const zCasualCountByCentre = {};
  for (const row of zCasualRows) {
    if (row.start_time && row.end_time) {
      zCasualCountByCentre[row.centre] = (zCasualCountByCentre[row.centre] || 0) + 1;
    }
  }

  const upsertRows = [];
  const summary    = [];

  for (const centre of CENTRES) {
    const campus = centre.ownaName ?? centre.name;

    const centreRosters = rosters.filter(r => {
      const uid = r.OperationalUnit;
      return centre.rooms.some(rm => rm.id === uid)
        || centre.floatUnitIds.includes(uid)
        || centre.leaveUnitIds.includes(uid)
        || centre.nonRatioUnitIds.includes(uid)
        || (centre.issUnitIds || []).includes(uid);
    }).map(r => ({
      employeeId: r.Employee,
      unitId:     r.OperationalUnit,
      unitName:   r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '',
    }));

    const leaveSet    = new Set(centre.leaveUnitIds);
    const floatSet    = new Set(centre.floatUnitIds);
    const nonRatioSet = new Set(centre.nonRatioUnitIds);

    function rawType(r) {
      if (leaveSet.has(r.unitId))    return 'leave';
      if (floatSet.has(r.unitId))    return 'float';
      if (nonRatioSet.has(r.unitId)) return 'support';
      if (centre.rooms.some(rm => rm.id === r.unitId)) return 'room';
      return 'other';
    }

    const floatEntries = centreRosters.filter(r => rawType(r) === 'float');
    const zFloat       = zCasualCountByCentre[centre.name] || 0;
    const floatCount   = floatEntries.length + zFloat;

    const adCount = centreRosters.filter(r =>
      rawType(r) === 'support' &&
      (r.unitName.toLowerCase().includes('assistant director') ||
       r.unitName.toLowerCase().includes('asst director') ||
       r.unitName.toLowerCase().includes('ass. director'))
    ).length;

    // Expected children per room from last week's attendance
    const campusAtt = attendance.filter(a => a.campus === campus);
    const childCount = campusAtt.length;

    const roomData = centre.rooms.map(room => {
      const owna = (room.ownaRoomName ?? '').toLowerCase();
      const roomKids = campusAtt
        .filter(a => owna && a.room && a.room.toLowerCase().includes(owna))
        .map(a => parseAgeMonths(a.age));
      return {
        required:   calcRequired(roomKids),
        staffCount: centreRosters.filter(r => r.unitId === room.id).length,
      };
    });

    const pool = calcFloatPool({ roomData, floatCount, adCount, childCount });

    upsertRows.push({
      centre_id:       centre.id,
      date,
      casuals_needed:  pool.casualsNeeded,
      float_surplus:   pool.floatSurplus,
      floaters_needed: pool.totalFloatersNeeded,
      floor_staff:     pool.totalFloorStaff,
      required_staff:  pool.totalRequired,
      expected_children: childCount,
      updated_at:      new Date().toISOString(),
    });

    summary.push({
      centreId:        centre.id,
      name:            centre.name,
      date,
      expectedChildren: childCount,
      requiredStaff:   pool.totalRequired,
      floorStaff:      pool.totalFloorStaff,
      floatCount,
      adAvailable:     pool.adAvailable,
      casualsNeeded:   pool.casualsNeeded,
      floatSurplus:    pool.floatSurplus,
      surplusVal:      pool.surplusVal,
    });
  }

  // Upsert all centres into staffing_analysis_cache
  const upsertRes = await sb(
    'staffing_analysis_cache?on_conflict=centre_id,date',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(upsertRows),
    }
  );

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    console.error('[cron-forecast-cache] Upsert failed:', err);
    return res.status(500).json({ error: 'Supabase upsert failed', detail: err });
  }

  console.log(`[cron-forecast-cache] Cached ${upsertRows.length} centres for ${date}`);
  return res.status(200).json({ ok: true, date, centres: summary.length, summary });
}
