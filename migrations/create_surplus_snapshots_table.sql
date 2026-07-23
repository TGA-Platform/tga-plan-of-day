-- Create surplus_snapshots table to store daily surplus/deficit values
-- Saves every 15 min to present_surplus_val (live)
-- At 11am, also locks to surplus_val (all-day)

CREATE TABLE IF NOT EXISTS surplus_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  centre_id text NOT NULL,
  centre_name text NOT NULL,
  present_surplus_val numeric(5,2),          -- live surplus (updated every 15 min)
  surplus_val numeric(5,2),                  -- locked at 11am
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date, centre_id)
);

CREATE INDEX IF NOT EXISTS surplus_snapshots_date_idx ON surplus_snapshots (date);
CREATE INDEX IF NOT EXISTS surplus_snapshots_centre_idx ON surplus_snapshots (centre_id);
CREATE INDEX IF NOT EXISTS surplus_snapshots_date_centre_idx ON surplus_snapshots (date, centre_id);
