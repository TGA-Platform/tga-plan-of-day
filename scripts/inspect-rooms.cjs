const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

async function main() {
  const [centreName, date] = process.argv.slice(2);
  const url = `${SUPABASE_URL}/rest/v1/attendance_daily?campus=eq.${encodeURIComponent(centreName)}&date=eq.${date}&limit=1000`;
  const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await r.json();
  console.log(centreName, date, 'rows', rows.length);
  console.log('rooms', [...new Set(rows.map(r => r.room))].sort());
  const ages = rows.map(r => r.age);
  console.log('age samples', ages.slice(0, 10));
  console.log('missing ages', rows.filter(r => !r.age).length);
}
main().catch(e => { console.error(e); process.exit(1); });
