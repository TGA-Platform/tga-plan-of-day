import pkg from 'pg';
const { Client } = pkg;
const PROJECT_REF = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD = '!b2TOWN7ksPto1pZ';
const SQL = `
CREATE TABLE IF NOT EXISTS user_settings (
  email TEXT PRIMARY KEY,
  allowed_centre_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DO $body$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_settings' AND policyname='service_role all') THEN
    CREATE POLICY "service_role all" ON user_settings FOR ALL USING (true);
  END IF;
END $body$;
`;

async function main() {
  const client = new Client({
    connectionString: `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  await client.query(SQL);
  await client.end();
  console.log('✅ user_settings table created OK');
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
