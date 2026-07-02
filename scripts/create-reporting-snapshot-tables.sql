-- Reporting snapshot tables for DB-first reporting.
-- Run this in the Supabase SQL editor.

-- Daily staffing aggregate per centre.
-- Does NOT duplicate daily_occupancy; occupancy numbers are read on demand.
CREATE TABLE IF NOT EXISTS report_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  campus text NOT NULL,
  date date NOT NULL,

  children_attended integer NOT NULL DEFAULT 0,

  -- Staffing totals
  floor_staff integer NOT NULL DEFAULT 0,
  float_staff integer NOT NULL DEFAULT 0,
  iss_staff integer NOT NULL DEFAULT 0,
  off_floor_staff integer NOT NULL DEFAULT 0,
  required_staff integer NOT NULL DEFAULT 0,

  -- Staffing analysis summary
  room_surplus numeric(6,1),
  buffer_required numeric(6,1),
  float_count integer,
  ad_available integer,
  float_surplus numeric(6,1),
  staffing_status text CHECK (staffing_status IN ('green','amber','red','unknown')),

  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(centre_id, date)
);
CREATE INDEX IF NOT EXISTS idx_report_daily_centre_date ON report_daily(centre_id, date);
CREATE INDEX IF NOT EXISTS idx_report_daily_date ON report_daily(date);

-- 30-minute slot metrics for Roster Optimisation (07:00-18:00).
CREATE TABLE IF NOT EXISTS report_slot_30 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  campus text NOT NULL,
  date date NOT NULL,
  time_slot time NOT NULL,

  children integer NOT NULL DEFAULT 0,
  floor_staff integer NOT NULL DEFAULT 0,
  required_staff integer NOT NULL DEFAULT 0,
  off_floor_staff integer NOT NULL DEFAULT 0,
  iss_staff integer NOT NULL DEFAULT 0,
  surplus numeric(6,1),

  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(centre_id, date, time_slot)
);
CREATE INDEX IF NOT EXISTS idx_report_slot_30_centre_date ON report_slot_30(centre_id, date);
CREATE INDEX IF NOT EXISTS idx_report_slot_30_date ON report_slot_30(date);

-- Educator Daily Record — materialized view of final staff positions.
CREATE TABLE IF NOT EXISTS report_educator (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  campus text NOT NULL,
  date date NOT NULL,

  employee_id integer NOT NULL,
  name text NOT NULL,
  room text NOT NULL,
  in_time time NOT NULL,
  out_time time NOT NULL,
  block_type text CHECK (block_type IN ('shift','lunch_break','float_move','lunch_cover','leave','support','grouping')),
  staff_type text CHECK (staff_type IN ('room','float','iss','support','leave','external')),
  note text,

  source text,
  computed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(centre_id, date, employee_id, in_time, room, block_type)
);
CREATE INDEX IF NOT EXISTS idx_report_educator_centre_date ON report_educator(centre_id, date);
CREATE INDEX IF NOT EXISTS idx_report_educator_employee ON report_educator(employee_id);

-- WWCC snapshot — active staff + expiry status at a point in time.
CREATE TABLE IF NOT EXISTS report_wwcc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  name text NOT NULL,
  wwcc_number text,
  wwcc_expiry date,
  days_remaining integer,
  exempt_reason text CHECK (exempt_reason IN ('under_18','kitchen')),
  active_in_period boolean NOT NULL DEFAULT true,
  snapshot_date date NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(centre_id, name, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_report_wwcc_centre_date ON report_wwcc(centre_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_report_wwcc_expiry ON report_wwcc(wwcc_expiry);
