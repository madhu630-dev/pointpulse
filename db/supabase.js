const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ebmfbnvmipevdrhylisw.supabase.co';
const supabaseKey = 'sb_publishable_-quvVia82ltJdRO-9pH2Kw_vfLXhC99';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
