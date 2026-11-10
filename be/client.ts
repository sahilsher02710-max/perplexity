import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient() {
  // alert(process.env.BUN_PUBLIC_SUPABASE_URL )
  return createClient(
    "https://fcmqjyqabyculqfdvgqb.supabase.co",
//     BUN_PUBLIC_SUPABASE_URL=https://fcmqjyqabyculqfdvgqb.supabase.co

    process.env.BUN_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    //  "sb_publishable_fQXomcIGP9R2YFt5GJ2Reg_PmDsr6vm"
  )
}
