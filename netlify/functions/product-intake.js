import { adminClient, json } from './_supabase.js'

function bad(message, status = 400) {
  return json(status, { error: message })
}

function cleanText(value, limit = 200) {
  return String(value || '').trim().slice(0, limit)
}

function cleanBarcode(value) {
  return cleanText(value, 80).replace(/\s+/g, '')
}

async function loadActiveLink(supabase, rawToken) {
  const token = cleanText(rawToken, 120)
  if (!token) throw new Error('Product intake link missing.')

  const result = await supabase
    .from('platform_product_intake_links')
    .select('id,token,is_active,expires_at,created_at')
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle()

  if (result.error) throw result.error
  if (!result.data) throw new Error('Product intake link is inactive or invalid.')
  if (new Date(result.data.expires_at).getTime() <= Date.now()) {
    throw new Error('Product intake link has expired. Ask an admin for a new link.')
  }

  return result.data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const body = JSON.parse(event.body || '{}')

    if (body.action === 'get-link') {
      const link = await loadActiveLink(supabase, body.token)
      return json(200, {
        link: {
          id: link.id,
          expires_at: link.expires_at,
        },
      })
    }

    if (body.action === 'check-barcode') {
      await loadActiveLink(supabase, body.token)
      const barcode = cleanBarcode(body.barcode)
      if (!barcode) return bad('Barcode is required.')

      const existing = await supabase
        .from('global_products')
        .select('id,barcode,name,category,size,is_hidden')
        .eq('barcode', barcode)
        .maybeSingle()

      if (existing.error) throw existing.error
      return json(200, { exists: Boolean(existing.data), product: existing.data || null })
    }

    if (body.action === 'save-product') {
      const link = await loadActiveLink(supabase, body.token)
      const product = body.product || {}
      const barcode = cleanBarcode(product.barcode)
      const name = cleanText(product.name, 160)
      const category = cleanText(product.category, 100) || 'General'
      const size = cleanText(product.size, 80) || null
      const labelText = cleanText(product.label_text, 5000) || null

      if (!barcode) return bad('Scan a barcode first.')
      if (!name) return bad('Product name is required.')

      const duplicate = await supabase
        .from('global_products')
        .select('id,name')
        .eq('barcode', barcode)
        .maybeSingle()

      if (duplicate.error) throw duplicate.error
      if (duplicate.data) return bad('This barcode already exists in the product database.', 409)

      const saved = await supabase
        .from('global_products')
        .insert({
          barcode,
          name,
          category,
          size,
          label_text: labelText,
          is_hidden: false,
        })
        .select('*')
        .single()

      if (saved.error) throw saved.error

      await supabase.from('platform_product_intake_items').insert({
        link_id: link.id,
        global_product_id: saved.data.id,
        barcode,
        submitted_payload: product,
      })

      return json(200, { product: saved.data })
    }

    return bad('Unknown product intake action.')
  } catch (error) {
    return bad(error.message, error.message.includes('inactive') || error.message.includes('expired') ? 404 : 500)
  }
}
