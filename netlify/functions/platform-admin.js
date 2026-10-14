import { adminClient, json, requirePlatformAdmin, token as makeToken } from './_supabase.js'

const productIntakeLinkLifetimeMs = 7 * 24 * 60 * 60 * 1000

function bad(message, status = 400) {
  return json(status, { error: message })
}

function cleanText(value, limit = 200) {
  return String(value ?? '').trim().slice(0, limit)
}

function cleanBarcode(value) {
  return cleanText(value, 80).replace(/\s+/g, '')
}

function getSiteUrl(event) {
  const configured = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`

  const host = event.headers.host || event.headers.Host
  if (!host) return ''

  const protocol =
    host.includes('localhost') || host.startsWith('127.') || host.startsWith('[::1]')
      ? 'http'
      : 'https'
  return `${protocol}://${host}`
}

async function tableCount(supabase, table, query = (request) => request) {
  const result = await query(supabase.from(table).select('id', { count: 'exact', head: true }))
  if (result.error) throw result.error
  return result.count || 0
}

async function audit(supabase, user, action, details = {}) {
  try {
    await supabase
      .from('platform_admin_audit_logs')
      .insert({
        admin_email: user.email,
        action,
        details,
      })
  } catch {
    // Audit writes should never block the admin action itself.
  }
}

async function adminProfile(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.app_metadata?.role || user.app_metadata?.glide_role || 'platform_admin',
  }
}

async function summary(supabase) {
  const analyticsStart = new Date()
  analyticsStart.setUTCHours(0, 0, 0, 0)
  analyticsStart.setUTCDate(analyticsStart.getUTCDate() - 13)
  const [
    merchantCount,
    productCount,
    globalProductCount,
    orderCount,
    paidOrderCount,
    smartAddCount,
    staffCount,
    activeStaffCount,
    hiddenGlobalProductCount,
    pendingMerchantCount,
    recentMerchants,
    recentGlobalProducts,
    recentAudit,
    paidOrders,
  ] = await Promise.all([
    tableCount(supabase, 'merchant_profile'),
    tableCount(supabase, 'products'),
    tableCount(supabase, 'global_products'),
    tableCount(supabase, 'orders'),
    tableCount(supabase, 'orders', (request) => request.eq('payment_status', 'paid')),
    tableCount(supabase, 'smart_add_items'),
    tableCount(supabase, 'staff_members'),
    tableCount(supabase, 'staff_members', (request) => request.eq('is_active', true)),
    tableCount(supabase, 'global_products', (request) => request.eq('is_hidden', true)),
    tableCount(supabase, 'merchant_profile', (request) => request.eq('onboarding_status', 'pending')),
    supabase
      .from('merchant_profile')
      .select('id,store_name,branch_name,onboarding_status,geofence_enabled,geofence_radius_meters,created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('global_products')
      .select('id,barcode,name,category,size,updated_at')
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase
      .from('platform_admin_audit_logs')
      .select('id,admin_email,action,details,created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('orders').select('total_amount').eq('payment_status', 'paid'),
  ])

  if (recentMerchants.error) throw recentMerchants.error
  if (recentGlobalProducts.error) throw recentGlobalProducts.error
  if (recentAudit.error) throw recentAudit.error
  if (paidOrders.error) throw paidOrders.error

  const [trendOrders, feedback, signups, receiptFailures, storePerformance, recentEvents] = await Promise.all([
    supabase.from('orders').select('id,merchant_id,total_amount,payment_status,status,created_at').gte('created_at', analyticsStart.toISOString()).order('created_at'),
    supabase.from('shopper_feedback').select('rating,created_at').gte('created_at', analyticsStart.toISOString()),
    supabase.from('shopper_app_signups').select('id,created_at').gte('created_at', analyticsStart.toISOString()),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('receipt_delivery_status', 'failed'),
    supabase.from('merchant_profile').select('id,store_name,branch_name,onboarding_status,geofence_enabled,orders(id,total_amount,payment_status,created_at)').limit(100),
    supabase.from('platform_system_logs').select('id,event_type,severity,message,created_at,merchant_profile(store_name)').order('created_at', { ascending: false }).limit(6),
  ])

  const analyticsError = [trendOrders.error, feedback.error, signups.error, receiptFailures.error, storePerformance.error, recentEvents.error].find(Boolean)
  if (analyticsError) throw analyticsError

  const orderRows = trendOrders.data || []
  const dailyTrend = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(analyticsStart)
    day.setUTCDate(day.getUTCDate() + index)
    const key = day.toISOString().slice(0, 10)
    const rows = orderRows.filter((order) => order.created_at.slice(0, 10) === key)
    const paid = rows.filter((order) => order.payment_status === 'paid')
    return {
      date: key,
      label: day.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      orders: rows.length,
      paidOrders: paid.length,
      revenue: paid.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    }
  })
  const today = dailyTrend.at(-1) || { orders: 0, paidOrders: 0, revenue: 0 }
  const yesterday = dailyTrend.at(-2) || { orders: 0, paidOrders: 0, revenue: 0 }
  const ratingRows = feedback.data || []
  const storeRows = (storePerformance.data || []).map((store) => {
    const paid = (store.orders || []).filter((order) => order.payment_status === 'paid')
    return {
      id: store.id,
      store_name: store.store_name,
      branch_name: store.branch_name,
      onboarding_status: store.onboarding_status,
      geofence_enabled: store.geofence_enabled,
      orders: store.orders?.length || 0,
      paid_orders: paid.length,
      revenue: paid.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    }
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 6)

  return {
    merchantCount,
    productCount,
    globalProductCount,
    orderCount,
    paidOrderCount,
    smartAddCount,
    staffCount,
    activeStaffCount,
    hiddenGlobalProductCount,
    pendingMerchantCount,
    totalRevenue: (paidOrders.data || []).reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0,
    ),
    recentMerchants: recentMerchants.data || [],
    recentGlobalProducts: recentGlobalProducts.data || [],
    recentAudit: recentAudit.data || [],
    dailyTrend,
    today,
    yesterday,
    averageRating: ratingRows.length ? ratingRows.reduce((sum, row) => sum + Number(row.rating), 0) / ratingRows.length : 0,
    feedbackCount: ratingRows.length,
    interestCount: signups.data?.length || 0,
    receiptFailureCount: receiptFailures.count || 0,
    approvedStoreCount: (storePerformance.data || []).filter((store) => store.onboarding_status === 'approved').length,
    geofencedStoreCount: (storePerformance.data || []).filter((store) => store.geofence_enabled).length,
    storePerformance: storeRows,
    recentEvents: recentEvents.data || [],
  }
}

async function listMerchants(supabase) {
  const result = await supabase
    .from('merchant_profile')
    .select('id,user_id,store_name,branch_name,onboarding_status,onboarding_submitted_at,onboarding_reviewed_at,onboarding_review_note,geofence_enabled,geofence_latitude,geofence_longitude,geofence_radius_meters,created_at,updated_at,products(id),orders(id,total_amount,payment_status,status),staff_members(id,is_active)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (result.error) throw result.error

  return Promise.all(
    (result.data || []).map(async (merchant) => {
      const ownerResult = await supabase.auth.admin.getUserById(merchant.user_id).catch(() => null)
      const orders = merchant.orders || []
      return {
        id: merchant.id,
        owner_email: ownerResult?.data?.user?.email || 'Unknown owner',
        store_name: merchant.store_name,
        branch_name: merchant.branch_name,
        onboarding_status: merchant.onboarding_status,
        onboarding_submitted_at: merchant.onboarding_submitted_at,
        onboarding_reviewed_at: merchant.onboarding_reviewed_at,
        onboarding_review_note: merchant.onboarding_review_note,
        geofence_enabled: merchant.geofence_enabled,
        geofence_latitude: merchant.geofence_latitude,
        geofence_longitude: merchant.geofence_longitude,
        geofence_radius_meters: merchant.geofence_radius_meters,
        created_at: merchant.created_at,
        updated_at: merchant.updated_at,
        products_count: merchant.products?.length || 0,
        staff_count: merchant.staff_members?.length || 0,
        active_staff_count: (merchant.staff_members || []).filter((staff) => staff.is_active).length,
        orders_count: orders.length,
        paid_orders_count: orders.filter((order) => order.payment_status === 'paid').length,
        paid_revenue: orders
          .filter((order) => order.payment_status === 'paid')
          .reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
      }
    }),
  )
}

async function listProducts(supabase, query) {
  const term = cleanText(query?.term ?? query, 120).replace(/[%,]/g, ' ')
  const includeHidden = Boolean(query?.includeHidden)
  const hiddenOnly = Boolean(query?.hiddenOnly)
  let request = supabase
    .from('global_products')
    .select('id,barcode,name,category,size,label_text,is_hidden,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(80)

  if (hiddenOnly) {
    request = request.eq('is_hidden', true)
  } else if (!includeHidden) {
    request = request.eq('is_hidden', false)
  }

  if (term) {
    request = request.or(`name.ilike.%${term}%,barcode.ilike.%${term}%,category.ilike.%${term}%`)
  }

  const result = await request
  if (result.error) throw result.error
  const rows = result.data || []
  const stats = await productStats(supabase)
  return { rows, stats }
}

async function saveProduct(supabase, product) {
  const id = cleanText(product.id, 80) || null
  const barcode = cleanBarcode(product.barcode)
  const name = cleanText(product.name, 160)
  const category = cleanText(product.category, 100) || null
  const size = cleanText(product.size, 80) || null
  const labelText = cleanText(product.label_text, 5000) || null

  if (!barcode) throw new Error('Barcode is required.')
  if (!name) throw new Error('Product name is required.')
  if (!id) throw new Error('Use a product scan link to add new database products.')

  const payload = {
    barcode,
    name,
    category,
    size,
    label_text: labelText,
    is_hidden: Boolean(product.is_hidden),
    updated_at: new Date().toISOString(),
  }

  const request = supabase.from('global_products').update(payload).eq('id', id)

  const result = await request.select('*').single()
  if (result.error) throw result.error
  return result.data
}

async function setProductHidden(supabase, id, isHidden) {
  const productId = cleanText(id, 80)
  if (!productId) throw new Error('Product id is required.')

  const result = await supabase
    .from('global_products')
    .update({ is_hidden: Boolean(isHidden), updated_at: new Date().toISOString() })
    .eq('id', productId)
    .select('*')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function productStats(supabase) {
  const result = await supabase
    .from('global_products')
    .select('category,is_hidden')

  if (result.error) throw result.error

  const rows = result.data || []
  const categories = new Map()
  for (const product of rows.filter((row) => !row.is_hidden)) {
    const category = product.category || 'General'
    categories.set(category, (categories.get(category) || 0) + 1)
  }

  return {
    total: rows.length,
    visible: rows.filter((row) => !row.is_hidden).length,
    hidden: rows.filter((row) => row.is_hidden).length,
    categories: [...categories.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

async function createProductIntakeLink(supabase, event, user) {
  const linkToken = makeToken(16)
  const expiresAt = new Date(Date.now() + productIntakeLinkLifetimeMs).toISOString()
  const siteUrl = getSiteUrl(event)

  const result = await supabase
    .from('platform_product_intake_links')
    .insert({
      token: linkToken,
      created_by_email: user.email,
      expires_at: expiresAt,
    })
    .select('id,token,is_active,expires_at,created_at')
    .single()

  if (result.error) throw result.error

  return {
    ...result.data,
    completed_count: 0,
    url: `${siteUrl}/product-intake/${linkToken}`,
  }
}

async function listProductIntakeLinks(supabase, event) {
  const siteUrl = getSiteUrl(event)
  const result = await supabase
    .from('platform_product_intake_links')
    .select('id,token,is_active,expires_at,created_at,created_by_email,platform_product_intake_items(id)')
    .order('created_at', { ascending: false })
    .limit(20)

  if (result.error) throw result.error

  return (result.data || []).map((link) => ({
    id: link.id,
    token: link.token,
    is_active: link.is_active && new Date(link.expires_at).getTime() > Date.now(),
    expires_at: link.expires_at,
    created_at: link.created_at,
    created_by_email: link.created_by_email,
    completed_count: link.platform_product_intake_items?.length || 0,
    url: `${siteUrl}/product-intake/${link.token}`,
  }))
}

async function updateMerchant(supabase, merchant) {
  const id = cleanText(merchant.id, 80)
  const storeName = cleanText(merchant.store_name, 160)
  const branchName = cleanText(merchant.branch_name, 160)

  if (!id) throw new Error('Store id is required.')
  if (!storeName) throw new Error('Store name is required.')
  if (!branchName) throw new Error('Branch name is required.')

  const result = await supabase
    .from('merchant_profile')
    .update({
      store_name: storeName,
      branch_name: branchName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id,store_name,branch_name,updated_at')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function listStaff(supabase) {
  const result = await supabase
    .from('staff_members')
    .select('id,email,full_name,role,is_active,created_at,updated_at,merchant_profile(store_name,branch_name)')
    .order('created_at', { ascending: false })
    .limit(120)

  if (result.error) throw result.error
  return result.data || []
}

async function setStaffActive(supabase, id, isActive) {
  const staffId = cleanText(id, 80)
  if (!staffId) throw new Error('Staff id is required.')

  const result = await supabase
    .from('staff_members')
    .update({ is_active: Boolean(isActive), updated_at: new Date().toISOString() })
    .eq('id', staffId)
    .select('id,email,full_name,role,is_active,created_at,updated_at,merchant_profile(store_name,branch_name)')
    .single()

  if (result.error) throw result.error
  return result.data
}

async function listOrders(supabase) {
  const result = await supabase
    .from('orders')
    .select('id,order_number,status,payment_status,total_amount,customer_email,receipt_delivery_status,receipt_sent_at,created_at,paid_at,exited_at,verification_outcome,checkout_duration_seconds,merchant_profile(store_name,branch_name),payments(provider,provider_reference,status,amount,created_at),verification_records(outcome,reason_codes,incident_note,balance_collected,balance_payment_method,created_at)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (result.error) throw result.error
  return result.data || []
}

async function listAudit(supabase) {
  const result = await supabase
    .from('platform_admin_audit_logs')
    .select('id,admin_email,action,details,created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (result.error) throw result.error
  return result.data || []
}

async function reviewMerchant(supabase, id, decision, note) {
  const merchantId = cleanText(id, 80)
  if (!merchantId) throw new Error('Store id is required.')
  if (!['approved', 'rejected', 'suspended'].includes(decision)) throw new Error('Invalid review decision.')

  const result = await supabase
    .from('merchant_profile')
    .update({
      onboarding_status: decision,
      onboarding_reviewed_at: new Date().toISOString(),
      onboarding_review_note: cleanText(note, 1000) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', merchantId)
    .select('id,store_name,branch_name,onboarding_status,onboarding_reviewed_at,onboarding_review_note')
    .single()
  if (result.error) throw result.error

  await supabase.from('qr_codes').update({ is_active: decision === 'approved' }).eq('merchant_id', merchantId)
  await supabase.from('platform_system_logs').insert({
    merchant_id: merchantId,
    event_type: `store_${decision}`,
    severity: decision === 'approved' ? 'info' : 'warning',
    message: `${result.data.store_name} was ${decision}.`,
    details: { note: cleanText(note, 1000) || null },
  })
  return result.data
}

async function listCustomerInsights(supabase) {
  const [feedback, interest] = await Promise.all([
    supabase.from('shopper_feedback').select('id,rating,tags,comment,created_at,merchant_profile(store_name,branch_name),orders(order_number)').order('created_at', { ascending: false }).limit(200),
    supabase.from('shopper_app_signups').select('id,email,full_name,phone,offers,early_access,created_at,merchant_profile(store_name,branch_name)').order('created_at', { ascending: false }).limit(200),
  ])
  if (feedback.error) throw feedback.error
  if (interest.error) throw interest.error
  return { feedback: feedback.data || [], interest: interest.data || [] }
}

async function listSystemLogs(supabase) {
  const result = await supabase
    .from('platform_system_logs')
    .select('id,event_type,severity,message,details,created_at,merchant_profile(store_name,branch_name)')
    .order('created_at', { ascending: false })
    .limit(250)
  if (result.error) throw result.error
  return result.data || []
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const user = await requirePlatformAdmin(event, supabase)
    const body = JSON.parse(event.body || '{}')

    if (body.action === 'verify') {
      return json(200, { admin: await adminProfile(user) })
    }

    if (body.action === 'summary') {
      return json(200, { summary: await summary(supabase), admin: await adminProfile(user) })
    }

    if (body.action === 'list-merchants') {
      return json(200, { merchants: await listMerchants(supabase) })
    }

    if (body.action === 'list-products') {
      const products = await listProducts(supabase, body.query)
      return json(200, { products: products.rows, productStats: products.stats })
    }

    if (body.action === 'create-product-intake-link') {
      const link = await createProductIntakeLink(supabase, event, user)
      await audit(supabase, user, 'product_intake_link_created', { link_id: link.id })
      return json(200, { link })
    }

    if (body.action === 'list-product-intake-links') {
      return json(200, { links: await listProductIntakeLinks(supabase, event) })
    }

    if (body.action === 'list-staff') {
      return json(200, { staff: await listStaff(supabase) })
    }

    if (body.action === 'list-orders') {
      return json(200, { orders: await listOrders(supabase) })
    }

    if (body.action === 'list-audit') {
      return json(200, { auditLogs: await listAudit(supabase) })
    }

    if (body.action === 'list-customer-insights') {
      return json(200, await listCustomerInsights(supabase))
    }

    if (body.action === 'list-system-logs') {
      return json(200, { logs: await listSystemLogs(supabase) })
    }

    if (body.action === 'review-merchant') {
      const merchant = await reviewMerchant(supabase, body.id, cleanText(body.decision, 20), body.note)
      await audit(supabase, user, `merchant_${merchant.onboarding_status}`, { merchant_id: merchant.id, note: merchant.onboarding_review_note })
      return json(200, { merchant })
    }

    if (body.action === 'update-merchant') {
      const merchant = await updateMerchant(supabase, body.merchant || {})
      await audit(supabase, user, 'merchant_updated', {
        merchant_id: merchant.id,
        store_name: merchant.store_name,
      })
      return json(200, { merchant })
    }

    if (body.action === 'set-staff-active') {
      const staff = await setStaffActive(supabase, body.id, body.isActive)
      await audit(supabase, user, staff.is_active ? 'staff_enabled' : 'staff_disabled', {
        staff_id: staff.id,
        email: staff.email,
      })
      return json(200, { staff })
    }

    if (body.action === 'save-product') {
      const product = await saveProduct(supabase, body.product || {})
      await audit(supabase, user, 'global_product_updated', {
        product_id: product.id,
        barcode: product.barcode,
      })
      return json(200, { product })
    }

    if (body.action === 'set-product-hidden') {
      const product = await setProductHidden(supabase, body.id, body.isHidden)
      await audit(supabase, user, product.is_hidden ? 'global_product_hidden' : 'global_product_restored', {
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
