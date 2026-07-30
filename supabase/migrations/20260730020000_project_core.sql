-- Project-centric core. Safe to run against the existing single-project database.
-- Existing Jefferson rows are retained and associated with the new project record.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  owner TEXT,
  builder TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_buildings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  building_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_areas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  building_id UUID REFERENCES project_buildings(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES project_areas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  area_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_id UUID NOT NULL,
  relation TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, from_type, from_id, relation, to_type, to_id)
);

INSERT INTO projects (name, address, owner, builder)
SELECT 'Jefferson Remodel', '3120 Jefferson St, Boulder CO 80304', 'Josh Meyer', 'Marc David Homes'
WHERE NOT EXISTS (SELECT 1 FROM projects);

INSERT INTO project_buildings (project_id, name, building_type, sort_order)
SELECT p.id, building.name, building.building_type, building.sort_order
FROM projects p
CROSS JOIN (VALUES
  ('Main House', 'residence', 1),
  ('Detached Garage', 'garage', 2)
) AS building(name, building_type, sort_order)
WHERE p.name = 'Jefferson Remodel'
  AND NOT EXISTS (
    SELECT 1 FROM project_buildings existing
    WHERE existing.project_id = p.id AND existing.name = building.name
  );

DO $$
DECLARE
  table_name TEXT;
  default_project UUID;
BEGIN
  SELECT id INTO default_project FROM projects ORDER BY created_at LIMIT 1;
  FOREACH table_name IN ARRAY ARRAY[
    'line_items', 'prepaid_items', 'draw_sheets', 'draw_items', 'schedule_tasks',
    'bids', 'contractors', 'selections', 'plans'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE', table_name);
      EXECUTE format('UPDATE %I SET project_id = $1 WHERE project_id IS NULL', table_name) USING default_project;
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(project_id)', 'idx_' || table_name || '_project_id', table_name);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.schedule_tasks') IS NOT NULL THEN
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'work';
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS trade TEXT;
    ALTER TABLE schedule_tasks ADD COLUMN IF NOT EXISTS references TEXT;

    UPDATE schedule_tasks
    SET task_type = 'inspection'
    WHERE parent_id IS NOT NULL AND name LIKE 'INSPECTION - %';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_buildings_project_id ON project_buildings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_areas_project_id ON project_areas(project_id);
CREATE INDEX IF NOT EXISTS idx_project_events_project_id ON project_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_links_project_id ON project_links(project_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_projects ON projects;
DROP POLICY IF EXISTS allow_all_project_buildings ON project_buildings;
DROP POLICY IF EXISTS allow_all_project_areas ON project_areas;
DROP POLICY IF EXISTS allow_all_project_events ON project_events;
DROP POLICY IF EXISTS allow_all_project_links ON project_links;

CREATE POLICY allow_all_projects ON projects FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_project_buildings ON project_buildings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_project_areas ON project_areas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_project_events ON project_events FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_all_project_links ON project_links FOR ALL TO anon USING (true) WITH CHECK (true);
