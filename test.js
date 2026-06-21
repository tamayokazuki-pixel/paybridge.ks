const { createClient } = require('@supabase/supabase-js');


const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const { data, error } = await supabase.from('profiles').insert({ 
    id: '00000000-0000-0000-0000-000000000000',
    first_name: 'Test',
    last_name: 'User'
  }).select();
  console.log('Insert profile error:', error);
}

test();
