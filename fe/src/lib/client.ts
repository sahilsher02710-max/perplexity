import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Make sure 'export' is present
export const createClient = () => {
  return createSupabaseClient(
    "https://fcmqjyqabyculqfdvgqb.supabase.co",
     "sb_publishable_fQXomcIGP9R2YFt5GJ2Reg_PmDsr6vm"
  );
};

// OR if you export a singleton instance:
export const supabase = createSupabaseClient(
  "https://fcmqjyqabyculqfdvgqb.supabase.co",
   "sb_publishable_fQXomcIGP9R2YFt5GJ2Reg_PmDsr6vm"
);


