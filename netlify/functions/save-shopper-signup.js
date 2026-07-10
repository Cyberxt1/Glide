import { adminClient, json } from './_supabase.js'

function bad(message) {
  return json(400, { error: message })
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const { receiptToken, email, preferences = {} } = JSON.parse(event.body || '{}')
    const cleanEmail = String(email || '').trim().toLowerCase()

    if (!receiptToken) return bad('Receipt token missing.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return bad('Enter a valid email address.')
    }

    const orderResult = await supabase
      .from('orders')
      .select('id,merchant_id,receipt_token,payment_status')
      .eq('receipt_token', receiptToken)
      .eq('payment_status', 'paid')
      .maybeSingle()

    if (orderResult.error) return bad(orderResult.error.message)
    if (!orderResult.data) return bad('Paid receipt not found.')

    const signupResult = await supabase
      .from('shopper_app_signups')
      .upsert(
        {
          merchant_id: orderResult.data.merchant_id,
          order_id: orderResult.data.id,
          receipt_token: receiptToken,
          email: cleanEmail,
          receipt_updates: preferences.receiptUpdates !== false,
          offers: Boolean(preferences.offers),
          product_updates: Boolean(preferences.productUpdates),
        },
        { onConflict: 'email,receipt_token' },
      )
      .select('*')
      .single()

    if (signupResult.error) return bad(signupResult.error.message)

    return json(200, { signup: signupResult.data })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
