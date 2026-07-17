import { adminClient, json, requireMerchant, token } from './_supabase.js'

function bad(message) {
  return json(400, { error: message })
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const merchant = await requireMerchant(event, supabase)
    const { email, password, fullName } = JSON.parse(event.body || '{}')
    const cleanEmail = String(email || '').trim().toLowerCase()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return bad('Enter a valid cashier email address.')
    }

    if (!password || String(password).length < 6) {
      return bad('Password must be at least 6 characters.')
    }

    const existing = await supabase
      .from('staff_members')
      .select('id')
      .eq('merchant_id', merchant.id)
      .eq('email', cleanEmail)
      .maybeSingle()

    if (existing.data) return bad('This cashier already exists.')

    const userResult = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'cashier',
        merchant_id: merchant.id,
      },
    })

    if (userResult.error) return bad(userResult.error.message)

    const staffResult = await supabase
      .from('staff_members')
      .insert({
        merchant_id: merchant.id,
        user_id: userResult.data.user.id,
        email: cleanEmail,
        full_name: String(fullName || '').trim() || null,
        role: 'cashier',
        is_active: true,
        terminal_auth_code: token(5).toUpperCase(),
      })
      .select('*')
      .single()

    if (staffResult.error) return bad(staffResult.error.message)

    return json(200, { staff: staffResult.data })
  } catch (error) {
    return json(500, { error: error.message })
  }
}
