import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

export function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function token(size = 18) {
  return crypto.randomBytes(size).toString('hex')
}

export async function requireMerchant(event, supabase) {
  const auth = event.headers.authorization || event.headers.Authorization
  const jwt = auth?.replace('Bearer ', '')

  if (!jwt) throw new Error('Login required.')

  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data.user) throw new Error('Login required.')

  const profile = await supabase
    .from('merchant_profile')
    .select('*')
    .eq('user_id', data.user.id)
    .single()

  if (profile.error) throw new Error('Merchant profile missing.')

  return profile.data
}
