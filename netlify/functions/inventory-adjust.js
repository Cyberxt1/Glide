import { adminClient, json, requireMerchant } from './_supabase.js'

function bad(message, status = 400) {
  return json(status, { error: message })
}

function clean(value, length = 160) {
  return String(value || '').trim().slice(0, length)
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const merchant = await requireMerchant(event, supabase)
    const body = JSON.parse(event.body || '{}')

    if (body.action === 'lookup') {
      const barcode = clean(body.barcode)
      if (!barcode) return bad('Scan or enter a barcode.')

      const result = await supabase
        .from('products')
        .select('id,name,barcode,sku,quantity,track_inventory,unit_label,pack_label,units_per_pack')
        .eq('merchant_id', merchant.id)
        .eq('barcode', barcode)
        .maybeSingle()

      if (result.error) return bad(result.error.message)
      if (!result.data) return bad('No inventory product matches this barcode.', 404)
      if (!result.data.track_inventory) return bad('Inventory tracking is disabled for this product.')

      return json(200, { product: result.data })
    }

    if (body.action === 'apply') {
      if (!Array.isArray(body.adjustments) || !body.adjustments.length) {
        return bad('Add at least one stock change.')
      }
      if (body.adjustments.length > 200) return bad('Apply no more than 200 products at once.')

      const adjustments = body.adjustments.map((item) => ({
        product_id: clean(item.productId, 60),
        operation: clean(item.operation, 20),
        quantity: Number(item.quantity),
        reason: clean(item.reason, 240),
      }))

      const invalid = adjustments.some(
        (item) =>
          !item.product_id ||
          !['receive', 'remove', 'count'].includes(item.operation) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < (item.operation === 'count' ? 0 : 1),
      )
      if (invalid) return bad('One or more stock changes are invalid.')

      const result = await supabase.rpc('apply_inventory_adjustments', {
        target_merchant_id: merchant.id,
        adjustments,
      })

      if (result.error) return bad(result.error.message)
      return json(200, { updates: result.data || [] })
    }

    return bad('Unknown inventory action.')
  } catch (error) {
    return json(500, { error: error.message })
  }
}
