import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const fallbackSupabaseUrl = 'https://heyncvrqbnkkgxgnxlcs.supabase.co'

export function adminClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || fallbackSupabaseUrl
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is missing in Netlify environment variables.')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing in Netlify environment variables.')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
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

export async function requirePlatformAdmin(event, supabase) {
  const auth = event.headers.authorization || event.headers.Authorization
  const jwt = auth?.replace('Bearer ', '')

  if (!jwt) throw new Error('Login required.')

  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data.user) throw new Error('Login required.')

  const allowedEmails = String(process.env.GLIDE_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  const userEmail = String(data.user.email || '').toLowerCase()
  const metadataRole =
    data.user.app_metadata?.role || data.user.user_metadata?.role || data.user.app_metadata?.glide_role

  if (!allowedEmails.includes(userEmail) && metadataRole !== 'platform_admin') {
    throw new Error('Platform admin access required.')
  }

  return data.user
}

export async function requireMerchantOrStaff(event, supabase) {
  const auth = event.headers.authorization || event.headers.Authorization
  const jwt = auth?.replace('Bearer ', '')

  if (!jwt) throw new Error('Login required.')

  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data.user) throw new Error('Login required.')

  const merchantProfile = await supabase
    .from('merchant_profile')
    .select('*')
    .eq('user_id', data.user.id)
    .maybeSingle()

  if (merchantProfile.data) {
    return {
      merchant: merchantProfile.data,
      staff: null,
      user: data.user,
      role: 'owner',
    }
  }

  const staffProfile = await supabase
    .from('staff_members')
    .select('*,merchant_profile(*)')
    .eq('user_id', data.user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!staffProfile.data) throw new Error('Staff access required.')

  return {
    merchant: staffProfile.data.merchant_profile,
    staff: staffProfile.data,
    user: data.user,
    role: staffProfile.data.role,
  }
}
