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

async function findReceipt(supabase, merchantId, credential, fields = '*,order_items(*)') {
  const byAuthenticationCode = await supabase
    .from('orders')
    .select(fields)
    .eq('merchant_id', merchantId)
    .eq('exit_token', credential)
    .maybeSingle()

  if (byAuthenticationCode.error || byAuthenticationCode.data) return byAuthenticationCode

  // Existing receipts used the internal receipt token as their barcode.
  return supabase
    .from('orders')
    .select(fields)
    .eq('merchant_id', merchantId)
    .eq('receipt_token', credential)
    .maybeSingle()
}

async function touchStaff(supabase, staff, station) {
  if (!staff?.id) return
  await supabase
    .from('staff_members')
    .update({ last_seen_at: new Date().toISOString(), current_station: station })
    .eq('id', staff.id)
}

async function getOrStartShift(supabase, access, station) {
  const existing = await supabase.from('cashier_shifts').select('*').eq('user_id', access.user.id).eq('station', station).is('ended_at', null).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return existing.data
  const created = await supabase.from('cashier_shifts').insert({
    merchant_id: access.merchant.id,
    staff_member_id: access.staff?.id || null,
    user_id: access.user.id,
    station,
  }).select('*').single()
  if (created.error) throw created.error
  return created.data
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

      if (storeName && !sameText(storeName, access.merchant.store_name)) {
        return bad('Store name does not match this terminal.', 403)
      }

      if (!expectedCode) {
        return bad('This account does not have a terminal code yet. Ask the store owner to run the terminal-code repair migration.', 409)
      }

      if (authCode !== expectedCode) {
        return bad('Authentication code is not valid for this store.', 403)
      }

      await touchStaff(supabase, access.staff, station)
      const shift = await getOrStartShift(supabase, access, station)

      const products = await supabase
        .from('products')
        .select('id,name,barcode,sku,category,price,quantity,low_stock_threshold,is_available,track_inventory,size,unit_label,pack_label,units_per_pack,pack_price,entry_mode,is_restricted,requires_quantity_entry,created_at')
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
          shiftId: shift.id,
          shiftStartedAt: shift.started_at,
        },
        catalog: products.data || [],
      })
    }

    if (body.action === 'verify-receipt') {
      const receiptCode = clean(body.receiptCode || body.receiptToken)
      if (!receiptCode) return bad('Receipt authentication code is required.')
      await touchStaff(supabase, access.staff, clean(body.station) || 'cashier')

      const order = await findReceipt(supabase, access.merchant.id, receiptCode)

      if (order.error) return bad(order.error.message)
      if (!order.data) return bad('Receipt not found.', 404)
      if (order.data.payment_status === 'paid' && order.data.status !== 'exited') {
        await supabase.from('orders').update({ verification_started_at: new Date().toISOString() }).eq('id', order.data.id).is('verification_started_at', null)
      }

      return json(200, { order: order.data })
    }

    if (body.action === 'lookup-transaction') {
      const query = clean(body.query)
      if (!query) return bad('Enter a receipt, payment reference or shopper email.')
      const payment = await supabase.from('payments').select('order_id').eq('merchant_id', access.merchant.id).ilike('provider_reference', query).maybeSingle()
      let request = supabase.from('orders').select('*,order_items(*)').eq('merchant_id', access.merchant.id)
      if (payment.data?.order_id) request = request.eq('id', payment.data.order_id)
      else if (query.includes('@')) request = request.ilike('customer_email', query)
      else request = request.or(`order_number.ilike.%${query.replace(/[%,]/g, '')}%,exit_token.eq.${query},receipt_token.eq.${query}`)
      const result = await request.order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (result.error) return bad(result.error.message)
      if (!result.data) return bad('No transaction matched that search.', 404)
      return json(200, { order: result.data })
    }

    if (body.action === 'burn-receipt') {
      const receiptCode = clean(body.receiptCode || body.receiptToken)
      if (!receiptCode) return bad('Receipt authentication code is required.')
      await touchStaff(supabase, access.staff, clean(body.station) || 'security')

      const order = await findReceipt(
        supabase,
        access.merchant.id,
        receiptCode,
        'id,status,payment_status',
      )

      if (order.error) return bad(order.error.message)
      if (!order.data) return bad('Receipt not found.', 404)
      if (order.data.status === 'exited') return bad('This receipt has already been verified and cannot be reused.', 409)
      if (order.data.payment_status !== 'paid') return bad('Receipt is not paid.', 409)

      const outcome = body.outcome === 'mismatch' ? 'mismatch' : 'matched'
      const reasonCodes = Array.isArray(body.reasonCodes) ? body.reasonCodes.map((reason) => clean(reason)).filter(Boolean).slice(0, 6) : []
      if (outcome === 'mismatch' && !reasonCodes.length) return bad('Select at least one mismatch reason.')
      const balanceCollected = Math.max(0, Number(body.balanceCollected) || 0)
      const balancePaymentMethod = clean(body.balancePaymentMethod).toLowerCase()
      if (balanceCollected > 0 && !['cash', 'card', 'transfer'].includes(balancePaymentMethod)) return bad('Select how the additional balance was collected.')

      const updated = await supabase
        .from('orders')
        .update({ status: 'exited', exited_at: new Date().toISOString(), verification_outcome: outcome, verified_by_staff_id: access.staff?.id || null })
        .eq('id', order.data.id)
        .eq('status', 'paid')
        .select('*,order_items(*)')
        .single()

      if (updated.error) return bad('This receipt has already been verified and cannot be reused.', 409)

      await supabase.from('verification_records').upsert({
        order_id: order.data.id,
        merchant_id: access.merchant.id,
        staff_member_id: access.staff?.id || null,
        outcome,
        reason_codes: reasonCodes,
        checked_items: Array.isArray(body.checkedItems) ? body.checkedItems : [],
        incident_note: clean(body.incidentNote).slice(0, 1000) || null,
        balance_collected: balanceCollected,
        balance_payment_method: balancePaymentMethod || null,
      }, { onConflict: 'order_id' })
      await supabase.from('order_events').insert({
        order_id: order.data.id,
        merchant_id: access.merchant.id,
        staff_member_id: access.staff?.id || null,
        event_type: outcome === 'mismatch' ? 'exit_mismatch' : 'exit_verified',
        event_label: outcome === 'mismatch' ? 'Exit verification found a mismatch' : 'Exit verification completed',
        details: { reason_codes: reasonCodes, balance_collected: balanceCollected },
      })
      const shift = await getOrStartShift(supabase, access, clean(body.station) || 'security')
      await supabase.from('cashier_shifts').update({
        baskets_verified: Number(shift.baskets_verified || 0) + 1,
        mismatches: Number(shift.mismatches || 0) + (outcome === 'mismatch' ? 1 : 0),
        cash_collected: Number(shift.cash_collected || 0) + (balancePaymentMethod === 'cash' ? balanceCollected : 0),
      }).eq('id', shift.id)

      return json(200, { order: updated.data })
    }

    if (body.action === 'end-shift') {
      const station = clean(body.station) || 'security'
      const shift = await supabase.from('cashier_shifts').update({ ended_at: new Date().toISOString() }).eq('user_id', access.user.id).eq('station', station).is('ended_at', null).select('*').maybeSingle()
      if (shift.error) return bad(shift.error.message)
      return json(200, { shift: shift.data })
    }

    return bad('Unknown cashier terminal action.')
  } catch (error) {
    return json(500, { error: error.message })
  }
}
