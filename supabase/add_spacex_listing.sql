-- Apply to an existing Supabase project that already has stock trading
-- installed (supabase/add_stock_trading.sql, plus supabase/add_stock_sales.sql
-- for sales). This seeds SpaceX (SPCX) as an individual stock listing for paper trading.
--
-- Space Exploration Technologies Corp. (SpaceX) trades under NASDAQ ticker SPCX.

insert into public.stock_quotes (symbol, company_name, sector, price_per_share)
values
  ('SPCX', 'SpaceX', 'Aerospace & Space Exploration', 137.00)
on conflict (symbol) do nothing;

notify pgrst, 'reload schema';
