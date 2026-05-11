-- TGA Plan of Day - Supabase Setup SQL
-- Run this in the Supabase Dashboard > SQL Editor
-- URL: https://supabase.com/dashboard/project/tgxpvzlibquqnldgmwho/sql

-- Daily attendance records (sign-in/out per child per day)
CREATE TABLE IF NOT EXISTS pod_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  date date NOT NULL,
  child_name text,
  room_name text,
  sign_in timestamptz,
  sign_out timestamptz,
  session text,
  scraped_at timestamptz DEFAULT now()
);

-- Daily summary stats (approved, attended, absent, % per day per centre)
CREATE TABLE IF NOT EXISTS pod_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  date date NOT NULL,
  approved_places integer,
  attendances integer,
  absences integer,
  attendance_pct numeric,
  scraped_at timestamptz DEFAULT now(),
  UNIQUE(centre_id, date)
);

-- Trend analysis cache (per room, per day-of-week)
CREATE TABLE IF NOT EXISTS pod_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  room_name text NOT NULL,
  day_of_week integer NOT NULL, -- 0=Mon, 1=Tue, ... 4=Fri
  avg_attendance_rate numeric NOT NULL, -- e.g. 0.88 = 88% of bookings show up
  sample_days integer,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(centre_id, room_name, day_of_week)
);

-- Enable Row Level Security
ALTER TABLE pod_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE pod_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE pod_trends ENABLE ROW LEVEL SECURITY;

-- Allow anon read (for frontend), service role can write
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pod_attendance' AND policyname = 'Allow anon read') THEN
    CREATE POLICY "Allow anon read" ON pod_attendance FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pod_daily_stats' AND policyname = 'Allow anon read') THEN
    CREATE POLICY "Allow anon read" ON pod_daily_stats FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pod_trends' AND policyname = 'Allow anon read') THEN
    CREATE POLICY "Allow anon read" ON pod_trends FOR SELECT USING (true);
  END IF;
END $$;

-- Insert default trend data (90% attendance rate as industry standard baseline)
-- These will be overwritten when the Owna scraper runs
INSERT INTO pod_trends (centre_id, room_name, day_of_week, avg_attendance_rate, sample_days)
VALUES
  ('oatley', 'Explorers', 0, 0.88, 0),
  ('oatley', 'Explorers', 1, 0.90, 0),
  ('oatley', 'Explorers', 2, 0.89, 0),
  ('oatley', 'Explorers', 3, 0.87, 0),
  ('oatley', 'Explorers', 4, 0.85, 0),
  ('oatley', 'Adventurers', 0, 0.88, 0),
  ('oatley', 'Adventurers', 1, 0.90, 0),
  ('oatley', 'Adventurers', 2, 0.89, 0),
  ('oatley', 'Adventurers', 3, 0.87, 0),
  ('oatley', 'Adventurers', 4, 0.85, 0),
  ('oatley', 'Pioneers', 0, 0.88, 0),
  ('oatley', 'Pioneers', 1, 0.90, 0),
  ('oatley', 'Pioneers', 2, 0.89, 0),
  ('oatley', 'Pioneers', 3, 0.87, 0),
  ('oatley', 'Pioneers', 4, 0.85, 0),
  ('oatley', 'Voyagers', 0, 0.88, 0),
  ('oatley', 'Voyagers', 1, 0.90, 0),
  ('oatley', 'Voyagers', 2, 0.89, 0),
  ('oatley', 'Voyagers', 3, 0.87, 0),
  ('oatley', 'Voyagers', 4, 0.85, 0),
  ('oatley', 'Creators', 0, 0.88, 0),
  ('oatley', 'Creators', 1, 0.90, 0),
  ('oatley', 'Creators', 2, 0.89, 0),
  ('oatley', 'Creators', 3, 0.87, 0),
  ('oatley', 'Creators', 4, 0.85, 0),
  ('oatley', 'Achievers', 0, 0.88, 0),
  ('oatley', 'Achievers', 1, 0.90, 0),
  ('oatley', 'Achievers', 2, 0.89, 0),
  ('oatley', 'Achievers', 3, 0.87, 0),
  ('oatley', 'Achievers', 4, 0.85, 0)
ON CONFLICT (centre_id, room_name, day_of_week) DO NOTHING;

SELECT 'Setup complete! Tables created: pod_attendance, pod_daily_stats, pod_trends' as status;
