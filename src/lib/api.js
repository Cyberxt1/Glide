import { supabase } from './supabase'

async function authHeaders() {
  const sessionResult = await supabase?.auth.getSession()
  const token = sessionResult?.data?.session?.access_token

  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function callFunction(name, payload = {}, authed = true) {
  const headers = {
    'Content-Type': 'application/json',
    ...(authed ? await authHeaders() : {}),
  }

  const response = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || 'Request failed. Please try again.')
  }

  return data
}
