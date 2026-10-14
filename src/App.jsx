import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import QRCode from 'qrcode'
import './App.css'
import glideLogo from './assets/logo.png'
import { SESSION_EXPIRED_MESSAGE, callFunction } from './lib/api'
import { formatDateTime, formatMoney } from './lib/format'
import { getConfigMessage, isSupabaseConfigured, supabase } from './lib/supabase'

const productColumns =
  'id,name,barcode,sku,category,price,quantity,low_stock_threshold,is_available,track_inventory,size,unit_label,pack_label,units_per_pack,pack_price,entry_mode,is_restricted,requires_quantity_entry,created_at'

const emptyProduct = {
  name: '',
  barcode: '',
  sku: '',
  category: '',
  price: '',
  quantity: '',
  low_stock_threshold: '5',
  unit_label: 'piece',
  pack_label: '',
  units_per_pack: '1',
  pack_price: '',
  is_available: true,
  track_inventory: true,
  size: '',
  entry_mode: 'barcode',
  is_restricted: false,
  requires_quantity_entry: false,
}

const SHOPPER_IDLE_TIMEOUT_MS = 20 * 60 * 1000
const SESSION_ACTIVITY_WRITE_MS = 15 * 1000

function distanceInMeters(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180
  const earthRadius = 6371000
  const latitudeDelta = toRadians(b.latitude - a.latitude)
  const longitudeDelta = toRadians(b.longitude - a.longitude)
  const latitudeA = toRadians(a.latitude)
  const latitudeB = toRadians(b.latitude)
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return path
}

function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new Event('popstate'))
}

function Link({ href, children, className }) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (href.startsWith('/')) {
          event.preventDefault()
          navigate(href)
        }
      }}
    >
      {children}
    </a>
  )
}

function useRealtimeRefresh(channelName, tables, onRefresh, enabled = true) {
  const refreshRef = useRef(onRefresh)
  const tablesKey = tables.join('|')
  const tableList = useMemo(() => tablesKey.split('|').filter(Boolean), [tablesKey])

  useEffect(() => {
    refreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!supabase || !enabled || !tableList.length) return undefined

    let refreshTimer = null
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshRef.current?.()
      }, 250)
    }

    const channel = supabase.channel(channelName)
    for (const table of tableList) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleRefresh,
      )
    }
    channel.subscribe()

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      supabase.removeChannel(channel)
    }
  }, [channelName, enabled, tableList])
}

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

function Notice({ children, tone = 'neutral' }) {
  return <div className={`notice ${tone}`}>{children}</div>
}

function ConfirmDialog({ dialog, onCancel, onConfirm }) {
  if (!dialog) return null
  return (
    <div className="app-dialog-backdrop" role="presentation">
      <section className="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <span className="app-dialog-mark" aria-hidden="true">!</span>
        <p className="eyebrow">Please confirm</p>
        <h2 id="app-dialog-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        <div className="app-dialog-actions">
          <button type="button" onClick={onCancel}>{dialog.cancelLabel || 'Keep shopping'}</button>
          <button className="danger" type="button" onClick={onConfirm}>{dialog.confirmLabel || 'Continue'}</button>
        </div>
      </section>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="skeleton-stack" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  )
}

function App() {
  const path = usePath()
  const [session, setSession] = useState(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setSessionLoaded(true)
      return undefined
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  if (path === '/') return <Landing />
  if (path === '/login') return <Login />
  if (path === '/signup') return <Signup />
  if (path === '/setup-store') {
    if (!sessionLoaded) return <main className="auth-page"><LoadingRows /></main>
    if (!session) return <Login />
    return <StoreSetup session={session} />
  }

  if (path.startsWith('/admin')) {
    if (!sessionLoaded) return <main className="auth-page"><LoadingRows /></main>
    if (!session) return <AdminLogin />
    return <AdminGate session={session} />
  }

  if (path === '/cashier') {
    if (!sessionLoaded) return <main className="auth-page"><LoadingRows /></main>
    if (!session) return <Login />
    return <CashierPage session={session} />
  }

  if (path === '/shopper-terminal' || path === '/security') {
    if (!sessionLoaded) return <main className="auth-page"><LoadingRows /></main>
    if (!session) return <Login />
    return <ShopperTerminal session={session} />
  }

  const smartAddMatch = path.match(/^\/smart-add\/([^/]+)$/)
  if (smartAddMatch) return <SmartAddPhone token={smartAddMatch[1]} />

  const productIntakeMatch = path.match(/^\/product-intake\/([^/]+)$/)
  if (productIntakeMatch) return <ProductIntakePhone token={productIntakeMatch[1]} />

  const qrMatch = path.match(/^\/s\/([^/]+)$/)
  if (qrMatch) return <CustomerCheckout qrCode={qrMatch[1]} />

  const payMatch = path.match(/^\/pay\/([^/]+)$/)
  if (payMatch) return <PaymentReturn receiptToken={payMatch[1]} />

  const receiptMatch = path.match(/^\/receipt\/([^/]+)$/)
  if (receiptMatch) return <ReceiptPage token={receiptMatch[1]} />

  if (path === '/shopper') return <ShopperSessionEnded />

  const shopperMatch = path.match(/^\/shopper\/([^/]+)$/)
  if (shopperMatch) return <ShopperLanding receiptToken={shopperMatch[1]} />

  if (path.startsWith('/dash')) {
    if (!sessionLoaded) return <AppShell session={session} main={<LoadingRows />} />
    if (!session) return <Login />
    return <MerchantDashboardRoute path={path} session={session} />
  }

  return <NotFound />
}

function Landing() {
  useEffect(() => {
    const animatedItems = document.querySelectorAll('.reveal-pop')

    if (!animatedItems.length) return undefined

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      animatedItems.forEach((item) => item.classList.add('is-visible'))
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.18 },
    )

    animatedItems.forEach((item) => observer.observe(item))

    return () => observer.disconnect()
  }, [])

  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="brand landing-brand" href="/">
          Glide
        </Link>
        <div className="landing-nav-links">
          <a href="#workflow">Workflow</a>
          <a href="#why-glide">Why Glide</a>
          <a href="#start">Start</a>
        </div>
        <div className="landing-nav-actions">
          <Link className="secondary-action" href="/login">
            Login
          </Link>
          <Link className="primary-action nav-signup-action" href="/signup">
            Start Free
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy reveal-pop">
          {/* <p className="eyebrow">Retail operating system</p> */}
          <h1>
            The checkout <span className="hero-accent">experience</span> customers actually want.
          </h1>
          <p className="lead">Manage inventory, payments, self-checkout and store operations from one platform.</p>
          <div className="action-row">
            <Link className="primary-action" href="/signup">
              Start Free
            </Link>
            <Link className="secondary-action" href="/login">
              Login
            </Link>
          </div>
        </div>
        <div className="landing-hero-mark reveal-pop" aria-hidden="true">
          <img alt="" src={glideLogo} />
          <span className="logo-badge logo-badge-one">Scan</span>
          <span className="logo-badge logo-badge-two">Pay</span>
          <span className="logo-badge logo-badge-three">Done</span>
        </div>
      </section>

      <section className="landing-ribbon reveal-pop">
        Built for supermarkets, pharmacies, convenience stores and modern retailers.
      </section>

      <section className="landing-workflow reveal-pop" id="workflow">
        <p className="eyebrow">One workflow</p>
        <h2>Every part of your store, connected.</h2>
        <div className="workflow-track" aria-label="Glide workflow">
          <span className="reveal-pop" style={{ '--reveal-delay': '80ms' }}>Inventory</span>
          <span className="reveal-pop" style={{ '--reveal-delay': '130ms' }}>Products</span>
          <span className="reveal-pop" style={{ '--reveal-delay': '180ms' }}>QR Checkout</span>
          <span className="reveal-pop" style={{ '--reveal-delay': '230ms' }}>Payments</span>
          <span className="reveal-pop" style={{ '--reveal-delay': '280ms' }}>Orders</span>
          <span className="reveal-pop" style={{ '--reveal-delay': '330ms' }}>Receipts</span>
        </div>
      </section>

      <section className="landing-sticky-story reveal-pop" id="why-glide">
        <div className="sticky-copy reveal-pop">
          <p className="eyebrow">Why Glide</p>
          <h2>You need</h2>
        </div>
        <div className="sticky-list">
          <article className="reveal-pop">
            <span>01</span>
            <h3>Modern checkout.</h3>
          </article>
          <article className="reveal-pop">
            <span>02</span>
            <h3>Live inventory.</h3>
          </article>
          <article className="reveal-pop">
            <span>03</span>
            <h3>Fast payments.</h3>
          </article>
          <article className="reveal-pop">
            <span>04</span>
            <h3>Digital receipts.</h3>
          </article>
          <article className="reveal-pop">
            <span>05</span>
            <h3>Store analytics.</h3>
          </article>
          <article className="reveal-pop">
            <span>06</span>
            <h3>Built for physical retail.</h3>
          </article>
        </div>
      </section>

      <section className="landing-audiences reveal-pop">
        <div className="reveal-pop">
          <p className="eyebrow">For merchants</p>
          <h2>Own the store.</h2>
          <ul>
            <li>Manage products</li>
            <li>Track inventory</li>
            <li>Monitor orders</li>
          </ul>
        </div>
        <div className="reveal-pop">
          <p className="eyebrow">For customers</p>
          <h2>Move faster.</h2>
          <ul>
            <li>Scan QR</li>
            <li>Shop</li>
            <li>Pay</li>
          </ul>
        </div>
      </section>

      <section className="landing-close reveal-pop" id="start">
        <h2>Optimize your store with Glide.</h2>
        <p>Your store is not the products, but your customers.</p>
        <Link className="primary-action" href="/signup">
          Start Free
        </Link>
      </section>

      <footer className="landing-footer">
        <Link className="brand landing-brand" href="/">
          Glide
        </Link>
        <div>
          <Link href="/dash">Product</Link>
          <a href="/docs">Documentation</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="mailto:hello@useglide.app">Contact</a>
        </div>
        <span>© {new Date().getFullYear()} Glide</span>
      </footer>
    </main>
  )
}

async function getUserHomePath() {
  const sessionResult = await supabase.auth.getSession()
  const userId = sessionResult.data.session?.user?.id
  if (!userId) return '/login'

  const merchant = await supabase
    .from('merchant_profile')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (merchant.data) return '/dash'

  const staff = await supabase
    .from('staff_members')
    .select('id,role,is_active')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (staff.data?.role === 'security') return '/shopper-terminal'
  if (staff.data?.role === 'cashier') return '/cashier'

  return '/setup-store'
}

const emptyGlobalProduct = {
  id: '',
  barcode: '',
  name: '',
  category: '',
  size: '',
  label_text: '',
  is_hidden: false,
}

const productCategories = [
  'Drinks',
  'Beverages',
  'Snacks',
  'Groceries',
  'Pharmacy',
  'Personal care',
  'Household',
  'Fresh food',
  'Frozen food',
  'Bakery',
  'Baby products',
  'Beauty',
  'Stationery',
  'Electronics',
  'Pet supplies',
  'General',
]

function AdminGate({ session }) {
  const [state, setState] = useState({ loading: true, admin: null, error: '' })

  useEffect(() => {
    let active = true

    async function verifyAdmin() {
      try {
        const result = await callFunction('platform-admin', { action: 'verify' })
        if (active) setState({ loading: false, admin: result.admin, error: '' })
      } catch (error) {
        await supabase.auth.signOut()
        if (active) setState({ loading: false, admin: null, error: error.message })
      }
    }

    verifyAdmin()
    return () => {
      active = false
    }
  }, [])

  if (state.loading) {
    return (
      <main className="auth-page admin-auth-page">
        <section className="auth-panel admin-auth-panel">
          <p className="eyebrow">Securing console</p>
          <h1>Checking admin access</h1>
          <LoadingRows />
        </section>
      </main>
    )
  }

  if (!state.admin) {
    return (
      <main className="auth-page admin-auth-page">
        <section className="auth-panel admin-auth-panel">
          <Link className="brand" href="/">
            Glide Admin
          </Link>
          <p className="eyebrow">Access denied</p>
          <h1>Platform admins only.</h1>
          <Notice tone="error">{state.error || 'Your account is not allowed to open this console.'}</Notice>
          <Link className="primary-action" href="/login">
            Go to merchant login
          </Link>
        </section>
      </main>
    )
  }

  return <PlatformAdminDashboard admin={state.admin} session={session} />
}

function PlatformAdminDashboard({ admin, session }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [products, setProducts] = useState([])
  const [productStats, setProductStats] = useState({ total: 0, visible: 0, hidden: 0, categories: [] })
  const [productLinks, setProductLinks] = useState([])
  const [merchants, setMerchants] = useState([])
  const [staff, setStaff] = useState([])
  const [orders, setOrders] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [systemLogs, setSystemLogs] = useState([])
  const [customerInsights, setCustomerInsights] = useState({ feedback: [], interest: [] })
  const [query, setQuery] = useState('')
  const [showHiddenProducts, setShowHiddenProducts] = useState(false)
  const [productForm, setProductForm] = useState(emptyGlobalProduct)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [merchantForm, setMerchantForm] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadAdmin = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const [summaryResult, productResult, merchantResult] = await Promise.all([
        callFunction('platform-admin', { action: 'summary' }),
        callFunction('platform-admin', {
          action: 'list-products',
          query: { term: query, hiddenOnly: showHiddenProducts },
        }),
        callFunction('platform-admin', { action: 'list-merchants' }),
      ])

      setSummary(summaryResult.summary)
      setProducts(productResult.products || [])
      setProductStats(productResult.productStats || { total: 0, visible: 0, hidden: 0, categories: [] })
      setMerchants(merchantResult.merchants || [])
      if (summaryResult.admin?.email && summaryResult.admin.email !== admin.email) {
        setMessage('Admin session refreshed.')
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }, [admin.email, query, showHiddenProducts])

  useEffect(() => {
    loadAdmin()
    loadProductLinks()
  }, [loadAdmin])

  useRealtimeRefresh(
    'platform-admin-live',
    ['global_products', 'merchant_profile', 'products', 'orders', 'payments', 'verification_records', 'order_events', 'smart_add_items'],
    loadAdmin,
  )

  async function searchProducts(event) {
    event.preventDefault()
    await loadAdmin()
  }

  async function loadStaff() {
    setLoading(true)
    setMessage('')
    try {
      const result = await callFunction('platform-admin', { action: 'list-staff' })
      setStaff(result.staff || [])
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadOrders() {
    setLoading(true)
    setMessage('')
    try {
      const result = await callFunction('platform-admin', { action: 'list-orders' })
      setOrders(result.orders || [])
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadAudit() {
    setLoading(true)
    setMessage('')
    try {
      const result = await callFunction('platform-admin', { action: 'list-audit' })
      setAuditLogs(result.auditLogs || [])
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadCustomerInsights() {
    setLoading(true)
    try {
      const result = await callFunction('platform-admin', { action: 'list-customer-insights' })
      setCustomerInsights({ feedback: result.feedback || [], interest: result.interest || [] })
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function loadSystemLogs() {
    setLoading(true)
    try {
      const result = await callFunction('platform-admin', { action: 'list-system-logs' })
      setSystemLogs(result.logs || [])
    } catch (error) { setMessage(error.message) } finally { setLoading(false) }
  }

  async function reviewStore(merchant, decision) {
    const note = decision === 'approved' ? '' : 'Please verify your store information and geofence, then contact Glide support for another review.'
    try {
      const result = await callFunction('platform-admin', { action: 'review-merchant', id: merchant.id, decision, note })
      setMerchants((current) => current.map((item) => item.id === merchant.id ? { ...item, ...result.merchant } : item))
      setMessage(`${merchant.store_name} ${decision}.`)
      await loadAdmin()
    } catch (error) { setMessage(error.message) }
  }

  function openMerchantEdit(merchant) {
    setMerchantForm({
      id: merchant.id,
      store_name: merchant.store_name || '',
      branch_name: merchant.branch_name || '',
    })
  }

  function updateMerchantForm(field, value) {
    setMerchantForm((current) => ({ ...current, [field]: value }))
  }

  async function saveMerchant(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const result = await callFunction('platform-admin', {
        action: 'update-merchant',
        merchant: merchantForm,
      })
      setMerchants((current) =>
        current.map((merchant) =>
          merchant.id === result.merchant.id ? { ...merchant, ...result.merchant } : merchant,
        ),
      )
      setMerchantForm(null)
      setMessage('Store profile updated.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function setStaffActive(member, isActive) {
    try {
      const result = await callFunction('platform-admin', {
        action: 'set-staff-active',
        id: member.id,
        isActive,
      })
      setStaff((current) =>
        current.map((item) => (item.id === result.staff.id ? result.staff : item)),
      )
      setMessage(`${result.staff.email} ${result.staff.is_active ? 'enabled' : 'disabled'}.`)
    } catch (error) {
      setMessage(error.message)
    }
  }

  function changeTab(tab) {
    setActiveTab(tab)
    if (tab === 'overview' || tab === 'products' || tab === 'merchants') loadAdmin()
    if (tab === 'products') loadProductLinks()
    if (tab === 'visible-products') {
      setShowHiddenProducts(false)
      if (showHiddenProducts === false) loadAdmin()
    }
    if (tab === 'hidden-products') {
      setShowHiddenProducts(true)
      if (showHiddenProducts === true) loadAdmin()
    }
    if (tab === 'staff') loadStaff()
    if (tab === 'orders' || tab === 'reconciliation' || tab === 'mismatches') loadOrders()
    if (tab === 'audit') loadAudit()
    if (tab === 'customers') loadCustomerInsights()
    if (tab === 'system') loadSystemLogs()
  }

  function editProduct(product) {
    setProductForm({
      id: product.id || '',
      barcode: product.barcode || '',
      name: product.name || '',
      category: product.category || '',
      size: product.size || '',
      label_text: product.label_text || '',
      is_hidden: Boolean(product.is_hidden),
    })
    setSelectedProduct(product)
  }

  function updateProductForm(field, value) {
    setProductForm((current) => ({ ...current, [field]: value }))
  }

  async function saveGlobalProduct(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const result = await callFunction('platform-admin', {
        action: 'save-product',
        product: productForm,
      })
      setProductForm({
        id: result.product.id || '',
        barcode: result.product.barcode || '',
        name: result.product.name || '',
        category: result.product.category || '',
        size: result.product.size || '',
        label_text: result.product.label_text || '',
        is_hidden: Boolean(result.product.is_hidden),
      })
      setProducts((current) => {
        const exists = current.some((item) => item.id === result.product.id)
        return exists
          ? current.map((item) => (item.id === result.product.id ? result.product : item))
          : [result.product, ...current]
      })
      setSelectedProduct(result.product)
      setMessage('Product database updated.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteGlobalProduct(product) {
    const confirmed = window.confirm(`Permanently delete ${product.name} from the master product database? Hiding is safer for normal cleanup.`)
    if (!confirmed) return

    try {
      await callFunction('platform-admin', { action: 'delete-product', id: product.id })
      setProducts((current) => current.filter((item) => item.id !== product.id))
      setMessage('Product removed from database.')
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function createProductIntakeLink() {
    setSaving(true)
    setMessage('')
    try {
      const result = await callFunction('platform-admin', { action: 'create-product-intake-link' })
      setProductLinks((current) => [result.link, ...current])
      await navigator.clipboard?.writeText(result.link.url)
      setMessage('Product scan link created and copied.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function loadProductLinks() {
    try {
      const result = await callFunction('platform-admin', { action: 'list-product-intake-links' })
      setProductLinks(result.links || [])
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function setProductHidden(product, isHidden) {
    try {
      const result = await callFunction('platform-admin', {
        action: 'set-product-hidden',
        id: product.id,
        isHidden,
      })
      setProducts((current) =>
        showHiddenProducts
          ? current.map((item) => (item.id === result.product.id ? result.product : item))
          : current.filter((item) => item.id !== result.product.id),
      )
      setSelectedProduct(null)
      setProductForm(emptyGlobalProduct)
      await loadAdmin()
      setMessage(`${result.product.name} ${result.product.is_hidden ? 'hidden' : 'restored'}.`)
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const pendingStores = merchants.filter((merchant) => merchant.onboarding_status === 'pending')
  const maxTrendRevenue = Math.max(1, ...(summary?.dailyTrend || []).map((day) => Number(day.revenue || 0)))
  const percentChange = (current = 0, previous = 0) => previous ? Math.round(((current - previous) / previous) * 100) : current ? 100 : 0
  const sectionTitles = {
    overview: ['Command center', 'Live operating view across every Glide store.'],
    merchants: ['Store network', 'Approve locations, inspect performance and manage store access.'],
    customers: ['Shopper voice', 'Feedback and customer interest, attributed to the store visit.'],
    system: ['System events', 'Receipt delivery, onboarding and platform signals.'],
    orders: ['Order ledger', 'Trace every order, payment, verification and receipt delivery.'],
    reconciliation: ['Payment reconciliation', 'Surface interrupted, pending and failed payment journeys for follow-up.'],
    mismatches: ['Verification exceptions', 'Review basket mismatches, evidence and recovered balances across stores.'],
    staff: ['Network access', 'Manage staff identities and store roles.'],
    audit: ['Control audit', 'A permanent trail of platform-admin decisions.'],
  }
  const [sectionTitle, sectionSubtitle] = sectionTitles[activeTab] || ['Product intelligence', 'Operate Glide’s shared product network.']

  return (
    <main className="admin-console">
      <aside className="admin-sidebar">
        <div className="admin-brand-lockup"><Link className="brand" href="/admin">Glide</Link><span>Control</span></div>
        <div className="admin-identity"><span>GA</span><div><strong>Platform admin</strong><small>{admin.email || session.user.email}</small></div></div>
        <p className="admin-nav-label">Operate</p>
        <nav>
          <button className={activeTab === 'overview' ? 'active' : ''} type="button" onClick={() => changeTab('overview')}>
            Overview
          </button>
          <button className={activeTab === 'products' ? 'active' : ''} type="button" onClick={() => changeTab('products')}>
            Product database
          </button>
          <button className={activeTab === 'visible-products' ? 'active' : ''} type="button" onClick={() => changeTab('visible-products')}>
            Visible products
          </button>
          <button className={activeTab === 'hidden-products' ? 'active' : ''} type="button" onClick={() => changeTab('hidden-products')}>
            Hidden products
          </button>
          <button className={activeTab === 'merchants' ? 'active' : ''} type="button" onClick={() => changeTab('merchants')}>
            Stores
          </button>
          <button className={activeTab === 'customers' ? 'active' : ''} type="button" onClick={() => changeTab('customers')}>
            Shopper voice
          </button>
          <button className={activeTab === 'system' ? 'active' : ''} type="button" onClick={() => changeTab('system')}>
            System events
          </button>
          <button className={activeTab === 'staff' ? 'active' : ''} type="button" onClick={() => changeTab('staff')}>
            Staff
          </button>
          <button className={activeTab === 'orders' ? 'active' : ''} type="button" onClick={() => changeTab('orders')}>
            Orders
          </button>
          <button className={activeTab === 'reconciliation' ? 'active' : ''} type="button" onClick={() => changeTab('reconciliation')}>Reconciliation</button>
          <button className={activeTab === 'mismatches' ? 'active' : ''} type="button" onClick={() => changeTab('mismatches')}>Mismatches</button>
          <button className={activeTab === 'audit' ? 'active' : ''} type="button" onClick={() => changeTab('audit')}>
            Audit
          </button>
        </nav>
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </aside>

      <section className="admin-main">
        <header className="admin-page-head"><div><p className="eyebrow">Glide network · {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1>{sectionTitle}</h1><p>{sectionSubtitle}</p></div><div className="admin-head-actions"><span className="live-indicator"><i />Live</span><button type="button" onClick={loadAdmin}>Refresh data</button></div></header>
        {message ? <Notice tone={message.includes('updated') || message.includes('removed') ? 'success' : 'warning'}>{message}</Notice> : null}
        {loading && !summary ? <LoadingRows /> : null}

        {activeTab === 'overview' ? (
          <section className="control-overview">
            <div className="control-kpis">
              <article className="primary"><span>Gross network volume</span><strong>{formatMoney(summary?.totalRevenue || 0)}</strong><small>{summary?.paidOrderCount || 0} successful orders all time</small></article>
              <article><span>Today’s volume</span><strong>{formatMoney(summary?.today?.revenue || 0)}</strong><small className={percentChange(summary?.today?.revenue, summary?.yesterday?.revenue) >= 0 ? 'up' : 'down'}>{percentChange(summary?.today?.revenue, summary?.yesterday?.revenue) >= 0 ? '↑' : '↓'} {Math.abs(percentChange(summary?.today?.revenue, summary?.yesterday?.revenue))}% vs yesterday</small></article>
              <article><span>Orders today</span><strong>{summary?.today?.orders || 0}</strong><small>{summary?.today?.paidOrders || 0} paid successfully</small></article>
              <article><span>Active stores</span><strong>{summary?.approvedStoreCount || 0}</strong><small>{summary?.geofencedStoreCount || 0} protected by geofence</small></article>
            </div>

            <div className="control-priority-grid">
              <section className="control-chart-card"><header><div><span>Network performance</span><h2>Revenue · last 14 days</h2></div><button type="button" onClick={() => changeTab('orders')}>View ledger</button></header>
                <div className="revenue-chart" aria-label="Fourteen day revenue chart">{(summary?.dailyTrend || []).map((day, index) => <div className="revenue-bar" key={day.date}><span style={{ height: `${Math.max(4, (Number(day.revenue || 0) / maxTrendRevenue) * 100)}%` }}><i>{formatMoney(day.revenue)}</i></span>{index % 2 === 0 || index === 13 ? <small>{day.label}</small> : <small />}</div>)}</div>
              </section>

              <section className="action-queue-card"><header><div><span>Action queue</span><h2>{pendingStores.length} store{pendingStores.length === 1 ? '' : 's'} need review</h2></div><b>{pendingStores.length}</b></header>
                {pendingStores.length ? <div className="approval-queue">{pendingStores.slice(0, 4).map((store) => <article key={store.id}><div className="store-avatar">{store.store_name?.charAt(0)}</div><div><strong>{store.store_name}</strong><small>{store.branch_name} · {store.geofence_radius_meters || 150} m zone</small></div><button type="button" onClick={() => changeTab('merchants')}>Review</button></article>)}</div> : <div className="queue-clear"><span>✓</span><strong>Queue clear</strong><small>No onboarding decisions are waiting.</small></div>}
                <button className="queue-footer" type="button" onClick={() => changeTab('merchants')}>Open store approvals →</button>
              </section>
            </div>

            <div className="control-detail-grid">
              <section className="network-health-card"><header><div><span>Platform health</span><h2>Operational signals</h2></div><span className={summary?.receiptFailureCount ? 'health-warning' : 'health-good'}>{summary?.receiptFailureCount ? 'Attention' : 'Healthy'}</span></header><div className="health-list"><div><span>Receipt delivery</span><strong>{summary?.receiptFailureCount || 0} failed</strong></div><div><span>Shopper rating</span><strong>{Number(summary?.averageRating || 0).toFixed(1)} / 5</strong></div><div><span>Feedback · 14 days</span><strong>{summary?.feedbackCount || 0}</strong></div><div><span>New shopper interest</span><strong>{summary?.interestCount || 0}</strong></div></div></section>

              <section className="top-stores-card"><header><div><span>Store performance</span><h2>Network leaders</h2></div><button type="button" onClick={() => changeTab('merchants')}>All stores</button></header>{summary?.storePerformance?.length ? <div className="store-ranking">{summary.storePerformance.map((store, index) => <article key={store.id}><b>{String(index + 1).padStart(2, '0')}</b><div><strong>{store.store_name}</strong><small>{store.paid_orders} paid orders</small></div><span>{formatMoney(store.revenue)}</span></article>)}</div> : <EmptyState>No store performance yet.</EmptyState>}</section>

              <section className="activity-card"><header><div><span>Live activity</span><h2>Latest network events</h2></div><button type="button" onClick={() => changeTab('system')}>Event log</button></header>{summary?.recentEvents?.length ? <div className="activity-list">{summary.recentEvents.map((event) => <article key={event.id}><i className={event.severity} /><div><strong>{event.message}</strong><small>{event.merchant_profile?.store_name || 'Platform'} · {formatDateTime(event.created_at)}</small></div></article>)}</div> : <EmptyState>No platform events yet.</EmptyState>}</section>
            </div>
          </section>
        ) : null}

        {activeTab === 'products' ? (
          <section className="dash-section">
            <div className="database-hero">
              <div>
                <p className="eyebrow">Master product database</p>
                <h2>Scan products into the large database.</h2>
                <p>
                  Generate a mobile scan link. Contributors scan barcodes, enter product details,
                  and duplicates are blocked before save.
                </p>
              </div>
              <button disabled={saving} type="button" onClick={createProductIntakeLink}>
                {saving ? 'Creating...' : 'Generate scan link'}
              </button>
            </div>

            <div className="metric-grid">
              <Metric label="Total products" value={productStats.total || 0} />
              <Metric label="Visible products" value={productStats.visible || 0} />
              <Metric label="Hidden products" value={productStats.hidden || 0} />
              <Metric label="Categories" value={productStats.categories?.length || 0} />
            </div>

            <TwoColumn>
              <Panel title="Recent scan links">
                {productLinks.length ? (
                  <div className="smart-link-list">
                    {productLinks.slice(0, 4).map((link) => (
                      <div key={link.id}>
                        <strong>{link.is_active ? 'Active scan link' : 'Expired scan link'}</strong>
                        <span>{link.completed_count} products submitted</span>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(link.url)}>
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState>No scan links yet.</EmptyState>
                )}
              </Panel>
              <Panel title="Categories">
                {productStats.categories?.length ? (
                  <div className="category-chip-list">
                    {productStats.categories.map((category) => (
                      <span key={category.name}>
                        {category.name} <b>{category.count}</b>
                      </span>
                    ))}
                  </div>
                ) : (
                  <EmptyState>No categories yet.</EmptyState>
                )}
              </Panel>
            </TwoColumn>
          </section>
        ) : null}

        {activeTab === 'visible-products' || activeTab === 'hidden-products' ? (
          <section className="admin-grid admin-store-grid">
            <section className="panel">
              <div className="modal-title-row">
                <h2>{activeTab === 'hidden-products' ? 'Hidden products' : 'Visible products'}</h2>
                <StatusPill tone={activeTab === 'hidden-products' ? 'neutral' : 'success'}>
                  {products.length} shown
                </StatusPill>
              </div>
              <form className="toolbar" onSubmit={searchProducts}>
                <input
                  placeholder="Search name, barcode or category"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button type="submit">Search</button>
              </form>
              {products.length ? (
                <div className="table-wrap compact-table admin-products-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Barcode</th>
                        <th>Category</th>
                        <th>Size</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product) => (
                        <tr
                          className="clickable-row"
                          key={product.id}
                          onClick={() => editProduct(product)}
                        >
                          <td>{product.name}</td>
                          <td className="sku-cell">{product.barcode}</td>
                          <td>{product.category || 'General'}</td>
                          <td>{product.size || 'Not set'}</td>
                          <td>
                            <StatusPill tone={product.is_hidden ? 'neutral' : 'success'}>
                              {product.is_hidden ? 'Hidden' : 'Visible'}
                            </StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState>No products found.</EmptyState>
              )}
            </section>

            <form className="product-form" onSubmit={saveGlobalProduct}>
              <h2>{selectedProduct ? 'Edit product' : 'Select a product'}</h2>
              {selectedProduct ? (
                <>
                  <label>
                    Barcode
                    <input readOnly value={productForm.barcode} />
                  </label>
                  <label>
                    Product name
                    <input
                      required
                      value={productForm.name}
                      onChange={(event) => {
                        updateProductForm('name', event.target.value)
                        if (!productForm.category) {
                          updateProductForm('category', smartCategoryFromText(event.target.value))
                        }
                      }}
                    />
                  </label>
                  <CategoryPicker
                    open={categoryMenuOpen}
                    value={productForm.category}
                    onOpenChange={setCategoryMenuOpen}
                    onChange={(value) => updateProductForm('category', value)}
                  />
                  <label>
                    Size
                    <input value={productForm.size} onChange={(event) => updateProductForm('size', event.target.value)} />
                  </label>
                  <label>
                    Notes / label text
                    <textarea value={productForm.label_text} onChange={(event) => updateProductForm('label_text', event.target.value)} />
                  </label>
                  <div className="action-row">
                    <button disabled={saving} type="submit">
                      {saving ? 'Saving...' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => setProductHidden(selectedProduct, !selectedProduct.is_hidden)}>
                      {selectedProduct.is_hidden ? 'Restore' : 'Hide'}
                    </button>
                    <button type="button" onClick={() => deleteGlobalProduct(selectedProduct)}>
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <EmptyState>Click a product row to edit, hide, restore or delete it.</EmptyState>
              )}
            </form>
          </section>
        ) : null}

        {activeTab === 'merchants' ? (
          <section className="admin-grid admin-store-grid">
            <section className="geofence-review-board">
              <header><div><p className="eyebrow">Onboarding queue</p><h2>Geofence requests</h2><p>Confirm the submitted shopping zone before activating a store.</p></div><StatusPill tone={pendingStores.length ? 'warning' : 'success'}>{pendingStores.length} waiting</StatusPill></header>
              {pendingStores.length ? <div className="geofence-request-list">{pendingStores.map((merchant) => <article key={merchant.id}><div className="store-avatar">{merchant.store_name?.charAt(0)}</div><div className="geofence-request-copy"><strong>{merchant.store_name}</strong><span>{merchant.branch_name} · {merchant.owner_email}</span><small>Submitted {formatDateTime(merchant.onboarding_submitted_at || merchant.created_at)}</small></div><div className="geofence-request-facts"><span>Radius<strong>{merchant.geofence_radius_meters || 150} m</strong></span><span>Coordinates<strong>{Number(merchant.geofence_latitude).toFixed(5)}, {Number(merchant.geofence_longitude).toFixed(5)}</strong></span></div><div className="geofence-request-actions"><a href={`https://www.google.com/maps?q=${merchant.geofence_latitude},${merchant.geofence_longitude}`} target="_blank" rel="noreferrer">Inspect map</a><button type="button" onClick={() => reviewStore(merchant, 'rejected')}>Request changes</button><button className="approve" type="button" onClick={() => reviewStore(merchant, 'approved')}>Approve store</button></div></article>)}</div> : <div className="queue-clear"><span>✓</span><strong>All geofence requests reviewed</strong><small>New submissions will appear here automatically.</small></div>}
            </section>
            <section className="panel">
              <h2>Stores on Glide</h2>
              {merchants.length ? (
                <div className="table-wrap compact-table admin-stores-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Owner</th>
                        <th>Onboarding</th>
                        <th>Products</th>
                        <th>Staff</th>
                        <th>Paid revenue</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merchants.map((merchant) => (
                        <tr key={merchant.id}>
                          <td>
                            <div className="product-cell">
                              <strong>{merchant.store_name}</strong>
                              <span>{merchant.branch_name}</span>
                            </div>
                          </td>
                          <td>{merchant.owner_email}</td>
                          <td><StatusPill tone={merchant.onboarding_status === 'approved' ? 'success' : merchant.onboarding_status === 'pending' ? 'warning' : 'neutral'}>{merchant.onboarding_status || 'approved'}</StatusPill><small>{merchant.geofence_enabled ? `${merchant.geofence_radius_meters} m zone` : 'No geofence'}</small></td>
                          <td>{merchant.products_count}</td>
                          <td>{merchant.active_staff_count}/{merchant.staff_count}</td>
                          <td>{formatMoney(merchant.paid_revenue)}</td>
                          <td className="table-actions">
                            <button type="button" onClick={() => openMerchantEdit(merchant)}>
                              Edit
                            </button>
                            {merchant.onboarding_status === 'pending' ? <><button type="button" onClick={() => reviewStore(merchant, 'approved')}>Approve</button><button type="button" onClick={() => reviewStore(merchant, 'rejected')}>Request changes</button></> : null}
                            {merchant.onboarding_status === 'approved' ? <button type="button" onClick={() => reviewStore(merchant, 'suspended')}>Suspend</button> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState>No stores yet.</EmptyState>
              )}
            </section>

            <form className="product-form" onSubmit={saveMerchant}>
              <h2>{merchantForm ? 'Edit store' : 'Select a store'}</h2>
              {merchantForm ? (
                <>
                  <label>
                    Store name
                    <input
                      required
                      value={merchantForm.store_name}
                      onChange={(event) => updateMerchantForm('store_name', event.target.value)}
                    />
                  </label>
                  <label>
                    Branch name
                    <input
                      required
                      value={merchantForm.branch_name}
                      onChange={(event) => updateMerchantForm('branch_name', event.target.value)}
                    />
                  </label>
                  <div className="action-row">
                    <button disabled={saving} type="submit">
                      {saving ? 'Saving...' : 'Save store'}
                    </button>
                    <button type="button" onClick={() => setMerchantForm(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <EmptyState>Choose a store to update its public profile.</EmptyState>
              )}
            </form>
          </section>
        ) : null}

        {activeTab === 'customers' ? (
          <section className="admin-insight-grid">
            <section className="panel"><div className="modal-title-row"><h2>Shopper feedback</h2><StatusPill>{customerInsights.feedback.length}</StatusPill></div>
              {customerInsights.feedback.length ? <div className="insight-feed">{customerInsights.feedback.map((entry) => <article key={entry.id}><header><strong>{entry.merchant_profile?.store_name || 'Unknown store'}</strong><span>{'★'.repeat(entry.rating)}{'☆'.repeat(5 - entry.rating)}</span></header><small>{entry.orders?.order_number} · {formatDateTime(entry.created_at)}</small><p>{entry.comment || entry.tags?.join(' · ') || 'Rating only'}</p></article>)}</div> : <EmptyState>No shopper feedback yet.</EmptyState>}
            </section>
            <section className="panel"><div className="modal-title-row"><h2>User interest</h2><StatusPill>{customerInsights.interest.length}</StatusPill></div>
              {customerInsights.interest.length ? <div className="table-wrap compact-table"><table><thead><tr><th>Shopper</th><th>Store</th><th>Offers</th><th>Joined</th></tr></thead><tbody>{customerInsights.interest.map((entry) => <tr key={entry.id}><td><strong>{entry.full_name || 'Shopper'}</strong><small>{entry.email}</small></td><td>{entry.merchant_profile?.store_name || 'Unknown store'}</td><td>{entry.offers ? 'Yes' : 'No'}</td><td>{formatDateTime(entry.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState>No early-access interest yet.</EmptyState>}
            </section>
          </section>
        ) : null}

        {activeTab === 'system' ? (
          <section className="panel"><div className="modal-title-row"><h2>System events</h2><button type="button" onClick={loadSystemLogs}>Refresh</button></div>
            {systemLogs.length ? <div className="event-stream">{systemLogs.map((entry) => <article className={entry.severity} key={entry.id}><span>{entry.event_type.replaceAll('_', ' ')}</span><div><strong>{entry.message}</strong><small>{entry.merchant_profile?.store_name || 'Platform'} · {formatDateTime(entry.created_at)}</small></div></article>)}</div> : <EmptyState>No system events yet.</EmptyState>}
          </section>
        ) : null}

        {activeTab === 'staff' ? (
          <section className="panel">
            <div className="modal-title-row">
              <h2>Staff access</h2>
              <button type="button" onClick={loadStaff}>
                Refresh
              </button>
            </div>
            {loading ? <LoadingRows /> : null}
            {staff.length ? (
              <div className="table-wrap compact-table admin-staff-table">
                <table>
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Store</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <div className="product-cell">
                            <strong>{member.full_name || 'Not set'}</strong>
                            <span>{member.email}</span>
                          </div>
                        </td>
                        <td>{member.merchant_profile?.store_name || 'Unknown store'}</td>
                        <td>{member.role}</td>
                        <td>
                          <StatusPill tone={member.is_active ? 'success' : 'neutral'}>
                            {member.is_active ? 'Active' : 'Disabled'}
                          </StatusPill>
                        </td>
                        <td>{formatDateTime(member.created_at)}</td>
                        <td className="table-actions">
                          <button type="button" onClick={() => setStaffActive(member, !member.is_active)}>
                            {member.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No staff accounts yet.</EmptyState>
            )}
          </section>
        ) : null}

        {activeTab === 'orders' ? (
          <section className="panel">
            <div className="modal-title-row">
              <h2>Recent orders</h2>
              <button type="button" onClick={loadOrders}>
                Refresh
              </button>
            </div>
            {loading ? <LoadingRows /> : null}
            {orders.length ? (
              <div className="table-wrap compact-table admin-orders-table">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Store</th>
                      <th>Status</th>
                      <th>Payment</th>
                      <th>Receipt delivery</th>
                      <th>Total</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>{order.order_number}</td>
                        <td>{order.merchant_profile?.store_name || 'Unknown store'}</td>
                        <td>{order.status}</td>
                        <td>{order.payment_status}</td>
                        <td><StatusPill tone={order.receipt_delivery_status === 'sent' ? 'success' : order.receipt_delivery_status === 'failed' ? 'warning' : 'neutral'}>{order.receipt_delivery_status || 'not requested'}</StatusPill><small>{order.customer_email || ''}</small></td>
                        <td>{formatMoney(order.total_amount)}</td>
                        <td>{formatDateTime(order.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No orders yet.</EmptyState>
            )}
          </section>
        ) : null}

        {activeTab === 'reconciliation' ? <section className="panel"><div className="modal-title-row"><h2>Payments requiring attention</h2><button type="button" onClick={loadOrders}>Refresh</button></div>{loading ? <LoadingRows /> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Store</th><th>Order state</th><th>Gateway state</th><th>Reference</th><th>Amount</th><th>Age</th></tr></thead><tbody>{orders.filter((order) => order.payment_status !== 'paid' || !order.payments?.some((payment) => payment.status === 'paid')).map((order) => { const payment = order.payments?.[0]; return <tr key={order.id}><td>{order.order_number}</td><td>{order.merchant_profile?.store_name || 'Unknown'}</td><td><StatusPill tone={order.payment_status === 'failed' ? 'warning' : 'neutral'}>{order.payment_status}</StatusPill></td><td>{payment?.status || 'No gateway record'}</td><td>{payment?.provider_reference || '—'}</td><td>{formatMoney(order.total_amount)}</td><td>{formatDateTime(order.created_at)}</td></tr> })}</tbody></table></div>}</section> : null}

        {activeTab === 'mismatches' ? <section className="panel"><div className="modal-title-row"><h2>Basket mismatch report</h2><button type="button" onClick={loadOrders}>Refresh</button></div>{loading ? <LoadingRows /> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Store</th><th>Reasons</th><th>Incident note</th><th>Balance recovered</th><th>Recorded</th></tr></thead><tbody>{orders.filter((order) => order.verification_outcome === 'mismatch').map((order) => { const record = order.verification_records?.[0]; return <tr key={order.id}><td>{order.order_number}</td><td>{order.merchant_profile?.store_name || 'Unknown'}</td><td>{record?.reason_codes?.map((reason) => reason.replaceAll('_', ' ')).join(', ') || 'Mismatch'}</td><td>{record?.incident_note || '—'}</td><td>{formatMoney(record?.balance_collected || 0)}<small>{record?.balance_payment_method || ''}</small></td><td>{formatDateTime(record?.created_at || order.exited_at)}</td></tr> })}</tbody></table></div>}</section> : null}

        {activeTab === 'audit' ? (
          <section className="panel">
            <div className="modal-title-row">
              <h2>Audit trail</h2>
              <button type="button" onClick={loadAudit}>
                Refresh
              </button>
            </div>
            {loading ? <LoadingRows /> : null}
            {auditLogs.length ? (
              <div className="table-wrap compact-table admin-audit-table">
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Admin</th>
                      <th>Details</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.action.replaceAll('_', ' ')}</td>
                        <td>{entry.admin_email}</td>
                        <td className="audit-details">{JSON.stringify(entry.details || {})}</td>
                        <td>{formatDateTime(entry.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No admin actions yet.</EmptyState>
            )}
          </section>
        ) : null}
      </section>
    </main>
  )
}

function MerchantDashboardRoute({ path, session }) {
  const [state, setState] = useState({ loading: true, error: '', profile: null })

  useEffect(() => {
    async function loadProfile() {
      const { data, error } = await supabase
        .from('merchant_profile')
        .select('id,store_name,branch_name,onboarding_status,onboarding_review_note')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (error) {
        setState({ loading: false, error: error.message, profile: null })
        return
      }

      if (!data) {
        const staff = await supabase
          .from('staff_members')
          .select('id,role,is_active')
          .eq('user_id', session.user.id)
          .eq('is_active', true)
          .maybeSingle()

        if (staff.data) {
          navigate('/cashier')
          return
        }

        navigate('/setup-store')
        return
      }

      setState({ loading: false, error: '', profile: data })
    }

    loadProfile()
  }, [session.user.id])

  if (state.loading) return <AppShell session={session} main={<LoadingRows />} />
  if (state.error) return <AppShell session={session} main={<Notice tone="error">{state.error}</Notice>} />
  if (state.profile?.onboarding_status !== 'approved') {
    return <OnboardingReview session={session} profile={state.profile} />
  }

  const shell = (main) => <AppShell session={session} profile={state.profile} main={main} />
  if (path === '/dash') return shell(<Dashboard />)
  if (path === '/dash/products') return shell(<Products />)
  if (path === '/dash/stock') return shell(<SmartStock />)
  if (path === '/dash/smart-add') return shell(<SmartAddDashboard />)
  if (path === '/dash/import') return shell(<CsvImport />)
  if (path === '/dash/qr') return shell(<QrPage />)
  if (path === '/dash/location') return shell(<LocationSettings />)
  if (path === '/dash/orders') return shell(<Orders />)
  if (path === '/dash/payments') return shell(<Payments />)
  if (path === '/dash/staff') return shell(<StaffManagement />)
  if (path === '/dash/reports') return shell(<StoreReports />)
  if (path === '/dash/verification') return shell(<VerificationSettings />)

  return <NotFound />
}

function OnboardingReview({ session, profile }) {
  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const rejected = profile.onboarding_status === 'rejected'
  return (
    <main className="onboarding-review-page">
      <section className="onboarding-review-card">
        <Link className="brand" href="/">Glide</Link>
        <div className={`review-orbit ${rejected ? 'rejected' : ''}`}><span>{rejected ? '!' : '✓'}</span></div>
        <p className="eyebrow">Store access review</p>
        <h1>{rejected ? 'Your setup needs attention.' : 'Your store is in the Glide queue.'}</h1>
        <p>{rejected ? profile.onboarding_review_note || 'Review your store details and contact Glide support.' : `We are reviewing ${profile.store_name} and its verified shopping zone. Your checkout QR will activate after approval.`}</p>
        <div className="onboarding-timeline"><span className="done">Account created</span><span className="done">Location secured</span><span className={rejected ? 'issue' : 'active'}>{rejected ? 'Changes requested' : 'Glide review'}</span><span>Store live</span></div>
        <small>Signed in as {session.user.email}</small>
        <button type="button" onClick={logout}>Sign out</button>
      </section>
    </main>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(getConfigMessage())
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!supabase) return

    setBusy(true)
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    const homePath = await getUserHomePath()
    navigate(homePath)
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <form className="auth-panel" onSubmit={submit}>
          <p className="eyebrow">Merchant login</p>
          <h2>Sign in</h2>
          <p>Use your store owner account to continue.</p>
          {message ? <Notice tone="warning">{message}</Notice> : null}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button disabled={busy || !isSupabaseConfigured} type="submit">
            {busy ? 'Signing in...' : 'Log in'}
          </button>
          <p className="auth-switch">
            New to Glide? <Link href="/signup">Create a store account.</Link>
          </p>
        </form>
      </section>
    </main>
  )
}

function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(getConfigMessage())
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!supabase) return

    setBusy(true)
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setBusy(false)
      setMessage(error.message)
      return
    }

    try {
      await callFunction('platform-admin', { action: 'summary' })
      navigate('/admin')
    } catch (adminError) {
      await supabase.auth.signOut()
      setMessage(adminError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page admin-auth-page">
      <form className="auth-panel admin-auth-panel" onSubmit={submit}>
        <Link className="brand" href="/">
          Glide Admin
        </Link>
        <p className="eyebrow">Master control</p>
        <h1>Admin login</h1>
        <p>Use a platform admin email and password to manage Glide.</p>
        {message ? <Notice tone="warning">{message}</Notice> : null}
        <label>
          Admin email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Admin password
          <input
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button disabled={busy || !isSupabaseConfigured} type="submit">
          {busy ? 'Checking access...' : 'Enter admin'}
        </button>
        <p className="auth-switch">
          Store owner? <Link href="/login">Go to merchant login.</Link>
        </p>
      </form>
    </main>
  )
}

function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState(getConfigMessage())
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!supabase) return

    if (password !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }

    setBusy(true)
    setMessage('')

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/setup-store`,
      },
    })

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (data.session) {
      navigate('/setup-store')
      return
    }

    setMessage('Check your email to confirm your account, then log in to create your store.')
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <form className="auth-panel" onSubmit={submit}>
          <p className="eyebrow">Merchant signup</p>
          <h2>Welcome to Glide</h2>
          {message ? <Notice tone="warning">{message}</Notice> : null}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              minLength={6}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              required
              minLength={6}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <button disabled={busy || !isSupabaseConfigured} type="submit">
            {busy ? 'Creating account...' : 'Create account'}
          </button>
          <p className="auth-switch">
            Already have an account? <Link href="/login">Log in.</Link>
          </p>
        </form>
      </section>
    </main>
  )
}

function StoreSetup({ session }) {
  const [storeName, setStoreName] = useState('')
  const [branchName, setBranchName] = useState('Main branch')
  const [location, setLocation] = useState(null)
  const [radius, setRadius] = useState(150)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    async function loadExistingProfile() {
      const { data } = await supabase
        .from('merchant_profile')
        .select('id')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (data) navigate('/dash')
    }

    loadExistingProfile()
  }, [session.user.id])

  async function submit(event) {
    event.preventDefault()
    if (!location) {
      setMessage('Capture your store location before submitting for review.')
      return
    }
    setBusy(true)
    setMessage('')

    const profileResult = await supabase
      .from('merchant_profile')
      .insert({
        user_id: session.user.id,
        store_name: storeName.trim(),
        branch_name: branchName.trim() || 'Main branch',
        geofence_latitude: location.latitude,
        geofence_longitude: location.longitude,
        geofence_radius_meters: Math.min(5000, Math.max(25, Number(radius) || 150)),
        geofence_enabled: true,
        onboarding_status: 'pending',
        onboarding_submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (profileResult.error) {
      setBusy(false)
      setMessage(profileResult.error.message)
      return
    }

    const qrCode = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    const qrResult = await supabase.from('qr_codes').insert({
      merchant_id: profileResult.data.id,
      qr_code: qrCode,
      is_active: false,
    })

    setBusy(false)

    if (qrResult.error) {
      setMessage(`Store created, but QR setup failed: ${qrResult.error.message}`)
      return
    }

    navigate('/dash')
  }

  function captureStoreLocation() {
    if (!navigator.geolocation) {
      setMessage('This device does not support location services.')
      return
    }
    setBusy(true)
    setMessage('Confirming your store location…')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy })
        setMessage(`Location confirmed with ±${Math.round(coords.accuracy)} m accuracy.`)
        setBusy(false)
      },
      () => {
        setMessage('We could not confirm the store location. Enable precise location and try again from the store.')
        setBusy(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }

  return (
    <main className="auth-page">
      <form className="auth-panel setup-panel" onSubmit={submit}>
        <Link className="brand" href="/">
          Glide
        </Link>
        <p className="eyebrow">Glide store onboarding</p>
        <h1>Bring your store into Glide.</h1>
        <p>
          Tell us where you operate, set your verified shopping area, then submit for a short Glide review.
        </p>
        {message ? <Notice tone="error">{message}</Notice> : null}
        <label>
          Store name
          <input
            required
            placeholder="Example: Greenway Supermarket"
            value={storeName}
            onChange={(event) => setStoreName(event.target.value)}
          />
        </label>
        <label>
          Branch name
          <input
            required
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
          />
        </label>
        <section className="onboarding-geofence">
          <div><span>02</span><div><strong>Verify the shopping zone</strong><small>Capture this while physically inside the store.</small></div></div>
          <button className="secondary-action" disabled={busy} type="button" onClick={captureStoreLocation}>
            {location ? 'Recapture store location' : 'Capture store location'}
          </button>
          {location ? <p className="location-proof">✓ Location secured · ±{Math.round(location.accuracy)} m</p> : null}
          <label>Shopping radius (metres)<input min="25" max="5000" type="number" value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
        </section>
        <button disabled={busy || !storeName.trim()} type="submit">
          {busy ? 'Submitting...' : 'Submit store for approval'}
        </button>
      </form>
    </main>
  )
}

function AppShell({ session, profile, main }) {
  const path = usePath()
  const navItems = [
    { href: '/dash', label: 'Overview', icon: 'grid' },
    { href: '/dash/orders', label: 'Orders', icon: 'receipt' },
    { href: '/dash/payments', label: 'Payments', icon: 'payment' },
    { href: '/dash/products', label: 'Inventory', icon: 'box' },
    { href: '/dash/stock', label: 'Smart Stock', icon: 'stock' },
    { href: '/dash/qr', label: 'Store QR', icon: 'qr' },
    { href: '/dash/location', label: 'Geofence', icon: 'location' },
    { href: '/dash/staff', label: 'Team', icon: 'team' },
    { href: '/dash/reports', label: 'Reports', icon: 'receipt' },
    { href: '/dash/verification', label: 'Verification', icon: 'payment' },
    { href: '/cashier', label: 'Cashier', icon: 'terminal' },
  ]

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <aside className="dash-sidebar">
        <div className="dash-brand-row">
          <Link className="brand" href="/dash">
            Glide
          </Link>
          <span>Store</span>
        </div>
        <div className="store-identity">
          <span aria-hidden="true">{profile?.store_name?.charAt(0)?.toUpperCase() || 'G'}</span>
          <div>
            <strong>{profile?.store_name || 'Glide store'}</strong>
            <small>{profile?.branch_name || 'Store workspace'}</small>
          </div>
        </div>
        <p className="workspace-label">Workspace</p>
        <nav>
          {navItems.map((item) => {
            const active = item.href === '/dash' ? path === '/dash' : path.startsWith(item.href)
            return (
              <Link key={item.href} className={active ? 'active' : ''} href={item.href}>
                <span className={`nav-glyph ${item.icon}`} aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="system-health">
          <span aria-hidden="true" />
          <div>
            <strong>Systems online</strong>
            <small>Network steady</small>
          </div>
        </div>
        <div className="merchant-meta">
          <button type="button" onClick={logout}>
            Sign out
          </button>
          <span>{session?.user?.email}</span>
        </div>
      </aside>
      <main className="dash-main">{main}</main>
    </div>
  )
}

function Dashboard() {
  const [state, setState] = useState({ loading: true, error: '', data: null })

  const loadDashboard = useCallback((showLoading = false) => {
    if (showLoading) setState((current) => ({ ...current, loading: true }))

    return callFunction('dashboard-summary')
      .then((data) => setState({ loading: false, error: '', data }))
      .catch(() => {
        loadDashboardSummaryFromClient()
          .then((data) => setState({ loading: false, error: '', data }))
          .catch((error) =>
            setState({ loading: false, error: error.message, data: null }),
          )
      })
  }, [])

  useEffect(() => {
    loadDashboard(true)
  }, [loadDashboard])

  useRealtimeRefresh(
    'dashboard-live',
    ['products', 'orders', 'order_items', 'payments', 'inventory_movements'],
    () => loadDashboard(false),
  )

  const data = {
    totalProducts: 0,
    lowStockCount: 0,
    todayPaidOrders: 0,
    todayRevenue: 0,
    pendingPaidOrders: 0,
    completedExits: 0,
    averageOrderValue: 0,
    recentOrders: [],
    topProducts: [],
    paymentSummary: { paid: 0, pending: 0, failed: 0, volume: 0, successRate: 0 },
    recentPayments: [],
    customerInsights: { feedbackCount: 0, averageRating: 0, earlyAccessSignups: 0 },
    storeName: '',
    branchName: '',
    ...(state.data || {}),
  }

  data.recentOrders = Array.isArray(data.recentOrders) ? data.recentOrders : []
  data.topProducts = Array.isArray(data.topProducts) ? data.topProducts : []
  const stockHealth = data.lowStockCount
    ? `${data.lowStockCount} needs restock`
    : 'Healthy'
  const exitHealth = data.pendingPaidOrders
    ? `${data.pendingPaidOrders} waiting`
    : 'Clear'
  const storeName = data.storeName || 'Foodco Stores'
  const branchName = data.branchName || 'Akobo'
  const networkText = state.loading ? 'Syncing store data...' : 'Live and synced'

  return (
    <section className="dash-section">
      <header className="dashboard-topbar">
        <div>
          <p className="ops-eyebrow">Store overview</p>
          <h1>{storeName}</h1>
          <p>{branchName}</p>
        </div>
        <div className="live-pill">
          <span aria-hidden="true" />
          <strong>{networkText}</strong>
          <small>Updates appear automatically</small>
        </div>
      </header>

      <div className="store-kpi-grid" aria-label="Store health">
        <div>
          <span>Revenue today</span>
          <strong>{formatMoney(data.todayRevenue)}</strong>
          <small>Verified payments only</small>
        </div>
        <div>
          <span>Payment success</span>
          <strong>{data.paymentSummary.successRate}%</strong>
          <small>{data.paymentSummary.failed} failed this week</small>
        </div>
        <div>
          <span>Shopping complete</span>
          <strong>{String(data.pendingPaidOrders).padStart(2, '0')}</strong>
          <small>{exitHealth === 'Clear' ? 'No customers awaiting exit' : exitHealth}</small>
        </div>
        <div>
          <span>Low stock</span>
          <strong>{String(data.lowStockCount).padStart(2, '0')}</strong>
          <small>{stockHealth === 'Healthy' ? 'At or below threshold' : stockHealth}</small>
        </div>
      </div>

      {state.loading ? (
        <Notice tone="warning">Checking network strength. Some store processes may delay briefly.</Notice>
      ) : (
        <>
          {state.error ? (
            <Notice tone="error">
              Dashboard data could not load. If you are running locally, use
              Netlify dev so the summary function is available. {state.error}
            </Notice>
          ) : null}
          <div className="dashboard-actions" aria-label="Store shortcuts">
            <Link href="/dash/orders"><span>01</span><div><small>In-store shopping</small><strong>View all orders</strong></div><b>→</b></Link>
            <Link href="/dash/payments"><span>02</span><div><small>Money movement</small><strong>Track payments</strong></div><b>→</b></Link>
            <Link href="/dash/stock"><span>03</span><div><small>Inventory</small><strong>Update stock</strong></div><b>→</b></Link>
            <Link href="/dash/qr"><span>04</span><div><small>Shopper access</small><strong>Manage store QR</strong></div><b>→</b></Link>
          </div>
          <div className="dashboard-insight-grid">
            <section className="dashboard-insight-card payment-health-card">
              <header><div><span>Last 7 days</span><h2>Payment health</h2></div><Link href="/dash/payments">Open payments</Link></header>
              <div className="payment-health-meter"><span style={{ width: `${data.paymentSummary.successRate}%` }} /></div>
              <div className="payment-health-numbers">
                <div><strong>{data.paymentSummary.paid}</strong><span>Successful</span></div>
                <div><strong>{data.paymentSummary.pending}</strong><span>Pending</span></div>
                <div><strong>{data.paymentSummary.failed}</strong><span>Failed</span></div>
                <div><strong>{formatMoney(data.paymentSummary.volume)}</strong><span>Processed</span></div>
              </div>
            </section>
            <section className="dashboard-insight-card customer-pulse-card">
              <header><div><span>Customer pulse</span><h2>Experience signals</h2></div></header>
              <div className="customer-pulse-score"><strong>{data.customerInsights.averageRating ? data.customerInsights.averageRating.toFixed(1) : '—'}</strong><span>average rating</span></div>
              <div className="customer-pulse-meta"><span>{data.customerInsights.feedbackCount} responses</span><span>{data.customerInsights.earlyAccessSignups} early-access signups</span></div>
            </section>
          </div>
          <section className="order-movement recent-activity-panel">
            <header>
              <div><span>Live store feed</span><h2>Recent activity</h2></div>
              <Link href="/dash/orders">View all activity {'->'}</Link>
            </header>
            {data.recentOrders.length ? <OrderList orders={data.recentOrders} /> : (
              <div className="quiet-state"><span>Quiet for now</span><strong>New in-store orders will appear here.</strong><small>This feed refreshes as customers shop and pay.</small></div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

async function loadDashboardSummaryFromClient() {
  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) throw new Error('Your session has expired.')
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const [
    productsResult,
    todayOrdersResult,
    pendingPaidResult,
    exitedResult,
    recentOrdersResult,
    paidOrdersWithItemsResult,
    profileResult,
  ] = await Promise.all([
    supabase
      .from('products')
      .select('id,name,quantity,low_stock_threshold,track_inventory'),
    supabase
      .from('orders')
      .select('*')
      .eq('payment_status', 'paid')
      .gte('paid_at', start.toISOString())
      .lt('paid_at', end.toISOString()),
    supabase.from('orders').select('id').eq('status', 'paid'),
    supabase
      .from('orders')
      .select('id')
      .eq('status', 'exited')
      .gte('exited_at', start.toISOString())
      .lt('exited_at', end.toISOString()),
    supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('orders')
      .select('payment_status,order_items(product_name,quantity)')
      .eq('payment_status', 'paid'),
    supabase
      .from('merchant_profile')
      .select('store_name,branch_name')
      .eq('user_id', authData.user.id)
      .maybeSingle(),
  ])

  const firstError = [
    productsResult.error,
    todayOrdersResult.error,
    pendingPaidResult.error,
    exitedResult.error,
    recentOrdersResult.error,
    paidOrdersWithItemsResult.error,
    profileResult.error,
  ].find(Boolean)

  if (firstError) throw firstError

  const productRows = productsResult.data || []
  const todayOrders = todayOrdersResult.data || []
  const todayRevenue = todayOrders.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0,
  )
  const topMap = new Map()

  for (const order of paidOrdersWithItemsResult.data || []) {
    for (const item of order.order_items || []) {
      topMap.set(item.product_name, (topMap.get(item.product_name) || 0) + item.quantity)
    }
  }

  return {
    storeName: profileResult.data?.store_name || '',
    branchName: profileResult.data?.branch_name || '',
    totalProducts: productRows.length,
    lowStockCount: productRows.filter(
      (product) => product.track_inventory && product.quantity <= product.low_stock_threshold,
    ).length,
    todayPaidOrders: todayOrders.length,
    todayRevenue,
    pendingPaidOrders: pendingPaidResult.data?.length || 0,
    completedExits: exitedResult.data?.length || 0,
    averageOrderValue: todayOrders.length ? todayRevenue / todayOrders.length : 0,
    recentOrders: recentOrdersResult.data || [],
    topProducts: [...topMap.entries()]
      .map(([name, quantity_sold]) => ({ name, quantity_sold }))
      .sort((a, b) => b.quantity_sold - a.quantity_sold)
      .slice(0, 5),
  }
}

function smartCategoryFromText(text = '') {
  const value = text.toLowerCase()
  const rules = [
    ['Drinks', ['drink', 'juice', 'water', 'soda', 'cola', 'malt', 'milk', 'tea', 'coffee']],
    ['Snacks', ['biscuit', 'chips', 'cracker', 'sweet', 'chocolate', 'cookie', 'wafer']],
    ['Pharmacy', ['tablet', 'capsule', 'syrup', 'cream', 'mg', 'medicine', 'pain', 'vitamin']],
    ['Personal care', ['soap', 'shampoo', 'toothpaste', 'cream', 'lotion', 'deodorant']],
    ['Household', ['detergent', 'bleach', 'cleaner', 'tissue', 'napkin', 'soap powder']],
    ['Groceries', ['rice', 'beans', 'flour', 'oil', 'salt', 'sugar', 'pasta', 'noodle']],
    ['Electronics', ['charger', 'cable', 'battery', 'earphone', 'adapter']],
    ['Books', ['book', 'notebook', 'journal', 'pen', 'pencil']],
  ]

  return rules.find(([, words]) => words.some((word) => value.includes(word)))?.[0] || 'General'
}

function smartSizeFromText(text = '') {
  return (
    text.match(/\b\d+(?:\.\d+)?\s?(?:ml|l|cl|g|kg|mg|pcs|pieces|pack|packs|sachets?)\b/i)?.[0] || ''
  )
}

function smartNameFromText(text = '', barcode = '') {
  const cleaned = text
    .split(/\n|,|\|/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !barcode || !line.includes(barcode))
    .filter((line) => !/^\d+$/.test(line))
    .sort((a, b) => b.length - a.length)

  return cleaned[0]?.slice(0, 80) || ''
}

function cleanBarcodeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, '')
}

function smartAddErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (!message) return 'Smart Add could not load. Please try again.'
  if (message === SESSION_EXPIRED_MESSAGE) return message
  if (
    message.toLowerCase() === 'something went wrong. please try again.' ||
    message.toLowerCase() === 'failed to fetch' ||
    message.toLowerCase().includes('networkerror')
  ) {
    return 'Smart Add could not load. Please try again.'
  }
  return message
}

function SmartAddDashboard() {
  const [state, setState] = useState({ loading: true, links: [], error: '', created: null })
  const [busy, setBusy] = useState(false)

  const loadLinks = useCallback(async (showLoading = true) => {
    if (showLoading) setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const data = await callFunction('smart-add', { action: 'list-links' })
      setState((current) => ({ ...current, loading: false, links: data.links || [], error: '' }))
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: smartAddErrorMessage(error) }))
    }
  }, [])

  useEffect(() => {
    loadLinks(true)
  }, [loadLinks])

  useRealtimeRefresh(
    'smart-add-dashboard-live',
    ['smart_add_links', 'smart_add_items', 'products'],
    () => loadLinks(false),
  )

  async function createLink() {
    setBusy(true)
    setState((current) => ({ ...current, error: '', created: null }))
    try {
      const data = await callFunction('smart-add', { action: 'create-link' })
      setState((current) => ({
        ...current,
        links: [data.link, ...current.links],
        created: data.link,
      }))
    } catch (error) {
      setState((current) => ({ ...current, error: smartAddErrorMessage(error) }))
    } finally {
      setBusy(false)
    }
  }

  async function copyLink(url) {
    await navigator.clipboard?.writeText(url)
    setState((current) => ({ ...current, error: 'Smart Add link copied.' }))
  }

  return (
    <section className="dash-section">
      <div className="dashboard-hero smart-add-hero">
        <PageTitle
          title="Smart Add"
          subtitle="Create a secure mobile link for someone to scan product barcodes and add product details into your store."
        />
        <button disabled={busy} type="button" onClick={createLink}>
          {busy ? 'Creating...' : 'Create mobile link'}
        </button>
      </div>

      {state.error ? <Notice tone={state.error.includes('copied') ? 'success' : 'warning'}>{state.error}</Notice> : null}
      {state.created ? (
        <Panel title="New Smart Add link">
          <p className="smart-link">{state.created.url}</p>
          <div className="action-row">
            <button type="button" onClick={() => copyLink(state.created.url)}>
              Copy link
            </button>
            <a className="secondary-action" href={`https://wa.me/?text=${encodeURIComponent(`Use this secure Glide Smart Add link to scan products: ${state.created.url}`)}`} target="_blank" rel="noreferrer">
              Send on WhatsApp
            </a>
            <button className="secondary-action" type="button" onClick={() => setState((current) => ({ ...current, created: null }))}>Done</button>
          </div>
        </Panel>
      ) : null}

      <TwoColumn>
        <Panel title="How it works">
          <SimpleList
            rows={[
              { label: '1. Create link', value: 'Send to any phone' },
              { label: '2. Camera reads barcode', value: 'Checks shared database' },
              { label: '3. Add details', value: 'Suggests size and category' },
              { label: '4. Save item', value: 'Adds to inventory' },
            ]}
          />
        </Panel>
        <Panel title="Recent Smart Add links">
          {state.loading ? (
            <LoadingRows />
          ) : state.links.length ? (
            <div className="smart-link-list">
              {state.links.map((link) => (
                <div key={link.id}>
                  <strong>{link.completed_count || 0} products added</strong>
                  <span>{link.is_active ? 'Active' : 'Closed'} · {formatDateTime(link.created_at)}</span>
                  <button type="button" onClick={() => copyLink(link.url)}>
                    Copy
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No Smart Add links yet.</EmptyState>
          )}
        </Panel>
      </TwoColumn>
    </section>
  )
}

function SmartAddPhone({ token }) {
  const [state, setState] = useState({ loading: true, error: '', link: null })
  const [barcode, setBarcode] = useState('')
  const [form, setForm] = useState({
    name: '',
    category: '',
    size: '',
    sku: '',
    price: '',
    quantity: '1',
    low_stock_threshold: '5',
    labelText: '',
  })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const videoRef = useRef(null)
  const scannerStopRef = useRef(null)
  const autoScanRef = useRef(false)

  useEffect(() => {
    async function loadLink() {
      try {
        const data = await callFunction('smart-add', { action: 'get-link', token }, false)
        setState({ loading: false, error: '', link: data.link })
      } catch (error) {
        setState({ loading: false, error: smartAddErrorMessage(error), link: null })
      }
    }

    loadLink()

    return () => {
      scannerStopRef.current?.()
    }
  }, [token])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function applySuggestions(text, nextBarcode = barcode) {
    const name = smartNameFromText(text, nextBarcode)
    const size = smartSizeFromText(text)
    const category = smartCategoryFromText(text)

    setForm((current) => ({
      ...current,
      labelText: text,
      name: current.name || name,
      size: current.size || size,
      category: current.category || category,
    }))
  }

  async function lookupBarcode(nextBarcode = barcode) {
    const cleanBarcode = cleanBarcodeText(nextBarcode)
    if (!cleanBarcode) {
      setMessage('Enter or scan a barcode first.')
      return
    }

    setBarcode(cleanBarcode)
    setMessage('Checking shared product database...')
    try {
      const data = await callFunction('smart-add', { action: 'lookup', token, barcode: cleanBarcode }, false)
      if (data.product) {
        setForm((current) => ({
          ...current,
          name: current.name || data.product.name || '',
          category: current.category || data.product.category || '',
          size: current.size || data.product.size || '',
        }))
        setMessage('Product found in the shared database. Confirm stock details and save.')
      } else {
        setMessage('New barcode. Enter the product details and save.')
      }
    } catch (error) {
      setMessage(smartAddErrorMessage(error))
    }
  }

  async function scanBarcode() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera scanning needs HTTPS or localhost. Use manual barcode entry on this device.')
      return
    }

    setMessage('Opening camera...')
    scannerStopRef.current?.()

    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }

      if ('BarcodeDetector' in window) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
        })
        const video = videoRef.current
        video.srcObject = stream
        await video.play()

        let stopped = false
        async function scanFrame() {
          if (stopped) return
          const detected = await detector.detect(video).catch(() => [])
          const rawValue = detected?.[0]?.rawValue
          if (rawValue) {
            stopped = true
            stream.getTracks().forEach((track) => track.stop())
            video.srcObject = null
            await lookupBarcode(rawValue)
            return
          }
          requestAnimationFrame(scanFrame)
        }

        scannerStopRef.current = () => {
          stopped = true
          stream.getTracks().forEach((track) => track.stop())
          if (video) video.srcObject = null
        }
        scanFrame()
        setMessage('Point at the barcode. It will fill automatically.')
        return
      }

      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const scanner = new BrowserMultiFormatReader()
      const controls = await scanner.decodeFromConstraints(
        constraints,
        videoRef.current,
        async (result) => {
          const rawValue = result?.getText?.()
          if (!rawValue) return
          controls.stop()
          scannerStopRef.current = null
          await lookupBarcode(rawValue)
        },
      )
      scannerStopRef.current = () => controls.stop()
      setMessage('Point at the barcode. It will fill automatically.')
    } catch (error) {
      setMessage(smartAddErrorMessage(error) || 'Camera could not scan. Enter the barcode manually.')
    }
  }

  useEffect(() => {
    if (state.loading || state.error || autoScanRef.current) return
    autoScanRef.current = true
    scanBarcode()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loading, state.error])

  async function saveProduct(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      const data = await callFunction(
        'smart-add',
        {
          action: 'save-item',
          token,
          product: {
            barcode,
            name: form.name,
            category: form.category,
            size: form.size,
            sku: form.sku,
            price: form.price,
            quantity: form.quantity,
            low_stock_threshold: form.low_stock_threshold,
            label_text: form.labelText,
          },
        },
        false,
      )

      setMessage(`${data.product?.name || form.name} saved to store inventory.`)
      setBarcode('')
      setForm({
        name: '',
        category: '',
        size: '',
        sku: '',
        price: '',
        quantity: '1',
        low_stock_threshold: '5',
        labelText: '',
      })
    } catch (error) {
      setMessage(smartAddErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (state.loading) return <main className="smart-add-mobile"><LoadingRows /></main>
  if (state.error) return <main className="smart-add-mobile"><Notice tone="error">{state.error}</Notice></main>

  return (
    <main className="smart-add-mobile">
      <section className="smart-phone-card">
        <p className="eyebrow">Smart Add</p>
        <h1>{state.link?.store_name || 'Glide store'}</h1>
        <p className="lead">Camera opens automatically. Add product details, then save.</p>

        {message ? <Notice tone={message.includes('saved') || message.includes('found') ? 'success' : 'warning'}>{message}</Notice> : null}

        <div className="smart-scanner">
          <video ref={videoRef} muted playsInline />
          <div className="action-row">
            <button type="button" onClick={scanBarcode}>
              Restart camera
            </button>
          </div>
        </div>

        <form className="smart-product-form" onSubmit={saveProduct}>
          <label>
            Barcode
            <div className="inline-input">
              <input
                required
                inputMode="numeric"
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="Scan or enter barcode"
              />
              <button type="button" onClick={() => lookupBarcode()}>
                Check
              </button>
            </div>
          </label>
          <label>
            Label text or notes
            <textarea
              rows="3"
              value={form.labelText}
              onChange={(event) => {
                update('labelText', event.target.value)
                applySuggestions(event.target.value)
              }}
              placeholder="Type visible label text if image reading is unavailable"
            />
          </label>
          <div className="form-grid smart-form-grid">
            <label>
              Product name
              <input required value={form.name} onChange={(event) => update('name', event.target.value)} />
            </label>
            <label>
              Category
              <input value={form.category} onChange={(event) => update('category', event.target.value)} />
            </label>
            <label>
              Size
              <input value={form.size} onChange={(event) => update('size', event.target.value)} placeholder="500ml, 1kg" />
            </label>
            <label>
              SKU
              <input value={form.sku} onChange={(event) => update('sku', event.target.value)} />
            </label>
            <label>
              Price
              <input required min="0" step="0.01" type="number" value={form.price} onChange={(event) => update('price', event.target.value)} />
            </label>
            <label>
              Quantity
              <input min="0" type="number" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} />
            </label>
            <label>
              Low stock threshold
              <input min="0" type="number" value={form.low_stock_threshold} onChange={(event) => update('low_stock_threshold', event.target.value)} />
            </label>
          </div>
          <button disabled={busy} type="submit">
            {busy ? 'Saving...' : 'Save product'}
          </button>
        </form>
      </section>
    </main>
  )
}

function CategoryPicker({ value, onChange, open, onOpenChange, disabled = false }) {
  const [customValue, setCustomValue] = useState('')

  function chooseCustomCategory() {
    const nextValue = customValue.trim()
    if (!nextValue) return
    onChange(nextValue)
    setCustomValue('')
    onOpenChange(false)
  }

  return (
    <label className="category-picker">
      Category
      <button disabled={disabled} type="button" onClick={() => onOpenChange(!open)}>
        <span>{value || 'Choose category'}</span>
        <b>{open ? 'Close' : 'Open'}</b>
      </button>
      {open ? (
        <div className="category-menu">
          <div className="category-custom-row">
            <input
              placeholder="Type custom category"
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  chooseCustomCategory()
                }
              }}
            />
            <button type="button" onClick={chooseCustomCategory}>
              Use
            </button>
          </div>
          {productCategories.map((category) => (
            <button
              className={value === category ? 'active' : ''}
              key={category}
              type="button"
              onClick={() => {
                onChange(category)
                onOpenChange(false)
              }}
            >
              {category}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  )
}

function ProductIntakePhone({ token }) {
  const [state, setState] = useState({ loading: true, error: '', link: null })
  const [barcode, setBarcode] = useState('')
  const [form, setForm] = useState({ name: '', category: '', size: '', labelText: '' })
  const [duplicateProduct, setDuplicateProduct] = useState(null)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const videoRef = useRef(null)
  const scannerStopRef = useRef(null)
  const autoScanRef = useRef(false)

  useEffect(() => {
    async function loadLink() {
      try {
        const data = await callFunction('product-intake', { action: 'get-link', token }, false)
        setState({ loading: false, error: '', link: data.link })
      } catch (error) {
        setState({ loading: false, error: error.message, link: null })
      }
    }

    loadLink()
    return () => scannerStopRef.current?.()
  }, [token])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function suggestFromText(text) {
    update('labelText', text)
    setForm((current) => ({
      ...current,
      labelText: text,
      name: current.name || smartNameFromText(text, barcode),
      size: current.size || smartSizeFromText(text),
      category: current.category || smartCategoryFromText(text),
    }))
  }

  async function checkBarcode(scannedBarcode) {
    const cleanBarcode = cleanBarcodeText(scannedBarcode)
    if (!cleanBarcode) return

    setBarcode(cleanBarcode)
    setDuplicateProduct(null)
    setMessage('Checking barcode...')

    try {
      const result = await callFunction(
        'product-intake',
        { action: 'check-barcode', token, barcode: cleanBarcode },
        false,
      )

      if (result.exists) {
        setDuplicateProduct(result.product)
        setMessage(`Already in database: ${result.product?.name || cleanBarcode}. Scan another barcode.`)
        return
      }

      setForm({ name: '', category: '', size: '', labelText: '' })
      setMessage('New barcode scanned. Add product details.')
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function scanBarcode() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera scanning needs HTTPS or localhost.')
      return
    }

    setMessage('Opening camera...')
    scannerStopRef.current?.()

    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }

      if ('BarcodeDetector' in window) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
        })
        const video = videoRef.current
        video.srcObject = stream
        await video.play()

        let stopped = false
        async function scanFrame() {
          if (stopped) return
          const detected = await detector.detect(video).catch(() => [])
          const rawValue = detected?.[0]?.rawValue
          if (rawValue) {
            stopped = true
            stream.getTracks().forEach((track) => track.stop())
            video.srcObject = null
            await checkBarcode(rawValue)
            return
          }
          requestAnimationFrame(scanFrame)
        }

        scannerStopRef.current = () => {
          stopped = true
          stream.getTracks().forEach((track) => track.stop())
          if (video) video.srcObject = null
        }
        scanFrame()
        setMessage('Point at a barcode. Manual entry is disabled.')
        return
      }

      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const scanner = new BrowserMultiFormatReader()
      const controls = await scanner.decodeFromConstraints(
        constraints,
        videoRef.current,
        async (result) => {
          const rawValue = result?.getText?.()
          if (!rawValue) return
          controls.stop()
          scannerStopRef.current = null
          await checkBarcode(rawValue)
        },
      )
      scannerStopRef.current = () => controls.stop()
      setMessage('Point at a barcode. Manual entry is disabled.')
    } catch (error) {
      setMessage(error.message || 'Camera could not scan.')
    }
  }

  useEffect(() => {
    if (state.loading || state.error || autoScanRef.current) return
    autoScanRef.current = true
    scanBarcode()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loading, state.error])

  async function saveProduct(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      const result = await callFunction(
        'product-intake',
        {
          action: 'save-product',
          token,
          product: {
            barcode,
            name: form.name,
            category: form.category,
            size: form.size,
            label_text: form.labelText,
          },
        },
        false,
      )

      setMessage(`${result.product.name} saved to the product database.`)
      setBarcode('')
      setDuplicateProduct(null)
      setForm({ name: '', category: '', size: '', labelText: '' })
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (state.loading) return <main className="smart-add-mobile"><LoadingRows /></main>
  if (state.error) return <main className="smart-add-mobile"><Notice tone="error">{state.error}</Notice></main>

  return (
    <main className="smart-add-mobile">
      <section className="smart-phone-card">
        <p className="eyebrow">Glide product database</p>
        <h1>Scan product</h1>
        <p className="lead">Scan a barcode, add product details, submit once.</p>
        {message ? <Notice tone={message.includes('saved') || message.includes('New barcode') ? 'success' : 'warning'}>{message}</Notice> : null}
        {duplicateProduct ? (
          <Notice tone="warning">
            <strong>{duplicateProduct.name}</strong> already uses barcode {duplicateProduct.barcode}.
            Scan another product before entering details.
          </Notice>
        ) : null}

        <div className="smart-scanner">
          <video ref={videoRef} muted playsInline />
          <button type="button" onClick={scanBarcode}>
            Restart camera
          </button>
          <small>Leading zeroes are kept exactly as scanned.</small>
        </div>

        <form className="smart-product-form" onSubmit={saveProduct}>
          <label>
            Scanned barcode
            <input readOnly required value={barcode} placeholder="Use camera scan" />
          </label>
          <label>
            Label text or notes
            <textarea
              disabled={Boolean(duplicateProduct)}
              rows="3"
              value={form.labelText}
              onChange={(event) => suggestFromText(event.target.value)}
              placeholder="Type product label text to suggest name, size and category"
            />
          </label>
          <label>
            Product name
            <input disabled={Boolean(duplicateProduct)} required value={form.name} onChange={(event) => update('name', event.target.value)} />
          </label>
          <CategoryPicker
            disabled={Boolean(duplicateProduct)}
            open={categoryOpen}
            value={form.category}
            onOpenChange={setCategoryOpen}
            onChange={(value) => update('category', value)}
          />
          <label>
            Size
            <input disabled={Boolean(duplicateProduct)} value={form.size} onChange={(event) => update('size', event.target.value)} placeholder="500ml, 1kg" />
          </label>
          <button disabled={busy || !barcode || Boolean(duplicateProduct)} type="submit">
            {busy ? 'Saving...' : 'Save to database'}
          </button>
        </form>
      </section>
    </main>
  )
}

function SmartStock() {
  const [mode, setMode] = useState('receive')
  const [barcode, setBarcode] = useState('')
  const [reason, setReason] = useState('')
  const [queue, setQueue] = useState([])
  const [message, setMessage] = useState('Ready to scan.')
  const [busy, setBusy] = useState(false)
  const [lastBatch, setLastBatch] = useState([])
  const [catalog, setCatalog] = useState([])
  const scanInputRef = useRef(null)

  const loadCatalog = useCallback(async () => {
    const { data, error } = await supabase
      .from('products')
      .select('id,name,barcode,sku,quantity,track_inventory,unit_label,pack_label,units_per_pack')
      .eq('track_inventory', true)

    if (error) {
      setMessage(error.message)
      return
    }
    setCatalog(data || [])
  }, [])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    function shortcuts(event) {
      if (!event.altKey) return
      if (event.key === '1') setMode('receive')
      if (event.key === '2') setMode('remove')
      if (event.key === '3') setMode('count')
      scanInputRef.current?.focus()
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  }, [])

  function addToQueue(product) {
    setQueue((current) => {
      const existing = current.find((item) => item.product.id === product.id && item.operation === mode)
      if (existing && mode !== 'count') {
        return current.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item)
      }
      if (existing) return current
      return [{ product, operation: mode, quantity: mode === 'count' ? Number(product.quantity) : 1 }, ...current]
    })
  }

  function scan(event) {
    event.preventDefault()
    const cleanBarcode = barcode.trim()
    if (!cleanBarcode || busy) return

    const product = catalog.find((item) => item.barcode === cleanBarcode)
    if (!product) {
      setMessage(`No tracked product matches ${cleanBarcode}.`)
      setBarcode('')
      return
    }

    addToQueue(product)
    setBarcode('')
    setMessage(mode === 'count' ? `${product.name} added. Enter the counted quantity.` : `${product.name} added. Scan again to increase by one.`)
  }

  function updateQuantity(index, quantity) {
    const cleanQuantity = Math.max(0, Math.floor(Number(quantity) || 0))
    setQueue((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: cleanQuantity } : item))
  }

  async function applyBatch() {
    if (!queue.length || busy) return
    if (queue.some((item) => item.operation !== 'count' && item.quantity < 1)) {
      setMessage('Receive and remove quantities must be at least one.')
      return
    }
    setBusy(true)
    setMessage('Applying stock changes...')
    try {
      const result = await callFunction('inventory-adjust', {
        action: 'apply',
        adjustments: queue.map((item) => ({ productId: item.product.id, operation: item.operation, quantity: item.quantity, reason })),
      })
      setLastBatch(result.updates || [])
      setQueue([])
      setReason('')
      setMessage(`${result.updates?.length || 0} products updated successfully.`)
      await loadCatalog()
    } catch (error) {
      setMessage(error.message || 'Stock changes could not be applied.')
    } finally {
      setBusy(false)
      window.setTimeout(() => scanInputRef.current?.focus(), 0)
    }
  }

  const unitTotal = queue.reduce((sum, item) => sum + (item.operation === 'count' ? 0 : item.quantity), 0)

  return (
    <section className="dash-section smart-stock-page">
      <PageTitle title="Smart Stock" subtitle="Scan products into a batch and update the entire delivery or count in one step." />
      <div className="stock-mode-switch" aria-label="Stock operation">
        {[
          ['receive', 'Receive stock', 'Alt + 1'],
          ['remove', 'Remove stock', 'Alt + 2'],
          ['count', 'Stock count', 'Alt + 3'],
        ].map(([value, label, shortcut]) => (
          <button className={mode === value ? 'active' : ''} key={value} type="button" onClick={() => { setMode(value); scanInputRef.current?.focus() }}>
            <strong>{label}</strong><span>{shortcut}</span>
          </button>
        ))}
      </div>
      <div className="smart-stock-grid">
        <section className="stock-scan-card">
          <span className="eyebrow">Rapid entry</span>
          <h2>{mode === 'receive' ? 'Scan incoming items' : mode === 'remove' ? 'Scan items leaving stock' : 'Scan and enter shelf count'}</h2>
          <form onSubmit={scan}>
            <input autoFocus autoComplete="off" ref={scanInputRef} placeholder="Scan barcode, then press Enter" value={barcode} onChange={(event) => setBarcode(event.target.value)} />
            <button disabled={busy || !barcode.trim()} type="submit">Add</button>
          </form>
          <p className="stock-scan-message" aria-live="polite">{message}</p>
          <div className="stock-speed-tip"><strong>Speed tip</strong><span>Repeated scans increase the same product. Review once, then apply the batch.</span></div>
        </section>
        <aside className="stock-batch-summary">
          <span>Current batch</span><strong>{queue.length}</strong>
          <small>{queue.length === 1 ? 'product' : 'products'} · {unitTotal} units moved</small>
          <label>Reference or reason<input placeholder="Delivery note, damage, shelf count..." value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button disabled={busy || !queue.length} type="button" onClick={applyBatch}>{busy ? 'Working...' : `Apply ${queue.length || ''} changes`}</button>
        </aside>
      </div>
      <section className="stock-queue-card">
        <header><div><span className="eyebrow">Review</span><h2>Pending changes</h2></div>{queue.length ? <button type="button" onClick={() => setQueue([])}>Clear batch</button> : null}</header>
        {queue.length ? (
          <div className="stock-queue-list">
            {queue.map((item, index) => (
              <article key={`${item.product.id}-${item.operation}`}>
                <div><strong>{item.product.name}</strong><span>{item.product.barcode} · {item.product.quantity} currently in stock</span></div>
                <StatusPill tone={item.operation === 'remove' ? 'warning' : item.operation === 'count' ? 'neutral' : 'success'}>{item.operation}</StatusPill>
                <div className="stock-quantity-control">
                  <button type="button" onClick={() => updateQuantity(index, item.quantity - 1)}>−</button>
                  <input aria-label={`Quantity for ${item.product.name}`} min={item.operation === 'count' ? 0 : 1} type="number" value={item.quantity} onChange={(event) => updateQuantity(index, event.target.value)} />
                  <button type="button" onClick={() => updateQuantity(index, item.quantity + 1)}>+</button>
                </div>
                <button className="stock-remove-line" type="button" onClick={() => setQueue((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
              </article>
            ))}
          </div>
        ) : <div className="stock-empty-state"><strong>No pending changes</strong><span>Your scanned products will appear here.</span></div>}
      </section>
      {lastBatch.length ? <section className="stock-complete-card"><strong>Last batch completed</strong><span>{lastBatch.map((item) => `${item.name}: ${item.previousQuantity} → ${item.quantity}`).join(' · ')}</span></section> : null}
    </section>
  )
}

function Products() {
  const pageSize = 100
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [repositoryOpen, setRepositoryOpen] = useState(false)
  const [barcodeProduct, setBarcodeProduct] = useState(null)
  const [page, setPage] = useState(1)

  const loadProducts = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const { data, error } = await supabase
      .from('products')
      .select(productColumns)
      .order('created_at', { ascending: false })

    if (showLoading) setLoading(false)
    if (error) {
      if (!showLoading) setLoading(false)
      setMessage(error.message)
      return
    }

    setProducts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadProducts(true)
  }, [loadProducts])

  useRealtimeRefresh('products-live', ['products', 'inventory_movements'], () => loadProducts(false))

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('action') === 'add') {
      setEditing(null)
      setFormOpen(true)
    }
  }, [])

  const categories = useMemo(
    () => ['all', ...new Set(products.map((product) => product.category).filter(Boolean))],
    [products],
  )

  const filtered = products.filter((product) => {
    const text = `${product.name} ${product.barcode} ${product.sku}`.toLowerCase()
    const matchesQuery = text.includes(query.toLowerCase())
    const matchesCategory = category === 'all' || product.category === category
    return matchesQuery && matchesCategory
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleProducts = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const showingEnd = Math.min(safePage * pageSize, filtered.length)
  const lowStockTotal = filtered.filter(
    (product) => product.track_inventory && product.quantity <= product.low_stock_threshold,
  ).length

  useEffect(() => {
    setPage(1)
  }, [query, category])

  function openAddProduct() {
    setEditing(null)
    setFormOpen(true)
  }

  function openRepositoryProduct(product) {
    setEditing({
      ...emptyProduct,
      global_product_id: product.id,
      name: product.name || '',
      barcode: product.barcode || '',
      category: product.category || '',
      size: product.size || '',
    })
    setRepositoryOpen(false)
    setFormOpen(true)
  }

  function openEditProduct(product) {
    setEditing(product)
    setFormOpen(true)
  }

  async function setProductAvailability(product, isAvailable) {
    const { error } = await supabase
      .from('products')
      .update({ is_available: isAvailable })
      .eq('id', product.id)

    if (error) {
      setMessage(error.message)
      return
    }

    await loadProducts()
  }

  return (
    <section className="dash-section">
      <div className="inventory-heading">
        <PageTitle title="Products" subtitle="Manage stock, prices, barcodes and availability." />
        <div className="inventory-actions">
          <Link className="primary-action" href="/dash/stock">
            Update stock
          </Link>
          <button type="button" onClick={openAddProduct}>
            Add product
          </button>
          <Link className="primary-action" href="/dash/smart-add">
            Smart Add
          </Link>
          <button className="premium-action" type="button" onClick={() => setRepositoryOpen(true)}>
            Product database
          </button>
          <Link className="secondary-action" href="/dash/import">
            Import CSV
          </Link>
        </div>
      </div>
      {message ? <Notice tone="warning">{message}</Notice> : null}
      {formOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel product-modal">
            <ProductForm
              product={editing || emptyProduct}
              onDone={() => {
                setMessage(editing ? 'Product updated and available to this store.' : 'Product added to this store inventory and is ready for shopper lookup.')
                setEditing(null)
                setFormOpen(false)
                loadProducts()
              }}
              onCancel={() => {
                setEditing(null)
                setFormOpen(false)
              }}
            />
          </div>
        </div>
      ) : null}
      {barcodeProduct ? (
        <ProductBarcodeModal product={barcodeProduct} onClose={() => setBarcodeProduct(null)} />
      ) : null}
      {repositoryOpen ? (
        <ProductRepositoryModal
          onClose={() => setRepositoryOpen(false)}
          onSelect={openRepositoryProduct}
        />
      ) : null}
      <div className="inventory-toolbar">
        <div className="toolbar">
          <input
            placeholder="Search name, barcode or SKU"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item === 'all' ? 'All categories' : item}
              </option>
            ))}
          </select>
        </div>
        <div className="inventory-counts">
          <span>
            Showing {filtered.length ? showingEnd : 0}/{filtered.length}
          </span>
          <span>{products.length} total</span>
          <span>{lowStockTotal} low stock</span>
        </div>
      </div>
      {loading ? (
        <LoadingRows />
      ) : visibleProducts.length ? (
        <>
          <div className="table-wrap compact-table inventory-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Barcode</th>
                <th>SKU</th>
                <th>Price</th>
                <th>Inventory</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="product-cell">
                      <div>
                        <strong>{product.name}</strong>
                        <span>
                          {[product.category || 'Uncategorised', product.size].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <button
                      className="barcode-button"
                      type="button"
                      onClick={() => setBarcodeProduct(product)}
                    >
                      {product.barcode}
                    </button>
                  </td>
                  <td className="sku-cell">{product.sku || 'Not set'}</td>
                  <td className="money-cell">{formatMoney(product.price)}</td>
                  <td>
                    <div className="stock-cell">
                      <strong>
                        {product.track_inventory
                          ? `${product.quantity} in stock`
                          : 'Not tracked'}
                      </strong>
                      {product.track_inventory ? (
                        <span>Low stock alert at {product.low_stock_threshold}</span>
                      ) : null}
                    </div>
                    {product.track_inventory &&
                    product.quantity <= product.low_stock_threshold ? (
                      <StatusPill tone="warning">Low</StatusPill>
                    ) : null}
                  </td>
                  <td>
                    <StatusPill tone={product.is_available ? 'success' : 'neutral'}>
                      {product.is_available ? 'Available' : 'Disabled'}
                    </StatusPill>
                  </td>
                  <td className="table-actions">
                    <button type="button" onClick={() => openEditProduct(product)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setProductAvailability(product, !product.is_available)}
                    >
                      {product.is_available ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" onClick={() => deleteProduct(product, loadProducts)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="pagination-row">
            <button disabled={safePage <= 1} type="button" onClick={() => setPage((current) => current - 1)}>
              Previous
            </button>
            <span>
              Page {safePage}/{pageCount}
            </span>
            <button
              disabled={safePage >= pageCount}
              type="button"
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <EmptyState>No products match this view.</EmptyState>
      )}
    </section>
  )
}

function StaffManagement() {
  const [staff, setStaff] = useState([])
  const [storeTerminal, setStoreTerminal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'cashier' })
  const [busy, setBusy] = useState(false)

  const loadStaff = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) {
      setLoading(false)
      setMessage('Your session has expired.')
      return
    }
    const [staffResult, profileResult] = await Promise.all([
      supabase.from('staff_members').select('*').order('created_at', { ascending: false }),
      supabase.from('merchant_profile').select('store_name,branch_name,terminal_auth_code').eq('user_id', authData.user.id).maybeSingle(),
    ])
    const { data, error } = staffResult

    if (showLoading) setLoading(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setStaff(data || [])
    setStoreTerminal(profileResult.data || null)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadStaff(true)
  }, [loadStaff])

  useRealtimeRefresh('staff-live', ['staff_members'], () => loadStaff(false))

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      await callFunction('create-staff-user', {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        role: form.role,
      })
      setForm({ fullName: '', email: '', password: '', role: 'cashier' })
      await loadStaff()
      setMessage('Staff account created.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function setActive(staffMember, isActive) {
    const { error } = await supabase
      .from('staff_members')
      .update({ is_active: isActive })
      .eq('id', staffMember.id)

    if (error) {
      setMessage(error.message)
      return
    }

    loadStaff()
  }

  return (
    <section className="dash-section">
      <PageTitle title="Staff" subtitle="Add cashier and security accounts for checkout operations." />
      <Notice tone="warning">After signing in, each staff member unlocks the terminal with their own authentication code. The signed-in account determines the store automatically.</Notice>
      {storeTerminal ? <section className="store-terminal-code"><div><span>Store-owner terminal code</span><strong>{storeTerminal.terminal_auth_code || 'Not provisioned'}</strong><small>{storeTerminal.store_name} · {storeTerminal.branch_name}</small></div><p>Use this code only when the store owner account opens a cashier terminal. Staff must use their individual code shown below.</p></section> : null}
      {message ? <Notice tone={message.includes('created') ? 'success' : 'warning'}>{message}</Notice> : null}
      <form className="product-form" onSubmit={submit}>
        <h2>Add staff</h2>
        <div className="form-grid">
          <label>
            Full name
            <input
              value={form.fullName}
              onChange={(event) => update('fullName', event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) => update('email', event.target.value)}
            />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(event) => update('role', event.target.value)}>
              <option value="cashier">Cashier</option>
              <option value="security">Shopper verifier</option>
            </select>
          </label>
          <label>
            Temporary password
            <input
              required
              minLength={6}
              type="password"
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
            />
          </label>
        </div>
        <button disabled={busy} type="submit">
          {busy ? 'Creating staff...' : 'Create staff'}
        </button>
      </form>

      {loading ? (
        <LoadingRows />
      ) : staff.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Terminal code</th>
                <th>Status</th>
                <th>Station</th>
                <th>Online</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id}>
                  <td>{member.full_name || 'Not set'}</td>
                  <td>{member.email}</td>
                  <td>{member.role}</td>
                  <td>{member.terminal_auth_code || 'Run migration'}</td>
                  <td>{member.is_active ? 'Active' : 'Disabled'}</td>
                  <td>{member.current_station || '-'}</td>
                  <td>
                    {member.last_seen_at && Date.now() - new Date(member.last_seen_at).getTime() < 2 * 60 * 1000
                      ? 'Online'
                      : 'Offline'}
                  </td>
                  <td>
                    <button type="button" onClick={() => setActive(member, !member.is_active)}>
                      {member.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No staff accounts yet.</EmptyState>
      )}
    </section>
  )
}

function ProductRepositoryModal({ onClose, onSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('Search by product name, barcode or category.')

  async function searchRepository(event) {
    event.preventDefault()
    const term = query.trim().replace(/[%,]/g, ' ')

    if (term.length < 2) {
      setMessage('Enter at least 2 characters to search the product database.')
      return
    }

    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('global_products')
      .select('id,barcode,name,category,size,updated_at')
      .or(`name.ilike.%${term}%,barcode.ilike.%${term}%,category.ilike.%${term}%`)
      .order('updated_at', { ascending: false })
      .limit(20)

    setLoading(false)

    if (error) {
      setResults([])
      setMessage('Product database is a premium feature. Run the Smart Add migration first, then enable repository access.')
      return
    }

    setResults(data || [])
    setMessage(data?.length ? '' : 'No products matched that search yet.')
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal-panel repository-modal">
        <div className="modal-title-row">
          <div>
            <p className="eyebrow">Premium preview</p>
            <h2>Add from product database</h2>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="repository-note">
          Search the shared barcode repository, choose a product, then complete
          price, stock and store-specific details before adding it.
        </p>
        <form className="toolbar repository-search" onSubmit={searchRepository}>
          <input
            autoFocus
            placeholder="Search name, barcode or category"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button disabled={loading} type="submit">
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
        {message ? <Notice tone={message.includes('premium') ? 'warning' : 'neutral'}>{message}</Notice> : null}
        {results.length ? (
          <div className="repository-results">
            {results.map((product) => (
              <button key={product.id} type="button" onClick={() => onSelect(product)}>
                <span>
                  <strong>{product.name}</strong>
                  <small>{[product.category || 'Uncategorised', product.size].filter(Boolean).join(' / ')}</small>
                </span>
                <em>{product.barcode}</em>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function ProductBarcodeModal({ product, onClose }) {
  const barcodeRef = useRef(null)

  useEffect(() => {
    if (!product?.barcode || !barcodeRef.current) return

    async function renderBarcode() {
      const { default: JsBarcode } = await import('jsbarcode')
      if (!barcodeRef.current) return

      JsBarcode(barcodeRef.current, product.barcode, {
        format: 'CODE128',
        width: 1.4,
        height: 78,
        margin: 12,
        displayValue: true,
        fontSize: 14,
      })
    }

    renderBarcode()
  }, [product])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal-panel barcode-modal">
        <div className="modal-title-row">
          <div>
            <p className="eyebrow">Product barcode</p>
            <h2>{product.name}</h2>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="barcode-preview">
          <svg ref={barcodeRef} aria-label={`${product.name} barcode`} />
        </div>
        <SimpleList
          rows={[
            { label: 'Barcode', value: product.barcode },
            { label: 'SKU', value: product.sku || 'Not set' },
            { label: 'Size', value: product.size || 'Not set' },
            { label: 'Price', value: formatMoney(product.price) },
          ]}
        />
      </section>
    </div>
  )
}

function ProductForm({ product, onDone, onCancel }) {
  const [form, setForm] = useState(product)
  const [message, setMessage] = useState('')
  const isEdit = Boolean(product.id)

  useEffect(() => {
    setForm(product)
    setMessage('')
  }, [product])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function save(event) {
    event.preventDefault()
    setMessage('')

    const payload = {
      name: form.name.trim(),
      barcode: form.barcode.trim() || `PLU-${Date.now().toString(36).toUpperCase()}`,
      sku: form.sku.trim() || null,
      category: form.category.trim() || null,
      price: Number(form.price),
      quantity: Number(form.quantity || 0),
      low_stock_threshold: Number(form.low_stock_threshold || 0),
      is_available: Boolean(form.is_available),
      track_inventory: Boolean(form.track_inventory),
      size: form.size?.trim() || null,
      entry_mode: form.entry_mode || 'barcode',
      is_restricted: Boolean(form.is_restricted),
      requires_quantity_entry: Boolean(form.requires_quantity_entry),
      ...(form.global_product_id ? { global_product_id: form.global_product_id } : {}),
    }

    const duplicate = await supabase
      .from('products')
      .select('id')
      .or(`barcode.eq.${payload.barcode},sku.eq.${payload.sku || '__empty__'}`)

    if (duplicate.error) {
      setMessage(duplicate.error.message)
      return
    }

    const conflict = duplicate.data.find((row) => row.id !== product.id)
    if (conflict) {
      setMessage('Barcode or SKU already exists.')
      return
    }

    const result = isEdit
      ? await supabase.from('products').update(payload).eq('id', product.id)
      : await supabase.from('products').insert(payload)

    if (result.error) {
      setMessage(result.error.message)
      return
    }

    setForm(emptyProduct)
    onDone()
  }

  return (
    <form className="product-form" onSubmit={save}>
      <h2>{isEdit ? 'Edit product' : 'Add product'}</h2>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <div className="form-grid">
        <label>
          Product name
          <input required value={form.name} onChange={(event) => update('name', event.target.value)} />
        </label>
        <label>
          Entry type
          <select value={form.entry_mode || 'barcode'} onChange={(event) => update('entry_mode', event.target.value)}><option value="barcode">Scannable barcode</option><option value="plu">PLU / loose item</option><option value="weighed">Priced by entered quantity</option></select>
        </label>
        <label>
          {form.entry_mode === 'barcode' ? 'Barcode' : 'PLU code (optional)'}
          <input
            required={form.entry_mode === 'barcode'}
            value={form.barcode}
            onChange={(event) => update('barcode', event.target.value)}
          />
        </label>
        <label className="check-field"><input type="checkbox" checked={Boolean(form.requires_quantity_entry)} onChange={(event) => update('requires_quantity_entry', event.target.checked)} /><span>Ask shopper/cashier for quantity</span></label>
        <label className="check-field"><input type="checkbox" checked={Boolean(form.is_restricted)} onChange={(event) => update('is_restricted', event.target.checked)} /><span>Restricted item — cashier assistance required</span></label>
        <label>
          SKU
          <input value={form.sku || ''} onChange={(event) => update('sku', event.target.value)} />
        </label>
        <label>
          Category
          <input
            value={form.category || ''}
            onChange={(event) => update('category', event.target.value)}
          />
        </label>
        <label>
          Size
          <input
            value={form.size || ''}
            onChange={(event) => update('size', event.target.value)}
            placeholder="500ml, 1kg, 12 pcs"
          />
        </label>
        <label>
          Price
          <input
            required
            min="0"
            step="0.01"
            type="number"
            value={form.price}
            onChange={(event) => update('price', event.target.value)}
          />
        </label>
        <label>
          Quantity
          <input
            min="0"
            type="number"
            value={form.quantity}
            onChange={(event) => update('quantity', event.target.value)}
          />
        </label>
        <label>
          Low stock threshold
          <input
            min="0"
            type="number"
            value={form.low_stock_threshold}
            onChange={(event) => update('low_stock_threshold', event.target.value)}
          />
        </label>
        <label>
          Availability status
          <select
            value={form.is_available ? 'available' : 'disabled'}
            onChange={(event) => update('is_available', event.target.value === 'available')}
          >
            <option value="available">Available</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label className="check-field">
          <input
            checked={Boolean(form.track_inventory)}
            type="checkbox"
            onChange={(event) => update('track_inventory', event.target.checked)}
          />
          Track inventory
        </label>
      </div>
      <div className="action-row">
        <button type="submit">{isEdit ? 'Save changes' : 'Add product'}</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

async function deleteProduct(product, onDone) {
  const confirmed = window.confirm(`Delete ${product.name}?`)
  if (!confirmed) return

  await supabase.from('products').delete().eq('id', product.id)
  onDone()
}

function CsvImport() {
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const required = ['name', 'barcode', 'price', 'quantity', 'category', 'sku', 'low_stock_threshold']

  function parseFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(result) {
        const nextErrors = []
        const headers = result.meta.fields || []
        required.forEach((field) => {
          if (!headers.includes(field)) nextErrors.push(`Missing column: ${field}`)
        })

        const seenBarcodes = new Set()
        const seenSkus = new Set()
        const nextRows = result.data.map((row, index) => {
          const line = index + 2
          const cleaned = {
            name: String(row.name || '').trim(),
            barcode: String(row.barcode || '').trim(),
            price: Number(row.price),
            quantity: Number(row.quantity),
            category: String(row.category || '').trim(),
            sku: String(row.sku || '').trim(),
            low_stock_threshold: Number(row.low_stock_threshold || 0),
          }

          if (!cleaned.name) nextErrors.push(`Row ${line}: name is required.`)
          if (!cleaned.barcode) nextErrors.push(`Row ${line}: barcode is required.`)
          if (Number.isNaN(cleaned.price) || cleaned.price < 0) nextErrors.push(`Row ${line}: price is invalid.`)
          if (Number.isNaN(cleaned.quantity) || cleaned.quantity < 0) nextErrors.push(`Row ${line}: quantity is invalid.`)
          if (Number.isNaN(cleaned.low_stock_threshold) || cleaned.low_stock_threshold < 0) {
            nextErrors.push(`Row ${line}: low_stock_threshold is invalid.`)
          }
          if (seenBarcodes.has(cleaned.barcode)) nextErrors.push(`Row ${line}: duplicate barcode in file.`)
          if (cleaned.sku && seenSkus.has(cleaned.sku)) nextErrors.push(`Row ${line}: duplicate SKU in file.`)

          seenBarcodes.add(cleaned.barcode)
          if (cleaned.sku) seenSkus.add(cleaned.sku)
          return cleaned
        })

        setRows(nextRows)
        setErrors(nextErrors)
      },
      error(error) {
        setErrors([error.message])
      },
    })
  }

  async function confirmImport() {
    setImporting(true)
    setErrors([])

    const barcodes = rows.map((row) => row.barcode)
    const skus = rows.map((row) => row.sku).filter(Boolean)
    const existing = await supabase
      .from('products')
      .select('barcode,sku')
      .or(`barcode.in.(${barcodes.join(',')}),sku.in.(${skus.join(',') || '__none__'})`)

    if (existing.error) {
      setErrors([existing.error.message])
      setImporting(false)
      return
    }

    if (existing.data.length) {
      setErrors(existing.data.map((item) => `Already exists: ${item.barcode || item.sku}`))
      setImporting(false)
      return
    }

    const { error } = await supabase.from('products').insert(
      rows.map((row) => ({
        ...row,
        sku: row.sku || null,
        category: row.category || null,
        is_available: true,
        track_inventory: true,
      })),
    )

    setImporting(false)
    if (error) {
      setErrors([error.message])
      return
    }

    navigate('/dash/products')
  }

  return (
    <section className="dash-section">
      <PageTitle
        title="CSV import"
        subtitle="Upload name, barcode, price, quantity, category, sku and low_stock_threshold."
      />
      <input accept=".csv,text/csv" type="file" onChange={parseFile} />
      {errors.length ? (
        <Notice tone="error">
          <strong>Fix these before importing:</strong>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {rows.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {required.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row) => (
                  <tr key={`${row.barcode}-${row.sku}`}>
                    {required.map((column) => (
                      <td key={column}>{row[column]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button disabled={Boolean(errors.length) || importing} type="button" onClick={confirmImport}>
            {importing ? 'Importing...' : `Import ${rows.length} products`}
          </button>
        </>
      ) : (
        <EmptyState>No CSV selected yet.</EmptyState>
      )}
    </section>
  )
}

function QrPage() {
  const [qr, setQr] = useState(null)
  const [merchantId, setMerchantId] = useState('')
  const [image, setImage] = useState('')
  const [loading, setLoading] = useState(true)
  const [qrBusy, setQrBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadQr = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setMessage('')
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) {
      setLoading(false)
      setMessage('Your session has expired. Sign in again to manage the store QR.')
      return
    }
    const profileResult = await supabase.from('merchant_profile').select('id').eq('user_id', authData.user.id).maybeSingle()
    if (profileResult.error || !profileResult.data) {
      setLoading(false)
      setMessage(profileResult.error?.message || 'Store profile not found.')
      return
    }
    setMerchantId(profileResult.data.id)
    const { data, error } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('merchant_id', profileResult.data.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (showLoading) setLoading(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setQr(data)
    if (data) {
      const url = `${window.location.origin}/s/${data.qr_code}`
      setImage(await QRCode.toDataURL(url, { margin: 1, width: 280 }))
    }
  }, [])

  useEffect(() => {
    loadQr(true)
  }, [loadQr])

  useRealtimeRefresh('qr-live', ['qr_codes'], () => loadQr(false))

  async function regenerate() {
    if (qrBusy) return
    if (!merchantId) {
      setMessage('Store profile is still loading. Refresh the page and try again.')
      return
    }
    setQrBusy(true)
    setMessage('')
    const newCode = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    const retired = await supabase.from('qr_codes').update({ is_active: false, disabled_at: new Date().toISOString() }).eq('merchant_id', merchantId).eq('is_active', true)
    if (retired.error) {
      setMessage(retired.error.message)
      setQrBusy(false)
      return
    }
    const { error } = await supabase.from('qr_codes').insert({ merchant_id: merchantId, qr_code: newCode, is_active: true })
    if (error) {
      setMessage(error.message)
      setQrBusy(false)
      return
    }
    await loadQr(false)
    setQrBusy(false)
  }

  function printQr() {
    window.print()
  }

  return (
    <section className="dash-section">
      <PageTitle title="Store QR code" subtitle="One active QR points customers to this store checkout." />
      {message ? <Notice tone="error">{message}</Notice> : null}
      {loading ? (
        <LoadingRows />
      ) : qr ? (
        <div className="qr-panel">
          <img alt="Active store checkout QR code" src={image} />
          <p>{`${window.location.origin}/s/${qr.qr_code}`}</p>
          <div className="action-row">
            <a className="primary-action" download="glide-store-qr.png" href={image}>
              Download QR
            </a>
            <button type="button" onClick={printQr}>
              Print QR
            </button>
            <button disabled={qrBusy} type="button" onClick={regenerate}>
              {qrBusy ? 'Creating…' : 'Regenerate QR'}
            </button>
          </div>
        </div>
      ) : (
        <div className="action-row">
          <EmptyState>No active QR exists yet.</EmptyState>
          <button disabled={qrBusy || !merchantId} type="button" onClick={regenerate}>
            {qrBusy ? 'Creating…' : 'Create active QR'}
          </button>
        </div>
      )}
    </section>
  )
}

const cashierCatalogKey = 'glide:cashier:catalog'
const cashierTerminalKey = 'glide:cashier:terminal'
const cashierHeldOrdersKey = 'glide:cashier:held-orders'
const cashierQueueKey = 'glide:cashier:queue'

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function CashierPage({ session }) {
  const [terminal, setTerminal] = useState(() => readJsonStorage(cashierTerminalKey, null))
  const [catalog, setCatalog] = useState(() => readJsonStorage(cashierCatalogKey, []))
  const [gateway, setGateway] = useState({ storeName: terminal?.storeName || '', authCode: '' })
  const [mode, setMode] = useState('home')
  const [barcode, setBarcode] = useState('')
  const [cart, setCart] = useState([])
  const [heldOrders, setHeldOrders] = useState(() => readJsonStorage(cashierHeldOrdersKey, []))
  const [queue, setQueue] = useState(() => readJsonStorage(cashierQueueKey, []))
  const [payment, setPayment] = useState({ type: 'Cash', reference: '' })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  const cartCount = cart.reduce((sum, item) => sum + item.cartQuantity, 0)
  const total = cart.reduce((sum, item) => sum + Number(item.price) * item.cartQuantity, 0)

  const searchResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    if (!term) return catalog.slice(0, 12)
    return catalog
      .filter((product) => {
        const text = `${product.name} ${product.barcode} ${product.sku} ${product.category}`.toLowerCase()
        return text.includes(term)
      })
      .slice(0, 20)
  }, [catalog, searchQuery])

  useEffect(() => {
    const refreshNetwork = () => setOnline(navigator.onLine)
    window.addEventListener('online', refreshNetwork)
    window.addEventListener('offline', refreshNetwork)
    return () => {
      window.removeEventListener('online', refreshNetwork)
      window.removeEventListener('offline', refreshNetwork)
    }
  }, [])

  useEffect(() => {
    if (terminal?.cashierEmail && terminal.cashierEmail !== session.user.email) {
      localStorage.removeItem(cashierTerminalKey)
      setTerminal(null)
    }
  }, [session.user.email, terminal])

  useEffect(() => {
    writeJsonStorage(cashierHeldOrdersKey, heldOrders)
  }, [heldOrders])

  useEffect(() => {
    writeJsonStorage(cashierQueueKey, queue)
  }, [queue])

  useEffect(() => {
    if (terminal) writeJsonStorage(cashierTerminalKey, terminal)
  }, [terminal])

  useEffect(() => {
    writeJsonStorage(cashierCatalogKey, catalog)
  }, [catalog])

  useEffect(() => {
    if (!terminal) return undefined

    const ping = () => {
      callFunction('cashier-terminal', {
        action: 'validate-terminal',
        storeName: terminal.storeName,
        authCode: gateway.authCode || terminal.authCode || '',
        station: 'cashier',
      }).catch(() => {})
    }

    const timer = window.setInterval(ping, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [gateway.authCode, terminal])

  async function logout() {
    localStorage.removeItem(cashierTerminalKey)
    setTerminal(null)
    await supabase.auth.signOut()
    navigate('/login')
  }

  function updateGateway(field, value) {
    setGateway((current) => ({ ...current, [field]: value }))
  }

  async function validateGateway(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      const result = await callFunction('cashier-terminal', {
        action: 'validate-terminal',
        authCode: gateway.authCode,
        station: 'cashier',
      })
      setTerminal({ ...result.terminal, authCode: gateway.authCode })
      setCatalog(result.catalog || [])
      setGateway((current) => ({ ...current, authCode: '' }))
      setMessage('Cashier terminal unlocked. Product catalog cached on this device.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  function addProduct(product) {
    const existing = cart.find((item) => item.id === product.id)
    const nextQuantity = (existing?.cartQuantity || 0) + 1

    if (product.track_inventory && nextQuantity > product.quantity) {
      setMessage('This item is out of stock.')
      return
    }

    setCart((current) =>
      existing
        ? current.map((item) =>
            item.id === product.id ? { ...item, cartQuantity: nextQuantity } : item,
          )
        : [...current, { ...product, cartQuantity: 1 }],
    )
    setBarcode('')
    setSearchOpen(false)
    setMessage(`${product.name} added.`)
  }

  function addBarcode(event) {
    event.preventDefault()
    const code = barcode.trim()
    if (!code) return

    const product = catalog.find((item) => item.barcode === code || item.sku === code)
    if (!product) {
      setMessage('Product not found in the cached branch catalog.')
      return
    }

    addProduct(product)
  }

  function changeQuantity(product, delta) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== product.id) return item
          const next = item.cartQuantity + delta
          if (item.track_inventory && next > item.quantity) return item
          return { ...item, cartQuantity: next }
        })
        .filter((item) => item.cartQuantity > 0),
    )
  }

  function pauseOrder() {
    if (!cart.length) return
    setHeldOrders((current) => [
      {
        id: `hold-${Date.now()}`,
        createdAt: new Date().toISOString(),
        cart,
        total,
      },
      ...current,
    ])
    setCart([])
    setMessage('Order paused. New checkout is ready.')
  }

  function restoreHeldOrder(order) {
    if (cart.length) pauseOrder()
    setCart(order.cart)
    setHeldOrders((current) => current.filter((item) => item.id !== order.id))
    setMessage('Held order restored.')
  }

  function removeHeldOrder(order) {
    setHeldOrders((current) => current.filter((item) => item.id !== order.id))
  }

  function decrementCachedInventory(saleCart) {
    setCatalog((current) =>
      current.map((product) => {
        const sold = saleCart.find((item) => item.id === product.id)
        if (!sold || !product.track_inventory) return product
        return {
          ...product,
          quantity: Math.max(0, Number(product.quantity || 0) - sold.cartQuantity),
        }
      }),
    )
  }

  const syncQueuedOrders = useCallback(async () => {
    if (!queue.length || busy) return
    setBusy(true)
    const [nextOrder, ...remaining] = queue

    try {
      const result = await callFunction('cashier-create-order', {
        cart: nextOrder.cart.map((item) => ({ productId: item.id, quantity: item.cartQuantity })),
        paymentType: nextOrder.paymentType,
        manualReference: nextOrder.manualReference,
      })
      setQueue(remaining)
      setMessage(`Synced queued sale. Receipt ${result.receiptToken}.`)
    } catch (error) {
      setMessage(`Queue waiting: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }, [busy, queue])

  useEffect(() => {
    if (online && terminal && queue.length) syncQueuedOrders()
  }, [online, terminal, queue.length, syncQueuedOrders])

  async function completeSale() {
    if (!cart.length) return
    const sale = {
      id: `sale-${Date.now()}`,
      createdAt: new Date().toISOString(),
      cart,
      paymentType: payment.type,
      manualReference: payment.reference.trim(),
      total,
    }

    if (!online) {
      setQueue((current) => [sale, ...current])
      decrementCachedInventory(sale.cart)
      setCart([])
      setPayment({ type: 'Cash', reference: '' })
      setMessage('Offline sale stored safely on this device.')
      window.print()
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const result = await callFunction('cashier-create-order', {
        cart: sale.cart.map((item) => ({ productId: item.id, quantity: item.cartQuantity })),
        paymentType: sale.paymentType,
        manualReference: sale.manualReference,
      })
      decrementCachedInventory(sale.cart)
      setCart([])
      setPayment({ type: 'Cash', reference: '' })
      navigate(`/receipt/${result.receiptToken}`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (!terminal) {
    return (
      <main className="cashier-page cashier-lock-page">
        <form className="cashier-lock-panel" onSubmit={validateGateway}>
          <Link className="brand" href="/">
            Glide Cashier
          </Link>
          <p className="eyebrow">Secure terminal</p>
          <h1>Unlock store access</h1>
          <p>Sign-in is complete. Enter the terminal code assigned to this account.</p>
          {message ? <Notice tone="warning">{message}</Notice> : null}
          <label>
            Authentication Code
            <input
              required
              autoFocus
              autoCapitalize="characters"
              value={gateway.authCode}
              onChange={(event) => updateGateway('authCode', event.target.value.toUpperCase())}
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? 'Checking terminal...' : 'Unlock terminal'}
          </button>
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="cashier-page">
      <header className="cashier-header">
        <div>
          <span>{terminal.storeName}</span>
          <strong>{mode === 'home' ? 'Cashier dashboard' : mode === 'verify' ? 'Payment verification' : 'Manual checkout'}</strong>
          <small>{terminal.branchName || 'Main branch'} - {session.user.email}</small>
        </div>
        <div className="cashier-header-actions">
          {mode !== 'home' ? (
            <button type="button" onClick={() => setMode('home')}>
              Home
            </button>
          ) : null}
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {message ? <Notice tone={message.includes('Security Warning') ? 'error' : message.includes('added') || message.includes('confirmed') || message.includes('unlocked') ? 'success' : 'warning'}>{message}</Notice> : null}

      {mode === 'home' ? (
        <section className="cashier-home-panel">
          <button className="cashier-mode-button manual" type="button" onClick={() => setMode('manual')}>
            <span>Manual Checkout</span>
            <small>Walk-in shoppers, scanner cart and counter payment</small>
          </button>
          <button className="cashier-mode-button verify" type="button" onClick={() => setMode('verify')}>
            <span>Verify shopper payment</span>
            <small>Find a paid receipt, inspect every item and mark the basket</small>
          </button>
        </section>
      ) : null}

      {mode === 'verify' ? <PaymentVerifier station="cashier" compact /> : null}

      {mode === 'manual' ? (
        <>
          <form className="cashier-scan-bar" onSubmit={addBarcode}>
            <label>
              Scan barcode
              <input
                autoFocus
                inputMode="numeric"
                placeholder="Hardware scanner or manual barcode"
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
              />
            </label>
            <button type="submit">Add</button>
            <button type="button" onClick={() => setSearchOpen(true)}>
              Search Items
            </button>
            <button disabled={!cart.length} type="button" onClick={pauseOrder}>
              Pause Order
            </button>
          </form>

          {heldOrders.length ? (
            <section className="held-order-strip" aria-label="Paused orders">
              {heldOrders.map((order) => (
                <div key={order.id}>
                  <span>{order.cart.reduce((sum, item) => sum + item.cartQuantity, 0)} items</span>
                  <strong>{formatMoney(order.total)}</strong>
                  <button type="button" onClick={() => restoreHeldOrder(order)}>
                    Restore
                  </button>
                  <button type="button" onClick={() => removeHeldOrder(order)}>
                    Clear
                  </button>
                </div>
              ))}
            </section>
          ) : null}

          <section className="cart-panel active cashier-cart">
            <div className="cart-title-row">
              <h1>Active cart</h1>
              <strong>{cartCount} items - {formatMoney(total)}</strong>
            </div>

            {cart.length ? (
              <>
                {cart.map((item) => (
                  <div className="cart-row" key={item.id}>
                    <button
                      className="cart-remove-dot"
                      type="button"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => changeQuantity(item, -item.cartQuantity)}
                    >
                      x
                    </button>
                    <div className="product-thumb" aria-hidden="true">
                      {productInitials(item.name)}
                    </div>
                    <div className="cart-item-copy">
                      <strong>{item.name}</strong>
                      <span>{item.barcode} - {formatMoney(item.price)}</span>
                    </div>
                    <strong className="cart-line-total">
                      {formatMoney(item.price * item.cartQuantity)}
                    </strong>
                    <div className="quantity-actions">
                      <button type="button" onClick={() => changeQuantity(item, -1)}>
                        -
                      </button>
                      <span>{item.cartQuantity}</span>
                      <button type="button" onClick={() => changeQuantity(item, 1)}>
                        +
                      </button>
                    </div>
                  </div>
                ))}

                <div className="cashier-payment-panel">
                  <label>
                    Payment type
                    <select
                      value={payment.type}
                      onChange={(event) => setPayment((current) => ({ ...current, type: event.target.value }))}
                    >
                      <option>Cash</option>
                      <option>Card</option>
                      <option>Bank Transfer</option>
                    </select>
                  </label>
                  <label>
                    Manual reference
                    <input
                      placeholder={online ? 'Optional' : 'Required while offline'}
                      value={payment.reference}
                      onChange={(event) => setPayment((current) => ({ ...current, reference: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="cart-checkout-bar">
                  <div className="cart-total">
                    <span>Total</span>
                    <strong>{formatMoney(total)}</strong>
                  </div>
                  <button disabled={busy} type="button" onClick={completeSale}>
                    {busy ? 'Finishing sale...' : online ? 'Print receipt and close sale' : 'Store offline sale'}
                  </button>
                </div>
              </>
            ) : (
              <EmptyState>Scan a barcode, search by item name, or restore a paused order.</EmptyState>
            )}
          </section>
        </>
      ) : null}

      {searchOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setSearchOpen(false)}>
          <section className="modal-panel cashier-search-modal" onClick={(event) => event.stopPropagation()}>
            <div className="cart-title-row">
              <h1>Search Items</h1>
              <button type="button" onClick={() => setSearchOpen(false)}>
                Close
              </button>
            </div>
            <input
              autoFocus
              placeholder="Name, barcode or SKU"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <div className="cashier-search-list">
              {searchResults.map((product) => (
                <button type="button" key={product.id} onClick={() => addProduct(product)}>
                  <span>{product.name}</span>
                  <strong>{formatMoney(product.price)}</strong>
                  <small>{product.barcode || product.sku}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <footer className={`cashier-status-bar ${online ? 'online' : 'offline'}`}>
        <span>{online ? 'Online and synced' : 'Offline mode'}</span>
        <strong>{queue.length} transaction{queue.length === 1 ? '' : 's'} waiting to upload</strong>
        {online && queue.length ? (
          <button disabled={busy} type="button" onClick={syncQueuedOrders}>
            Sync now
          </button>
        ) : null}
      </footer>
    </main>
  )
}

function CustomerCheckout({ qrCode }) {
  const [store, setStore] = useState(null)
  const [inactive, setInactive] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [shopperSessionId, setShopperSessionId] = useState('')
  const [showSplash, setShowSplash] = useState(true)
  const [showIntro, setShowIntro] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [activeTab, setActiveTab] = useState('scan')
  const [barcode, setBarcode] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [cart, setCart] = useState([])
  const [message, setMessage] = useState('')
  const [networkWarning, setNetworkWarning] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraState, setCameraState] = useState('idle')
  const [addToast, setAddToast] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [pendingScan, setPendingScan] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [shopperLocation, setShopperLocation] = useState(null)
  const [geofenceState, setGeofenceState] = useState('checking')
  const [locationMessage, setLocationMessage] = useState('')
  const [locationBusy, setLocationBusy] = useState(false)
  const [pendingPayment, setPendingPayment] = useState(() => readJsonStorage(`glide:pending-payment:${qrCode}`, null))
  const [paymentRecoveryState, setPaymentRecoveryState] = useState('idle')
  const [spendLimit, setSpendLimit] = useState(() => Number(localStorage.getItem(`glide:spend-limit:${qrCode}`)) || 0)
  const [budgetDraft, setBudgetDraft] = useState('')
  const [showBudgetPrompt, setShowBudgetPrompt] = useState(false)
  const [editingBudget, setEditingBudget] = useState(false)
  const [showChallengeModal, setShowChallengeModal] = useState(false)
  const [nepoToast, setNepoToast] = useState('')
  const [limitIgnored, setLimitIgnored] = useState(false)
  const [limitExceededPrompt, setLimitExceededPrompt] = useState(false)
  const videoRef = useRef(null)
  const toastTimerRef = useRef(null)
  const idleTimerRef = useRef(null)
  const nativeScanStopRef = useRef(null)
  const audioContextRef = useRef(null)
  const sessionIdRef = useRef('')
  const sessionMetaRef = useRef({ qrCodeId: null, merchantId: null })
  const activityWriteRef = useRef(0)
  const cartRef = useRef(cart)
  const scannerControlsRef = useRef(null)
  const scannerReaderRef = useRef(null)
  const scanProcessingRef = useRef(false)
  const lastDetectedRef = useRef({ code: '', time: 0 })
  const latestVisibleBarcodeRef = useRef({ code: '', time: 0 })
  const pendingScanRef = useRef(null)
  const autoCameraTriedRef = useRef(false)
  const confirmResolveRef = useRef(null)
  const recoveryAttemptedRef = useRef(false)
  const limitAlertedRef = useRef(false)
  const sessionStorageKey = `glide:checkout:${qrCode}:session`
  const cartStorageKey = `glide:checkout:${qrCode}:cart`
  const activityStorageKey = `glide:checkout:${qrCode}:lastActivity`
  const networkWarningKey = `glide:checkout:${qrCode}:networkWarningShown`
  const spendLimitKey = `glide:spend-limit:${qrCode}`
  const pendingPaymentKey = `glide:pending-payment:${qrCode}`
  const challengeTarget = 15000

  useEffect(() => {
    if (spendLimit > 0) localStorage.setItem(spendLimitKey, String(spendLimit))
    else localStorage.removeItem(spendLimitKey)
  }, [spendLimit, spendLimitKey])

  useEffect(() => {
    if (!message || pendingPayment || busy) return undefined
    const timer = window.setTimeout(() => setMessage(''), 3500)
    return () => window.clearTimeout(timer)
  }, [busy, message, pendingPayment])

  useEffect(() => {
    let nextSessionId = sessionStorage.getItem(sessionStorageKey)
    const lastActivity = Number(sessionStorage.getItem(activityStorageKey) || Date.now())

    if (nextSessionId && Date.now() - lastActivity >= SHOPPER_IDLE_TIMEOUT_MS) {
      destroyShopperSession(nextSessionId)
      sessionStorage.removeItem(sessionStorageKey)
      sessionStorage.removeItem(cartStorageKey)
      sessionStorage.removeItem(activityStorageKey)
      nextSessionId = ''
      setSessionEnded(true)
      return undefined
    }

    if (!nextSessionId) {
      nextSessionId = crypto.randomUUID()
      sessionStorage.setItem(sessionStorageKey, nextSessionId)
      sessionStorage.setItem(activityStorageKey, String(Date.now()))
    }

    sessionIdRef.current = nextSessionId
    setShopperSessionId(nextSessionId)

    const savedCart = sessionStorage.getItem(cartStorageKey)
    if (savedCart) {
      try {
        const parsedCart = JSON.parse(savedCart)
        if (Array.isArray(parsedCart)) setCart(parsedCart)
      } catch {
        sessionStorage.removeItem(cartStorageKey)
      }
    }

    async function loadStore() {
      const { data, error } = await supabase
        .from('qr_codes')
        .select('id,merchant_id,qr_code,is_active,merchant_profile(store_name,geofence_enabled,geofence_latitude,geofence_longitude,geofence_radius_meters)')
        .eq('qr_code', qrCode)
        .maybeSingle()

      if (error || !data || !data.is_active) {
        setInactive(true)
        return
      }

      sessionMetaRef.current = { qrCodeId: data.id, merchantId: data.merchant_id }
      setStore(data)
      markShopperActivity(nextSessionId, data)
    }
    loadStore()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activityStorageKey, cartStorageKey, qrCode, sessionStorageKey])

  useEffect(() => {
    if (!store) return undefined

    const splashTimer = window.setTimeout(() => {
      setShowSplash(false)
      setShowIntro(true)
    }, 2000)

    return () => window.clearTimeout(splashTimer)
  }, [store])

  useEffect(() => {
    if (!store || !pendingPayment?.receiptToken || recoveryAttemptedRef.current) return
    recoveryAttemptedRef.current = true
    recoverPendingPayment(true)
    // The recovery is deliberately attempted once when this store checkout reloads.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [store, pendingPayment?.receiptToken])

  useEffect(() => {
    if (!store || !shopperSessionId || pendingPayment?.receiptToken || recoveryAttemptedRef.current) return
    recoveryAttemptedRef.current = true
    recoverSessionPayment(shopperSessionId)
    // This one-time lookup recovers payments created before browser recovery data existed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [store, shopperSessionId, pendingPayment?.receiptToken])

  useEffect(() => {
    if (!store) return undefined
    if (!store.merchant_profile?.geofence_enabled) {
      setGeofenceState('inside')
      return undefined
    }

    if (!navigator.geolocation) {
      setGeofenceState('unsupported')
      setLocationMessage('This browser does not support location. Open the store link in Chrome, Safari or Edge on a location-enabled device.')
      return undefined
    }
    setGeofenceState('required')
    navigator.permissions?.query?.({ name: 'geolocation' })?.then((permission) => {
      if (permission.state === 'granted') requestShopperLocation(true)
      if (permission.state === 'denied') {
        setGeofenceState('blocked')
        setLocationMessage('Location is blocked for this site. Allow precise location in your browser settings, then try again.')
      }
    })?.catch(() => {})
    return undefined
    // Location is intentionally requested from a visible user action when permission is not already granted.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  function requestShopperLocation(automatic = false) {
    if (!navigator.geolocation || !store?.merchant_profile?.geofence_enabled) return
    if (!window.isSecureContext) {
      setGeofenceState('blocked')
      setLocationMessage('Location requires a secure HTTPS link. Open the published Glide store URL instead of an unsecured preview.')
      return
    }
    const rawStoreLatitude = store.merchant_profile.geofence_latitude
    const rawStoreLongitude = store.merchant_profile.geofence_longitude
    const storeLatitude = Number(rawStoreLatitude)
    const storeLongitude = Number(rawStoreLongitude)
    if (rawStoreLatitude == null || rawStoreLongitude == null || !Number.isFinite(storeLatitude) || !Number.isFinite(storeLongitude)) {
      setGeofenceState('unavailable')
      setLocationMessage('This store’s shopping area is not configured correctly. Please ask a staff member for help.')
      return
    }
    setLocationBusy(true)
    setGeofenceState('checking')
    setLocationMessage(automatic ? 'Refreshing your location…' : 'Waiting for precise location permission…')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, capturedAt: new Date().toISOString() }
        const distance = distanceInMeters({ latitude: storeLatitude, longitude: storeLongitude }, location)
        const allowedRadius = Number(store.merchant_profile.geofence_radius_meters || 150)
        const accuracyBuffer = Math.min(Math.max(Number(coords.accuracy) || 0, 0), 250)
        const inside = distance <= allowedRadius + accuracyBuffer
        setShopperLocation(location)
        if (Number(coords.accuracy) > 500) {
          setGeofenceState('unavailable')
          setLocationMessage(`Your location is only accurate to ±${Math.round(coords.accuracy)} m, so Glide cannot verify the store safely. Turn on precise location and Wi-Fi, then retry.`)
        } else {
          setGeofenceState(inside ? 'inside' : 'outside')
          setLocationMessage(inside ? `Location confirmed: about ${Math.round(distance)} m from the store point with ±${Math.round(coords.accuracy || 0)} m device accuracy.` : `Your device places you about ${Math.round(distance)} m from the saved store point. This store allows ${allowedRadius} m, plus device accuracy. Ask the store to recapture its geofence if you are physically inside.`)
        }
        setLocationBusy(false)
      },
      (error) => {
        const messages = {
          1: 'Location permission was denied. Allow precise location for this site in your browser settings, then try again.',
          2: 'Your device could not determine its location. Turn on Location Services, Wi-Fi or mobile data and try again.',
          3: 'Location took too long. Move near a window or store entrance and try again.',
        }
        setGeofenceState(error.code === 1 ? 'blocked' : 'unavailable')
        setLocationMessage(messages[error.code] || 'Location could not be confirmed. Check device location settings and try again.')
        setLocationBusy(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }

  useEffect(
    () => () => {
      stopCamera()
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!store || showSplash || activeTab !== 'scan' || sessionEnded) return
    if (store.merchant_profile?.geofence_enabled && geofenceState !== 'inside') return
    if (cameraState !== 'idle' || autoCameraTriedRef.current) return

    autoCameraTriedRef.current = true
    startCamera({ automatic: true })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, cameraState, geofenceState, sessionEnded, showSplash, store])

  useEffect(() => {
    cartRef.current = cart
    if (cart.length) {
      sessionStorage.setItem(cartStorageKey, JSON.stringify(cart))
    } else {
      sessionStorage.removeItem(cartStorageKey)
    }
  }, [cart, cartStorageKey])

  useEffect(() => {
    if (!shopperSessionId || sessionEnded) return undefined

    resetIdleTimer()
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopperSessionId, sessionEnded])

  useEffect(() => {
    function checkNetworkQuality() {
      if (sessionStorage.getItem(networkWarningKey)) return

      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
      const poorConnection =
        !navigator.onLine ||
        connection?.effectiveType === 'slow-2g' ||
        connection?.effectiveType === '2g' ||
        (Number(connection?.downlink) > 0 && Number(connection.downlink) < 1) ||
        Number(connection?.rtt) > 800

      if (!poorConnection) return

      sessionStorage.setItem(networkWarningKey, 'true')
      setNetworkWarning('Internet access is poor. Please connect to a good service.')
    }

    checkNetworkQuality()
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    connection?.addEventListener?.('change', checkNetworkQuality)
    window.addEventListener('offline', checkNetworkQuality)

    return () => {
      connection?.removeEventListener?.('change', checkNetworkQuality)
      window.removeEventListener('offline', checkNetworkQuality)
    }
  }, [networkWarningKey])

  async function markShopperActivity(sessionId = sessionIdRef.current, storeData = store, force = false) {
    if (!sessionId) return

    const now = Date.now()
    if (!force && now - activityWriteRef.current < SESSION_ACTIVITY_WRITE_MS) return
    activityWriteRef.current = now

    try {
      await callFunction(
        'shopper-session',
        {
          action: 'touch',
          sessionId,
          qrCode: qrCode || storeData?.qr_code || sessionMetaRef.current.qrCode,
        },
        false,
      )
    } catch {
      // The session table is optional until its migration is run.
    }
  }

  async function destroyShopperSession(sessionId = sessionIdRef.current) {
    if (!sessionId) return

    try {
      await callFunction('shopper-session', { action: 'end', sessionId }, false)
    } catch {
      // Local cleanup still matters if the remote session row is unavailable.
    }
  }

  function resetIdleTimer() {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => {
      endSession('idle')
    }, SHOPPER_IDLE_TIMEOUT_MS)
  }

  function noteActivity(force = false) {
    if (!sessionIdRef.current) return
    sessionStorage.setItem(activityStorageKey, String(Date.now()))
    resetIdleTimer()
    markShopperActivity(sessionIdRef.current, store, force)
  }

  async function addBarcodeFromValue(rawCode, source = 'manual') {
    setMessage('')
    noteActivity()
    const code = cleanBarcodeText(rawCode)
    if (!code) return false
    const barcodeCandidates = [...new Set([code, /^0\d{11,13}$/.test(code) ? code.slice(1) : '', /^\d{11,12}$/.test(code) ? `0${code}` : ''].filter(Boolean))]

    const { data, error } = await supabase
      .from('products')
      .select('id,name,barcode,sku,category,price,quantity,low_stock_threshold,is_available,track_inventory,size,unit_label,pack_label,units_per_pack,pack_price,created_at')
      .eq('merchant_id', store?.merchant_id)
      .in('barcode', barcodeCandidates)
      .eq('is_available', true)
      .limit(1)
      .maybeSingle()

    if (error) {
      setMessage(`We could not check this store’s inventory. ${error.message}`)
      setScanResult({ status: 'blocked', code, label: 'Inventory lookup unavailable' })
      return false
    }
    if (!data) {
      setMessage(source === 'camera' ? `Barcode ${code} is not active in this store’s inventory. Ask staff to confirm its barcode and availability.` : 'This barcode is not active in this store’s inventory.')
      setScanResult({ status: 'missing', code, label: 'No product found' })
      return false
    }

    const existing = cartRef.current.find((item) => item.id === data.id)
    const suggestedQuantity = (existing?.cartQuantity || 0) + 1
    if (data.track_inventory && suggestedQuantity > data.quantity) {
      setMessage('This item is out of stock.')
      setScanResult({ status: 'blocked', code, label: 'Out of stock' })
      return false
    }

    const nextPendingScan = {
      product: data,
      quantity: Math.max(1, suggestedQuantity),
      existingQuantity: existing?.cartQuantity || 0,
      source,
    }
    pendingScanRef.current = nextPendingScan
    setPendingScan(nextPendingScan)
    setScanResult({ status: 'ready', code, label: data.name })
    playScanSound()
    setBarcode('')
    return true
  }

  function playScanSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return

      const audioContext = audioContextRef.current || new AudioContext()
      audioContextRef.current = audioContext
      const first = audioContext.createOscillator()
      const second = audioContext.createOscillator()
      const gain = audioContext.createGain()

      first.type = 'sine'
      second.type = 'triangle'
      first.frequency.setValueAtTime(1046.5, audioContext.currentTime)
      first.frequency.exponentialRampToValueAtTime(1568, audioContext.currentTime + 0.09)
      second.frequency.setValueAtTime(1318.5, audioContext.currentTime + 0.04)
      second.frequency.exponentialRampToValueAtTime(2093, audioContext.currentTime + 0.16)
      gain.gain.setValueAtTime(0.001, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.34, audioContext.currentTime + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.28)
      first.connect(gain)
      second.connect(gain)
      gain.connect(audioContext.destination)
      first.start(audioContext.currentTime)
      second.start(audioContext.currentTime + 0.035)
      first.stop(audioContext.currentTime + 0.18)
      second.stop(audioContext.currentTime + 0.28)
    } catch {
      // Audio feedback is optional; scanning must keep working if audio is blocked.
    }
  }

  function observeDetectedBarcode(rawCode) {
    const exactCode = String(rawCode || '').trim()
    const now = Date.now()
    if (!exactCode) return null

    const previous = latestVisibleBarcodeRef.current
    latestVisibleBarcodeRef.current = { code: exactCode, time: now }

    if (
      !scanProcessingRef.current &&
      !pendingScanRef.current &&
      (previous.code !== exactCode || now - previous.time > 1500)
    ) {
      setScanResult({ status: 'ready', code: exactCode, label: 'Barcode detected' })
    }

    return exactCode
  }

  async function processDetectedBarcode(rawCode, source = 'camera') {
    const exactCode = observeDetectedBarcode(rawCode)
    const now = Date.now()
    if (
      !exactCode ||
      pendingScanRef.current ||
      scanProcessingRef.current ||
      (lastDetectedRef.current.code === exactCode && now - lastDetectedRef.current.time <= 3500)
    ) {
      return
    }

    scanProcessingRef.current = true
    lastDetectedRef.current = { code: exactCode, time: now }
    setScanResult({ status: 'reading', code: exactCode, label: 'Reading barcode' })

    try {
      await addBarcodeFromValue(exactCode, source)
    } finally {
      scanProcessingRef.current = false
    }
  }

  async function addBarcode(event) {
    event.preventDefault()
    await addBarcodeFromValue(barcode)
  }

  function changeQuantity(product, delta) {
    noteActivity()
    setCart((current) =>
      current
        .map((item) => {
          if (item.id !== product.id) return item
          const next = item.cartQuantity + delta
          if (item.track_inventory && next > item.quantity) return item
          return { ...item, cartQuantity: next }
        })
        .filter((item) => item.cartQuantity > 0),
    )
  }

  function setPendingScanQuantity(nextQuantity) {
    setPendingScan((current) => {
      if (!current) return current
      const maxQuantity = current.product.track_inventory ? Number(current.product.quantity) : Infinity
      const cleanQuantity = Math.max(1, Math.min(maxQuantity, Number(nextQuantity) || 1))
      const updated = { ...current, quantity: cleanQuantity }
      pendingScanRef.current = updated
      return updated
    })
  }

  function closePendingScan() {
    pendingScanRef.current = null
    setPendingScan(null)
    setScanResult((current) =>
      current?.status === 'ready'
        ? { status: 'ready', code: '', label: 'Camera ready. Point at a barcode.' }
        : current,
    )
  }

  function confirmPendingScan() {
    const currentScan = pendingScanRef.current
    if (!currentScan) return

    const { product, quantity } = currentScan
    noteActivity()
    setCart((current) => {
      const exists = current.some((item) => item.id === product.id)
      return exists
        ? current.map((item) =>
            item.id === product.id ? { ...item, cartQuantity: quantity } : item,
          )
        : [...current, { ...product, cartQuantity: quantity }]
    })
    setAddToast({
      name: product.name,
      price: product.price,
      quantity,
    })
    setScanResult({ status: 'added', code: product.barcode, label: product.name })
    pendingScanRef.current = null
    setPendingScan(null)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setAddToast(null)
    }, 1800)
  }

  const total = cart.reduce((sum, item) => sum + item.price * item.cartQuantity, 0)
  const cartCount = cart.reduce((sum, item) => sum + item.cartQuantity, 0)
  const challengeQualified = total >= challengeTarget && !limitIgnored

  useEffect(() => {
    if (!spendLimit || total <= spendLimit || limitAlertedRef.current) return
    limitAlertedRef.current = true
    navigator.vibrate?.([250, 100, 250, 100, 450])
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (AudioContext) {
        const context = audioContextRef.current || new AudioContext()
        audioContextRef.current = context
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'square'
        oscillator.frequency.setValueAtTime(620, context.currentTime)
        oscillator.frequency.setValueAtTime(440, context.currentTime + 0.18)
        gain.gain.setValueAtTime(0.14, context.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.55)
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.55)
      }
    } catch { /* Vibration is the fallback where browser audio is unavailable. */ }
    setLimitExceededPrompt(true)
  }, [spendLimit, total])

  function finishShopperIntro() {
    setShowIntro(false)
    setEditingBudget(false)
    setShowBudgetPrompt(true)
  }

  function activateBudget() {
    const amount = Number(budgetDraft)
    if (!Number.isFinite(amount) || amount < 100) {
      setNepoToast('Enter a realistic shopping limit first — even gala don cost pass that 😅')
      return
    }
    setSpendLimit(amount)
    setLimitIgnored(false)
    limitAlertedRef.current = false
    setShowBudgetPrompt(false)
    setEditingBudget(false)
    setNepoToast(`Budget locked at ${formatMoney(amount)}. Your account officer can breathe now 😌`)
  }

  function skipBudget() {
    setSpendLimit(0)
    setShowBudgetPrompt(false)
    setEditingBudget(false)
    setNepoToast('Nepo mode verified 😂 No budget, just vibes — but the ₦15k gift challenge is still on!')
  }

  function ignoreSpendLimit() {
    setLimitIgnored(true)
    setLimitExceededPrompt(false)
    setNepoToast('Limit ignored. Omo, you chose enjoyment 😅 Gift-challenge eligibility is now off for this trip.')
  }

  async function startNativeBarcodeScanner(stream) {
    if (!('BarcodeDetector' in window) || !videoRef.current) return false

    const allFormats = [
      'ean_13',
      'ean_8',
      'upc_a',
      'upc_e',
      'code_128',
      'code_39',
      'itf',
      'codabar',
    ]
    const supportedFormats = window.BarcodeDetector.getSupportedFormats
      ? await window.BarcodeDetector.getSupportedFormats()
      : allFormats
    const formats = allFormats.filter((format) => supportedFormats.includes(format))

    if (!formats.length) return false

    const detector = new window.BarcodeDetector({ formats })
    let stopped = false
    let frameId = 0
    let videoFrameId = 0
    const video = videoRef.current

    video.srcObject = stream
    await video.play()

    async function scanFrame() {
      if (stopped || !videoRef.current) return

      try {
        if (video.readyState >= 2 && !scanProcessingRef.current) {
          const detected = await detector.detect(video)
          const exactCode = detected?.[0]?.rawValue
          if (exactCode) {
            observeDetectedBarcode(exactCode)
            await processDetectedBarcode(exactCode, 'camera')
          }
        }
      } catch {
        // Keep scanning; a single bad frame should not stop checkout.
      }

      if (video.requestVideoFrameCallback) {
        videoFrameId = video.requestVideoFrameCallback(scanFrame)
      } else {
        frameId = window.requestAnimationFrame(scanFrame)
      }
    }

    nativeScanStopRef.current = () => {
      stopped = true
      if (frameId) window.cancelAnimationFrame(frameId)
      if (videoFrameId && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(videoFrameId)
      }
    }

    scanFrame()
    return true
  }

  async function startCamera({ automatic = false } = {}) {
    setMessage('')
    if (!automatic) noteActivity(true)

    if (!window.isSecureContext) {
      setCameraState('blocked')
      setMessage('Camera access needs HTTPS or localhost. Open this checkout on a secure link to scan products.')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unsupported')
      setMessage('This browser cannot open the camera from a web page. Use manual entry.')
      setActiveTab('manual')
      return
    }

    try {
      setCameraState('requesting')
      const permissionStatus =
        navigator.permissions && navigator.permissions.query
          ? await navigator.permissions.query({ name: 'camera' }).catch(() => null)
          : null

      if (permissionStatus?.state === 'denied') {
        setCameraState('blocked')
        setMessage('Camera permission is blocked. Allow camera access in your browser settings, then tap Start camera again.')
        return
      }

      stopCamera()

      if (!videoRef.current) {
        throw new Error('Camera preview is not ready. Try again.')
      }

      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }
      const nativeStream = await navigator.mediaDevices.getUserMedia(constraints)
      const nativeStarted = await startNativeBarcodeScanner(nativeStream)

      if (nativeStarted) {
        setCameraState('scanning')
        setScanResult((current) =>
          current?.status === 'reading'
            ? current
            : { status: 'ready', code: '', label: 'Camera ready. Point at a barcode.' },
        )
        return
      }

      nativeStream.getTracks().forEach((track) => track.stop())

      const { BarcodeFormat, BrowserMultiFormatReader } = await import('@zxing/browser')
      const scanner = new BrowserMultiFormatReader()
      scanner.possibleFormats = [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
      ]

      scannerReaderRef.current = scanner
      scannerControlsRef.current = await scanner.decodeFromConstraints(
        constraints,
        videoRef.current,
        async (result) => {
          const exactCode = observeDetectedBarcode(result?.getText?.())
          await processDetectedBarcode(exactCode, 'camera')
        },
      )

      setCameraState('scanning')
      setScanResult((current) =>
        current?.status === 'reading'
          ? current
          : { status: 'ready', code: '', label: 'Camera ready. Point at a barcode.' },
      )
    } catch (error) {
      setCameraState('blocked')
      const blockedMessage =
        error.name === 'NotAllowedError'
          ? 'Camera access was not allowed. Tap the browser camera icon and allow access, then start again.'
          : error.message || 'Camera access was blocked. Use manual entry or allow camera access.'
      setMessage(blockedMessage)
    }
  }

  function stopCamera() {
    nativeScanStopRef.current?.()
    nativeScanStopRef.current = null
    scannerControlsRef.current?.stop()
    scannerControlsRef.current = null
    scannerReaderRef.current = null
    scanProcessingRef.current = false
    latestVisibleBarcodeRef.current = { code: '', time: 0 }

    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks?.().forEach((track) => track.stop())
      videoRef.current.srcObject = null
    }
    setCameraState((current) => (current === 'scanning' || current === 'requesting' ? 'idle' : current))
  }

  async function clearCheckoutCache() {
    sessionStorage.removeItem(sessionStorageKey)
    sessionStorage.removeItem(cartStorageKey)
    sessionStorage.removeItem(activityStorageKey)
    sessionStorage.removeItem(networkWarningKey)
    localStorage.removeItem(sessionStorageKey)
    localStorage.removeItem(cartStorageKey)

    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => name.toLowerCase().includes('glide'))
          .map((name) => caches.delete(name)),
      )
    }
  }

  async function endSession(reason = 'manual') {
    const sessionIdToDestroy = sessionIdRef.current || shopperSessionId
    stopCamera()
    setCart([])
    setBarcode('')
    setMessage('')
    setNetworkWarning('')
    setScanResult(null)
    setAddToast(null)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
    setShowIntro(false)
    setShowHelp(false)
    setActiveTab('scan')
    await destroyShopperSession(sessionIdToDestroy)
    await clearCheckoutCache()
    sessionIdRef.current = ''
    setShopperSessionId('')
    setSessionEnded(true)
    if (reason === 'manual') window.location.replace('/shopper')
  }

  function requestConfirmation(options) {
    setConfirmDialog(options)
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve
    })
  }

  function closeConfirmation(result) {
    confirmResolveRef.current?.(result)
    confirmResolveRef.current = null
    setConfirmDialog(null)
  }

  async function confirmEndSession() {
    if (pendingPayment?.receiptToken) {
      setMessage('A payment is still being reconciled. Check its status before ending this session so you do not lose the receipt.')
      await recoverPendingPayment()
      return
    }
    const hasUnpaidCart = cartRef.current.length > 0
    const confirmed = await requestConfirmation({
      title: hasUnpaidCart ? 'End without paying?' : 'End this session?',
      message: hasUnpaidCart
        ? `You have ${cartRef.current.length} unpaid cart item${cartRef.current.length === 1 ? '' : 's'}. Ending now permanently clears this cart and closes the store session. No payment will be taken. You will return to the shopper home page.`
        : 'Ending closes this store session, stops the scanner and clears shopping data from this device. You will return to the shopper home page and can scan a store QR whenever you want to shop again.',
      confirmLabel: hasUnpaidCart ? 'Clear cart and end' : 'Yes, end session',
      cancelLabel: 'Continue shopping',
    })
    if (confirmed) endSession('manual')
  }

  function openHelp() {
    noteActivity()
    setShowHelp(true)
  }

  async function recoverPendingPayment(automatic = false) {
    if (!pendingPayment?.receiptToken || paymentRecoveryState === 'checking') return
    setPaymentRecoveryState('checking')
    if (!automatic) setMessage('Checking Paystack for your completed payment…')

    try {
      const result = await callFunction('verify-payment', {
        receiptToken: pendingPayment.receiptToken,
        reference: pendingPayment.reference,
      }, false)

      if (result.order?.payment_status === 'paid') {
        localStorage.removeItem(pendingPaymentKey)
        sessionStorage.removeItem(cartStorageKey)
        setPendingPayment(null)
        setCart([])
        window.location.replace(`/receipt/${pendingPayment.receiptToken}`)
        return
      }

      setPaymentRecoveryState('awaiting')
      setMessage('Your payment is still pending. You can return to Paystack or check again shortly.')
    } catch (error) {
      if (String(error.message).toLowerCase().includes('expired')) {
        localStorage.removeItem(pendingPaymentKey)
        setPendingPayment(null)
        setPaymentRecoveryState('expired')
      } else {
        setPaymentRecoveryState('awaiting')
      }
      if (!automatic || !String(error.message).toLowerCase().includes('not been confirmed')) {
        setMessage(error.message)
      }
    }
  }

  async function recoverSessionPayment(sessionId) {
    try {
      const result = await callFunction('verify-payment', { shopperSessionId: sessionId }, false)
      if (result.order?.payment_status !== 'paid' || !result.order?.receipt_token) return
      sessionStorage.removeItem(cartStorageKey)
      setCart([])
      window.location.replace(`/receipt/${result.order.receipt_token}`)
    } catch {
      // No order or an unpaid attempt is normal when a shopper first opens the scanner.
    }
  }

  async function checkout() {
    noteActivity(true)
    let challengeAllowed = !limitIgnored
    if (pendingPayment?.receiptToken) {
      await recoverPendingPayment()
      return
    }
    if (store?.merchant_profile?.geofence_enabled && geofenceState !== 'inside') {
      setMessage(geofenceState === 'outside' ? 'You are outside this store’s shopping area.' : 'Enable precise location to checkout in this store.')
      return
    }
    if (spendLimit > 0 && total > spendLimit && !limitIgnored) {
      const continueOverLimit = await requestConfirmation({
        title: 'You are over your spend limit',
        message: `Your cart is ${formatMoney(total - spendLimit)} above your limit. Do you still want to continue to payment?`,
        confirmLabel: 'Continue to payment',
      })
      if (!continueOverLimit) return
      challengeAllowed = false
      setLimitIgnored(true)
    }
    const confirmed = await requestConfirmation({
      title: 'Ready to pay?',
      message: 'Please confirm that every item and quantity in your cart is accurate.',
      confirmLabel: 'Yes, start payment',
    })
    if (!confirmed) return

    setBusy(true)
    setMessage('')
    try {
      const result = await callFunction(
        'create-order',
        {
          qrCode,
          shopperSessionId,
          location: shopperLocation,
          customerEmail,
          challengeEnabled: challengeAllowed,
          spendLimit: spendLimit || null,
          cart: cart.map((item) => ({ productId: item.id, quantity: item.cartQuantity })),
        },
        false,
      )

      if (!result.authorizationUrl) {
        throw new Error('Payment could not start. The checkout server did not return a Paystack link.')
      }

      const recoverablePayment = {
        receiptToken: result.receiptToken,
        reference: result.reference,
        authorizationUrl: result.authorizationUrl,
        createdAt: new Date().toISOString(),
        total,
        customerEmail,
      }
      localStorage.setItem(pendingPaymentKey, JSON.stringify(recoverablePayment))
      setPendingPayment(recoverablePayment)

      window.location.href = result.authorizationUrl
    } catch (error) {
      setMessage(error.message)
      setBusy(false)
    }
  }

  if (inactive) {
    return (
      <main className="public-page narrow">
        <h1>Inactive store QR.</h1>
        <p className="lead">This QR code is no longer active. Please ask the store for the current Glide QR.</p>
      </main>
    )
  }

  if (sessionEnded) {
    return (
      <main className="public-page narrow">
        <h1>Session ended.</h1>
        <p className="lead">
          Your checkout session, cart and local data have been cleared. You can
          close this tab.
        </p>
      </main>
    )
  }

  if (showSplash) {
    return (
      <main className="shop-page splash-only">
        <div className="shop-splash">
          <span>Welcome to</span>
          <strong>{store?.merchant_profile?.store_name || 'Glide'}</strong>
        </div>
      </main>
    )
  }

  return (
    <main className="shop-page">
      <ConfirmDialog dialog={confirmDialog} onCancel={() => closeConfirmation(false)} onConfirm={() => closeConfirmation(true)} />
      {showIntro ? (
        <div
          className="guide-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={finishShopperIntro}
        >
          <section className="guide-modal" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Welcome to Glide</p>
            <h1>Scan products and checkout faster.</h1>
            <p className="lead">Glide seamlessly through the store, pay on your device and show your receipt at the exit.</p>
            <button type="button" onClick={finishShopperIntro}>
              Start shopping
            </button>
          </section>
        </div>
      ) : null}

      {showBudgetPrompt ? <div className="guide-backdrop" role="dialog" aria-modal="true"><section className="guide-modal budget-prompt-card"><p className="eyebrow">{editingBudget ? 'Budget control' : 'Before temptation starts'}</p><h1>How much are we spending today?</h1><p className="lead">Set a personal limit and Glide will warn you when the basket crosses it. Or cancel and activate full “Nepo mode” 😂</p><label>Shopping limit<div className="budget-input"><span>₦</span><input autoFocus inputMode="decimal" min="100" placeholder="e.g. 20,000" type="number" value={budgetDraft} onChange={(event) => setBudgetDraft(event.target.value)} /></div></label><div className="app-dialog-actions"><button type="button" onClick={() => editingBudget ? setShowBudgetPrompt(false) : skipBudget()}>{editingBudget ? 'Keep current' : 'Cancel — no limit'}</button><button type="button" onClick={activateBudget}>Enter limit</button></div></section></div> : null}

      {showChallengeModal ? <div className="guide-backdrop" role="dialog" aria-modal="true" onClick={() => setShowChallengeModal(false)}><section className={`guide-modal challenge-modal ${challengeQualified ? 'complete' : ''}`} onClick={(event) => event.stopPropagation()}><div className="challenge-modal-ring" style={{ '--challenge-progress': `${Math.min(100, (total / challengeTarget) * 100) * 3.6}deg` }}><strong>{Math.min(100, Math.round((total / challengeTarget) * 100))}%</strong></div><p className="eyebrow">Today’s basket challenge</p><h1>{challengeQualified ? 'You did it! Gift unlocked 🎁' : `${formatMoney(Math.max(0, challengeTarget - total))} to go`}</h1><p className="lead">{challengeQualified ? 'Complete payment, verify your receipt, then redeem your participating-store gift at the checkpoint.' : limitIgnored ? 'This challenge is paused because the spend-limit warning was ignored.' : `Build your basket to ${formatMoney(challengeTarget)} to unlock a counter gift. No shortcuts, abeg 😄`}</p><button type="button" onClick={() => setShowChallengeModal(false)}>Back to shopping</button></section></div> : null}

      {limitExceededPrompt ? <div className="guide-backdrop" role="alertdialog" aria-modal="true"><section className="guide-modal limit-alert-card"><p className="eyebrow">Budget don red 🚨</p><h1>You’ve crossed your limit.</h1><p className="lead">Your basket is {formatMoney(total - spendLimit)} above the {formatMoney(spendLimit)} limit. Remove something to stay disciplined, or continue and leave the gift challenge.</p><div className="app-dialog-actions"><button type="button" onClick={() => { setLimitExceededPrompt(false); setActiveTab('cart') }}>Review my cart</button><button className="danger" type="button" onClick={ignoreSpendLimit}>Ignore limit</button></div></section></div> : null}

      {nepoToast ? <div className="nepo-toast" role="status"><span>{nepoToast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNepoToast('')}>×</button></div> : null}

      {showHelp ? (
        <div
          className="guide-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowHelp(false)}
        >
          <section className="guide-modal" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Help</p>
            <h1>How to shop with Glide</h1>
            <ol className="help-steps">
              <li>Point your phone camera at a product barcode.</li>
              <li>When the product appears in your cart, continue shopping.</li>
              <li>Open Cart to change quantities or remove items.</li>
              <li>Tap Checkout and pay securely on your phone.</li>
              <li>Show your receipt at the exit before leaving the store.</li>
            </ol>
            <button type="button" onClick={() => setShowHelp(false)}>
              Got it
            </button>
          </section>
        </div>
      ) : null}

      <header className="shop-header">
        <div className="shop-header-main">
          <span>Welcome to</span>
          <strong>{store?.merchant_profile?.store_name || 'Store'}</strong>
          <small>{cartCount ? `${cartCount} item${cartCount === 1 ? '' : 's'} in cart` : 'Scan products as you shop'}</small>
        </div>
        <div className="shop-options">
          <button className="header-budget-button" type="button" onClick={() => { setBudgetDraft(spendLimit || ''); setEditingBudget(true); setShowBudgetPrompt(true) }}><span>Budget</span><strong>{spendLimit ? formatMoney(spendLimit) : 'Set'}</strong></button>
          <button className={`header-challenge-button ${challengeQualified ? 'complete' : ''}`} aria-label="Open basket challenge" style={{ '--challenge-progress': `${Math.min(100, (total / challengeTarget) * 100) * 3.6}deg` }} type="button" onClick={() => setShowChallengeModal(true)}><i>{challengeQualified ? '🎁' : `${Math.min(100, Math.round((total / challengeTarget) * 100))}%`}</i></button>
          <button
            className="end-session-button"
            type="button"
            onClick={confirmEndSession}
          >
            End
          </button>
        </div>
      </header>

      <nav className="shop-tabs" aria-label="Checkout tabs">
        <button
          className={activeTab === 'scan' ? 'active' : ''}
          type="button"
          onClick={() => {
            noteActivity()
            setActiveTab('scan')
          }}
        >
          Scan
        </button>
        <button
          className={activeTab === 'manual' ? 'active' : ''}
          type="button"
          onClick={() => {
            noteActivity()
            setActiveTab('manual')
          }}
        >
          Manual
        </button>
        <button
          className={activeTab === 'cart' ? 'active' : ''}
          type="button"
          onClick={() => {
            noteActivity()
            setActiveTab('cart')
          }}
        >
          <span className="cart-tab-label">Cart{cartCount ? <b>{cartCount}</b> : null}</span>
        </button>
      </nav>

      {networkWarning ? <Notice tone="warning">{networkWarning}</Notice> : null}
      {store?.merchant_profile?.geofence_enabled && geofenceState !== 'inside' ? (
        <section className={`shopper-location-card ${geofenceState}`} role="status">
          <div className="shopper-location-icon" aria-hidden="true">{geofenceState === 'inside' ? '✓' : '⌖'}</div>
          <div><span>Store location check</span><strong>{geofenceState === 'inside' ? 'You’re inside the shopping area' : geofenceState === 'outside' ? 'You’re outside the shopping area' : geofenceState === 'checking' ? 'Checking your location…' : 'Location access is required'}</strong><small>{locationMessage || 'Glide uses your location only to confirm that you are physically at this store.'}</small></div>
          {geofenceState !== 'inside' ? <button disabled={locationBusy || geofenceState === 'unsupported'} type="button" onClick={() => requestShopperLocation(false)}>{locationBusy ? 'Checking…' : geofenceState === 'blocked' ? 'Try location again' : 'Use my location'}</button> : <button className="secondary-action" disabled={locationBusy} type="button" onClick={() => requestShopperLocation(false)}>Refresh</button>}
        </section>
      ) : null}
      {message ? <div className="shopper-flash" role="status"><strong>{message}</strong><button type="button" aria-label="Dismiss notification" onClick={() => setMessage('')}>×</button></div> : null}

      {pendingPayment ? (
        <section className="payment-recovery-card" role="status">
          <div className={`payment-recovery-icon ${paymentRecoveryState}`} aria-hidden="true">↻</div>
          <div><span>Payment in progress</span><strong>{paymentRecoveryState === 'checking' ? 'Checking your payment…' : 'Your receipt is protected'}</strong><small>{formatMoney(pendingPayment.total || total)} · {pendingPayment.customerEmail || customerEmail}</small></div>
          <div className="payment-recovery-actions"><button disabled={paymentRecoveryState === 'checking'} type="button" onClick={() => recoverPendingPayment()}>{paymentRecoveryState === 'checking' ? 'Checking…' : 'Check payment status'}</button>{pendingPayment.authorizationUrl ? <button type="button" onClick={() => { window.location.href = pendingPayment.authorizationUrl }}>Return to Paystack</button> : null}</div>
        </section>
      ) : null}

      {addToast ? (
        <div className="added-toast" role="status">
          <span>Added to cart</span>
          <strong>{addToast.name}</strong>
          <small>{addToast.quantity} x {formatMoney(addToast.price)}</small>
        </div>
      ) : null}

      {pendingScan ? (
        <div
          className="scan-popup-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={closePendingScan}
        >
          <section className="scan-popup" onClick={(event) => event.stopPropagation()}>
            <div className="scan-popup-product">
              <div className="product-thumb" aria-hidden="true">
                {productInitials(pendingScan.product.name)}
              </div>
              <div>
                <span>{pendingScan.existingQuantity ? 'Already in cart' : 'Product scanned'}</span>
                <strong>{pendingScan.product.name}</strong>
                <small>{pendingScan.product.barcode}</small>
              </div>
            </div>
            <div className="scan-popup-price">
              <span>{formatMoney(pendingScan.product.price)} each</span>
              <strong>{formatMoney(pendingScan.product.price * pendingScan.quantity)}</strong>
            </div>
            <div className="scan-popup-stepper" aria-label="Quantity">
              <button type="button" onClick={() => setPendingScanQuantity(pendingScan.quantity - 1)}>
                -
              </button>
              <input
                inputMode="numeric"
                value={pendingScan.quantity}
                onChange={(event) => setPendingScanQuantity(event.target.value)}
                aria-label="Quantity"
              />
              <button type="button" onClick={() => setPendingScanQuantity(pendingScan.quantity + 1)}>
                +
              </button>
            </div>
            {pendingScan.product.track_inventory ? (
              <small className="scan-popup-stock">{pendingScan.product.quantity} available</small>
            ) : null}
            <div className="scan-popup-actions">
              <button type="button" onClick={closePendingScan}>
                Cancel
              </button>
              <button type="button" onClick={confirmPendingScan}>
                Add to cart
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'scan' ? (
        <section className="scanner-panel">
          <div
            className={`scanner-window ${cameraState}`}
          >
            <video ref={videoRef} muted playsInline />
            <div className="scan-frame">
              <span />
            </div>
            <p>
              {cameraState === 'requesting'
                ? 'Allow camera access in your browser'
                : cameraState === 'scanning'
                  ? 'Point at a barcode'
                  : 'Camera starts automatically'}
            </p>
          </div>
          {scanResult ? (
            <div className={`scan-result ${scanResult.status}`} role="status">
              <span>
                {scanResult.status === 'added'
                  ? `You scanned ${scanResult.label}.`
                  : scanResult.label}
              </span>
              {scanResult.code ? <strong>{scanResult.code}</strong> : null}
            </div>
          ) : null}
          <button
            className="scan-cart-button"
            type="button"
            onClick={() => {
              noteActivity()
              setActiveTab('cart')
            }}
          >
            <span>Cart</span>
            <strong>{cartCount}</strong>
            <small>{formatMoney(total)}</small>
          </button>
        </section>
      ) : null}

      {activeTab === 'manual' ? (
        <form className="barcode-form" onSubmit={addBarcode}>
          <label>
            Enter barcode
            <input
              inputMode="numeric"
              placeholder="Type barcode exactly"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
            />
          </label>
          <button type="submit">Add to cart</button>
        </form>
      ) : null}

      {activeTab === 'cart' ? (
        <section className="cart-panel active">
          <div className="cart-title-row">
            <h1>Your cart</h1>
            <strong className="cart-title-count">{cartCount}</strong>
          </div>
          {cart.length ? (
            <>
              {cart.map((item) => (
                <div className="cart-row" key={item.id}>
                  <button
                    className="cart-remove-dot"
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => changeQuantity(item, -item.cartQuantity)}
                  >
                    x
                  </button>
                  <div className="product-thumb" aria-hidden="true">
                    {productInitials(item.name)}
                  </div>
                  <div className="cart-item-copy">
                    <strong>{item.name}</strong>
                    <span>{formatMoney(item.price)}</span>
                  </div>
                  <strong className="cart-line-total">
                    {formatMoney(item.price * item.cartQuantity)}
                  </strong>
                  <div className="quantity-actions">
                    <button type="button" onClick={() => changeQuantity(item, -1)}>
                      -
                    </button>
                    <span>{item.cartQuantity}</span>
                    <button type="button" onClick={() => changeQuantity(item, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
              <div className="cart-checkout-bar">
                <label className="checkout-email">Receipt email<input required type="email" placeholder="you@example.com" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></label>
                <div className="cart-total">
                  <span>Total</span>
                  <strong>{formatMoney(total)}</strong>
                </div>
                <button disabled={!cart.length || !customerEmail.trim() || busy || (store?.merchant_profile?.geofence_enabled && geofenceState !== 'inside')} type="button" onClick={checkout}>
                  {busy ? 'Starting payment...' : 'Checkout'}
                </button>
              </div>
            </>
          ) : (
            <EmptyState>Scan or enter a barcode to begin.</EmptyState>
          )}
        </section>
      ) : null}

      <button className="help-fab" type="button" onClick={openHelp}>
        Help
      </button>
    </main>
  )
}

function LocationSettings() {
  const [settings, setSettings] = useState({ latitude: '', longitude: '', radius: 150, enabled: false })
  const [merchantId, setMerchantId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: authData }) => {
      if (!authData.user) return { data: null, error: new Error('Your session has expired.') }
      return supabase.from('merchant_profile').select('id,geofence_latitude,geofence_longitude,geofence_radius_meters,geofence_enabled').eq('user_id', authData.user.id).maybeSingle()
    }).then(({ data, error }) => {
        if (error) setMessage(error.message)
        if (data) {
          setMerchantId(data.id)
          setSettings({ latitude: data.geofence_latitude ?? '', longitude: data.geofence_longitude ?? '', radius: data.geofence_radius_meters || 150, enabled: Boolean(data.geofence_enabled) })
        }
    })
  }, [])

  function captureLocation() {
    if (!navigator.geolocation) {
      setMessage('This device does not support location services.')
      return
    }
    setBusy(true)
    setMessage('Finding the store location…')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setSettings((current) => ({ ...current, latitude: coords.latitude, longitude: coords.longitude }))
        setMessage(`Store location captured with ±${Math.round(coords.accuracy)} m accuracy.`)
        setBusy(false)
      },
      () => {
        setMessage('Location could not be captured. Allow precise location and try again.')
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }

  async function save(event) {
    event.preventDefault()
    const latitude = Number(settings.latitude)
    const longitude = Number(settings.longitude)
    if (settings.enabled && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      setMessage('Capture the store location before enabling the geofence.')
      return
    }
    if (!merchantId) {
      setMessage('Your store profile could not be loaded. Refresh the page and try again.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('merchant_profile').update({
      geofence_latitude: Number.isFinite(latitude) ? latitude : null,
      geofence_longitude: Number.isFinite(longitude) ? longitude : null,
      geofence_radius_meters: Math.min(5000, Math.max(25, Number(settings.radius) || 150)),
      geofence_enabled: settings.enabled,
    }).eq('id', merchantId).select('id').single()
    setBusy(false)
    setMessage(error ? error.message : settings.enabled ? 'Geofence enabled. Shoppers must be inside this area.' : 'Geofence settings saved but enforcement is off.')
  }

  return (
    <section className="dash-section geofence-settings">
      <PageTitle title="Store geofence" subtitle="Only allow self-checkout while a shopper is physically inside your store area." />
      <form className="settings-card" onSubmit={save}>
        {message ? <Notice tone={message.includes('enabled') || message.includes('saved') || message.includes('captured') ? 'success' : 'warning'}>{message}</Notice> : null}
        <div className="geofence-status"><span className={settings.enabled ? 'on' : ''} /><div><strong>{settings.enabled ? 'Enforcement on' : 'Enforcement off'}</strong><small>Checkout is checked again securely on the server.</small></div></div>
        <button className="secondary-action" disabled={busy} type="button" onClick={captureLocation}>Use my current store location</button>
        <div className="geofence-coordinates"><label>Latitude<input readOnly value={settings.latitude} /></label><label>Longitude<input readOnly value={settings.longitude} /></label></div>
        <label>Allowed radius (metres)<input min="25" max="5000" type="number" value={settings.radius} onChange={(event) => setSettings((current) => ({ ...current, radius: event.target.value }))} /></label>
        <label className="check-field"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} /><span>Require shoppers to be inside this geofence</span></label>
        <button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save geofence'}</button>
      </form>
    </section>
  )
}

function PaymentReturn({ receiptToken }) {
  const [state, setState] = useState({ loading: true, error: '' })

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference')
    callFunction('verify-payment', { receiptToken, reference }, false)
      .then(() => {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('glide:pending-payment:'))
          .forEach((key) => {
            try {
              const pending = JSON.parse(localStorage.getItem(key) || '{}')
              if (pending.receiptToken !== receiptToken) return
              const storeCode = key.replace('glide:pending-payment:', '')
              localStorage.removeItem(key)
              sessionStorage.removeItem(`glide:checkout:${storeCode}:cart`)
            } catch {
              localStorage.removeItem(key)
            }
          })
        window.location.replace(`/receipt/${receiptToken}`)
      })
      .catch((error) => setState({ loading: false, error: error.message }))
  }, [receiptToken])

  return (
    <main className="payment-page">
      {state.loading ? <LoadingRows /> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
    </main>
  )
}

function ShopperSessionEnded() {
  return (
    <main className="shopper-home shopper-session-home">
      <nav><Link className="brand" href="/">Glide</Link><span>Shopper home</span></nav>
      <section className="shopper-welcome">
        <div className="shopper-success-mark" aria-hidden="true">✓</div>
        <p className="eyebrow">Session safely closed</p>
        <h1>You’re no longer connected to the store.</h1>
        <p>Your scanner has stopped and the cart and local shopping data for that session have been cleared. No payment was taken for unpaid items.</p>
        <div className="shopper-welcome-actions">
          <Link className="primary-action" href="/">Go to Glide home</Link>
          <span>To shop again, scan the QR displayed at a Glide-enabled store.</span>
        </div>
      </section>
      <section className="shopper-after-grid">
        <article className="shopper-feedback-card"><p className="eyebrow">What happens next</p><h2>Ready whenever you are.</h2><SimpleList rows={[{ label: 'Cart', value: 'Cleared' }, { label: 'Store session', value: 'Closed' }, { label: 'Payment', value: 'None taken' }, { label: 'Shop again', value: 'Scan a store QR' }]} /></article>
      </section>
    </main>
  )
}

function ShopperLanding({ receiptToken }) {
  const [order, setOrder] = useState(null)
  const [rating, setRating] = useState(0)
  const [tags, setTags] = useState([])
  const [comment, setComment] = useState('')
  const [feedbackDone, setFeedbackDone] = useState(false)
  const [signupDone, setSignupDone] = useState(false)
  const [profile, setProfile] = useState({ fullName: '', email: '', phone: '', offers: false })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const feedbackTags = ['Fast checkout', 'Easy to use', 'Helpful staff', 'Clean store', 'Payment issue', 'Could be clearer']

  useEffect(() => {
    callFunction('shopper-experience', { action: 'load', receiptToken }, false)
      .then((result) => setOrder(result.order))
      .catch((error) => setMessage(error.message))
  }, [receiptToken])

  function toggleTag(tag) {
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])
  }

  async function submitFeedback(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await callFunction('shopper-experience', { action: 'feedback', receiptToken, rating, tags, comment }, false)
      setFeedbackDone(true)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function joinEarlyAccess(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await callFunction('shopper-experience', { action: 'early-access', receiptToken, ...profile }, false)
      setSignupDone(true)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shopper-home">
      <nav><Link className="brand" href="/">Glide</Link><span>Checkout complete</span></nav>
      <section className="shopper-welcome">
        <div className="shopper-success-mark" aria-hidden="true">✓</div>
        <p className="eyebrow">You are all set</p>
        <h1>Thanks for shopping at {order?.storeName || 'the store'}.</h1>
        <p>Your payment is complete and your receipt remains available whenever you need it.</p>
        <div className="shopper-welcome-actions">
          <Link className="primary-action" href={`/receipt/${receiptToken}`}>View receipt</Link>
          <span>{order?.orderNumber || 'Loading order...'}</span>
        </div>
      </section>

      {message ? <Notice tone="warning">{message}</Notice> : null}
      <section className="shopper-after-grid">
        <form className="shopper-feedback-card" onSubmit={submitFeedback}>
          <span className="eyebrow">30-second feedback</span>
          <h2>{feedbackDone ? 'Thank you for helping us improve.' : 'How was your checkout?'}</h2>
          {feedbackDone ? <div className="shopper-thanks">Your feedback has been shared with the store.</div> : (
            <>
              <div className="rating-buttons" aria-label="Rate checkout from 1 to 5">
                {[
                  [1, '😣'], [2, '😕'], [3, '🙂'], [4, '😊'], [5, '🤩'],
                ].map(([value, emoji]) => <button className={rating === value ? 'active' : ''} key={value} type="button" onClick={() => setRating(value)}><span>{emoji}</span><small>{value}</small></button>)}
              </div>
              <div className="feedback-tags">
                {feedbackTags.map((tag) => <button className={tags.includes(tag) ? 'active' : ''} key={tag} type="button" onClick={() => toggleTag(tag)}>{tag}</button>)}
              </div>
              <textarea placeholder="Anything else we should know? (optional)" value={comment} onChange={(event) => setComment(event.target.value)} />
              <button disabled={busy || !rating} type="submit">Send feedback</button>
            </>
          )}
        </form>

        <form className="shopper-early-card" onSubmit={joinEarlyAccess}>
          <span className="early-badge">Early access</span>
          <h2>{signupDone ? 'You are on the list.' : 'Make every store visit move faster.'}</h2>
          <p>{signupDone ? 'We will let you know when your Glide shopper profile is ready.' : 'Save receipts, get smarter offers and enjoy quicker checkout with the upcoming Glide shopper experience.'}</p>
          {!signupDone ? <>
            <input required placeholder="Your name" value={profile.fullName} onChange={(event) => setProfile((current) => ({ ...current, fullName: event.target.value }))} />
            <input required type="email" placeholder="Email address" value={profile.email} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} />
            <input inputMode="tel" placeholder="Phone number (optional)" value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} />
            <label className="shopper-consent"><input type="checkbox" checked={profile.offers} onChange={(event) => setProfile((current) => ({ ...current, offers: event.target.checked }))} /><span>Send me relevant store offers. I can opt out anytime.</span></label>
            <button disabled={busy} type="submit">Join early access</button>
          </> : null}
        </form>
      </section>
      <footer className="shopper-footer"><strong>Glide</strong><span>Your store, without the checkout line.</span></footer>
    </main>
  )
}

function ReceiptPage({ token }) {
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const receiptBarcodeRef = useRef(null)

  async function exitStore() {
    const checkoutKeys = Object.keys(sessionStorage).filter((key) => key.startsWith('glide:checkout:'))
    const sessionIds = checkoutKeys
      .filter((key) => key.endsWith(':session'))
      .map((key) => sessionStorage.getItem(key))
      .filter(Boolean)

    await Promise.allSettled(
      sessionIds.map((sessionId) => callFunction('shopper-session', { action: 'end', sessionId }, false)),
    )

    checkoutKeys.forEach((key) => sessionStorage.removeItem(key))
    window.location.assign(`/shopper/${token}`)
  }

  useEffect(() => {
    async function loadReceipt() {
      const { data } = await supabase
        .from('orders')
        .select('*,order_items(*),merchant_profile(store_name)')
        .eq('receipt_token', token)
        .maybeSingle()
      setOrder(data)
      setLoading(false)
    }
    loadReceipt()
  }, [token])

  useEffect(() => {
    if (!order || order.status === 'exited') return undefined

    const interval = window.setInterval(async () => {
      const { data } = await supabase
        .from('orders')
        .select('*,order_items(*),merchant_profile(store_name)')
        .eq('receipt_token', token)
        .maybeSingle()

      if (data) setOrder(data)
    }, 5000)

    return () => window.clearInterval(interval)
  }, [order, token])

  useEffect(() => {
    if (!order?.exit_token || !receiptBarcodeRef.current) return

    async function renderBarcode() {
      const { default: JsBarcode } = await import('jsbarcode')
      if (!receiptBarcodeRef.current) return

      JsBarcode(receiptBarcodeRef.current, order.exit_token, {
        format: 'CODE128',
        width: 1.35,
        height: 64,
        margin: 8,
        displayValue: false,
      })
    }

    renderBarcode()
  }, [order])

  if (loading) return <main className="public-page narrow"><LoadingRows /></main>
  if (!order) return <main className="public-page narrow"><h1>Receipt not found.</h1></main>

  const isVerified = order.status === 'exited'

  return (
    <main className={`receipt-page ${isVerified ? 'is-verified' : 'is-unverified'}`}>
      <section className="receipt-card">
        <p className="eyebrow">{order.merchant_profile?.store_name || 'Glide store'}</p>
        <div className="receipt-heading">
          <h1>Receipt {order.order_number}</h1>
          <span className={`receipt-verification-badge ${isVerified ? 'verified' : 'pending'}`}>
            {isVerified ? '✓ Verified' : 'Verification pending'}
          </span>
        </div>
        {order.challenge_qualified ? <div className="receipt-gift-badge"><span>🎁 Basket challenge complete</span><strong>Show this verified receipt at the counter to claim the participating-store gift.</strong></div> : null}
        <div className="receipt-items-panel">
          <SimpleList
            rows={order.order_items.map((item) => ({
              label: `${item.product_name} x ${item.quantity}`,
              value: formatMoney(item.line_total),
            }))}
          />
        </div>
        <div className="cart-total">
          <span>Total paid</span>
          <strong>{formatMoney(order.total_amount)}</strong>
        </div>
        <SimpleList
          rows={[
            { label: 'Payment status', value: order.payment_status },
            { label: 'Receipt email', value: order.customer_email || 'Not provided' },
            { label: 'Authentication code', value: order.exit_token },
          ]}
        />
        <div className="receipt-barcode-panel">
          <span>Scan to verify receipt</span>
          <svg ref={receiptBarcodeRef} aria-label="Receipt authentication barcode" />
          <strong>{order.exit_token}</strong>
        </div>
        <div className="receipt-actions">
          <button disabled={!isVerified} type="button" onClick={() => isVerified && window.print()}>
            {isVerified ? 'Download receipt' : 'Download locked until verified'}
          </button>
          <button className="receipt-exit-button" disabled={!isVerified} type="button" onClick={exitStore}>
            {isVerified ? 'Finish session' : 'Verify at payment station'}
          </button>
        </div>
        <p className="receipt-exit-note">{isVerified ? 'This receipt has been verified at the payment station.' : 'Show this receipt at the payment station. Download becomes available after verification.'}</p>
        {!isVerified ? <p className="print-verification-warning">Receipt download is locked until station verification.</p> : null}
      </section>
    </main>
  )
}

// oxlint-disable-next-line no-unused-vars -- retained temporarily for rollback during terminal rollout
function PaymentVerifierLegacy() {
  const [code, setCode] = useState('')
  const [order, setOrder] = useState(null)
  const [message, setMessage] = useState('')

  const verifyCode = useCallback(async (receiptCode) => {
    setMessage('')
    setOrder(null)

    try {
      const result = await callFunction('cashier-terminal', {
        action: 'verify-receipt',
        receiptCode: receiptCode.trim(),
        station: 'security',
      })
      setOrder(result.order)
    } catch (error) {
      setMessage(error.message || 'Invalid receipt.')
    }
  }, [])

  async function verify(event) {
    event.preventDefault()
    await verifyCode(code)
  }

  useRealtimeRefresh('verify-receipt-live', ['orders'], () => {
    if (code.trim() && (!order || order.payment_status !== 'paid')) verifyCode(code)
  })

  async function markExited() {
    if (!order || order.status === 'exited') return
    setMessage('')

    try {
      const result = await callFunction('cashier-terminal', {
        action: 'burn-receipt',
        receiptCode: order.exit_token,
        station: 'security',
      })
      setOrder(result.order)
      setMessage('Payment verified. This receipt is now closed and cannot be used again.')
    } catch (error) {
      setMessage(error.message || 'This receipt cannot be exited again.')
    }
  }

  const items = order?.order_items || []
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

  return (
    <section className="dash-section payment-verifier">
      <PageTitle title="Verify payment" subtitle="Scan the shopper's receipt, confirm the purchase, then close it permanently." />
      <div className="verification-guide">
        <div><span>1</span><strong>Scan receipt</strong><small>Use the barcode or 7-character code.</small></div>
        <div><span>2</span><strong>Confirm payment</strong><small>Review the amount and purchased items.</small></div>
        <div><span>3</span><strong>Close once</strong><small>The receipt cannot be verified again.</small></div>
      </div>
      <form className="security-scanner" onSubmit={verify}>
        <label>
          Receipt code
          <input
            autoFocus
            placeholder="Scan or enter the 7-character code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button type="submit">Check payment</button>
      </form>
      {message ? <Notice tone="warning">{message}</Notice> : null}
      {order ? (
        <section className={`security-manifest ${order.status === 'exited' ? 'used' : ''}`}>
          <header>
            <div>
              <span>{order.status === 'exited' ? 'Already verified · Cannot be reused' : 'Payment confirmed'}</span>
              <h2>{order.order_number}</h2>
            </div>
            <strong>{itemCount} items</strong>
          </header>
          <SimpleList
            rows={[
              { label: 'Payment', value: order.payment_status },
              { label: 'Verification status', value: order.status === 'exited' ? 'closed' : 'ready' },
              { label: 'Total', value: formatMoney(order.total_amount) },
            ]}
          />
          <div className="audit-list">
            {items.map((item) => (
              <div className={Number(item.line_total) >= 10000 ? 'high-value' : ''} key={item.id}>
                <span>{item.product_name}</span>
                <strong>{item.quantity} x {formatMoney(item.unit_price)}</strong>
              </div>
            ))}
          </div>
          {order.status === 'paid' ? (
            <button type="button" onClick={markExited}>
              Verify and close receipt
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  )
}

function PaymentVerifier({ station = 'security', compact = false }) {
  const [code, setCode] = useState('')
  const [order, setOrder] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkedItems, setCheckedItems] = useState({})
  const [mismatchMode, setMismatchMode] = useState(false)
  const [reasonCodes, setReasonCodes] = useState([])
  const [incidentNote, setIncidentNote] = useState('')
  const [balanceCollected, setBalanceCollected] = useState('')
  const [balancePaymentMethod, setBalancePaymentMethod] = useState('card')

  const resetInspection = useCallback((nextOrder) => {
    setCheckedItems(Object.fromEntries((nextOrder?.order_items || []).map((item) => [item.id, false])))
    setMismatchMode(false)
    setReasonCodes([])
    setIncidentNote('')
    setBalanceCollected('')
  }, [])

  const verifyCode = useCallback(async (receiptCode) => {
    const query = receiptCode.trim()
    if (!query) return
    setMessage('')
    setOrder(null)
    setBusy(true)
    try {
      let result
      try {
        result = await callFunction('cashier-terminal', { action: 'verify-receipt', receiptCode: query, station })
      } catch {
        result = await callFunction('cashier-terminal', { action: 'lookup-transaction', query, station })
      }
      setOrder(result.order)
      resetInspection(result.order)
    } catch (error) {
      setMessage(error.message || 'No transaction matched that code, reference or email.')
    } finally {
      setBusy(false)
    }
  }, [resetInspection, station])

  async function verify(event) {
    event.preventDefault()
    await verifyCode(code)
  }

  useRealtimeRefresh('verify-receipt-live', ['orders'], () => {
    if (code.trim() && (!order || order.payment_status !== 'paid')) verifyCode(code)
  })

  const items = order?.order_items || []
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const paid = order?.payment_status === 'paid'
  const used = order?.status === 'exited'
  const statusLabel = used ? 'Already verified' : paid ? 'Paid — inspect basket' : order?.payment_status === 'failed' ? 'Payment failed' : 'Payment pending'
  const mismatchReasons = [['item_not_scanned', 'Item not scanned'], ['wrong_quantity', 'Wrong quantity'], ['wrong_item', 'Wrong item'], ['price_dispute', 'Price dispute']]

  async function closeReceipt() {
    if (!order || used) return
    const inspected = Object.entries(checkedItems).filter(([, value]) => value).map(([itemId]) => itemId)
    if (!paid) return setMessage('This transaction is not paid. Refresh after payment is confirmed.')
    if (!mismatchMode && inspected.length !== items.length) return setMessage('Tick every item before confirming a matched basket.')
    if (mismatchMode && !reasonCodes.length) return setMessage('Select at least one mismatch reason.')
    setBusy(true)
    setMessage('')
    try {
      const result = await callFunction('cashier-terminal', {
        action: 'burn-receipt', receiptCode: order.exit_token, station,
        outcome: mismatchMode ? 'mismatch' : 'matched', reasonCodes, checkedItems: inspected,
        incidentNote, balanceCollected: Number(balanceCollected) || 0,
        balancePaymentMethod: Number(balanceCollected) > 0 ? balancePaymentMethod : '',
      })
      setOrder(result.order)
      setMessage(mismatchMode ? 'Mismatch recorded and receipt closed.' : 'Basket matched. Receipt verified and closed.')
    } catch (error) {
      setMessage(error.message || 'This receipt cannot be verified.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash-section payment-verifier">
      <PageTitle title={compact ? 'Verify shopper payment' : 'Exit verification'} subtitle="Scan or search a paid receipt, inspect every item, then record the outcome once." />
      <div className="verification-guide">
        <div><span>1</span><strong>Find transaction</strong><small>Receipt code, reference or email.</small></div>
        <div><span>2</span><strong>Inspect basket</strong><small>Tick each physical item.</small></div>
        <div><span>3</span><strong>Record outcome</strong><small>Match or documented mismatch.</small></div>
      </div>
      <form className="security-scanner" onSubmit={verify}>
        <label>Transaction lookup<input autoFocus placeholder="Scan code, reference or shopper email" value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <button disabled={busy} type="submit">{busy ? 'Checking...' : 'Check transaction'}</button>
      </form>
      {message ? <Notice tone={message.includes('closed') || message.includes('matched') ? 'success' : 'warning'}>{message}</Notice> : null}
      {order ? (
        <section className={`security-manifest ${used ? 'used' : ''}`}>
          <header className={`verification-status ${used ? 'used' : paid ? 'paid' : 'pending'}`}><div><span>{statusLabel}</span><h2>{order.order_number}</h2></div><strong>{itemCount} items</strong></header>
          <SimpleList rows={[{ label: 'Payment', value: order.payment_status }, { label: 'Verification', value: used ? order.verification_outcome || 'closed' : 'open' }, { label: 'Total', value: formatMoney(order.total_amount) }]} />
          {order.challenge_qualified ? <Notice tone="success">🎁 Gift challenge qualified — direct the shopper to the counter after verification.</Notice> : null}
          <div className="audit-list verification-checklist">
            {items.map((item) => (
              <button className={`${Number(item.line_total) >= 10000 ? 'high-value' : ''} ${checkedItems[item.id] ? 'checked' : ''}`} disabled={!paid || used} key={item.id} type="button" onClick={() => setCheckedItems((current) => ({ ...current, [item.id]: !current[item.id] }))}>
                <span><i>{checkedItems[item.id] ? '✓' : ''}</i>{item.product_name}</span><strong>{item.quantity} × {formatMoney(item.unit_price)}</strong>
              </button>
            ))}
          </div>
          {paid && !used ? (
            <div className="verification-decision">
              <div className="decision-toggle"><button className={!mismatchMode ? 'active' : ''} type="button" onClick={() => setMismatchMode(false)}>Basket matches</button><button className={mismatchMode ? 'active danger' : ''} type="button" onClick={() => setMismatchMode(true)}>Report mismatch</button></div>
              {mismatchMode ? <div className="mismatch-form"><p>Select every issue found. The inspection is saved in the audit trail.</p><div className="reason-grid">{mismatchReasons.map(([value, label]) => <label key={value}><input type="checkbox" checked={reasonCodes.includes(value)} onChange={() => setReasonCodes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} /> {label}</label>)}</div><label>Incident note<textarea value={incidentNote} onChange={(event) => setIncidentNote(event.target.value)} placeholder="What happened and how was it resolved?" /></label><div className="form-grid two"><label>Balance collected<input min="0" step="0.01" type="number" value={balanceCollected} onChange={(event) => setBalanceCollected(event.target.value)} /></label><label>Method<select value={balancePaymentMethod} onChange={(event) => setBalancePaymentMethod(event.target.value)}><option value="card">Card</option><option value="transfer">Transfer</option><option value="cash">Cash</option><option value="none">Not collected</option></select></label></div></div> : null}
              <button disabled={busy} type="button" onClick={closeReceipt}>{busy ? 'Saving...' : mismatchMode ? 'Record mismatch and close' : 'Confirm match and verify exit'}</button>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  )
}

function ShopperTerminal({ session }) {
  const [terminal, setTerminal] = useState(() => readJsonStorage('glide:shopper-terminal', null))
  const [gateway, setGateway] = useState({ storeName: '', authCode: '' })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [shiftSummary, setShiftSummary] = useState(null)

  useEffect(() => {
    if (terminal) writeJsonStorage('glide:shopper-terminal', terminal)
  }, [terminal])

  async function logout() {
    localStorage.removeItem('glide:shopper-terminal')
    setTerminal(null)
    await supabase.auth.signOut()
    navigate('/login')
  }

  async function validateGateway(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      const result = await callFunction('cashier-terminal', {
        action: 'validate-terminal',
        authCode: gateway.authCode,
        station: 'security',
      })
      setTerminal({ ...result.terminal, authCode: gateway.authCode })
      setGateway((current) => ({ ...current, authCode: '' }))
      setMessage('Shopper payment terminal online.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function endShift() {
    setBusy(true)
    setMessage('')
    try {
      const result = await callFunction('cashier-terminal', { action: 'end-shift', station: 'security' })
      setShiftSummary(result.shift || { baskets_verified: 0, mismatches: 0, cash_collected: 0 })
      localStorage.removeItem('glide:shopper-terminal')
      setTerminal(null)
    } catch (error) {
      setMessage(error.message || 'Could not close this shift.')
    } finally {
      setBusy(false)
    }
  }

  if (!terminal) {
    return (
      <main className="cashier-page cashier-lock-page">
        {shiftSummary ? <div className="shift-summary-card"><p className="eyebrow">Shift closed</p><h2>Handover summary</h2><SimpleList rows={[{ label: 'Baskets verified', value: shiftSummary.baskets_verified || 0 }, { label: 'Mismatches', value: shiftSummary.mismatches || 0 }, { label: 'Assisted sales', value: shiftSummary.assisted_sales || 0 }, { label: 'Cash collected', value: formatMoney(shiftSummary.cash_collected || 0) }]} /><button type="button" onClick={() => setShiftSummary(null)}>Open another shift</button></div> : null}
        <form className="cashier-lock-panel" onSubmit={validateGateway}>
          <Link className="brand" href="/">
            Glide
          </Link>
          <p className="eyebrow">Shopper terminal</p>
          <h1>Open payment verification</h1>
          {message ? <Notice tone="warning">{message}</Notice> : null}
          <label>
            Authentication Code
            <input required autoFocus autoCapitalize="characters" value={gateway.authCode} onChange={(event) => setGateway((current) => ({ ...current, authCode: event.target.value.toUpperCase() }))} />
          </label>
          <button disabled={busy} type="submit">
            {busy ? 'Checking terminal...' : 'Open terminal'}
          </button>
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="cashier-page shopper-terminal-page">
      <header className="cashier-header">
        <div>
          <span>{terminal.storeName}</span>
          <strong>Shopper payment verification</strong>
          <small>{terminal.branchName || 'Main branch'} - {session.user.email}</small>
        </div>
        <div className="cashier-header-actions">
          <button disabled={busy} type="button" onClick={endShift}>End shift</button>
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      {message ? <Notice tone="success">{message}</Notice> : null}
      <PaymentVerifier />
    </main>
  )
}

function Payments() {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const loadPayments = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const { data } = await supabase
      .from('payments')
      .select('id,status,amount,provider,provider_reference,created_at,paid_at,orders(order_number,receipt_token,customer_email)')
      .order('created_at', { ascending: false })
      .limit(250)
    setPayments(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadPayments(true) }, [loadPayments])
  useRealtimeRefresh('payments-workspace-live', ['payments', 'orders'], () => loadPayments(false))

  const visible = payments.filter((payment) => {
    const matchesStatus = filter === 'all' || payment.status === filter
    const haystack = `${payment.provider_reference} ${payment.orders?.order_number} ${payment.orders?.customer_email}`.toLowerCase()
    return matchesStatus && haystack.includes(query.toLowerCase())
  })
  const paid = payments.filter((payment) => payment.status === 'paid')
  const total = paid.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const successRate = payments.length ? Math.round((paid.length / payments.length) * 100) : 0

  return (
    <section className="dash-section payments-page">
      <div className="payments-heading"><PageTitle title="Payments" subtitle="Monitor successful, pending and failed transactions in real time." /><button type="button" onClick={() => loadPayments(true)}>Refresh</button></div>
      <div className="payment-kpi-grid">
        <div><span>Processed</span><strong>{formatMoney(total)}</strong><small>{paid.length} successful payments</small></div>
        <div><span>Success rate</span><strong>{successRate}%</strong><small>Across loaded transactions</small></div>
        <div><span>Pending</span><strong>{payments.filter((payment) => payment.status === 'pending').length}</strong><small>Awaiting confirmation</small></div>
        <div><span>Failed</span><strong>{payments.filter((payment) => payment.status === 'failed').length}</strong><small>Needs attention</small></div>
      </div>
      <div className="payments-toolbar">
        <input placeholder="Search order, reference or customer" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div>{['all', 'paid', 'pending', 'failed'].map((status) => <button className={filter === status ? 'active' : ''} key={status} type="button" onClick={() => setFilter(status)}>{status}</button>)}</div>
      </div>
      {loading ? <LoadingRows /> : visible.length ? <div className="table-wrap payments-table"><table><thead><tr><th>Order</th><th>Reference</th><th>Provider</th><th>Amount</th><th>Status</th><th>Created</th><th>Receipt</th></tr></thead><tbody>
        {visible.map((payment) => <tr key={payment.id}><td><strong>{payment.orders?.order_number || 'Unlinked'}</strong><small>{payment.orders?.customer_email || ''}</small></td><td className="payment-reference">{payment.provider_reference}</td><td>{String(payment.provider || '').replaceAll('_', ' ')}</td><td>{formatMoney(payment.amount)}</td><td><StatusPill tone={payment.status === 'paid' ? 'success' : payment.status === 'failed' ? 'warning' : 'neutral'}>{payment.status}</StatusPill></td><td>{formatDateTime(payment.created_at)}</td><td>{payment.orders?.receipt_token ? <Link href={`/receipt/${payment.orders.receipt_token}`}>Open</Link> : '—'}</td></tr>)}
      </tbody></table></div> : <EmptyState>No payments match this view.</EmptyState>}
    </section>
  )
}

function VerificationSettings() {
  const [settings, setSettings] = useState({ verification_mode: 'all', verification_threshold: 0, random_audit_percent: 10, mismatch_tolerance: 0, vat_percent: 0, receipt_footer: '', operating_hours: '' })
  const [merchantId, setMerchantId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: authData }) => {
      if (!authData.user) return { data: null, error: new Error('Your session has expired.') }
      return supabase.from('merchant_profile').select('id,verification_mode,verification_threshold,random_audit_percent,mismatch_tolerance,vat_percent,receipt_footer,operating_hours').eq('user_id', authData.user.id).maybeSingle()
    }).then(({ data, error }) => {
      if (data) {
        setMerchantId(data.id)
        setSettings((current) => ({ ...current, verification_mode: data.verification_mode, verification_threshold: data.verification_threshold, random_audit_percent: data.random_audit_percent, mismatch_tolerance: data.mismatch_tolerance, vat_percent: data.vat_percent, receipt_footer: data.receipt_footer, operating_hours: typeof data.operating_hours === 'string' ? data.operating_hours : data.operating_hours?.note || '' }))
      }
      if (error) setMessage(error.message)
      setBusy(false)
    })
  }, [])

  async function save(event) {
    event.preventDefault()
    if (!merchantId) {
      setMessage('Your store profile could not be loaded. Refresh the page and try again.')
      return
    }
    setBusy(true)
    setMessage('')
    const values = {
      ...settings,
      verification_threshold: Math.max(0, Number(settings.verification_threshold) || 0),
      random_audit_percent: Math.min(100, Math.max(0, Number(settings.random_audit_percent) || 0)),
      mismatch_tolerance: Math.max(0, Number(settings.mismatch_tolerance) || 0),
      vat_percent: Math.min(100, Math.max(0, Number(settings.vat_percent) || 0)),
      operating_hours: settings.operating_hours ? { note: settings.operating_hours } : {},
    }
    const { error } = await supabase.from('merchant_profile').update(values).eq('id', merchantId).select('id').single()
    setMessage(error ? error.message : 'Verification and receipt policy saved.')
    setBusy(false)
  }

  const field = (key, value) => setSettings((current) => ({ ...current, [key]: value }))
  return <section className="dash-section"><PageTitle title="Verification policy" subtitle="Set the store rules used at the exit station and on customer receipts." /><form className="settings-card" onSubmit={save}>{message ? <Notice tone={message.includes('saved') ? 'success' : 'warning'}>{message}</Notice> : null}<label>Verification mode<select value={settings.verification_mode} onChange={(event) => field('verification_mode', event.target.value)}><option value="all">Verify every basket</option><option value="threshold_random">High-value plus random audit</option></select></label>{settings.verification_mode === 'threshold_random' ? <div className="form-grid two"><label>Always verify above<input min="0" step="100" type="number" value={settings.verification_threshold} onChange={(event) => field('verification_threshold', event.target.value)} /></label><label>Random audit percentage<input max="100" min="0" type="number" value={settings.random_audit_percent} onChange={(event) => field('random_audit_percent', event.target.value)} /></label></div> : null}<div className="form-grid two"><label>Allowed mismatch tolerance<input min="0" step="1" type="number" value={settings.mismatch_tolerance} onChange={(event) => field('mismatch_tolerance', event.target.value)} /></label><label>VAT percentage<input max="100" min="0" step="0.01" type="number" value={settings.vat_percent} onChange={(event) => field('vat_percent', event.target.value)} /></label></div><label>Operating hours<input placeholder="Mon–Sat 8:00–21:00" value={settings.operating_hours} onChange={(event) => field('operating_hours', event.target.value)} /></label><label>Receipt footer<textarea maxLength="240" placeholder="Thank you for shopping with us." value={settings.receipt_footer || ''} onChange={(event) => field('receipt_footer', event.target.value)} /></label><button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save policy'}</button></form></section>
}

function StoreReports() {
  const [orders, setOrders] = useState([])
  const [verifications, setVerifications] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    Promise.all([
      supabase.from('orders').select('id,order_number,total_amount,payment_status,status,verification_outcome,checkout_duration_seconds,created_at').order('created_at', { ascending: false }),
      supabase.from('verification_records').select('order_id,outcome,reason_codes,balance_collected,created_at').order('created_at', { ascending: false }),
    ]).then(([orderResult, verificationResult]) => { setOrders(orderResult.data || []); setVerifications(verificationResult.data || []); setLoading(false) })
  }, [])
  const paid = orders.filter((order) => order.payment_status === 'paid')
  const mismatchCount = verifications.filter((record) => record.outcome === 'mismatch').length
  const averageSeconds = paid.length ? Math.round(paid.reduce((sum, order) => sum + Number(order.checkout_duration_seconds || 0), 0) / paid.length) : 0
  const daily = Object.values(paid.reduce((days, order) => { const date = order.created_at.slice(0, 10); days[date] ||= { date, orders: 0, sales: 0 }; days[date].orders += 1; days[date].sales += Number(order.total_amount || 0); return days }, {})).sort((a, b) => b.date.localeCompare(a.date))
  function exportCsv() {
    const csv = Papa.unparse(orders.map((order) => ({ order: order.order_number, payment: order.payment_status, verification: order.verification_outcome || 'pending', total: order.total_amount, created_at: order.created_at })))
    const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); anchor.download = `glide-store-report-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href)
  }
  return <section className="dash-section"><PageTitle title="Pilot reports" subtitle="Sales, basket verification and checkout performance in one operational view." /><div className="report-actions"><button type="button" onClick={exportCsv}>Export CSV</button><button className="secondary-action" type="button" onClick={() => window.print()}>Print / save PDF</button></div>{loading ? <LoadingRows /> : <><div className="metrics-grid"><Metric label="Paid sales" value={formatMoney(paid.reduce((sum, order) => sum + Number(order.total_amount || 0), 0))} /><Metric label="Paid baskets" value={paid.length} /><Metric label="Mismatch rate" value={`${verifications.length ? ((mismatchCount / verifications.length) * 100).toFixed(1) : '0.0'}%`} /><Metric label="Avg. checkout" value={averageSeconds ? `${Math.floor(averageSeconds / 60)}m ${averageSeconds % 60}s` : '—'} /></div><div className="table-wrap"><table><thead><tr><th>Day</th><th>Paid baskets</th><th>Sales</th></tr></thead><tbody>{daily.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.orders}</td><td>{formatMoney(row.sales)}</td></tr>)}</tbody></table></div></>}</section>
}

function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState(null)

  const loadOrders = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadOrders(true)
  }, [loadOrders])

  useRealtimeRefresh('orders-live', ['orders', 'payments'], () => loadOrders(false))

  async function openOrder(order) {
    const [items, events, verification] = await Promise.all([
      supabase.from('order_items').select('*').eq('order_id', order.id),
      supabase.from('order_events').select('*').eq('order_id', order.id).order('created_at', { ascending: true }),
      supabase.from('verification_records').select('*').eq('order_id', order.id).maybeSingle(),
    ])
    setDetail({ ...order, items: items.data || [], events: events.data || [], verification: verification.data || null })
  }

  const visibleOrders = orders.filter((order) => `${order.order_number} ${order.customer_email || ''} ${order.receipt_token || ''}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <section className="dash-section">
      <PageTitle title="Orders" subtitle="All self-checkout orders for this store." />
      <div className="order-tools"><input placeholder="Search order, receipt or shopper email" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {loading ? (
        <LoadingRows />
      ) : visibleOrders.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Time</th>
                <th>Receipt token</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((order) => (
                <tr key={order.id} onClick={() => openOrder(order)}>
                  <td>{order.order_number}</td>
                  <td>{order.status}</td>
                  <td>{formatMoney(order.total_amount)}</td>
                  <td>{order.payment_status}</td>
                  <td>{formatDateTime(order.created_at)}</td>
                  <td>{order.receipt_token}</td>
                  <td>
                    {order.receipt_token ? (
                      <Link href={`/receipt/${order.receipt_token}`}>Receipt</Link>
                    ) : (
                      'Not paid'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No orders match this search.</EmptyState>
      )}
      {detail ? <div className="modal-backdrop" role="presentation" onClick={() => setDetail(null)}><section className="modal-card order-detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setDetail(null)}>×</button><p className="eyebrow">Transaction detail</p><h2>{detail.order_number}</h2><SimpleList rows={[{ label: 'Total', value: formatMoney(detail.total_amount) }, { label: 'Payment', value: detail.payment_status }, { label: 'Exit outcome', value: detail.verification_outcome || 'Not verified' }, { label: 'Shopper', value: detail.customer_email || 'Guest' }]} /><h3>Items</h3><SimpleList rows={detail.items.map((item) => ({ label: `${item.product_name} × ${item.quantity}`, value: formatMoney(item.line_total) }))} /><h3>Audit timeline</h3><div className="timeline-list">{detail.events.length ? detail.events.map((event) => <div key={event.id}><i /><span><strong>{event.event_label}</strong><small>{formatDateTime(event.created_at)}</small></span></div>) : <EmptyState>No audit events were captured for this older order.</EmptyState>}</div>{detail.verification?.reason_codes?.length ? <Notice tone="warning">Mismatch: {detail.verification.reason_codes.map((reason) => reason.replaceAll('_', ' ')).join(', ')}</Notice> : null}</section></div> : null}
    </section>
  )
}

function PageTitle({ title, subtitle }) {
  return (
    <header className="page-title">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function TwoColumn({ children }) {
  return <div className="two-column">{children}</div>
}

function EmptyState({ children }) {
  return <p className="empty-state">{children}</p>
}

function SimpleList({ rows }) {
  return (
    <div className="simple-list">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  )
}

function OrderList({ orders }) {
  return (
    <SimpleList
      rows={orders.map((order) => ({
        label: `${order.order_number} - ${order.status}`,
        value: formatMoney(order.total_amount),
      }))}
    />
  )
}

function productInitials(name) {
  return String(name || 'Item')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function NotFound() {
  return (
    <main className="public-page narrow">
      <h1>Page not found.</h1>
      <Link className="primary-action" href="/">
        Go home
      </Link>
    </main>
  )
}

export default App
