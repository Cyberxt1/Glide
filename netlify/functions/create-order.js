import { adminClient, json, receiptCode, token } from './_supabase.js'

function bad(message) {
  return json(400, { error: message })
}

function fallbackEmail(shopperSessionId) {
  const safeId = String(shopperSessionId || token(6))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24)

  return `customer+${safeId || token(6)}@glidecheckout.com`
}

function getSiteUrl(event) {
  const configured = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL
  if (configured) return configured.startsWith('http') ? configured : `https://${configured}`

  const host = event.headers.host || event.headers.Host
  if (host) {
    const protocol =
      host.includes('localhost') || host.startsWith('127.') || host.startsWith('[::1]')
        ? 'http'
        : 'https'
    return `${protocol}://${host}`
  }

  return null
}

function paystackSecretKey() {
  return String(process.env.PAYSTACK_SECRET_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

function distanceInMeters(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180
  const earthRadius = 6371000
  const latitudeDelta = toRadians(b.latitude - a.latitude)
  const longitudeDelta = toRadians(b.longitude - a.longitude)
  const latitudeA = toRadians(a.latitude)
  const latitudeB = toRadians(b.latitude)
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
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

async function ensureShopperSessionIsActive(supabase, shopperSessionId) {
  if (!shopperSessionId) return null

  const sessionResult = await supabase
    .from('shopper_sessions')
    .select('id,ended_at,expires_at,created_at')
    .eq('session_id', shopperSessionId)
    .maybeSingle()

  if (sessionResult.error) return null
  if (!sessionResult.data) return null

  if (sessionResult.data.ended_at) {
    throw new Error('This checkout session has ended. Scan the store QR again to start a new session.')
  }

  if (new Date(sessionResult.data.expires_at).getTime() <= Date.now()) {
    await supabase.from('shopper_sessions').delete().eq('session_id', shopperSessionId)
    throw new Error('This checkout session was idle for too long. Scan the store QR again to start a new session.')
  }

  return sessionResult.data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const { qrCode, cart, shopperSessionId, location, customerEmail, challengeEnabled, spendLimit } = JSON.parse(event.body || '{}')
    const cleanCustomerEmail = String(customerEmail || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanCustomerEmail)) return bad('Enter a valid email for your receipt.')
    const paymentEmail = cleanCustomerEmail || fallbackEmail(shopperSessionId)
    const secretKey = paystackSecretKey()

    if (!qrCode || !Array.isArray(cart) || cart.length === 0) {
      return bad('Cart is empty.')
    }

    if (!secretKey) {
      return bad('Paystack secret key is missing on the server.')
    }

    if (!secretKey.startsWith('sk_')) {
      return bad('Paystack secret key must be a secret key that starts with sk_.')
    }

    try {
      await ensureShopperSessionIsActive(supabase, shopperSessionId)
    } catch (sessionError) {
      return bad(sessionError.message)
    }

    const siteUrl = getSiteUrl(event)
    if (!siteUrl) {
      return bad('Could not determine the public site URL for Paystack callback.')
    }

    const qrResult = await supabase
      .from('qr_codes')
      .select('id,merchant_id,qr_code,is_active,merchant_profile(store_name,geofence_enabled,geofence_latitude,geofence_longitude,geofence_radius_meters)')
      .eq('qr_code', qrCode)
      .eq('is_active', true)
      .single()

    if (qrResult.error) return bad('Store QR is inactive.')

    const storeProfile = qrResult.data.merchant_profile
    if (storeProfile?.geofence_enabled) {
      const shopperLatitude = Number(location?.latitude)
      const shopperLongitude = Number(location?.longitude)
      const accuracy = Math.max(0, Number(location?.accuracy) || 0)
      const storeLatitude = Number(storeProfile.geofence_latitude)
      const storeLongitude = Number(storeProfile.geofence_longitude)

      if (![shopperLatitude, shopperLongitude, storeLatitude, storeLongitude].every(Number.isFinite)) {
        return bad('Location is required to shop at this store. Enable precise location and try again.')
      }

      const distance = distanceInMeters(
        { latitude: storeLatitude, longitude: storeLongitude },
        { latitude: shopperLatitude, longitude: shopperLongitude },
      )
      const allowedRadius = Number(storeProfile.geofence_radius_meters) || 150
      if (accuracy > 500) return bad('Your location is not accurate enough to verify this store. Enable precise location and try again.')
      if (distance - Math.min(accuracy, 250) > allowedRadius) {
        return bad(`You are outside this store's shopping area (${Math.round(distance)} m from the saved store point; ${allowedRadius} m allowed).`)
      }
    }

    const productIds = cart.map((item) => item.productId)
    const productsResult = await supabase
      .from('products')
      .select('*')
      .eq('merchant_id', qrResult.data.merchant_id)
      .in('id', productIds)

    if (productsResult.error) return bad(productsResult.error.message)

    const products = productsResult.data
    const items = []
    let total = 0

    for (const cartItem of cart) {
      const quantity = Number(cartItem.quantity)
      const product = products.find((item) => item.id === cartItem.productId)

      if (!product || !product.is_available) return bad('A product is unavailable.')
      if (product.is_restricted) return bad(`${product.name} requires cashier assistance and cannot be paid through self-checkout.`)
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

    if (total <= 0) return bad('Cart total must be greater than zero.')

    const receiptToken = token()
    const exitToken = receiptCode()
    const orderNumber = `G-${Date.now().toString().slice(-7)}`

    const orderResult = await supabase
      .from('orders')
      .insert({
        merchant_id: qrResult.data.merchant_id,
        qr_code_id: qrResult.data.id,
        order_number: orderNumber,
        shopper_session_id: shopperSessionId || null,
        status: 'pending_payment',
        payment_status: 'pending',
        total_amount: total,
        receipt_token: receiptToken,
        exit_token: exitToken,
        customer_email: cleanCustomerEmail,
        receipt_delivery_status: 'pending',
        spend_limit: Number(spendLimit) > 0 ? Number(spendLimit) : null,
        challenge_target: 15000,
        challenge_qualified: Boolean(challengeEnabled) && total >= 15000,
      })
      .select('*')
      .single()

    if (orderResult.error) return bad(orderResult.error.message)

    const shopperSession = await supabase.from('shopper_sessions').select('created_at').eq('session_id', shopperSessionId).maybeSingle()
    const checkoutDuration = shopperSession.data?.created_at
      ? Math.max(0, Math.round((Date.now() - new Date(shopperSession.data.created_at).getTime()) / 1000))
      : null
    if (checkoutDuration !== null) {
      await supabase.from('orders').update({ checkout_duration_seconds: checkoutDuration }).eq('id', orderResult.data.id)
    }
    await supabase.from('order_events').insert([
      { order_id: orderResult.data.id, merchant_id: qrResult.data.merchant_id, event_type: 'session_started', event_label: 'Store QR session started', details: { shopper_session_id: shopperSessionId } },
      { order_id: orderResult.data.id, merchant_id: qrResult.data.merchant_id, event_type: 'basket_confirmed', event_label: 'Basket confirmed', details: { item_count: items.reduce((sum, item) => sum + item.quantity, 0), total } },
      { order_id: orderResult.data.id, merchant_id: qrResult.data.merchant_id, event_type: 'payment_initiated', event_label: 'Paystack payment initiated', details: { reference: `pending` } },
    ])

    const orderItems = items.map((item) => ({ ...item, order_id: orderResult.data.id }))
    const itemResult = await supabase.from('order_items').insert(orderItems)
    if (itemResult.error) return bad(itemResult.error.message)

    const reference = `glide_${token(10)}`
    const callbackUrl = `${siteUrl}/pay/${receiptToken}`
    const paymentResult = await supabase
      .from('payments')
      .insert({
        merchant_id: qrResult.data.merchant_id,
        order_id: orderResult.data.id,
        provider: 'paystack',
        provider_reference: reference,
        status: 'pending',
        amount: total,
      })
      .select('*')
      .single()

    if (paymentResult.error) return bad(paymentResult.error.message)
    await supabase.from('order_events').update({ details: { reference } }).eq('order_id', orderResult.data.id).eq('event_type', 'payment_initiated')

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: paymentEmail,
        amount: Math.round(total * 100),
        reference,
        callback_url: callbackUrl,
        metadata: {
          order_id: orderResult.data.id,
          receipt_token: receiptToken,
          store_name: qrResult.data.merchant_profile?.store_name,
        },
      }),
    })

    const paystack = await parseProviderResponse(response)
    if (!response.ok || !paystack.status) {
      return bad(paystack.message || 'Payment could not start. Check your Paystack secret key and currency setup.')
    }

    return json(200, {
      authorizationUrl: paystack.data.authorization_url,
      receiptToken,
      reference,
    })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
