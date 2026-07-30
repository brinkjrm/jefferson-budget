-- Store scheduling semantics without replacing the existing UUID predecessor array.
-- Existing links remain finish-to-start with zero lag.

ALTER TABLE schedule_tasks
  ADD COLUMN IF NOT EXISTS dependency_settings JSONB NOT NULL DEFAULT '{}'::JSONB;

UPDATE schedule_tasks
SET dependency_settings = COALESCE(dependency_settings, '{}'::JSONB)
WHERE dependency_settings IS NULL;

COMMENT ON COLUMN schedule_tasks.dependency_settings IS
  'Map keyed by predecessor task UUID. Each value contains dependency type (FS, SS, FF, SF) and workday lag.';
