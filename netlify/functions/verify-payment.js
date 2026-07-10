import { adminClient, json } from './_supabase.js'

function bad(message) {
  return json(400, { error: message })
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const { receiptToken, reference } = JSON.parse(event.body || '{}')
    if (!receiptToken) return bad('Receipt token missing.')

    const orderResult = await supabase
      .from('orders')
      .select('*,order_items(*)')
      .eq('receipt_token', receiptToken)
      .single()

    if (orderResult.error) return bad('Order not found.')
    const order = orderResult.data

    if (order.status === 'paid' || order.status === 'exited') {
      return json(200, { order })
    }

    const paymentResult = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', order.id)
      .single()

    if (paymentResult.error) return bad('Payment not found.')
    const payment = paymentResult.data
    const paystackReference = reference || payment.provider_reference

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(paystackReference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    )
    const paystack = await response.json()

    if (!response.ok || paystack.data?.status !== 'success') {
      await supabase
        .from('payments')
        .update({ status: 'failed', provider_payload: paystack })
        .eq('id', payment.id)
      return bad('Payment has not been confirmed.')
    }

    for (const item of order.order_items) {
      const productResult = await supabase
        .from('products')
        .select('id,quantity,track_inventory')
        .eq('id', item.product_id)
        .single()

      if (productResult.data?.track_inventory) {
        const nextQuantity = Math.max(0, Number(productResult.data.quantity) - item.quantity)
        await supabase.from('products').update({ quantity: nextQuantity }).eq('id', item.product_id)
        await supabase.from('inventory_movements').insert({
          merchant_id: order.merchant_id,
          product_id: item.product_id,
          order_id: order.id,
          movement_type: 'sale',
          quantity_delta: -item.quantity,
        })
      }
    }

    await supabase
      .from('payments')
      .update({
        status: 'paid',
        provider_payload: paystack,
        paid_at: new Date().toISOString(),
      })
      .eq('id', payment.id)

    const updated = await supabase
      .from('orders')
      .update({
        status: 'paid',
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .eq('status', 'pending_payment')
      .select('*,order_items(*)')
      .single()

    if (updated.error) return bad(updated.error.message)

    return json(200, { order: updated.data })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
