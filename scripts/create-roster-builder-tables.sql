-- Roster Builder tables for Plan of Day
-- Run this in the Supabase SQL Editor for the tgxpvzlibquqnldgmwho project

-- Roster weeks (one per centre per week)
CREATE TABLE IF NOT EXISTS roster_weeks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id     TEXT NOT NULL,
  week_start    DATE NOT NULL,        -- always Monday
  status        TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'published'
  created_by    TEXT,                 -- user email
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (centre_id, week_start)
);

-- Individual shift assignments
CREATE TABLE IF NOT EXISTS roster_shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_week_id  UUID REFERENCES roster_weeks(id) ON DELETE CASCADE,
  centre_id       TEXT NOT NULL,
  staff_id        TEXT NOT NULL,       -- Deputy employeeId as text, or internal staff ID
  staff_name      TEXT NOT NULL,
  date            DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  room_id         TEXT,                -- null = unassigned / float
  room_name       TEXT,
  lunch_start     TIME,
  lunch_duration  INTEGER DEFAULT 30,  -- minutes
  is_casual       BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roster_shifts_week ON roster_shifts(roster_week_id);
CREATE INDEX IF NOT EXISTS idx_roster_shifts_centre_date ON roster_shifts(centre_id, date);
CREATE INDEX IF NOT EXISTS idx_roster_shifts_staff ON roster_shifts(staff_id);
