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
  const typesToTry = ['withdraw', 'withdrawal', 'debit', 'payment', 'expense', 'out', 'send', 'buy', 'purchase'];
  
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
        profile_id: '00000000-0000-0000-0000-000000000000', // Invalid UUID to trigger foreign key error if type check passes
        type: t,
        amount: 1,
        description: 'test'
      });
      
    if (insertError) {
      if (insertError.message.includes('transactions_type_check')) {
        console.log(`Type "${t}" failed TYPE CHECK.`);
      } else if (insertError.message.includes('foreign key constraint')) {
        console.log(`Type "${t}" PASSED type check! Failed on foreign key.`);
      } else {
        console.log(`Type "${t}" failed with: ${insertError.message}`);
      }
    } else {
      console.log(`Type "${t}" SUCCEEDED!`);
    }
  }
}
checkTypes();
