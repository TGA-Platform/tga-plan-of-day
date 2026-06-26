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