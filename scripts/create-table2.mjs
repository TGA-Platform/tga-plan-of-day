import pkg from 'pg';
const { Client } = pkg;

const SQL = `
CREATE TABLE IF NOT EXISTS ratio_check_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  centre_id TEXT NOT NULL,
  date DATE NOT NULL,
  session TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(centre_id, date, session)
);
ALTER TABLE ratio_check_data ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='ratio_check_data' AND policyname='service role all'
  ) THEN
    CREATE POLICY "service role all" ON ratio_check_data USING (true) WITH CHECK (true);
  END IF;
END $body$;
`;

const configs = [
  // Direct connection (not via pooler)
  {
    host: 'db.tgxpvzlibquqnldgmwho.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: '!b2TOWN7ksPto1pZ',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  },
  // Pooler transaction mode
  {
    connectionString: 'postgresql://postgres.tgxpvzlibquqnldgmwho:!b2TOWN7ksPto1pZ@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  },
  // Pooler session mode
  {
    connectionString: 'postgresql://postgres.tgxpvzlibquqnldgmwho:!b2TOWN7ksPto1pZ@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  },
];

for (const config of configs) {
  console.log('Trying:', JSON.stringify(config).slice(0, 80) + '...');
  const client = new Client(config);
  try {
    await client.connect();
    console.log('Connected! Running SQL...');
    await client.query(SQL);
    await client.end();
    console.log('✅ Table ratio_check_data created successfully');
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    try { await client.end(); } catch {}
  }
}

console.error('❌ All connections failed');
process.exit(1);
