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

async function checkTypes() {
  const typesToTry = ['payout', 'cashout', 'admin_adjustment', 'transfer', 'deposit'];
  
  const { data: users, error: userError } = await supabase.from('users').select('id').limit(1);
  if (userError || users.length === 0) {
    console.log("Could not fetch user:", userError);
    return;
  }
  const userId = users[0].id;
  
  for (const t of typesToTry) {
    const { error: insertError } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        profile_id: userId,
        type: t,
        amount: 1,
        description: 'test'
      });
      
    if (insertError) {
      console.log(`Type "${t}" failed: ${insertError.message}`);
    } else {
      console.log(`Type "${t}" SUCCEEDED!`);
    }
  }
}
checkTypes();
