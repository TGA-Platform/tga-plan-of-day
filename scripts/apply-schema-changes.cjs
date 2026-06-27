/**
 * Apply schema changes for Belfield data mapping
 * Adds missing columns to staff_members table
 */

const https = require('https');

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

async function sbQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'tgxpvzlibquqnldgmwho.supabase.co',
      path: '/rest/v1/rpc/exec_sql',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(d);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${d}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Applying schema changes...\n');

  const queries = [
    `ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS date_of_qualification date;`,
    `ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS campus text;`,
  ];

  for (const sql of queries) {
    try {
      await sbQuery(sql);
      console.log('✓', sql.split(' ').slice(0, 6).join(' '), '...');
    } catch (err) {
      console.error('✗ Failed:', err.message);
      process.exit(1);
    }
  }

  console.log('\nSchema updated successfully.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
