import { adminClient, json } from './_supabase.js'

function bad(message) {
  return json(400, { error: message })
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const { receiptToken, email } = JSON.parse(event.body || '{}')
    const cleanEmail = String(email || '').trim().toLowerCase()

    if (!receiptToken) return bad('Receipt token missing.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return bad('Enter a valid email address.')
    }

    const result = await supabase
      .from('orders')
      .update({ customer_email: cleanEmail })
      .eq('receipt_token', receiptToken)
      .in('payment_status', ['paid'])
      .select('id,receipt_token,customer_email')
      .maybeSingle()

    if (result.error) return bad(result.error.message)
    if (!result.data) return bad('Paid receipt not found.')

    return json(200, { order: result.data })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
