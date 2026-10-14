import { adminClient, json } from './_supabase.js'

function bad(message, status = 400) {
  return json(status, { error: message })
}

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const body = JSON.parse(event.body || '{}')
    const receiptToken = clean(body.receiptToken, 120)
    if (!receiptToken) return bad('Receipt is required.')

    const orderResult = await supabase
      .from('orders')
      .select('id,merchant_id,order_number,payment_status,status,merchant_profile(store_name)')
      .eq('receipt_token', receiptToken)
      .eq('payment_status', 'paid')
      .maybeSingle()

    if (orderResult.error) return bad(orderResult.error.message)
    if (!orderResult.data) return bad('Paid receipt not found.', 404)
    const order = orderResult.data

    if (body.action === 'load') {
      return json(200, {
        order: {
          orderNumber: order.order_number,
          status: order.status,
          storeName: order.merchant_profile?.store_name || 'the store',
        },
      })
    }

    if (body.action === 'feedback') {
      const rating = Number(body.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad('Choose a rating.')
      const tags = Array.isArray(body.tags)
        ? body.tags.map((tag) => clean(tag, 40)).filter(Boolean).slice(0, 6)
        : []

      const result = await supabase
        .from('shopper_feedback')
        .upsert({
          merchant_id: order.merchant_id,
          order_id: order.id,
          rating,
          tags,
          comment: clean(body.comment, 800) || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'order_id' })
        .select('id,rating')
        .single()

      if (result.error) return bad(result.error.message)
      await supabase.from('platform_system_logs').insert({ merchant_id: order.merchant_id, event_type: 'shopper_feedback_received', message: `Feedback received for ${order.order_number}.`, details: { rating, order_id: order.id } })
      return json(200, { feedback: result.data })
    }

    if (body.action === 'early-access') {
      const email = clean(body.email, 200).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('Enter a valid email address.')

      const result = await supabase
        .from('shopper_app_signups')
        .upsert({
          merchant_id: order.merchant_id,
          order_id: order.id,
          receipt_token: receiptToken,
          email,
          full_name: clean(body.fullName, 120) || null,
          phone: clean(body.phone, 40) || null,
          early_access: true,
          receipt_updates: true,
          offers: Boolean(body.offers),
          product_updates: true,
        }, { onConflict: 'email,receipt_token' })
        .select('id,email')
        .single()

      if (result.error) return bad(result.error.message)
      await supabase.from('platform_system_logs').insert({ merchant_id: order.merchant_id, event_type: 'shopper_interest_registered', message: `A shopper joined early access after visiting ${order.merchant_profile?.store_name || 'a store'}.`, details: { order_id: order.id, offers: Boolean(body.offers) } })
      return json(200, { signup: result.data })
    }

    return bad('Unknown shopper action.')
  } catch (error) {
    return json(500, { error: error.message })
  }
}
