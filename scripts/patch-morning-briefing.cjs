const fs = require('fs');
const p = 'src/pages/MorningBriefingPage.tsx';
let s = fs.readFileSync(p, 'utf8');

const re = /      const \[todayAtt, lastWeekAtt, unitsRes, lastSnapshotRes, allForecasts, staffAllocations\] = await Promise\.all\(\[[\s\S]*?\]\);\r?\n\r?\n      \/\/ Saved staff moves from the Ratio Dashboard \(per-employee: room\.id \| 'float' \| 'support' \| 'iss'\)[\s\S]*?\}\r?\n/;

const neu = `      const [todayAtt, lastWeekAtt, unitsRes, lastSnapshotRes, allForecasts] = await Promise.all([
        withCache(\`briefing-today:\${date}\`, () =>
          fetch(\`/api/attendance?date=\${date}\`).then(r => r.json()), 3 * 60 * 1000),
        withCache(\`briefing-lw:\${lastWeek}\`, () =>
          fetch(\`/api/attendance?date=\${lastWeek}\`).then(r => r.json()), 60 * 60 * 1000),
        withCache('deputy-units', () =>
          fetch('/api/deputy-units').then(r => r.json()), 10 * 60 * 1000),
        // Most recent updated_at from today's attendance - tells us when the last snapshot ran
        fetch(\`https://tgxpvzlibquqnldgmwho.supabase.co/rest/v1/attendance_daily?date=eq.\${date}&select=updated_at&order=updated_at.desc&limit=1\`, {
          headers: { apikey: 'eyJhbG…_jTY' }
        }).then(r => r.json()).catch(() => []),
        withCache(\`briefing-forecast-all:\${date}\`, () =>
          fetch(\`/api/room-forecast?campus=all&date=\${date}\`)
            .then(r => r.json())
            .catch(() => null), 5 * 60 * 1000),
      ]);\n`;

if (!re.test(s)) {
  console.log('pattern not found');
  process.exit(1);
}
s = s.replace(re, neu);
fs.writeFileSync(p, s, 'utf8');
console.log('removed fetch');
