/**
 * Creates staffing structure tables + storage bucket in Supabase.
 * Run: node scripts/setup-staffing-schema.cjs
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const HEADERS = {
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'apikey': SERVICE_KEY,
  'Content-Type': 'application/json',
};

// Run SQL via Supabase's pg REST endpoint (service role)
async function sql(query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ sql: query }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`SQL failed (${r.status}): ${text}`);
  }
  return r.json();
}

// Use Supabase SQL API (pg endpoint for service role)
async function runSQL(query) {
  const r = await fetch(`${SUPABASE_URL}/pg`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Profile': 'public' },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return JSON.parse(text);
}

// Supabase Management API for storage bucket
async function createBucket(name) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ id: name, name, public: false, fileSizeLimit: 52428800 }), // 50MB limit
  });
  const text = await r.text();
  if (!r.ok && !text.includes('already exists') && !text.includes('Duplicate')) {
    throw new Error(`Bucket create failed (${r.status}): ${text}`);
  }
  return text;
}

// Supabase REST DDL via POST to /rest/v1/ doesn't work — use the db endpoint
async function execDDL(statements) {
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    // Use Supabase's built-in REST endpoint for DDL via service role
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'return=minimal', 'X-Client-Info': 'supabase-js/2' },
      body: trimmed,
    });
    // DDL via REST API not supported — we need the admin API
    // Instead write SQL file for Matt to run manually, OR use pg connection
    break;
  }
}

async function main() {
  console.log('Creating storage bucket...');
  try {
    const r = await createBucket('staff-documents');
    console.log('Bucket result:', r);
  } catch (e) {
    console.error('Bucket error:', e.message);
  }

  // Write SQL file for Matt to run in Supabase SQL editor
  const sqlScript = `
-- Run this in Supabase SQL editor: https://supabase.com/dashboard/project/tgxpvzlibquqnldgmwho/sql

CREATE TABLE IF NOT EXISTS staff_members (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_id                text UNIQUE,
  centre_id                text NOT NULL,
  group_id                 text NOT NULL,
  group_title              text NOT NULL,
  group_color              text DEFAULT '#808080',
  is_active_group          boolean NOT NULL DEFAULT true,
  name                     text NOT NULL,
  qualification            text,
  position                 text,
  position_category        text,
  ratio_50                 text,
  start_date               date,
  end_date                 text,
  dob                      date,
  days_per_week            text,
  min_hours_pw             text,
  probationary_date        date,
  email                    text,
  mobile                   text,
  seek_url                 text,
  action                   text,
  wwcc_number              text,
  wwcc_expiry              date,
  first_aid_code           text,
  first_aid_expiry         date,
  cpr_code                 text,
  cpr_expiry               date,
  anaphylaxis_code         text,
  anaphylaxis_expiry       date,
  child_protection_renewal date,
  sort_order               integer DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  label        text NOT NULL,
  doc_type     text NOT NULL DEFAULT 'main',
  storage_path text,
  file_name    text,
  mime_type    text,
  monday_url   text,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id  text NOT NULL,
  group_id   text NOT NULL,
  title      text NOT NULL,
  color      text DEFAULT '#808080',
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer DEFAULT 0,
  UNIQUE(centre_id, group_id)
);

CREATE INDEX IF NOT EXISTS staff_members_centre ON staff_members(centre_id);
CREATE INDEX IF NOT EXISTS staff_members_group  ON staff_members(centre_id, group_id);
CREATE INDEX IF NOT EXISTS staff_docs_staff     ON staff_documents(staff_id);
CREATE INDEX IF NOT EXISTS staff_rooms_centre   ON staff_rooms(centre_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_members_updated_at ON staff_members;
CREATE TRIGGER staff_members_updated_at
  BEFORE UPDATE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`;

  const fs = require('fs');
  const sqlPath = require('path').join(__dirname, 'staffing-schema.sql');
  fs.writeFileSync(sqlPath, sqlScript.trim(), 'utf8');
  console.log(`\nSQL schema written to: ${sqlPath}`);
  console.log('Run it in Supabase SQL editor:\nhttps://supabase.com/dashboard/project/tgxpvzlibquqnldgmwho/sql/new');
}

main().catch(console.error);
