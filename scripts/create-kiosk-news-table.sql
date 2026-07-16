CREATE TABLE IF NOT EXISTS kiosk_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('centre', 'room', 'person')),
  target_room_id text,
  target_staff_id text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  posted_by text NOT NULL DEFAULT 'Director',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS kiosk_news_centre_created ON kiosk_news (centre_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kiosk_news_target ON kiosk_news (centre_id, target_type, target_room_id, target_staff_id);

-- Enable RLS if required (admin/service key bypasses RLS)
ALTER TABLE kiosk_news ENABLE ROW LEVEL SECURITY;
