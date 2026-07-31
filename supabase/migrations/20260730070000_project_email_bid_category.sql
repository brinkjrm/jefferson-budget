-- Bid emails are first-class project inbox records. Contact and proposal details
-- remain in the private classification JSON and normalized contractor/bid tables.

ALTER TABLE project_emails
  DROP CONSTRAINT IF EXISTS project_emails_category_check;

ALTER TABLE project_emails
  ADD CONSTRAINT project_emails_category_check
  CHECK (category IN (
    'bid', 'invoice', 'change_order', 'inspection', 'schedule',
    'decision', 'rfi', 'submittal', 'general'
  ));
