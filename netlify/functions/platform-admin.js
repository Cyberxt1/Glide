import { adminClient, json, requirePlatformAdmin } from './_supabase.js'

function bad(message, status = 400) {
  return json(status, { error: message })
}

function cleanText(value, limit = 200) {
  return String(value || '').trim().slice(0, limit)
}

async function tableCount(supabase, table, query = (request) => request) {
  const result = await query(supabase.from(table).select('id', { count: 'exact', head: true }))
  if (result.error) throw result.error
  return result.count || 0
}

async function audit(supabase, user, action, details = {}) {
  await supabase
    .from('platform_admin_audit_logs')
    .insert({
      admin_email: user.email,
      action,
      details,
    })
    .throwOnError()
    .catch(() => {})
}

async function summary(supabase) {
  const [
    merchantCount,
    productCount,
    globalProductCount,
    orderCount,
    paidOrderCount,
    smartAddCount,
    recentMerchants,
    recentGlobalProducts,
    paidOrders,
  ] = await Promise.all([
    tableCount(supabase, 'merchant_profile'),
    tableCount(supabase, 'products'),
    tableCount(supabase, 'global_products'),
    tableCount(supabase, 'orders'),
    tableCount(supabase, 'orders', (request) => request.eq('payment_status', 'paid')),
    tableCount(supabase, 'smart_add_items'),
    supabase
      .from('merchant_profile')
      .select('id,store_name,branch_name,created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('global_products')
      .select('id,barcode,name,category,size,updated_at')
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase.from('orders').select('total_amount').eq('payment_status', 'paid'),
  ])

  if (recentMerchants.error) throw recentMerchants.error
  if (recentGlobalProducts.error) throw recentGlobalProducts.error
  if (paidOrders.error) throw paidOrders.error

  return {
    merchantCount,
    productCount,
    globalProductCount,
    orderCount,
    paidOrderCount,
    smartAddCount,
    totalRevenue: (paidOrders.data || []).reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0,
    ),
    recentMerchants: recentMerchants.data || [],
    recentGlobalProducts: recentGlobalProducts.data || [],
  }
}

async function listMerchants(supabase) {
  const result = await supabase
    .from('merchant_profile')
    .select('id,store_name,branch_name,created_at,products(id),orders(id,total_amount,payment_status)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (result.error) throw result.error

  return (result.data || []).map((merchant) => ({
    id: merchant.id,
    store_name: merchant.store_name,
    branch_name: merchant.branch_name,
    created_at: merchant.created_at,
    products_count: merchant.products?.length || 0,
    orders_count: merchant.orders?.length || 0,
    paid_revenue: (merchant.orders || [])
      .filter((order) => order.payment_status === 'paid')
      .reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
  }))
}

async function listProducts(supabase, query) {
  const term = cleanText(query, 120).replace(/[%,]/g, ' ')
  let request = supabase
    .from('global_products')
    .select('id,barcode,name,category,size,label_text,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(80)

  if (term) {
    request = request.or(`name.ilike.%${term}%,barcode.ilike.%${term}%,category.ilike.%${term}%`)
  }

  const result = await request
  if (result.error) throw result.error
  return result.data || []
}

async function saveProduct(supabase, product) {
  const id = cleanText(product.id, 80) || null
  const barcode = cleanText(product.barcode, 80).replace(/\s+/g, '')
  const name = cleanText(product.name, 160)
  const category = cleanText(product.category, 100) || null
  const size = cleanText(product.size, 80) || null
  const labelText = cleanText(product.label_text, 5000) || null

  if (!barcode) throw new Error('Barcode is required.')
  if (!name) throw new Error('Product name is required.')

  const payload = {
    barcode,
    name,
    category,
    size,
    label_text: labelText,
    updated_at: new Date().toISOString(),
  }

  const request = id
    ? supabase.from('global_products').update(payload).eq('id', id)
    : supabase.from('global_products').insert(payload)

  const result = await request.select('*').single()
  if (result.error) throw result.error
  return result.data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const user = await requirePlatformAdmin(event, supabase)
    const body = JSON.parse(event.body || '{}')

    if (body.action === 'summary') {
      return json(200, { summary: await summary(supabase) })
    }

    if (body.action === 'list-merchants') {
      return json(200, { merchants: await listMerchants(supabase) })
    }

    if (body.action === 'list-products') {
      return json(200, { products: await listProducts(supabase, body.query) })
    }

    if (body.action === 'save-product') {
      const product = await saveProduct(supabase, body.product || {})
      await audit(supabase, user, body.product?.id ? 'global_product_updated' : 'global_product_created', {
        product_id: product.id,
        barcode: product.barcode,
      })
      return json(200, { product })
    }

    if (body.action === 'delete-product') {
      const id = cleanText(body.id, 80)
      if (!id) return bad('Product id is required.')

      const result = await supabase.from('global_products').delete().eq('id', id)
      if (result.error) throw result.error
      await audit(supabase, user, 'global_product_deleted', { product_id: id })
      return json(200, { ok: true })
    }

    return bad('Unknown admin action.')
  } catch (error) {
    const status = error.message.includes('Login')
      ? 401
      : error.message.includes('Platform admin')
        ? 403
        : 500
    return bad(error.message, status)
  }
}
