import { supabase } from './supabase'

export const SESSION_EXPIRED_MESSAGE = 'Login Again Your session Has expired, Oops😭'

function friendlyFunctionError(message, status) {
  const value = String(message || '').trim()
  const lower = value.toLowerCase()

  if (
    status === 401 ||
    lower.includes('jwt') ||
    lower.includes('token expired') ||
    lower.includes('session expired') ||
    lower.includes('login required')
  ) {
    return SESSION_EXPIRED_MESSAGE
  }

  if (!value || lower === 'request failed. please try again.') {
    return 'Something went wrong. Please try again.'
  }

  return value
}

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
    throw new Error(friendlyFunctionError(data.error || data.message || data.details, response.status))
  }

  return data
}
