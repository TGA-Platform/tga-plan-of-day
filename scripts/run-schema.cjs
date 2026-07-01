/**
 * Creates staffing structure tables in Supabase via direct pg connection.
 * Run: node scripts/run-schema.cjs
 */
const { Client } = require('pg');

// Supabase connection string (service role, direct)
const PROJECT_REF = 'tgxpvzlibquqnldgmwho';
const DB_PASSWORD = '!b2TOWN7ksPto1pZ';
const DB_URL = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`;

async function main() {
  console.log('Connecting...');
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('Connected.');

    const schema = `
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

      CREATE OR REPLACE FUNCTION update_staff_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS staff_members_updated_at ON staff_members;
      CREATE TRIGGER staff_members_updated_at
        BEFORE UPDATE ON staff_members
        FOR EACH ROW EXECUTE FUNCTION update_staff_updated_at();

      CREATE TABLE IF NOT EXISTS compliance_requirements (
        id                          text PRIMARY KEY,
        label                       text NOT NULL,
        category                    text NOT NULL CHECK (category IN ('certification', 'document', 'check')),
        required_for                text[] NOT NULL DEFAULT '{}',
        required_for_qualifications text[] NOT NULL DEFAULT '{}',
        expiry_field                text,
        doc_pattern                 text,
        is_mandatory                boolean NOT NULL DEFAULT true,
        description                 text,
        sort_order                  integer DEFAULT 0,
        created_at                  timestamptz NOT NULL DEFAULT now(),
        updated_at                  timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS compliance_requirements_category ON compliance_requirements(category);

      DROP TRIGGER IF EXISTS compliance_requirements_updated_at ON compliance_requirements;
      CREATE TRIGGER compliance_requirements_updated_at
        BEFORE UPDATE ON compliance_requirements
        FOR EACH ROW EXECUTE FUNCTION update_staff_updated_at();
    `;

    await client.query(schema);
    console.log('Schema created successfully.');

    // Verify
    const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('staff_members','staff_documents','staff_rooms','compliance_requirements') ORDER BY table_name`);
    console.log('Tables confirmed:', res.rows.map(r => r.table_name).join(', '));

  } finally {
    await client.end();
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
