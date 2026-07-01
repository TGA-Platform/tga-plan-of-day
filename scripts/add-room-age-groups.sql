-- Add age group columns to staff_rooms table
-- This allows configuring which age group each room serves (for ratio checking)

ALTER TABLE staff_rooms 
  ADD COLUMN IF NOT EXISTS age_min integer,
  ADD COLUMN IF NOT EXISTS age_max integer,
  ADD COLUMN IF NOT EXISTS capacity integer;

-- Add comment explaining the columns
COMMENT ON COLUMN staff_rooms.age_min IS 'Minimum age in months for this room (e.g., 0 for babies)';
COMMENT ON COLUMN staff_rooms.age_max IS 'Maximum age in months for this room (e.g., 24 for 0-2 room)';
COMMENT ON COLUMN staff_rooms.capacity IS 'Licensed capacity for this room';
