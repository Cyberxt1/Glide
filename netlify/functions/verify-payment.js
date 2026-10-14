import { adminClient, json } from './_supabase.js'

function bad(message) {
  return json(400, { error: message })
}

function paystackSecretKey() {
  return String(process.env.PAYSTACK_SECRET_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

async function parseProviderResponse(response) {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

function siteUrl(event) {
  const configured = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`
  const host = event.headers.host || event.headers.Host
  return host ? `${host.includes('localhost') ? 'http' : 'https'}://${host}` : ''
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character])
}

async function sendReceiptEmail(event, order) {
  if (!order.customer_email) return { status: 'not_requested' }
  const key = String(process.env.RESEND_API_KEY || '').trim()
  const from = String(process.env.RECEIPT_FROM_EMAIL || 'Glide Receipts <receipts@useglide.app>').trim()
  if (!key) return { status: 'failed', reason: 'RESEND_API_KEY is not configured.' }

  const itemRows = (order.order_items || []).map((item) => `<tr><td style="padding:8px 0">${escapeHtml(item.product_name)} × ${item.quantity}</td><td style="padding:8px 0;text-align:right">₦${Number(item.line_total).toLocaleString()}</td></tr>`).join('')
  const receiptUrl = `${siteUrl(event)}/receipt/${encodeURIComponent(order.receipt_token)}`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [order.customer_email],
      subject: `Your ${order.merchant_profile?.store_name || 'Glide'} receipt · ${order.order_number}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17231d"><h1>Your shopping receipt</h1><p>Payment confirmed at <strong>${escapeHtml(order.merchant_profile?.store_name || 'Glide store')}</strong>.</p><table style="width:100%;border-collapse:collapse">${itemRows}<tr><td style="padding:14px 0;border-top:1px solid #ddd"><strong>Total</strong></td><td style="padding:14px 0;border-top:1px solid #ddd;text-align:right"><strong>₦${Number(order.total_amount).toLocaleString()}</strong></td></tr></table><p><a href="${receiptUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#075c3d;color:white;text-decoration:none">Open secure receipt</a></p><p style="color:#65716a;font-size:13px">Your downloadable receipt unlocks after in-store verification.</p></div>`,
    }),
  })
  if (!response.ok) return { status: 'failed', reason: (await parseProviderResponse(response)).message || 'Email provider rejected the receipt.' }
  return { status: 'sent' }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const { receiptToken, reference, shopperSessionId } = JSON.parse(event.body || '{}')
    if (!receiptToken && !/^[a-z0-9-]{16,80}$/i.test(String(shopperSessionId || ''))) {
      return bad('Receipt or shopper session is required.')
    }

    let orderRequest = supabase
      .from('orders')
      .select('*,order_items(*),merchant_profile(store_name)')
    orderRequest = receiptToken
      ? orderRequest.eq('receipt_token', receiptToken)
      : orderRequest.eq('shopper_session_id', shopperSessionId).order('created_at', { ascending: false }).limit(1)
    const orderResult = await orderRequest.maybeSingle()

    if (orderResult.error || !orderResult.data) return bad('Order not found.')
    const order = orderResult.data

    await supabase.rpc('cancel_expired_pending_orders', { target_merchant_id: order.merchant_id })

    if (
      order.status === 'cancelled' ||
      (order.status === 'pending_payment' &&
        new Date(order.created_at).getTime() <= Date.now() - 60 * 60 * 1000)
    ) {
      return bad('This unpaid order expired after one hour. Please create a new order.')
    }

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
    const secretKey = paystackSecretKey()

    if (!secretKey) return bad('Paystack secret key is missing on the server.')
    if (!secretKey.startsWith('sk_')) {
      return bad('Paystack secret key must be a secret key that starts with sk_.')
    }

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(paystackReference)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      },
    )
    const paystack = await parseProviderResponse(response)

    if (!response.ok || paystack.data?.status !== 'success') {
      return bad(paystack.message || 'Payment has not been confirmed.')
    }

    const updated = await supabase
      .from('orders')
      .update({
        status: 'paid',
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .eq('status', 'pending_payment')
      .select('*,order_items(*),merchant_profile(store_name)')
      .maybeSingle()

    if (updated.error) return bad(updated.error.message)

    if (!updated.data) {
      const latest = await supabase
        .from('orders')
        .select('*,order_items(*),merchant_profile(store_name)')
        .eq('id', order.id)
        .single()

      if (latest.error) return bad(latest.error.message)
      return json(200, { order: latest.data })
    }

    for (const item of updated.data.order_items) {
      const productResult = await supabase
        .from('products')
        .select('id,quantity,track_inventory')
        .eq('id', item.product_id)
        .single()

      if (productResult.data?.track_inventory) {
        const nextQuantity = Math.max(0, Number(productResult.data.quantity) - item.quantity)
        await supabase.from('products').update({ quantity: nextQuantity }).eq('id', item.product_id)
        await supabase.from('inventory_movements').insert({
          merchant_id: updated.data.merchant_id,
          product_id: item.product_id,
          order_id: updated.data.id,
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

    await supabase.from('order_events').insert({
      order_id: updated.data.id,
      merchant_id: updated.data.merchant_id,
      event_type: 'payment_confirmed',
      event_label: 'Payment confirmed by Paystack',
      details: { reference: paystackReference, amount: updated.data.total_amount },
    })

    const delivery = await sendReceiptEmail(event, updated.data)
    await supabase.from('orders').update({
      receipt_delivery_status: delivery.status,
      receipt_sent_at: delivery.status === 'sent' ? new Date().toISOString() : null,
    }).eq('id', updated.data.id)
    await supabase.from('platform_system_logs').insert({
      merchant_id: updated.data.merchant_id,
      event_type: delivery.status === 'sent' ? 'receipt_sent' : 'receipt_delivery_failed',
      severity: delivery.status === 'sent' ? 'info' : 'warning',
      message: delivery.status === 'sent' ? `Receipt ${updated.data.order_number} was emailed.` : `Receipt ${updated.data.order_number} email failed.`,
      details: { order_id: updated.data.id, reason: delivery.reason || null },
    })

    return json(200, { order: { ...updated.data, receipt_delivery_status: delivery.status } })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
