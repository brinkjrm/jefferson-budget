-- Owner-controlled flag for schedule items that need a contractor conversation.

ALTER TABLE schedule_tasks
  ADD COLUMN IF NOT EXISTS needs_contractor_discussion BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN schedule_tasks.needs_contractor_discussion IS
  'True when the owner wants this task surfaced for follow-up with the contractor.';
