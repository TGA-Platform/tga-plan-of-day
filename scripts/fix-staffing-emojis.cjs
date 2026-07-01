const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'pages', 'StaffingStructurePage.tsx');
let content = fs.readFileSync(file, 'utf8');

// Replace heading emoji
content = content.replace(/[^\x00-\x7F\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]*\s*Staffing Structure/, 'Staffing Structure');

// Replace all non-ASCII characters that aren't part of normal unicode text
// (keep standard latin extended, but strip emoji garbage)
// Strategy: replace known patterns

// ComplianceDot — replace emoji spans with coloured dot spans
content = content.replace(
  /if \(level === 'expired'\) return <span title="Compliance expired">[^<]*<\/span>;/,
  'if (level === \'expired\') return <span title="Compliance expired" style={{display:\'inline-block\',width:10,height:10,borderRadius:\'50%\',backgroundColor:\'#ef4444\'}} />;'
);
content = content.replace(
  /if \(level === 'warning'\)\s+return <span title="Compliance expiring soon">[^<]*<\/span>;/,
  'if (level === \'warning\') return <span title="Compliance expiring soon" style={{display:\'inline-block\',width:10,height:10,borderRadius:\'50%\',backgroundColor:\'#f59e0b\'}} />;'
);
content = content.replace(
  /if \(level === 'ok'\)\s+return <span title="Compliance ok"[^>]*>[^<]*<\/span>;/,
  'if (level === \'ok\') return <span title="Compliance ok" style={{display:\'inline-block\',width:10,height:10,borderRadius:\'50%\',backgroundColor:\'#22c55e\'}} />;'
);

// Compliance icons in staff card detail
content = content.replace(
  /const icon = level === 'expired' \? '[^']*' : level === 'warning' \? '[^']*' : level === 'ok' \? '[^']*' : '[^']*';/,
  "const icon = level === 'expired' ? 'EXP' : level === 'warning' ? 'WARN' : level === 'ok' ? 'OK' : '—';"
);

// Action badge emoji
content = content.replace(/[^\x00-\x7F]+\s*\{staff\.action\}/g, '{staff.action}');
content = content.replace(/<span[^>]*>[^\x00-\x7F]+\s*\{staff\.action\}/g, '<span style={{fontSize:\'0.75rem\'}}>{staff.action}');

// "Open in new tab" arrow
content = content.replace(/Open in new tab\s*[^\x00-\x7F]*/g, 'Open in new tab \u2197');

// Preview arrow
content = content.replace(/Preview\s*[^\x00-\x7F]*/g, 'Preview \u2197');

// h1 heading
content = content.replace(/<h1[^>]*>[^\x00-\x7F]*\s*Staffing Structure/, '<h1 className="text-xl font-bold" style={{ color: BRAND.text }}>Staffing Structure');

// statCard icon args — already fixed, just clean up any remaining non-ascii in single-quoted strings
// Replace any remaining non-ASCII chars in JSX text nodes and string literals
content = content.replace(/(['"`])[^\x00-\x7F]+\1/g, (match) => {
  // only strip if it's just an emoji (no alphanumeric)
  const inner = match.slice(1, -1);
  if (/[a-zA-Z0-9]/.test(inner)) return match;
  return match[0] + '' + match[0];
});

// Doc preview icon
content = content.replace(/<span className="text-base">[^\x00-\x7F]+<\/span>\s*\n\s*<span className="flex-1 truncate"/, '<span className="text-sm mr-1">doc</span>\n                      <span className="flex-1 truncate"');

// Contact email/phone icons in staff card
content = content.replace(/<span>[^\x00-\x7F]+<\/span>\{staff\.email\}/g, '{staff.email}');
content = content.replace(/<span>[^\x00-\x7F]+<\/span>\{staff\.mobile && /g, '{staff.mobile && ');
content = content.replace(/<span>[^\x00-\x7F]+<\/span>0\{staff\.mobile\}/g, '0{staff.mobile}');

// Remove any remaining isolated non-ASCII sequences (likely garbled emojis)
content = content.replace(/[^\x00-\x7F\u00A0-\u00FF]{2,}/g, '');

fs.writeFileSync(file, content, 'utf8');
console.log('Done — emojis replaced with plain text/CSS');
