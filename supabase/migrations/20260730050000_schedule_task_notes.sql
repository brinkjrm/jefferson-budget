-- Shared schedule comments. The table is service-role only: public visitors use
-- the token-validated Vercel API and never receive direct database write access.

CREATE TABLE IF NOT EXISTS schedule_task_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL DEFAULT public.default_project_id() REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  message_sid TEXT,
  notification_status TEXT NOT NULL DEFAULT 'pending',
  notification_error TEXT,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(author_name) BETWEEN 2 AND 80),
  CHECK (char_length(body) BETWEEN 1 AND 1000),
  CHECK (notification_status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_task_notes_task
  ON schedule_task_notes(task_id, created_at);

CREATE INDEX IF NOT EXISTS idx_schedule_task_notes_created
  ON schedule_task_notes(project_id, created_at DESC);

ALTER TABLE schedule_task_notes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE schedule_task_notes IS
  'Task-level comments submitted through the token-validated shared schedule portal.';
