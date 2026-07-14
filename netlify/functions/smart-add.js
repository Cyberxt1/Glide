import { adminClient, json, requireMerchant, token as makeToken } from './_supabase.js'

const linkLifetimeMs = 7 * 24 * 60 * 60 * 1000

function bad(message) {
  return json(400, { error: message })
}

function cleanText(value, limit = 200) {
  return String(value || '').trim().slice(0, limit)
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

async function loadActiveLink(supabase, rawToken) {
  const linkToken = cleanText(rawToken, 120)
  if (!linkToken) throw new Error('Smart Add link missing.')

  const result = await supabase
    .from('smart_add_links')
    .select('*,merchant_profile(store_name,branch_name)')
    .eq('token', linkToken)
    .eq('is_active', true)
    .maybeSingle()

  if (result.error) throw new Error(result.error.message)
  if (!result.data) throw new Error('Smart Add link is inactive or invalid.')
  if (new Date(result.data.expires_at).getTime() <= Date.now()) {
    throw new Error('Smart Add link has expired. Ask the store owner for a new link.')
  }

  return result.data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const body = JSON.parse(event.body || '{}')
    const action = body.action

    if (action === 'create-link') {
      const merchant = await requireMerchant(event, supabase)
      const linkToken = makeToken(16)
      const siteUrl = getSiteUrl(event)
      const expiresAt = new Date(Date.now() + linkLifetimeMs).toISOString()

      const result = await supabase
        .from('smart_add_links')
        .insert({
          merchant_id: merchant.id,
          token: linkToken,
          expires_at: expiresAt,
        })
        .select('*')
        .single()

      if (result.error) return bad(result.error.message)

      return json(200, {
        link: {
          ...result.data,
          url: `${siteUrl}/smart-add/${linkToken}`,
          completed_count: 0,
        },
      })
    }

    if (action === 'list-links') {
      const merchant = await requireMerchant(event, supabase)
      const siteUrl = getSiteUrl(event)
      const result = await supabase
        .from('smart_add_links')
        .select('id,token,is_active,expires_at,created_at,smart_add_items(id)')
        .eq('merchant_id', merchant.id)
        .order('created_at', { ascending: false })
        .limit(12)

      if (result.error) return bad(result.error.message)

      return json(200, {
        links: (result.data || []).map((link) => ({
          id: link.id,
          token: link.token,
          is_active: link.is_active && new Date(link.expires_at).getTime() > Date.now(),
          expires_at: link.expires_at,
          created_at: link.created_at,
          completed_count: link.smart_add_items?.length || 0,
          url: `${siteUrl}/smart-add/${link.token}`,
        })),
      })
    }

    if (action === 'get-link') {
      const link = await loadActiveLink(supabase, body.token)
      return json(200, {
        link: {
          id: link.id,
          store_name: link.merchant_profile?.store_name,
          branch_name: link.merchant_profile?.branch_name,
          expires_at: link.expires_at,
        },
      })
    }

    if (action === 'lookup') {
      await loadActiveLink(supabase, body.token)
      const barcode = cleanBarcode(body.barcode)
      if (!barcode) return bad('Barcode is required.')

      const result = await supabase
        .from('global_products')
        .select('*')
        .eq('barcode', barcode)
        .maybeSingle()

      if (result.error) return bad(result.error.message)
      return json(200, { product: result.data || null })
    }

    if (action === 'save-item') {
      const link = await loadActiveLink(supabase, body.token)
      const product = body.product || {}
      const barcode = cleanBarcode(product.barcode)
      const name = cleanText(product.name, 160)
      const category = cleanText(product.category, 100) || 'General'
      const size = cleanText(product.size, 80) || null
      const sku = cleanText(product.sku, 80) || null
      const imageUrl = cleanText(product.image_url, 500000) || null
      const labelText = cleanText(product.label_text, 5000) || null
      const price = Number(product.price)
      const quantity = Number(product.quantity || 0)
      const lowStockThreshold = Number(product.low_stock_threshold || 0)

      if (!barcode) return bad('Barcode is required.')
      if (!name) return bad('Product name is required.')
      if (!Number.isFinite(price) || price < 0) return bad('Enter a valid price.')
      if (!Number.isInteger(quantity) || quantity < 0) return bad('Enter a valid quantity.')
      if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
        return bad('Enter a valid low stock threshold.')
      }

      const globalResult = await supabase
        .from('global_products')
        .upsert(
          {
            barcode,
            name,
            category,
            size,
            image_url: imageUrl,
            label_text: labelText,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'barcode' },
        )
        .select('*')
        .single()

      if (globalResult.error) return bad(globalResult.error.message)

      const payload = {
        merchant_id: link.merchant_id,
        global_product_id: globalResult.data.id,
        barcode,
        name,
        category,
        size,
        sku,
        image_url: imageUrl,
        price,
        quantity,
        low_stock_threshold: lowStockThreshold,
        is_available: true,
        track_inventory: true,
      }

      const productResult = await supabase
        .from('products')
        .upsert(payload, { onConflict: 'merchant_id,barcode' })
        .select('*')
        .single()

      if (productResult.error) return bad(productResult.error.message)

      await supabase.from('smart_add_items').insert({
        link_id: link.id,
        merchant_id: link.merchant_id,
        product_id: productResult.data.id,
        global_product_id: globalResult.data.id,
        barcode,
        captured_image_url: imageUrl,
        extracted_text: labelText,
        submitted_payload: product,
      })

      return json(200, { product: productResult.data, globalProduct: globalResult.data })
    }

    return bad('Unknown Smart Add action.')
  } catch (error) {
    return json(error.message.includes('Login') ? 401 : 500, { error: error.message })
  }
}
