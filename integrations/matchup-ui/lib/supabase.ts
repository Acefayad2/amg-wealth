import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jkwhoisuhcbkokwntrfg.supabase.co";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imprd2hvaXN1aGNia29rd250cmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1Njc0NzMsImV4cCI6MjA4MDkyNzQ3M30.TbylFatKse3YAvRIEAJzuh2GczfxYEB4N2iAhy8XISY";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
