-- Roster Weeks: tracks published/draft status for each centre+week
CREATE TABLE IF NOT EXISTS roster_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  week_start text NOT NULL, -- ISO date (Monday)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS roster_weeks_centre_week ON roster_weeks (centre_id, week_start);
CREATE INDEX IF NOT EXISTS roster_weeks_status ON roster_weeks (status);

-- Roster Shifts: individual staff shifts within a week
CREATE TABLE IF NOT EXISTS roster_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_week_id uuid NOT NULL REFERENCES roster_weeks(id) ON DELETE CASCADE,
  centre_id text NOT NULL,
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  date text NOT NULL, -- ISO date
  start_time text NOT NULL, -- HH:MM
  end_time text NOT NULL, -- HH:MM
  room_id text,
  room_name text,
  lunch_start text, -- HH:MM
  lunch_duration integer NOT NULL DEFAULT 30,
  leave_type text CHECK (leave_type IN ('sick', 'annual', 'other')),
  is_casual boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roster_shifts_week ON roster_shifts (roster_week_id);
CREATE INDEX IF NOT EXISTS roster_shifts_date ON roster_shifts (date);
CREATE INDEX IF NOT EXISTS roster_shifts_staff ON roster_shifts (staff_id);
CREATE INDEX IF NOT EXISTS roster_shifts_centre_date ON roster_shifts (centre_id, date);

-- Enable RLS (public anon read/write — matches existing app pattern)
ALTER TABLE roster_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roster_weeks_all" ON roster_weeks;
CREATE POLICY "roster_weeks_all" ON roster_weeks FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "roster_shifts_all" ON roster_shifts;
CREATE POLICY "roster_shifts_all" ON roster_shifts FOR ALL USING (true) WITH CHECK (true);
