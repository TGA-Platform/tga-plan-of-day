import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://tgxpvzlibquqnldgmwho.supabase.co','***');
const { data } = await sb.from('deputy_roster_cache').select('date, fetched_at').order('date',{ascending:false}).limit(10);
data.forEach(r => {
  const d = JSON.parse(JSON.stringify(r));
  console.log(d.date, 'fetched:', d.fetched_at?.slice(0,19));
});
