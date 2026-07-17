-- Roster Templates: saved week patterns (Week A, Week B, School Holidays, etc.)
CREATE TABLE IF NOT EXISTS roster_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  name text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roster_templates_centre ON roster_templates (centre_id);

-- Roster Template Shifts: shifts stored by day_of_week (1=Mon..5=Fri)
CREATE TABLE IF NOT EXISTS roster_template_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES roster_templates(id) ON DELETE CASCADE,
  centre_id text NOT NULL,
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  start_time text NOT NULL,
  end_time text NOT NULL,
  room_id text,
  room_name text,
  lunch_start text,
  lunch_duration integer NOT NULL DEFAULT 30,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roster_template_shifts_template ON roster_template_shifts (template_id);
CREATE INDEX IF NOT EXISTS roster_template_shifts_centre ON roster_template_shifts (centre_id);

-- Enable RLS (public anon read, authenticated write)
ALTER TABLE roster_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_template_shifts ENABLE ROW LEVEL SECURITY;

-- Allow anon read and write (matches existing roster_shifts pattern)
DROP POLICY IF EXISTS "roster_templates_all" ON roster_templates;
CREATE POLICY "roster_templates_all" ON roster_templates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "roster_template_shifts_all" ON roster_template_shifts;
CREATE POLICY "roster_template_shifts_all" ON roster_template_shifts FOR ALL USING (true) WITH CHECK (true);
