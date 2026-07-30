-- Private project-email intelligence and SMS delivery records.
-- These tables are service-role only; no anonymous policies are created.

CREATE TABLE IF NOT EXISTS project_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL DEFAULT public.default_project_id() REFERENCES projects(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE,
  email_from TEXT,
  email_to TEXT,
  subject TEXT NOT NULL DEFAULT '(No subject)',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  body_excerpt TEXT,
  summary TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  urgency TEXT NOT NULL DEFAULT 'routine',
  requires_action BOOLEAN NOT NULL DEFAULT FALSE,
  confidence NUMERIC(4,3),
  attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
  classification JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (category IN ('invoice', 'change_order', 'inspection', 'schedule', 'decision', 'rfi', 'submittal', 'general')),
  CHECK (urgency IN ('critical', 'important', 'routine'))
);

CREATE TABLE IF NOT EXISTS project_action_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL DEFAULT public.default_project_id() REFERENCES projects(id) ON DELETE CASCADE,
  source_email_id UUID UNIQUE REFERENCES project_emails(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT,
  action_type TEXT NOT NULL DEFAULT 'general',
  priority INTEGER NOT NULL DEFAULT 3,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  confidence NUMERIC(4,3),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (priority BETWEEN 1 AND 4),
  CHECK (status IN ('open', 'complete', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS project_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL DEFAULT public.default_project_id() REFERENCES projects(id) ON DELETE CASCADE,
  source_email_id UUID UNIQUE REFERENCES project_emails(id) ON DELETE CASCADE,
  vendor TEXT,
  invoice_number TEXT,
  amount DECIMAL(12,2),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  attachment JSONB,
  confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('draft', 'approved', 'paid', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL DEFAULT public.default_project_id() REFERENCES projects(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'sms',
  summary_date DATE NOT NULL,
  recipient_masked TEXT,
  message_sid TEXT,
  delivery_status TEXT,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  UNIQUE (project_id, channel, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_project_emails_received ON project_emails(project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_action_items_open ON project_action_items(project_id, status, priority, due_date);
CREATE INDEX IF NOT EXISTS idx_project_invoices_status ON project_invoices(project_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_date ON notification_deliveries(project_id, summary_date DESC);

ALTER TABLE project_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-email-attachments', 'project-email-attachments', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

INSERT INTO settings (key, value) VALUES
  ('project_email', 'Josh@3120jeffersonst.com'),
  ('daily_sms_enabled', 'true'),
  ('sms_timezone', 'America/Denver')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE project_emails IS 'Private normalized records imported from the dedicated project inbox.';
COMMENT ON TABLE project_action_items IS 'Private review queue extracted from project emails.';
COMMENT ON TABLE project_invoices IS 'Draft invoices extracted from project emails; owner approval is always required.';
