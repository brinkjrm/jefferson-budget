-- ============================================================
-- Jefferson Budget App — Supabase Setup
-- Run this entire file in: Supabase > SQL Editor > New Query
-- ============================================================

-- 1. TABLES ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS line_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code            TEXT,
  section         TEXT NOT NULL DEFAULT 'hard',  -- 'soft' or 'hard'
  name            TEXT NOT NULL,
  estimated_cost  DECIMAL(12,2) DEFAULT 0,
  actual_cost     DECIMAL(12,2),
  status          TEXT DEFAULT 'pending',        -- 'pending' or 'locked'
  vendor          TEXT,
  date_paid       DATE,
  notes           TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prepaid_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  description     TEXT NOT NULL,
  vendor          TEXT,
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  date_paid       DATE,
  payment_method  TEXT,
  check_number    TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS draw_sheets (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  draw_number           INTEGER NOT NULL,
  draw_date             DATE NOT NULL,
  borrower              TEXT,
  property_address      TEXT,
  builder               TEXT,
  bank_name             TEXT DEFAULT 'FirstBank',
  loan_amount           DECIMAL(12,2),
  loan_number           TEXT,
  previous_draws_total  DECIMAL(12,2) DEFAULT 0,
  this_draw_amount      DECIMAL(12,2) DEFAULT 0,
  status                TEXT DEFAULT 'draft',   -- 'draft' or 'submitted'
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS draw_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  draw_sheet_id   UUID NOT NULL REFERENCES draw_sheets(id) ON DELETE CASCADE,
  line_item_id    UUID REFERENCES line_items(id),
  description     TEXT NOT NULL DEFAULT '',
  previous_amount DECIMAL(12,2) DEFAULT 0,
  this_draw_amount DECIMAL(12,2) DEFAULT 0,
  invoice_url     TEXT,
  invoice_filename TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ROW LEVEL SECURITY (open for personal use) ──────────────
ALTER TABLE line_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prepaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE draw_sheets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE draw_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings      ENABLE ROW LEVEL SECURITY;

-- Allow full access via anon key (personal-use app)
CREATE POLICY "allow_all_line_items"    ON line_items    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_prepaid"       ON prepaid_items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_draw_sheets"   ON draw_sheets   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_draw_items"    ON draw_items    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_settings"      ON settings      FOR ALL TO anon USING (true) WITH CHECK (true);

-- 3. STORAGE BUCKET FOR INVOICES ─────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', true)
ON CONFLICT DO NOTHING;

CREATE POLICY "allow_all_invoices" ON storage.objects
FOR ALL TO anon USING (bucket_id = 'invoices') WITH CHECK (bucket_id = 'invoices');

-- 4. DEFAULT SETTINGS ────────────────────────────────────────
INSERT INTO settings (key, value) VALUES
  ('bank_name',         'FirstBank'),
  ('borrower',          'Josh Meyer'),
  ('property_address',  '3120 Jefferson St, Boulder CO 80304'),
  ('builder',           'Marc David Homes'),
  ('loan_amount',       ''),
  ('loan_number',       '')
ON CONFLICT (key) DO NOTHING;

-- 5. SEED: PRE-POPULATED BUDGET LINE ITEMS ───────────────────

INSERT INTO line_items (section, code, name, estimated_cost, actual_cost, status, sort_order) VALUES

-- ── Soft Costs ──────────────────────────────────────────────
('soft', 'B001', 'Architectural / Design Fees',            NULL,  NULL,  'pending', 1),
('soft', 'B002', 'Asbestos Testing and Abatement',         NULL,  NULL,  'pending', 2),
('soft', 'B003', 'Builders Risk / Liability Insurance',    NULL,  NULL,  'pending', 3),
('soft', 'B004', 'Building Permits',                       NULL,  NULL,  'pending', 4),
('soft', 'B005', 'Loan Fees',                              NULL,  NULL,  'pending', 5),
('soft', 'B006', 'Designer',                               NULL,  NULL,  'pending', 6),
('soft', 'B007', 'Efficiency Planning and Inspections',    NULL,  NULL,  'pending', 7),
('soft', 'B008', 'Engineering',                            NULL,  NULL,  'pending', 8),
('soft', 'B009', 'Improvement Survey',                     NULL,  NULL,  'pending', 9),
('soft', 'B010', 'Interest Carry / Construction',          NULL,  NULL,  'pending', 10),
('soft', 'B013', 'Soils Test / Engineering',               NULL,  NULL,  'pending', 13),
('soft', 'B014', 'Water / Sewer Tap Fees',                 NULL,  NULL,  'pending', 14),
('soft', 'B015', 'Utility Shutoff',                        NULL,  NULL,  'pending', 15),
('soft', 'B017', 'Builder Fee',                            NULL,  NULL,  'pending', 17),
('soft', 'B018', 'Third Party Inspection Fees',            NULL,  NULL,  'pending', 18),

-- ── Hard Costs ───────────────────────────────────────────────
('hard', 'C000', 'Contingency',                            NULL,   NULL,  'pending', 100),
('hard', 'C001', 'Appliances',                             25000,  25000, 'locked',  101),
('hard', 'C001a','Asbestos Abatement',                     21000,  21000, 'locked',  102),
('hard', 'C002', 'Blinds — Hardware, Installation',        NULL,   NULL,  'pending', 103),
('hard', 'C003', 'Cabinets',                               53000,  53000, 'locked',  104),
('hard', 'C005', 'Concrete Flatwork / Steps / Walks',      NULL,   NULL,  'pending', 105),
('hard', 'C006', 'Countertops',                            15000,  15000, 'pending', 106),
('hard', 'C007', 'Deck',                                   NULL,   NULL,  'pending', 107),
('hard', 'C008', 'Deconstruction',                         30000,  30000, 'locked',  108),
('hard', 'C011', 'Drywall / Texture',                      22000,  22000, 'pending', 110),
('hard', 'C012', 'House Pre-wire (Smart/AV)',               NULL,   NULL,  'pending', 111),
('hard', 'C013', 'Electrical Final / Rough',               43000,  43000, 'locked',  112),
('hard', 'C014', 'Electrical Fixtures',                    NULL,   NULL,  'pending', 113),
('hard', 'C015', 'Excavation / Backfill / Grading',        NULL,   NULL,  'pending', 114),
('hard', 'C016', 'Exterior — Brick',                       17500,  17500, 'pending', 115),
('hard', 'C019', 'Exterior — Hardie Board Siding',         15000,  15000, 'pending', 116),
('hard', 'C020', 'Exterior — Doors',                       18000,  18000, 'pending', 117),
('hard', 'C021', 'Exterior — Fascia',                      NULL,   NULL,  'pending', 118),
('hard', 'C022', 'Exterior — Soffit',                      NULL,   NULL,  'pending', 119),
('hard', 'C024', 'Flashing / Gutters / Downspouts',        NULL,   NULL,  'pending', 120),
('hard', 'C025', 'Flooring',                               45000,  45000, 'pending', 121),
('hard', 'C026', 'Foundation Labor & Materials',           NULL,   NULL,  'pending', 122),
('hard', 'C027', 'Framing — Lumber, Steel, Trusses',       125000, 125000,'locked',  123),
('hard', 'C029', 'Front Door',                             NULL,   NULL,  'pending', 124),
('hard', 'C030', 'Hardware (doors, cabinets, pocket)',      3000,   3000,  'pending', 125),
('hard', 'C031', 'House AV',                               NULL,   NULL,  'pending', 126),
('hard', 'C032', 'HVAC',                                   43000,  43000, 'pending', 127),
('hard', 'C033', 'Insulation',                             24000,  24000, 'locked',  128),
('hard', 'C034', 'Interior Doors (pocket, 36")',           4680,   4680,  'pending', 129),
('hard', 'C035', 'Interior Trim Labor',                    NULL,   NULL,  'pending', 130),
('hard', 'C036', 'Labor — Common',                         NULL,   NULL,  'pending', 131),
('hard', 'C037', 'Landscaping / Fence',                    NULL,   NULL,  'pending', 132),
('hard', 'C038', 'Mirrors / Shower Doors',                 NULL,   NULL,  'pending', 133),
('hard', 'C039', 'Painting — Exterior',                    NULL,   NULL,  'pending', 134),
('hard', 'C040', 'Painting — Interior',                    NULL,   NULL,  'pending', 135),
('hard', 'C041', 'Plumbing',                               37000,  37000, 'locked',  136),
('hard', 'C042', 'Plumbing Fixtures',                      8000,   8000,  'pending', 137),
('hard', 'C045', 'Rentals / Portable Toilet',              NULL,   NULL,  'pending', 138),
('hard', 'C046', 'Roofing — Labor & Materials',            15000,  15000, 'pending', 139),
('hard', 'C047', 'Temp Power / Winter Heat',               NULL,   NULL,  'pending', 140),
('hard', 'C048', 'Tile — Material',                        NULL,   NULL,  'pending', 141),
('hard', 'C049', 'Tile — Labor',                           NULL,   NULL,  'pending', 142),
('hard', 'C050', 'Trash Cleanup',                          NULL,   NULL,  'pending', 143),
('hard', 'C051', 'Waterproofing',                          NULL,   NULL,  'pending', 144),
('hard', 'C052', 'Windows',                                54000,  54000, 'pending', 145);
