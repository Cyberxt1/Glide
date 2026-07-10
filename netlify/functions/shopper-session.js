import { adminClient, json } from './_supabase.js'

const idleWindowMs = 20 * 60 * 1000

function bad(message) {
  return json(400, { error: message })
}

function validSessionId(sessionId) {
  return /^[a-z0-9-]{16,80}$/i.test(String(sessionId || ''))
}

async function findActiveQr(supabase, qrCode) {
  if (!qrCode || String(qrCode).length > 160) return null

  const result = await supabase
    .from('qr_codes')
    .select('id,merchant_id,is_active')
    .eq('qr_code', qrCode)
    .eq('is_active', true)
    .maybeSingle()

  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const { action, sessionId, qrCode } = JSON.parse(event.body || '{}')

    if (!validSessionId(sessionId)) return bad('Invalid shopper session.')

    if (action === 'end') {
      await supabase.from('shopper_sessions').delete().eq('session_id', sessionId)
      return json(200, { ok: true })
    }

    if (action !== 'touch') return bad('Invalid shopper session action.')

    const activeQr = await findActiveQr(supabase, qrCode)
    if (!activeQr) return bad('Store QR is inactive.')

    const now = Date.now()
    const result = await supabase.from('shopper_sessions').upsert(
      {
        session_id: sessionId,
        qr_code_id: activeQr.id,
        merchant_id: activeQr.merchant_id,
        last_activity_at: new Date(now).toISOString(),
        expires_at: new Date(now + idleWindowMs).toISOString(),
        ended_at: null,
      },
      { onConflict: 'session_id' },
    )

    if (result.error) return bad(result.error.message)

    return json(200, { ok: true })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
