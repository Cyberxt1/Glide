import { adminClient, json, requireMerchantOrStaff, token } from './_supabase.js'

function bad(message) {
  return json(400, { error: message })
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const access = await requireMerchantOrStaff(event, supabase)
    const { cart, paymentType, manualReference } = JSON.parse(event.body || '{}')

    if (!Array.isArray(cart) || cart.length === 0) return bad('Cart is empty.')

    const productIds = cart.map((item) => item.productId)
    const productsResult = await supabase
      .from('products')
      .select('*')
      .eq('merchant_id', access.merchant.id)
      .in('id', productIds)

    if (productsResult.error) return bad(productsResult.error.message)

    const items = []
    let total = 0

    for (const cartItem of cart) {
      const quantity = Number(cartItem.quantity)
      const product = productsResult.data.find((item) => item.id === cartItem.productId)

      if (!product || !product.is_available) return bad('A product is unavailable.')
      if (!Number.isInteger(quantity) || quantity < 1) return bad('Invalid quantity.')
      if (product.track_inventory && quantity > product.quantity) {
        return bad(`${product.name} is out of stock.`)
      }

      const lineTotal = Number(product.price) * quantity
      total += lineTotal
      items.push({
        product_id: product.id,
        product_name: product.name,
        barcode: product.barcode,
        quantity,
        unit_price: product.price,
        line_total: lineTotal,
      })
    }

    const receiptToken = token()
    const orderResult = await supabase
      .from('orders')
      .insert({
        merchant_id: access.merchant.id,
        staff_member_id: access.staff?.id || null,
        order_number: `C-${Date.now().toString().slice(-7)}`,
        shopper_session_id: `cashier-${access.user.id}`,
        status: 'paid',
        payment_status: 'paid',
        total_amount: total,
        receipt_token: receiptToken,
        exit_token: token(10),
        paid_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (orderResult.error) return bad(orderResult.error.message)

    const itemResult = await supabase
      .from('order_items')
      .insert(items.map((item) => ({ ...item, order_id: orderResult.data.id })))

    if (itemResult.error) return bad(itemResult.error.message)

    await supabase.from('payments').insert({
      merchant_id: access.merchant.id,
      order_id: orderResult.data.id,
      provider: `cashier_${String(paymentType || 'cash').toLowerCase().replace(/\s+/g, '_')}`,
      provider_reference: String(manualReference || '').trim() || `cashier_${token(10)}`,
      status: 'paid',
      amount: total,
      paid_at: new Date().toISOString(),
    })

    for (const item of items) {
      const product = productsResult.data.find((row) => row.id === item.product_id)
      if (!product?.track_inventory) continue

      await supabase
        .from('products')
        .update({ quantity: Math.max(0, Number(product.quantity) - item.quantity) })
        .eq('id', item.product_id)

      await supabase.from('inventory_movements').insert({
        merchant_id: access.merchant.id,
        product_id: item.product_id,
        order_id: orderResult.data.id,
        movement_type: 'sale',
        quantity_delta: -item.quantity,
      })
    }

    return json(200, {
      order: orderResult.data,
      receiptToken,
    })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
