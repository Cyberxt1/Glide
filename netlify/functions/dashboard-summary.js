import { adminClient, json, requireMerchant } from './_supabase.js'

function startOfToday() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  try {
    const supabase = adminClient()
    const merchant = await requireMerchant(event, supabase)
    const { start, end } = startOfToday()
    await supabase.rpc('cancel_expired_pending_orders', { target_merchant_id: merchant.id })

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 6)
    weekStart.setHours(0, 0, 0, 0)

    const [products, todayOrders, pendingPaid, exited, recentOrders, paidItems, activeStaff, payments, feedback, signups] =
      await Promise.all([
        supabase
          .from('products')
          .select('id,name,quantity,low_stock_threshold,track_inventory')
          .eq('merchant_id', merchant.id),
        supabase
          .from('orders')
          .select('*')
          .eq('merchant_id', merchant.id)
          .eq('payment_status', 'paid')
          .gte('paid_at', start)
          .lt('paid_at', end),
        supabase
          .from('orders')
          .select('id')
          .eq('merchant_id', merchant.id)
          .eq('status', 'paid'),
        supabase
          .from('orders')
          .select('id')
          .eq('merchant_id', merchant.id)
          .eq('status', 'exited')
          .gte('exited_at', start)
          .lt('exited_at', end),
        supabase
          .from('orders')
          .select('*')
          .eq('merchant_id', merchant.id)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('order_items')
          .select('product_name,quantity,orders!inner(merchant_id,payment_status)')
          .eq('orders.merchant_id', merchant.id)
          .eq('orders.payment_status', 'paid'),
        supabase
          .from('staff_members')
          .select('id,full_name,email,role,last_seen_at,current_station,is_active')
          .eq('merchant_id', merchant.id)
          .eq('is_active', true),
        supabase
          .from('payments')
          .select('id,status,amount,provider,created_at,paid_at,orders(order_number)')
          .eq('merchant_id', merchant.id)
          .gte('created_at', weekStart.toISOString())
          .order('created_at', { ascending: false }),
        supabase
          .from('shopper_feedback')
          .select('rating,tags,created_at')
          .eq('merchant_id', merchant.id)
          .gte('created_at', weekStart.toISOString()),
        supabase
          .from('shopper_app_signups')
          .select('id,created_at')
          .eq('merchant_id', merchant.id)
          .gte('created_at', weekStart.toISOString()),
      ])

    const productRows = products.data || []
    const orderRows = todayOrders.data || []
    const todayRevenue = orderRows.reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
    const topMap = new Map()

    for (const item of paidItems.data || []) {
      topMap.set(item.product_name, (topMap.get(item.product_name) || 0) + item.quantity)
    }

    const topProducts = [...topMap.entries()]
      .map(([name, quantity_sold]) => ({ name, quantity_sold }))
      .sort((a, b) => b.quantity_sold - a.quantity_sold)
      .slice(0, 5)
    const paymentRows = payments.data || []
    const feedbackRows = feedback.data || []
    const paidPayments = paymentRows.filter((payment) => payment.status === 'paid')
    const paymentVolume = paidPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)

    return json(200, {
      storeName: merchant.store_name,
      branchName: merchant.branch_name,
      totalProducts: productRows.length,
      lowStockCount: productRows.filter(
        (product) =>
          product.track_inventory && product.quantity <= product.low_stock_threshold,
      ).length,
      todayPaidOrders: orderRows.length,
      todayRevenue,
      pendingPaidOrders: pendingPaid.data?.length || 0,
      completedExits: exited.data?.length || 0,
      averageOrderValue: orderRows.length ? todayRevenue / orderRows.length : 0,
      recentOrders: recentOrders.data || [],
      topProducts,
      paymentSummary: {
        paid: paidPayments.length,
        pending: paymentRows.filter((payment) => payment.status === 'pending').length,
        failed: paymentRows.filter((payment) => payment.status === 'failed').length,
        volume: paymentVolume,
        successRate: paymentRows.length ? Math.round((paidPayments.length / paymentRows.length) * 100) : 0,
      },
      recentPayments: paymentRows.slice(0, 5),
      customerInsights: {
        feedbackCount: feedbackRows.length,
        averageRating: feedbackRows.length
          ? feedbackRows.reduce((sum, entry) => sum + Number(entry.rating), 0) / feedbackRows.length
          : 0,
        earlyAccessSignups: signups.data?.length || 0,
      },
      activeStaff: (activeStaff.data || []).map((member) => ({
        ...member,
        is_online: member.last_seen_at
          ? Date.now() - new Date(member.last_seen_at).getTime() < 2 * 60 * 1000
          : false,
      })),
    })
  } catch (error) {
    return json(401, { error: error.message })
  }
}
