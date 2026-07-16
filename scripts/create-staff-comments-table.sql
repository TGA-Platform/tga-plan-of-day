-- Staff comments for staffing structure cards
CREATE TABLE IF NOT EXISTS staff_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  staff_id text NOT NULL,
  user_name text NOT NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_comments_staff_id_idx ON staff_comments (staff_id);
CREATE INDEX IF NOT EXISTS staff_comments_centre_id_idx ON staff_comments (centre_id);
