-- Add missing columns for Belfield Monday.com board mapping
-- Run in Supabase SQL editor

-- Add employment_status if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_members' AND column_name = 'employment_status') THEN
    ALTER TABLE staff_members ADD COLUMN employment_status text DEFAULT 'Active';
  END IF;
END $$;

-- Add date_of_qualification if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_members' AND column_name = 'date_of_qualification') THEN
    ALTER TABLE staff_members ADD COLUMN date_of_qualification date;
  END IF;
END $$;

-- Add campus if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_members' AND column_name = 'campus') THEN
    ALTER TABLE staff_members ADD COLUMN campus text;
  END IF;
END $$;

-- Verify columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'staff_members' 
ORDER BY ordinal_position;
