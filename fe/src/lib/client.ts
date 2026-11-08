import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // alert(process.env.BUN_PUBLIC_SUPABASE_URL )
  return createBrowserClient(
    "https://fcmqjyqabyculqfdvgqb.supabase.co",
     "sb_publishable_fQXomcIGP9R2YFt5GJ2Reg_PmDsr6vm"
  )
}
