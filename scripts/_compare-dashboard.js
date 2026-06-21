// Pull the same data the Morning Briefing dashboard uses and compute surplus/deficit
// then compare to what the staffing report emailed
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../api/deputy-rosters.js', import.meta.url), 'utf8');
const SK = src.match(/SERVICE_KEY\s*=\s*'([^']+)'/)[1];
const DEPUTY_TOKEN = src.match(/DEPUTY_TOKEN\s*=\s*'([^']+)'/)[1];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

// Same CENTRES config as the dashboard (id, ownaName, rooms with deputyUnitId, floatUnitIds, leaveUnitIds, nonRatioUnitIds)
const CENTRES = [
  { id:'oatley',          name:'Oatley',            ownaName:'Oatley',
    rooms:[213,132,133,196,159,223], floatUnitIds:[224], leaveUnitIds:[134,142,139], nonRatioUnitIds:[130,131,197,165,141,235,324,337] },
  { id:'wollongong',      name:'Wollongong',         ownaName:'Wollongong',       deputyName:'Wollongong',
    rooms:[118,119,201], floatUnitIds:[126], leaveUnitIds:[128,460,127], nonRatioUnitIds:[116,117,124,166,202,312,326,339] },
  { id:'mount-annan',     name:'Mount Annan',        ownaName:'Mount Annan',
    rooms:[74,76,221,78,193], floatUnitIds:[222], leaveUnitIds:[108,456,109], nonRatioUnitIds:[72,73,101,162,234,323,335,79] },
  { id:'spring-farm',     name:'Spring Farm',        ownaName:'Spring Farm',
    rooms:[265,266,267,269], floatUnitIds:[270], leaveUnitIds:[272,273,275], nonRatioUnitIds:[263,264,277,271,311,325,338,279] },
  { id:'denham-court',    name:'Denham Court',       ownaName:'Denham Court',
    rooms:[247,248,300,249,250,251], floatUnitIds:[252], leaveUnitIds:[254,448,257], nonRatioUnitIds:[245,246,259,253,301,320,333,261] },
  { id:'ed-park-1',       name:'Edmondson Park 1',   ownaName:'Ed Park 1',        deputyName:'Edmondson Park 1',
    rooms:[91,92,93,103,204], floatUnitIds:[207], leaveUnitIds:[102,454,100], nonRatioUnitIds:[89,90,94,163,308,321,340,104] },
  { id:'ed-park-2',       name:'Edmondson Park 2',   ownaName:'Ed Park 2',        deputyName:'Edmondson Park 2',
    rooms:[174,175,187,218,219], floatUnitIds:[220], leaveUnitIds:[188,455,194], nonRatioUnitIds:[172,173,190,191,309,322,334,177] },
  { id:'wilton',          name:'Wilton',             ownaName:'Wilton',
    rooms:[366,367,428,368,369,370,371], floatUnitIds:[372], leaveUnitIds:[442,459,376], nonRatioUnitIds:[360,361,362,363,364,374,375,373] },
  { id:'dapto-1',         name:'Dapto 1',            ownaName:'Dapto 1',
    rooms:[137,138,182,183,170], floatUnitIds:[205], leaveUnitIds:[144,452,145], nonRatioUnitIds:[135,136,143,167,306,331,146] },
  { id:'dapto-2',         name:'Dapto 2',            ownaName:'Dapto 2',
    rooms:[155,186,157,203,184,156], floatUnitIds:[206], leaveUnitIds:[185,211,160], nonRatioUnitIds:[153,154,217,168,307,319,332,161] },
  { id:'north-wollongong',name:'North Wollongong',   ownaName:'North Wollongong',
    rooms:[283,284,285,286,327], floatUnitIds:[288], leaveUnitIds:[290,457,293], nonRatioUnitIds:[281,282,287,289,429,297,313,336] },
  { id:'shell-cove',      name:'Shell Cove',         ownaName:'Shell Cove',
    rooms:[349,350,351,352,353,430,354,431], floatUnitIds:[355], leaveUnitIds:[440,458,359], nonRatioUnitIds:[343,344,345,346,347,357,358,356] },
  { id:'bexley',          name:'Bexley',             ownaName:'Bexley',
    rooms:[113,125,115,121,114], floatUnitIds:[181], leaveUnitIds:[446,451,195], nonRatioUnitIds:[111,112,216,164,305,318,330,232] },
  { id:'belfield',        name:'Belfield',           ownaName:'Belfield',
    rooms:[383,384,385,386,387,388,439], floatUnitIds:[389], leaveUnitIds:[445,450,393], nonRatioUnitIds:[377,378,379,380,381,390,391,392] },
  { id:'bankstown',       name:'Bankstown',          ownaName:'Bankstown',
    rooms:[417,420,422], floatUnitIds:[423], leaveUnitIds:[444,449,427], nonRatioUnitIds:[411,412,413,414,415,425,424] },
  { id:'glendale',        name:'Glendale',           ownaName:'Glendale',
    rooms:[466,467,468,469,470,471], floatUnitIds:[473], leaveUnitIds:[476,477,475], nonRatioUnitIds:[461,462,463,464,479,478,474] },
  { id:'edgeworth',       name:'Edgeworth',          ownaName:'Edgeworth',
    rooms:[400,401,403,435,404,436,402,405], floatUnitIds:[406], leaveUnitIds:[447,453,410], nonRatioUnitIds:[394,395,396,397,398,407,408,409] },
];

const ROOM_NAMES = {
  'oatley':           ['0-1 Room','1-2 Room','2-3 Room 1','2.5-3.5 Room','3-4 Room','3.5-5 Room'],
  'wollongong':       ['0-2 Room','2-3 Room','3-5 Room'],
  'mount-annan':      ['0-1 Room','1-2 Room','2-3 Room','3-4 Room','4-5 Room'],
  'spring-farm':      ['0-1','1-2','2-3','3-5'],
  'denham-court':     ['0-1','1-2','2-3 Room 1','2-3 Room 2','3-4','4-5'],
  'ed-park-1':        ['0-1 Room','1-2 Room','2-3 Room','3-4 Room','4-5 Room'],
  'ed-park-2':        ['0-1 Room','1-2 Room','2-3 Room','3-4 Room','4-5 Room'],
  'wilton':           ['Explorers 0-1','Adventurers 1-2','Wonderers 1-2','Pioneers 2-3','Voyagers 2-3','Creators 3-4','Achievers 4-5'],
  'dapto-1':          ['0-1 Room CS','1-2 Room CS','2-3 Room CS','3-4 Room CS','4-5 Room CS'],
  'dapto-2':          ['Explorers','Adventurers','Voyagers','Pioneers','Creators','Achievers'],
  'north-wollongong': ['Explorers','Adventurers','Voyagers','Creators','Achievers'],
  'shell-cove':       ['Explorers 0-1','Adventurers 1-2','1 Pioneers 2-3','2 Voyagers 2-3','Creators 3-4','Dreamers 3-4','Achievers 4-5','Inventors 4-5'],
  'bexley':           ['0-2 Room','2-3 Room','3-4 Room 1','3-4 Room 2','4-5 Room'],
  'belfield':         ['0-1 Explorers','1-2 Adventurers','2-3 Pioneers','2-3 Voyagers','3-4 Creators','4-5 Achievers','4-5 Inventors'],
  'bankstown':        ['0-2 Explorers','2-3 Voyagers','3-5 Achievers'],
  'glendale':         ['Explorers','Adventurers','Voyagers','Pioneers','Creators','Achievers'],
  'edgeworth':        ['0-1 Explorers','1-2 Adventurers','2-3 Voyagers','2-3 Wonderlings','3-4 Creators','3-4 Dreamers','4-5 Achievers','4-5 Inventors'],
};

function parseAgeMonths(ageStr) {
  if (!ageStr) return 36;
  const ym = ageStr.match(/(\d+)y\s*(\d+)m/); if (ym) return parseInt(ym[1])*12+parseInt(ym[2]);
  const y = ageStr.match(/(\d+)y/); if (y) return parseInt(y[1])*12;
  const m = ageStr.match(/(\d+)m/); if (m) return parseInt(m[1]);
  return 36;
}

function calcRequired(ages) {
  const u2=ages.filter(a=>a<24).length, u3=ages.filter(a=>a>=24&&a<36).length, u6=ages.filter(a=>a>=36).length;
  let req=0,cap=0;
  const s1=Math.ceil(u2/4); cap=s1*4-u2; req+=s1;
  const net23=Math.max(0,u3-cap); cap=Math.max(0,cap-u3)+(Math.ceil(net23/5)*5-net23); req+=Math.ceil(net23/5);
  req+=Math.ceil(Math.max(0,u6-cap)/10);
  return req;
}

// Fetch attendance (paginated + ordered)
let attendance=[], offset=0;
while(true){
  const r=await fetch(`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?select=campus,room,age&date=eq.${today}&order=campus.asc,child_name.asc&limit=1000&offset=${offset}`,{headers:{apikey:SK,Authorization:`Bearer ${SK}`}});
  const rows=await r.json(); if(!rows.length)break; attendance.push(...rows); if(rows.length<1000)break; offset+=1000;
}

// Fetch live rosters
let allRosters=[], start=1;
while(true){
  const body=JSON.stringify({max:500,start,search:{s1:{field:'Date',type:'eq',data:today}}});
  const r=await fetch('https://thegroveacademy.au.deputy.com/api/v1/resource/Roster/QUERY',{method:'POST',headers:{Authorization:`Bearer ${DEPUTY_TOKEN}`,'Content-Type':'application/json'},body});
  const page=await r.json(); if(!Array.isArray(page)||!page.length)break; allRosters.push(...page); if(page.length<500)break; start+=500;
}

// Index attendance by campus
const attendanceByCampus={};
for(const r of attendance){if(!attendanceByCampus[r.campus])attendanceByCampus[r.campus]=[];attendanceByCampus[r.campus].push(r);}

// Index rosters by deputy company name
const rostersByCampus={};
for(const r of allRosters){
  const company=r._DPMetaData?.OperationalUnitInfo?.CompanyName||'';
  const campus=company.includes(' - ')?company.split(' - ').slice(1).join(' - '):company;
  if(!campus)continue;
  if(!rostersByCampus[campus])rostersByCampus[campus]=[];
  rostersByCampus[campus].push(r);
}

console.log(`\nDashboard comparison — ${today}`);
console.log(`${'Centre'.padEnd(22)} ${'Chld'.padStart(4)} ${'Req'.padStart(4)} ${'Avail'.padStart(5)} ${'Surplus'.padStart(8)}  Dashboard expects`);
console.log('─'.repeat(80));

for(const centre of CENTRES){
  const campusName=centre.ownaName||centre.name;
  const deputyName=centre.deputyName||centre.name;
  const kids=attendanceByCampus[campusName]||[];

  let rosters=rostersByCampus[deputyName]||[];
  if(!rosters.length){
    const key=Object.keys(rostersByCampus).find(k=>k.toLowerCase()===deputyName.toLowerCase());
    if(key)rosters=rostersByCampus[key];
  }

  const leaveSet=new Set(centre.leaveUnitIds);
  const floatSet=new Set(centre.floatUnitIds);
  const nonRatioSet=new Set(centre.nonRatioUnitIds);
  const roomSet=new Set(centre.rooms);

  const staffIds=new Set(), leaveIds=new Set(), floatEntries=[], adEntries=[];
  for(const r of rosters){
    const uid=r.OperationalUnit, eid=r.Employee;
    if(!eid||r.Open)continue;
    if(leaveSet.has(uid))leaveIds.add(eid);
    else if(floatSet.has(uid))floatEntries.push(r);
    else if(roomSet.has(uid))staffIds.add(eid);
    else if(nonRatioSet.has(uid)){
      const ul=(r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName||'').toLowerCase();
      if(ul.includes('assistant director')||ul.includes('asst director'))adEntries.push(r);
    }
  }
  const floatIds=new Set(floatEntries.map(r=>r.Employee));
  const floatCount=floatEntries.length;
  const roomAndFloatAbsent=[...leaveIds].filter(id=>staffIds.has(id)||floatIds.has(id)).length;
  const roomAbsent=[...leaveIds].filter(id=>staffIds.has(id)).length;
  const totalAvailable=staffIds.size+floatIds.size-roomAndFloatAbsent;
  const adAvailable=(kids.length>0&&kids.length<100)?adEntries.length:0;

  // Per-room required
  const roomNames=ROOM_NAMES[centre.id]||[];
  let required=0;
  for(const ownaRoomName of roomNames){
    const ownaLower=ownaRoomName.toLowerCase();
    const roomKids=kids.filter(k=>k.room&&k.room.toLowerCase().includes(ownaLower));
    required+=calcRequired(roomKids.map(k=>parseAgeMonths(k.age)));
  }
  if(!roomNames.length) required=calcRequired(kids.map(k=>parseAgeMonths(k.age)));

  // Float pool formula
  const roomStaffAvail=staffIds.size-roomAbsent;
  const totalRatioShortage=Math.max(0,required-roomStaffAvail);
  const totalRoomSurplus=Math.max(0,roomStaffAvail-required);
  const netShortageAfterRealloc=Math.max(0,totalRatioShortage-totalRoomSurplus);
  const totalFloorStaff=roomSet.size>0?[...rosters].filter(r=>roomSet.has(r.OperationalUnit)&&!r.Open&&r.Employee).length:0;
  const bufferRequired=totalFloorStaff>0?totalFloorStaff/6:0;
  const roomNetSurplus=Math.max(0,totalRoomSurplus-totalRatioShortage);
  const effectiveFloatCount=floatCount+roomNetSurplus;
  const totalFloatersNeeded=Math.max(0,netShortageAfterRealloc+bufferRequired);
  const casualsNeeded=Math.max(0,totalFloatersNeeded-effectiveFloatCount-adAvailable);
  const floatSurplus=casualsNeeded<=0?(effectiveFloatCount+adAvailable-totalFloatersNeeded):0;
  const surplusVal=casualsNeeded>0?-casualsNeeded:floatSurplus;
  const absent=roomAndFloatAbsent;

  const s=surplusVal>=0?`+${surplusVal.toFixed(1)}`:surplusVal.toFixed(1);
  console.log(`${centre.name.padEnd(22)} ${String(kids.length).padStart(4)} ${String(required).padStart(4)} ${String(totalAvailable).padStart(5)} ${s.padStart(8)}  ${absent>0?`(${absent} absent)`:''}`);
}
