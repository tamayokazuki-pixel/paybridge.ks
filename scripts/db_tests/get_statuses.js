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

async function check() {
  const { data, error } = await supabase.from('transactions').select('id, status');
  if (error) {
    console.error('Error fetching transactions:', error);
    return;
  }
  
  const counts = {};
  for (const row of data) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  console.log('Transaction statuses:', counts);
  
  // also get the exact constraint error by trying to update one to 'approved'
  if (data.length > 0) {
    const testTxn = data[0];
    const statusesToTry = ['Approved', 'APPROVED', 'completed', 'success', 'done'];
    for (const s of statusesToTry) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ status: s })
        .eq('id', testTxn.id);
      console.log(`Update Error for "${s}":`, updateError ? updateError.message : 'Success!');
      if (!updateError) {
        // revert
        await supabase.from('transactions').update({ status: 'pending' }).eq('id', testTxn.id);
        break;
      }
    }
  }
}
check();
