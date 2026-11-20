-- Apply to an existing Supabase project that already has stock trading installed.
-- Seeds a worldwide list of leading global public companies across technology,
-- semiconductors, healthcare, automotive, e-commerce, and entertainment.

insert into public.stock_quotes (symbol, company_name, sector, price_per_share)
values
  ('TSM', 'Taiwan Semiconductor Manufacturing Co. (TSMC)', 'Semiconductors', 395.00),
  ('ASML', 'ASML Holding N.V.', 'Semiconductor Equipment', 1350.00),
  ('AVGO', 'Broadcom Inc.', 'Semiconductors & Infrastructure', 340.00),
  ('ARM', 'Arm Holdings plc', 'Semiconductors & Architecture', 188.00),
  ('SSNLF', 'Samsung Electronics Co., Ltd.', 'Technology & Hardware', 136.00),
  ('SAP', 'SAP SE', 'Enterprise Software', 203.00),
  ('SONY', 'Sony Group Corporation', 'Consumer Electronics & Entertainment', 27.00),
  ('BABA', 'Alibaba Group Holding Limited', 'Consumer Internet & E-Commerce', 83.50),
  ('TM', 'Toyota Motor Corporation', 'Automotive & Mobility', 212.00),
  ('NVO', 'Novo Nordisk A/S', 'Healthcare & Pharmaceuticals', 41.50),
  ('LLY', 'Eli Lilly and Company', 'Healthcare & Pharmaceuticals', 1438.00),
  ('AZN', 'AstraZeneca PLC', 'Healthcare & Biopharmaceuticals', 78.00),
  ('LVMUY', 'LVMH Moët Hennessy Louis Vuitton', 'Consumer & Luxury Goods', 155.00),
  ('WMT', 'Walmart Inc.', 'Consumer Staples & Retail', 125.00),
  ('COST', 'Costco Wholesale Corporation', 'Consumer Staples & Retail', 950.00),
  ('NFLX', 'Netflix, Inc.', 'Entertainment & Streaming', 820.00),
  ('DIS', 'The Walt Disney Company', 'Entertainment & Media', 115.00),
  ('HDB', 'HDFC Bank Limited', 'Financials & Banking', 68.00)
on conflict (symbol) do nothing;

notify pgrst, 'reload schema';
