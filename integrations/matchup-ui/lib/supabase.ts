import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jkwhoisuhcbkokwntrfg.supabase.co";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoiamt3aG9pc3VoY2Jrb2t3bnRyZmciLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc2NTU2NzQ3MywiZXhwIjoyMDgwOTI3NDczfQ.TbylFatKse3YAvRIEAJzuh2GczfxYEB4N2iAhy8XISY";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
