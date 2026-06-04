const fs = require('fs');
const FFFD = '\uFFFD';

function fixFile(path, fixes) {
  let content = fs.readFileSync(path, 'utf8');
  let total = 0;
  for (const [bad, good] of fixes) {
    const count = content.split(bad).length - 1;
    if (count > 0) {
      content = content.split(bad).join(good);
      total += count;
      console.log(`  ${count}x: ${JSON.stringify(bad).substring(0,40)} → ${JSON.stringify(good).substring(0,40)}`);
    }
  }
  fs.writeFileSync(path, content, 'utf8');
  return total;
}

// Common substitutions: FFFD in a code comment or label → em dash
// FFFD between two words in JSX → middle dot or em dash depending on context
// FFFD replacing emojis → restore the emoji

const dashPage = [
  // Time range en-dash in template literal: ${start}–${end}
  ['${start}' + FFFD + '${end}', '${start}\u2013${end}'],
  // String apostrophes
  ['don' + FFFD + 't', "don't"],
  ['room' + FFFD + 's', "room's"],
  ["they" + FFFD + "re", "they're"],
  // Em-dash in comments/labels (space–space pattern)
  [' ' + FFFD + ' best coverage', ' — best coverage'],
  [' ' + FFFD + ' guards against', ' — guards against'],
  [' ' + FFFD + ' excluded from float', ' — excluded from float'],
  [' ' + FFFD + ' persisted in URL', ' — persisted in URL'],
  [' ' + FFFD + ' local copy', ' — local copy'],
  [' ' + FFFD + ' offline', ' — offline'],
  [' ' + FFFD + ' saved locally', ' — saved locally'],
  [' ' + FFFD + ' used for snapshot', ' — used for snapshot'],
  [' ' + FFFD + ' Plan of the Day', ' — Plan of the Day'],
  [' ' + FFFD + ' Inclusion Support Staff', ' — Inclusion Support Staff'],
  [' ' + FFFD + ' All Rooms', ' — All Rooms'],
  [' ' + FFFD + ' 15-min intervals', ' — 15-min intervals'],
  [' ' + FFFD + ' always real-time', ' — always real-time'],
  // Middle dot separators (· not —)
  ['` ' + FFFD + ' ${onLeave', '` \xb7 ${onLeave'],
  [' ' + FFFD + ' ${issDeployed', ' \xb7 ${issDeployed'],
  ['.length} ' + FFFD + ' deployed', '.length} \xb7 deployed'],
  // Refresh button emoji
  [FFFD + FFFD + ' Refresh', '🔄 Refresh'],
  // Snapshot with middot
  [FFFD + FFFD + ' Snapshot ' + FFFD + ' right now', '👁 Snapshot · right now'],
  // Float tooltip: No overlap — room active
  [FFFD + FFFD + ' No overlap ' + FFFD + ' room active', '⚠️ No overlap — room active'],
  // Float tooltip: Partial — covers
  [FFFD + FFFD + ' Partial ' + FFFD + ' covers', '🟡 Partial — covers'],
  // Reallocation active
  [FFFD + FFFD + ' Reallocation active ' + FFFD + ' ', '✅ Reallocation active — '],
  // Drag instruction emoji
  [FFFD + FFFD + ' Drag staff chips', '🖱 Drag staff chips'],
  // Saved indicator
  [' ' + FFFD + ' ' + FFFD + ' Saved', ' · ✅ Saved'],
  [' ' + FFFD + '✅ Saved', ' · ✅ Saved'],
  // Close X buttons
  ['>' + FFFD + '</button>', '>×</button>'],
  // Header separator: centre name · date
  ['.name} ' + FFFD + ' {safeFormat', '.name} · {safeFormat'],
  // Time ranges in tooltips: 7–9am, 4–6pm
  ['7' + FFFD + '9am', '7–9am'],
  ['4' + FFFD + '6pm', '4–6pm'],
  // Any remaining FFFD in comments (→ em-dash)
  ['// Sort by shift overlap with the room' + FFFD + 's', "// Sort by shift overlap with the room's"],
  ['// Rank available floats by overlap with this room' + FFFD + 's', "// Rank available floats by overlap with this room's"],
];

const checkPanel = [
  // Curly apostrophes in comments
  ['don' + FFFD + 't', "don't"],
  ['they' + FFFD + 're', "they're"],
  // Em-dashes in comments
  [' ' + FFFD + ' always real-time', ' — always real-time'],
  [' ' + FFFD + ' suppress float', ' — suppress float'],
  [' ' + FFFD + ' dragging', ' — dragging'],
  [' ' + FFFD + ' Manual', ' — Manual'],
  [' ' + FFFD + ' if', ' — if'],
  [' ' + FFFD + ' in a room', ' — in a room'],
  [' ' + FFFD + ' at this slot', ' — at this slot'],
  [' ' + FFFD + ' dedup', ' — dedup'],
  [' ' + FFFD + ' skip', ' — skip'],
  [' ' + FFFD + ' render merged cell', ' — render merged cell'],
  [' ' + FFFD + ' drag to Additional', ' — drag to Additional'],
  [' ' + FFFD + ' drag to reassign', ' — drag to reassign'],
  [' ' + FFFD + ' on lunch break', ' — on lunch break'],
  [' ' + FFFD + ' scheduled for cleaning', ' — scheduled for cleaning'],
  [' ' + FFFD + ' scheduled for programming', ' — scheduled for programming'],
  [' ' + FFFD + ' each merges', ' — each merges'],
  [' ' + FFFD + ' Add staff only', ' — Add staff only'],
  // Select option arrows
  ['— start ' + FFFD, '— start —'],
  ['— end ' + FFFD, '— end —'],
  [FFFD + ' start ' + FFFD, '— start —'],
  [FFFD + ' end ' + FFFD, '— end —'],
  // FG label with emoji: 🎨 {fg.label} — {slot}
  [FFFD + FFFD + ' {fg.label} ' + FFFD + ' {slot}', '🎨 {fg.label} — {slot}'],
  // Close X button
  ['>' + FFFD + '</button>', '>×</button>'],
  // Add to option
  ['+ Add to' + FFFD, '+ Add to—'],
  // "drag to move" title
  [') ' + FFFD + ' drag to move', ') — drag to move'],
  // Roster time display
  ['startTime) || ' + "'?'" + '}' + FFFD + '{formatRosterTime', "startTime) || '?'}" + '–{formatRosterTime'],
  ["|| '?'}" + FFFD + '{formatRosterTime', "|| '?'}–{formatRosterTime"],
  // Drop here fallback
  [": '?'}",  ": '—'}"],
  ["'Drop here' : '" + FFFD + "'}", "'Drop here' : '—'}"],
  // Ratio Check header dash
  ['Ratio Check ' + FFFD + ' {activeSession', 'Ratio Check — {activeSession'],
  // Empty FG slot indicator
  [FFFD + '\n', '—\n'],
  // 🔃 First FG
  ['First room of this FG ' + FFFD + ' render', 'First room of this FG — render'],
  ['Already rendered this FG ' + FFFD + ' skip', 'Already rendered this FG — skip'],
];

console.log('\nFixing RatioDashboardPage.tsx...');
const n1 = fixFile('C:/Users/ClaudeAI/.openclaw/workspace/tga-plan-of-day/src/pages/RatioDashboardPage.tsx', dashPage);
console.log('Total RatioDashboardPage fixes:', n1);

console.log('\nFixing RatioCheckPanel.tsx...');
const n2 = fixFile('C:/Users/ClaudeAI/.openclaw/workspace/tga-plan-of-day/src/components/RatioCheckPanel.tsx', checkPanel);
console.log('Total RatioCheckPanel fixes:', n2);
