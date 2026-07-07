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

async function listRPCs() {
  // Can we fetch swagger/openapi JSON from the postgrest API?
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/?apikey=${env.SUPABASE_SERVICE_ROLE_KEY}`);
  const json = await res.json();
  const paths = Object.keys(json.paths);
  const rpcs = paths.filter(p => p.startsWith('/rpc/'));
  console.log('Available RPCs:', rpcs);
}

listRPCs();
