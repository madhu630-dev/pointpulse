const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://ebmfbnvmipevdrhylisw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_-quvVia82ltJdRO-9pH2Kw_vfLXhC99';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
