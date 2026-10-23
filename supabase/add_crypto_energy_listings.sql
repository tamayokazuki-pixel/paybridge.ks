-- Apply to an existing Supabase project that already has stock trading
-- installed (supabase/add_stock_trading.sql, plus supabase/add_stock_sales.sql
-- for sales). This only seeds additional paper-trading listings.
--
-- Existing symbols are left untouched, including any locally changed anchor
-- price or active flag. Cryptocurrency entries use the same fractional
-- paper buy/sell mechanics as the equities; they are not a crypto exchange
-- or custody integration.

insert into public.stock_quotes (symbol, company_name, sector, price_per_share)
values
  ('BTC', 'Bitcoin', 'Cryptocurrency', 97000.00),
  ('ETH', 'Ethereum', 'Cryptocurrency', 3400.00),
  ('SOL', 'Solana', 'Cryptocurrency', 210.00),
  ('XRP', 'XRP', 'Cryptocurrency', 2.40),
  ('DOGE', 'Dogecoin', 'Cryptocurrency', 0.32),
  ('ADA', 'Cardano', 'Cryptocurrency', 0.95),
  ('XOM', 'Exxon Mobil Corporation', 'Energy · Integrated Oil & Gas', 120.00),
  ('CVX', 'Chevron Corporation', 'Energy · Integrated Oil & Gas', 160.00),
  ('COP', 'ConocoPhillips', 'Energy · Oil & Gas Exploration', 115.00),
  ('SLB', 'SLB (Schlumberger)', 'Energy · Oilfield Services', 48.00),
  ('BP', 'BP p.l.c.', 'Energy · Integrated Oil & Gas', 42.00),
  ('SHEL', 'Shell plc', 'Energy · Integrated Oil & Gas', 72.00),
  ('OXY', 'Occidental Petroleum Corporation', 'Energy · Oil & Gas Exploration', 52.00),
  ('EOG', 'EOG Resources, Inc.', 'Energy · Oil & Gas Exploration', 125.00)
on conflict (symbol) do nothing;

notify pgrst, 'reload schema';
