import { adminClient, json, requireMerchantOrStaff } from './_supabase.js'

function bad(message, status = 400) {
  return json(status, { error: message })
}

function clean(value) {
  return String(value || '').trim()
}

function sameText(left, right) {
  return clean(left).toLowerCase() === clean(right).toLowerCase()
}

async function touchStaff(supabase, staff, station) {
  if (!staff?.id) return
  await supabase
    .from('staff_members')
    .update({ last_seen_at: new Date().toISOString(), current_station: station })
    .eq('id', staff.id)
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const access = await requireMerchantOrStaff(event, supabase)
    const body = JSON.parse(event.body || '{}')

    if (body.action === 'validate-terminal') {
      const storeName = clean(body.storeName)
      const authCode = clean(body.authCode).toUpperCase()
      const expectedCode = clean(access.staff?.terminal_auth_code || access.merchant.terminal_auth_code).toUpperCase()
      const station = clean(body.station) || (access.staff?.role === 'security' ? 'security' : 'cashier')

      if (!sameText(storeName, access.merchant.store_name)) {
        return bad('Store name does not match this terminal.', 403)
      }

      if (!expectedCode || authCode !== expectedCode) {
        return bad('Authentication code is not valid for this store.', 403)
      }

      await touchStaff(supabase, access.staff, station)

      const products = await supabase
        .from('products')
        .select('id,name,barcode,sku,category,price,quantity,low_stock_threshold,is_available,track_inventory,size,unit_label,pack_label,units_per_pack,pack_price,created_at')
        .eq('merchant_id', access.merchant.id)
        .eq('is_available', true)
        .order('name', { ascending: true })

      if (products.error) return bad(products.error.message)

      return json(200, {
        terminal: {
          merchantId: access.merchant.id,
          staffId: access.staff?.id || null,
          storeName: access.merchant.store_name,
          branchName: access.merchant.branch_name,
          cashierEmail: access.user.email,
          role: access.staff?.role || 'owner',
          station,
          validatedAt: new Date().toISOString(),
        },
        catalog: products.data || [],
      })
    }

    if (body.action === 'verify-receipt') {
      const receiptToken = clean(body.receiptToken)
      if (!receiptToken) return bad('Receipt token is required.')
      await touchStaff(supabase, access.staff, clean(body.station) || 'cashier')

      const order = await supabase
        .from('orders')
        .select('*,order_items(*)')
        .eq('merchant_id', access.merchant.id)
        .eq('receipt_token', receiptToken)
        .maybeSingle()

      if (order.error) return bad(order.error.message)
      if (!order.data) return bad('Receipt not found.', 404)
      if (order.data.payment_status !== 'paid') return bad('Receipt is not paid.', 409)

      return json(200, { order: order.data })
    }

    if (body.action === 'burn-receipt') {
      const receiptToken = clean(body.receiptToken)
      if (!receiptToken) return bad('Receipt token is required.')
      await touchStaff(supabase, access.staff, clean(body.station) || 'security')

      const order = await supabase
        .from('orders')
        .select('id,status,payment_status')
        .eq('merchant_id', access.merchant.id)
        .eq('receipt_token', receiptToken)
        .maybeSingle()

      if (order.error) return bad(order.error.message)
      if (!order.data) return bad('Receipt not found.', 404)
      if (order.data.status === 'exited') return bad('Security Warning: Receipt Already Used.', 409)
      if (order.data.payment_status !== 'paid') return bad('Receipt is not paid.', 409)

      const updated = await supabase
        .from('orders')
        .update({ status: 'exited', exited_at: new Date().toISOString() })
        .eq('id', order.data.id)
        .eq('status', 'paid')
        .select('*,order_items(*)')
        .single()

      if (updated.error) return bad('Security Warning: Receipt Already Used.', 409)

      return json(200, { order: updated.data })
    }

    return bad('Unknown cashier terminal action.')
  } catch (error) {
    return json(500, { error: error.message })
  }
}
