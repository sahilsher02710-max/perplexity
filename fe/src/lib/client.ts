import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://fcmqjyqabyculqfdvgqb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_fQXomcIGP9R2YFt5GJ2Reg_PmDsr6vm";

// ── Singleton: one GoTrueClient across the whole app ─────────────────────────
export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Legacy factory shim – Auth.tsx imports createClient(); keep it pointing at the
// same singleton so we never spin up a second GoTrueClient instance.
export const createClient = () => supabase;
