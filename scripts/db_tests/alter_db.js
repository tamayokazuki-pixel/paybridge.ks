const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    env[match[1].trim()] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function alterDb() {
  const sql = `
    ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check CHECK (type in ('deposit', 'withdrawal', 'transfer', 'admin_adjustment'));
  `;
  const { data, error } = await supabase.rpc('query', { sql_query: sql });
  console.log("RPC Error:", error);
  console.log("RPC Data:", data);
}
alterDb();
