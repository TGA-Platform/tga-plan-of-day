CREATE TABLE IF NOT EXISTS family_grouping_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id text NOT NULL,
  name text NOT NULL,
  days_of_week integer[] NOT NULL DEFAULT '{}',
  template_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_grouping_templates_centre
  ON family_grouping_templates(centre_id);
