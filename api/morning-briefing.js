/**
 * /api/morning-briefing
 * GET ?date=YYYY-MM-DD&centreId=oatley (optional filters)
 *
 * Returns the exact same surplus/deficit values shown on the Morning Briefing
 * dashboard cards — calculated from the same Deputy roster cache + Owna
 * attendance data. The email script reads these numbers directly instead of
 * recalculating them.
 *
 * Response: [{ centreId, name, surplusVal, casualsNeeded, floatSurplus,
 *              floatCount, adAvailable, totalFloatersNeeded,
 *              childrenToday, staffAvailable, requiredStaff }]
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

// Mirrors src/config.ts — rooms include ownaRoomName for child matching
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

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  }).then(r => r.ok ? r.json() : []);
}

// Exact same ratio calculation as calcRequiredStaff in ratioEngine.ts
function calcRequired(children) {
  // Sort by age ascending, then cascade
  const sorted = [...children].sort((a, b) => a - b);
  let staff = 0, i = 0;
  while (i < sorted.length) {
    const age = sorted[i];
    let ratio, groupEnd;
    if (age < 24)       { ratio = 4;  groupEnd = 24; }
    else if (age < 36)  { ratio = 5;  groupEnd = 36; }
    else                { ratio = 10; groupEnd = Infinity; }
    // Count how many in this group
    let count = 0;
    while (i < sorted.length && sorted[i] < groupEnd) { count++; i++; }
    staff += Math.ceil(count / ratio);
  }
  return staff;
}

function parseAgeMonths(ageStr) {
  if (!ageStr) return 48; // default to 4yr if unknown
  const m = String(ageStr).match(/(\d+)\s*yr.*?(\d+)?\s*m/i);
  if (m) return parseInt(m[1]) * 12 + (parseInt(m[2]) || 0);
  const yr = String(ageStr).match(/^(\d+)/);
  if (yr) return parseInt(yr[1]) * 12;
  return 48;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const date      = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  const centreFilter = req.query.centreId ? req.query.centreId.split(',') : null;

  const centres = centreFilter
    ? CENTRES.filter(c => centreFilter.includes(c.id))
    : CENTRES;

  // Fetch processed rosters via the same endpoint the frontend uses.
  // This ensures we apply the same filtering/dedup (Employee!=0, no staff
  // meeting/study time, split-shift dedup) so API numbers match the page.
  const allUnitIds = [...new Set(centres.flatMap(c => [
    ...c.rooms.map(r => r.id),
    ...(c.floatUnitIds ?? []),
    ...(c.leaveUnitIds ?? []),
    ...(c.nonRatioUnitIds ?? []),
    ...(c.issUnitIds ?? []),
  ]))];
  const host = req.headers.host || 'plan.tga.edu.au';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const rosterRes = await fetch(`${proto}://${host}/api/deputy-rosters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, unitIds: allUnitIds }),
  });
  const rosters = rosterRes.ok ? await rosterRes.json() : [];

  // Fetch attendance for the date (children sign-ins)
  // Paginate attendance to beat Supabase's 1000-row default cap
  const attendance = [];
  {
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const page = await sb(`attendance_daily?date=eq.${date}&select=campus,room,age,sign_in,sign_out,predicted_sign_out&order=campus,room,child_name&limit=${PAGE}&offset=${offset}`);
      if (!Array.isArray(page) || page.length === 0) break;
      attendance.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }
  }

  // Current Sydney time as HH:MM for "currently present" filtering
  const nowSyd = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const nowHHMM = `${String(nowSyd.getHours()).padStart(2, '0')}:${String(nowSyd.getMinutes()).padStart(2, '0')}`;

  function isPresent(a) {
    if (!a.sign_in) return false;
    if (a.sign_out) return false;
    if (a.predicted_sign_out && a.predicted_sign_out <= nowHHMM) return false;
    return true;
  }

  // Fetch saved ratio-check state (staffMoves) for all centres
  const ratioCheckRows = await sb(`ratio_check_data?date=eq.${date}&select=centre_id,session,data`)
    .catch(() => []);
  const staffMovesByCentre = {};
  for (const row of ratioCheckRows) {
    const moves = row.data?.staffMoves || {};
    const existing = staffMovesByCentre[row.centre_id] || {};
    staffMovesByCentre[row.centre_id] = { ...existing, ...moves };
  }

  // Fetch cached Z Staffing casuals for all centres
  const zCasualRows = await sb(`z_casuals?date=eq.${date}&select=centre,start_time,end_time`)
    .catch(() => []);
  const zCasualCountByCentre = {};
  for (const row of zCasualRows) {
    if (row.start_time && row.end_time) {
      zCasualCountByCentre[row.centre] = (zCasualCountByCentre[row.centre] || 0) + 1;
    }
  }

  // ── Read staffing_analysis_cache from Supabase ──────────────────────────
  // Written by RatioDashboardPage every time the float pool recalculates.
  // If a cached value exists for a centre+date, use it — guarantees the email
  // shows exactly the same surplus/deficit as the dashboard.
  let analysisCache = {};
  try {
    const cacheRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staffing_analysis_cache?date=eq.${date}&select=centre_id,casuals_needed,float_surplus,floaters_needed,floor_staff,updated_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (cacheRes.ok) {
      const rows = await cacheRes.json();
      for (const row of rows) analysisCache[row.centre_id] = row;
    }
  } catch (e) {
    console.warn('[morning-briefing] Could not fetch staffing_analysis_cache:', e.message);
  }

  const results = [];

  for (const centre of centres) {
    const campus = centre.ownaName ?? centre.name;

    // Rosters for this centre
    const centreRosters = rosters.filter(r => {
      const unitId = r.OperationalUnit;
      return centre.rooms.some(rm => rm.id === unitId)
        || centre.floatUnitIds.includes(unitId)
        || centre.leaveUnitIds.includes(unitId)
        || centre.nonRatioUnitIds.includes(unitId)
        || (centre.issUnitIds || []).includes(unitId);
    }).map(r => ({
      employeeId: r.Employee,
      unitId:     r.OperationalUnit,
      unitName:   r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName ?? '',
    }));

    // Children for this campus
    const campusAttendance = attendance.filter(a => a.campus === campus);
    const presentAttendance = campusAttendance.filter(isPresent);
    const presentKids = presentAttendance.map(a => parseAgeMonths(a.age));
    const allDayKids = campusAttendance.map(a => parseAgeMonths(a.age));

    const leaveSet    = new Set(centre.leaveUnitIds);
    const floatSet    = new Set(centre.floatUnitIds);
    const nonRatioSet = new Set(centre.nonRatioUnitIds);
    const staffMoves  = staffMovesByCentre[centre.id] || {};
    const zCasualFloatCount = zCasualCountByCentre[centre.name] || 0;

    // Raw unit type ignoring saved staffMoves — matches MorningBriefingPage.tsx exactly.
    function rawUnitType(r) {
      if (leaveSet.has(r.unitId)) return 'leave';
      if (floatSet.has(r.unitId)) return 'float';
      if (nonRatioSet.has(r.unitId)) return 'support';
      if (centre.rooms.some(rm => rm.id === r.unitId)) return 'room';
      return 'other';
    }

    const staffIds = new Set(centreRosters
      .filter(r => rawUnitType(r) === 'room')
      .map(r => r.employeeId));

    const absentIds = new Set(centreRosters
      .filter(r => rawUnitType(r) === 'leave')
      .map(r => r.employeeId));

    const floatEntries = centreRosters.filter(r => rawUnitType(r) === 'float');
    const floatIds     = new Set(floatEntries.map(r => r.employeeId));
    const floatCount   = floatEntries.length + zCasualFloatCount;

    const adCount = centreRosters.filter(r =>
      rawUnitType(r) === 'support' &&
      (r.unitName.toLowerCase().includes('assistant director') ||
       r.unitName.toLowerCase().includes('asst director') ||
       r.unitName.toLowerCase().includes('ass. director'))
    ).length;

    // Per-room breakdown for each basis so we can report both all-day and currently-present.
    function makeRoomData(attendanceSet) {
      return centre.rooms.map(room => {
        const owna = (room.ownaRoomName ?? '').toLowerCase();
        const roomKids = attendanceSet
          .filter(a => owna && a.room && a.room.toLowerCase().includes(owna))
          .map(a => parseAgeMonths(a.age));
        const roomRequired = calcRequired(roomKids);
        // Match the frontend exactly: room staff are rostered to this room's Deputy unit.
        const roomStaff = centreRosters.filter(r => r.unitId === room.id).length;
        return { required: roomRequired, staffCount: roomStaff };
      });
    }

    function calcFloatPool(roomData, childCount) {
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
      const totalRequired           = roomData.reduce((s, r) => s + r.required, 0);
      return { totalRequired, totalFloatersNeeded, casualsNeeded, floatSurplus, surplusVal, effectiveFloatCount, roomNetSurplus };
    }

    const allDayPool   = calcFloatPool(makeRoomData(campusAttendance), allDayKids.length);
    const presentPool  = calcFloatPool(makeRoomData(presentAttendance), presentKids.length);

    // Default the report to currently-present, as requested.
    const totalRequired       = presentPool.totalRequired;
    const totalFloatersNeeded = presentPool.totalFloatersNeeded;
    const casualsNeeded       = presentPool.casualsNeeded;
    const floatSurplus        = presentPool.floatSurplus;
    const surplusVal          = presentPool.surplusVal;
    const effectiveFloatCount = presentPool.effectiveFloatCount;
    const roomNetSurplus      = presentPool.roomNetSurplus;
    const adAvailable         = (presentKids.length > 0 && presentKids.length < 100) ? adCount : 0;

    const roomAbsent = [...absentIds].filter(id => staffIds.has(id)).length;

    // Use cached values from Supabase when available (written by RatioDashboardPage)
    // so the email always matches the dashboard exactly.
    const cached = analysisCache[centre.id];
    const finalCasualsNeeded = cached != null ? cached.casuals_needed : casualsNeeded;
    const finalFloatSurplus  = cached != null ? cached.float_surplus  : floatSurplus;
    const finalSurplusVal    = cached != null ? (finalCasualsNeeded > 0 ? -finalCasualsNeeded : finalFloatSurplus) : surplusVal;
    const finalFloatersNeeded = cached != null ? cached.floaters_needed : totalFloatersNeeded;

    results.push({
      centreId:           centre.id,
      name:               centre.name,
      date,
      childrenToday:      presentKids.length,
      childrenAllDay:     allDayKids.length,
      staffAvailable:     staffIds.size - roomAbsent,
      floatCount,
      adAvailable,
      requiredStaff:      totalRequired,
      totalFloatersNeeded: finalFloatersNeeded,
      casualsNeeded:      finalCasualsNeeded,
      floatSurplus:       finalFloatSurplus,
      surplusVal:         finalSurplusVal,
      cachedAt:           cached?.updated_at ?? null,
      allDay: {
        children: allDayKids.length,
        required: allDayPool.totalRequired,
        totalFloatersNeeded: allDayPool.totalFloatersNeeded,
        casualsNeeded: allDayPool.casualsNeeded,
        floatSurplus: allDayPool.floatSurplus,
        surplusVal: allDayPool.surplusVal,
      },
      present: {
        children: presentKids.length,
        required: presentPool.totalRequired,
        totalFloatersNeeded: presentPool.totalFloatersNeeded,
        casualsNeeded: presentPool.casualsNeeded,
        floatSurplus: presentPool.floatSurplus,
        surplusVal: presentPool.surplusVal,
      },
    });
  }

  res.status(200).json(results);
}
