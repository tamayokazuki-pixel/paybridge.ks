-- Apply to an existing Supabase project that already has stock trading installed.
-- Seeds a list of leading airline and commercial aviation stocks for paper trading.

insert into public.stock_quotes (symbol, company_name, sector, price_per_share)
values
  ('DAL', 'Delta Air Lines, Inc.', 'Aviation & Airlines', 65.00),
  ('UAL', 'United Airlines Holdings, Inc.', 'Aviation & Airlines', 95.00),
  ('AAL', 'American Airlines Group Inc.', 'Aviation & Airlines', 14.50),
  ('LUV', 'Southwest Airlines Co.', 'Aviation & Airlines', 32.00),
  ('RYAAY', 'Ryanair Holdings plc', 'Aviation & Low-Cost Carriers', 128.00),
  ('SINGY', 'Singapore Airlines Limited', 'Aviation & International Airlines', 18.50),
  ('DLAKY', 'Deutsche Lufthansa AG', 'Aviation & Global Airlines', 8.20),
  ('ICAGY', 'International Consolidated Airlines Group (British Airways / Iberia)', 'Aviation & Airlines', 5.80),
  ('AFLYY', 'Air France-KLM SA', 'Aviation & Airlines', 9.40),
  ('JBLU', 'JetBlue Airways Corporation', 'Aviation & Airlines', 6.20),
  ('ALK', 'Alaska Air Group, Inc.', 'Aviation & Airlines', 52.00),
  ('BA', 'The Boeing Company', 'Aerospace & Commercial Aviation', 175.00),
  ('EADSY', 'Airbus SE', 'Aerospace & Commercial Aviation', 42.00)
on conflict (symbol) do nothing;

notify pgrst, 'reload schema';
