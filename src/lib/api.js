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

  const text = await response.text()
  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(
      `Server function "${name}" is not available. Run with Netlify dev locally or deploy to Netlify before using checkout/payment.`,
    )
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed. Please try again.')
  }

  return data
}
