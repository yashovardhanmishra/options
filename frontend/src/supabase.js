import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Auth is ON only when both Supabase keys are provided at build time. Without
// them the app runs exactly as before (no login) — handy for local dev.
export const authEnabled = Boolean(url && anonKey)

export const supabase = authEnabled ? createClient(url, anonKey) : null

export async function signInWithGoogle() {
  if (!supabase) return
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut()
}

// Current access token (sent to the backend as a Bearer token).
export async function getAccessToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
