-- Adds comment columns for kiosk end-shift workflow
ALTER TABLE kiosk_timeclock_events ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE timesheet_approvals ADD COLUMN IF NOT EXISTS employee_comment text;
