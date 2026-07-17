import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import QRCode from 'qrcode'
import './App.css'
import glideLogo from './assets/logo.png'
import { SESSION_EXPIRED_MESSAGE, callFunction } from './lib/api'
import { formatDateTime, formatMoney } from './lib/format'
import { getConfigMessage, isSupabaseConfigured, supabase } from './lib/supabase'

const productColumns =
  'id,name,barcode,sku,category,price,quantity,low_stock_threshold,is_available,track_inventory,size,created_at'

const emptyProduct = {
  name: '',
  barcode: '',
  sku: '',
  category: '',
  price: '',
  quantity: '',
  low_stock_threshold: '5',
  is_available: true,
  track_inventory: true,
  size: '',
}

const SHOPPER_IDLE_TIMEOUT_MS = 20 * 60 * 1000
const SESSION_ACTIVITY_WRITE_MS = 15 * 1000

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
    ['global_products', 'merchant_profile', 'products', 'orders', 'smart_add_items'],
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
    if (tab === 'orders') loadOrders()
    if (tab === 'audit') loadAudit()
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

  return (
    <main className="admin-console">
      <aside className="admin-sidebar">
        <Link className="brand" href="/admin">
          Glide Admin
        </Link>
        <span>{admin.email || session.user.email}</span>
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
          <button className={activeTab === 'staff' ? 'active' : ''} type="button" onClick={() => changeTab('staff')}>
            Staff
          </button>
          <button className={activeTab === 'orders' ? 'active' : ''} type="button" onClick={() => changeTab('orders')}>
            Orders
          </button>
          <button className={activeTab === 'audit' ? 'active' : ''} type="button" onClick={() => changeTab('audit')}>
            Audit
          </button>
        </nav>
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </aside>

      <section className="admin-main">
        <PageTitle
          title="Master control"
          subtitle="Platform-level view for Glide stores, shared product data and operating health."
        />
        {message ? <Notice tone={message.includes('updated') || message.includes('removed') ? 'success' : 'warning'}>{message}</Notice> : null}
        {loading && !summary ? <LoadingRows /> : null}

        {activeTab === 'overview' ? (
          <>
            <div className="metric-grid">
              <Metric label="Stores" value={summary?.merchantCount || 0} />
              <Metric label="Store products" value={summary?.productCount || 0} />
              <Metric label="Master products" value={summary?.globalProductCount || 0} />
              <Metric label="Orders" value={summary?.orderCount || 0} />
              <Metric label="Paid orders" value={summary?.paidOrderCount || 0} />
              <Metric label="Active staff" value={`${summary?.activeStaffCount || 0}/${summary?.staffCount || 0}`} />
              <Metric label="Revenue tracked" value={formatMoney(summary?.totalRevenue || 0)} />
            </div>
            <TwoColumn>
              <Panel title="Recent stores">
                {summary?.recentMerchants?.length ? (
                  <SimpleList
                    rows={summary.recentMerchants.map((merchant) => ({
                      label: merchant.store_name,
                      value: formatDateTime(merchant.created_at),
                    }))}
                  />
                ) : (
                  <EmptyState>No stores yet.</EmptyState>
                )}
              </Panel>
              <Panel title="Recent master products">
                {summary?.recentGlobalProducts?.length ? (
                  <SimpleList
                    rows={summary.recentGlobalProducts.map((product) => ({
                      label: product.name,
                      value: product.barcode,
                    }))}
                  />
                ) : (
                  <EmptyState>No master products yet.</EmptyState>
                )}
              </Panel>
              <Panel title="Admin audit">
                {summary?.recentAudit?.length ? (
                  <SimpleList
                    rows={summary.recentAudit.map((entry) => ({
                      label: entry.action.replaceAll('_', ' '),
                      value: formatDateTime(entry.created_at),
                    }))}
                  />
                ) : (
                  <EmptyState>No admin actions yet.</EmptyState>
                )}
              </Panel>
            </TwoColumn>
          </>
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
            <section className="panel">
              <h2>Stores on Glide</h2>
              {merchants.length ? (
                <div className="table-wrap compact-table admin-stores-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Owner</th>
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
                          <td>{merchant.products_count}</td>
                          <td>{merchant.active_staff_count}/{merchant.staff_count}</td>
                          <td>{formatMoney(merchant.paid_revenue)}</td>
                          <td className="table-actions">
                            <button type="button" onClick={() => openMerchantEdit(merchant)}>
                              Edit
                            </button>
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
        .select('id,store_name,branch_name')
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

  if (path === '/dash') return <AppShell session={session} main={<Dashboard />} />
  if (path === '/dash/products') return <AppShell session={session} main={<Products />} />
  if (path === '/dash/smart-add') return <AppShell session={session} main={<SmartAddDashboard />} />
  if (path === '/dash/import') return <AppShell session={session} main={<CsvImport />} />
  if (path === '/dash/qr') return <AppShell session={session} main={<QrPage />} />
  if (path === '/dash/verify') return <AppShell session={session} main={<VerifyReceipt />} />
  if (path === '/dash/orders') return <AppShell session={session} main={<Orders />} />
  if (path === '/dash/staff') return <AppShell session={session} main={<StaffManagement />} />

  return <NotFound />
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
    setBusy(true)
    setMessage('')

    const profileResult = await supabase
      .from('merchant_profile')
      .insert({
        user_id: session.user.id,
        store_name: storeName.trim(),
        branch_name: branchName.trim() || 'Main branch',
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
      is_active: true,
    })

    setBusy(false)

    if (qrResult.error) {
      setMessage(`Store created, but QR setup failed: ${qrResult.error.message}`)
      return
    }

    navigate('/dash')
  }

  return (
    <main className="auth-page">
      <form className="auth-panel setup-panel" onSubmit={submit}>
        <Link className="brand" href="/">
          Glide
        </Link>
        <p className="eyebrow">Store setup</p>
        <h1>Create your store</h1>
        <p>
          This creates one merchant profile, one branch and the first active
          checkout QR for your pilot.
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
        <button disabled={busy || !storeName.trim()} type="submit">
          {busy ? 'Creating store...' : 'Create store'}
        </button>
      </form>
    </main>
  )
}

function AppShell({ session, main }) {
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
          <span>Store MVP</span>
        </div>
        <nav>
          <Link href="/dash">Dashboard</Link>
          <Link href="/dash/products">Products</Link>
          <Link href="/dash/smart-add">Smart Add</Link>
          <Link href="/dash/import">CSV import</Link>
          <Link href="/dash/qr">Store QR</Link>
          <Link href="/dash/verify">Verify receipt</Link>
          <Link href="/dash/orders">Orders</Link>
          <Link href="/dash/staff">Staff</Link>
        </nav>
        <div className="merchant-meta">
          <span>{session?.user?.email}</span>
          <button type="button" onClick={logout}>
            Sign out
          </button>
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

  return (
    <section className="dash-section">
      <div className="dashboard-command">
        <div className="dashboard-hero">
          <PageTitle
            title={data.storeName || 'Store dashboard'}
            subtitle={`${data.branchName ? `${data.branchName} - ` : ''}Store dashboard for live activity, stock risk and exit readiness.`}
          />
          <div className="dashboard-status">
            <span>Today revenue</span>
            <strong>{formatMoney(data.todayRevenue)}</strong>
            <small>{data.todayPaidOrders} paid orders</small>
          </div>
        </div>
        <div className="ops-strip" aria-label="Store health">
          <div>
            <span>Stock health</span>
            <strong>{stockHealth}</strong>
          </div>
          <div>
            <span>Exit queue</span>
            <strong>{exitHealth}</strong>
          </div>
          <div>
            <span>Average basket</span>
            <strong>{formatMoney(data.averageOrderValue)}</strong>
          </div>
        </div>
      </div>
      {state.loading ? (
        <LoadingRows />
      ) : (
        <>
          {state.error ? (
            <Notice tone="error">
              Dashboard data could not load. If you are running locally, use
              Netlify dev so the summary function is available. {state.error}
            </Notice>
          ) : null}
          <div className="metric-grid">
            <Metric label="Products live" value={data.totalProducts} />
            <Metric label="Low stock" value={data.lowStockCount} />
            <Metric label="Paid orders today" value={data.todayPaidOrders} />
            <Metric label="Revenue today" value={formatMoney(data.todayRevenue)} />
            <Metric label="Awaiting exit" value={data.pendingPaidOrders} />
            <Metric label="Completed exits" value={data.completedExits} />
          </div>

          <div className="quick-actions">
            <Link href="/dash/products?action=add" className="primary-action">
              Add product
            </Link>
            <Link href="/dash/smart-add" className="primary-action">
              Smart Add
            </Link>
            <Link href="/dash/import" className="secondary-action">
              Import CSV
            </Link>
            <Link href="/dash/qr" className="secondary-action">
              View checkout QR
            </Link>
            <Link href="/dash/verify" className="secondary-action">
              Open receipt verifier
            </Link>
            <Link href="/dash/orders" className="secondary-action">
              Review orders
            </Link>
          </div>

          <TwoColumn>
            <Panel title="Recent orders">
              {data.recentOrders.length ? (
                <OrderList orders={data.recentOrders} />
              ) : (
                <EmptyState>No orders yet.</EmptyState>
              )}
            </Panel>
            <Panel title="Top selling products">
              {data.topProducts.length ? (
                <SimpleList
                  rows={data.topProducts.map((item) => ({
                    label: item.name,
                    value: `${item.quantity_sold} sold`,
                  }))}
                />
              ) : (
                <EmptyState>No paid product sales yet.</EmptyState>
              )}
            </Panel>
          </TwoColumn>
        </>
      )}
    </section>
  )
}

async function loadDashboardSummaryFromClient() {
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
      setState({ loading: false, links: data.links || [], error: '', created: null })
    } catch (error) {
      setState({ loading: false, links: [], error: smartAddErrorMessage(error), created: null })
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
            <a className="secondary-action" href={`https://wa.me/?text=${encodeURIComponent(state.created.url)}`}>
              Send on WhatsApp
            </a>
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
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)

  const loadStaff = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const { data, error } = await supabase
      .from('staff_members')
      .select('*')
      .order('created_at', { ascending: false })

    if (showLoading) setLoading(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setStaff(data || [])
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
      })
      setForm({ fullName: '', email: '', password: '' })
      await loadStaff()
      setMessage('Cashier account created.')
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
      <PageTitle title="Staff" subtitle="Add cashier accounts for counter checkout." />
      <Notice tone="warning">Each cashier must use their email, password, store name and terminal authentication code at login.</Notice>
      {message ? <Notice tone={message.includes('created') ? 'success' : 'warning'}>{message}</Notice> : null}
      <form className="product-form" onSubmit={submit}>
        <h2>Add cashier</h2>
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
          {busy ? 'Creating cashier...' : 'Create cashier'}
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
        <EmptyState>No cashier accounts yet.</EmptyState>
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
      barcode: form.barcode.trim(),
      sku: form.sku.trim() || null,
      category: form.category.trim() || null,
      price: Number(form.price),
      quantity: Number(form.quantity || 0),
      low_stock_threshold: Number(form.low_stock_threshold || 0),
      is_available: Boolean(form.is_available),
      track_inventory: Boolean(form.track_inventory),
      size: form.size?.trim() || null,
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
          Barcode
          <input
            required
            value={form.barcode}
            onChange={(event) => update('barcode', event.target.value)}
          />
        </label>
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
  const [image, setImage] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const loadQr = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    const { data, error } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('is_active', true)
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
    const newCode = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    await supabase.from('qr_codes').update({ is_active: false }).eq('is_active', true)
    const { error } = await supabase.from('qr_codes').insert({ qr_code: newCode, is_active: true })
    if (error) {
      setMessage(error.message)
      return
    }
    loadQr(false)
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
            <button type="button" onClick={regenerate}>
              Regenerate QR
            </button>
          </div>
        </div>
      ) : (
        <div className="action-row">
          <EmptyState>No active QR exists yet.</EmptyState>
          <button type="button" onClick={regenerate}>
            Create active QR
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
  const [receiptToken, setReceiptToken] = useState('')
  const [auditOrder, setAuditOrder] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)

  const cartCount = cart.reduce((sum, item) => sum + item.cartQuantity, 0)
  const total = cart.reduce((sum, item) => sum + Number(item.price) * item.cartQuantity, 0)

  const groupedAuditItems = useMemo(() => {
    const rows = auditOrder?.order_items || []
    return [...rows].sort((left, right) => {
      const leftValue = Number(left.line_total || 0)
      const rightValue = Number(right.line_total || 0)
      return rightValue - leftValue
    })
  }, [auditOrder])

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
    let channel
    try {
      channel = new BroadcastChannel('glide-cashier-terminal')
      channel.onmessage = (event) => {
        if (event.data?.type === 'receipt-burned' && event.data.receiptToken === auditOrder?.receipt_token) {
          setAuditOrder((current) => current ? { ...current, status: 'exited' } : current)
          setMessage('Security Warning: Receipt Already Used.')
        }
      }
    } catch {
      return undefined
    }

    return () => channel?.close()
  }, [auditOrder?.receipt_token])

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
        storeName: gateway.storeName,
        authCode: gateway.authCode,
      })
      setTerminal(result.terminal)
      setCatalog(result.catalog || [])
      setGateway((current) => ({ ...current, authCode: '' }))
      setMessage('Terminal unlocked. Product catalog cached on this device.')
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

  async function verifyReceipt(event) {
    event.preventDefault()
    const token = receiptToken.trim()
    if (!token) return

    setBusy(true)
    setMessage('')
    setAuditOrder(null)

    try {
      const result = await callFunction('cashier-terminal', {
        action: 'verify-receipt',
        receiptToken: token,
      })
      setAuditOrder(result.order)
      if (result.order.status === 'exited') {
        setMessage('Security Warning: Receipt Already Used.')
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function burnReceipt() {
    if (!auditOrder?.receipt_token) return
    setBusy(true)
    setMessage('')

    try {
      const result = await callFunction('cashier-terminal', {
        action: 'burn-receipt',
        receiptToken: auditOrder.receipt_token,
      })
      try {
        const channel = new BroadcastChannel('glide-cashier-terminal')
        channel.postMessage({ type: 'receipt-burned', receiptToken: auditOrder.receipt_token })
        channel.close()
      } catch {
        // BroadcastChannel is best-effort across nearby browser contexts.
      }
      setAuditOrder(result.order)
      setMessage('Receipt confirmed and marked paid. Exit token burned.')
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
          <p>Sign-in is complete. Enter the assigned store name and active authentication code for this branch.</p>
          {message ? <Notice tone="warning">{message}</Notice> : null}
          <label>
            Store Name
            <input
              required
              autoFocus
              value={gateway.storeName}
              onChange={(event) => updateGateway('storeName', event.target.value)}
            />
          </label>
          <label>
            Authentication Code
            <input
              required
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
          <strong>{mode === 'home' ? 'Cashier dashboard' : mode === 'manual' ? 'Manual Checkout' : 'Self-Checkout Verification'}</strong>
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
            <span>Self-Checkout Verification</span>
            <small>Smart Shopper receipt audit and token burn</small>
          </button>
        </section>
      ) : null}

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

      {mode === 'verify' ? (
        <section className="cashier-verify-panel">
          <form className="cashier-scan-bar" onSubmit={verifyReceipt}>
            <label>
              Receipt barcode
              <input
                autoFocus
                placeholder="Scan customer exit pass"
                value={receiptToken}
                onChange={(event) => setReceiptToken(event.target.value)}
              />
            </label>
            <button disabled={busy} type="submit">
              {busy ? 'Checking...' : 'Scan Receipt'}
            </button>
          </form>

          {auditOrder ? (
            <section className={`audit-card ${auditOrder.status === 'exited' ? 'used' : ''}`}>
              <div className="audit-summary">
                <span>{auditOrder.status === 'exited' ? 'Security Warning: Receipt Already Used' : `${groupedAuditItems.reduce((sum, item) => sum + item.quantity, 0)} Items Total - Paid`}</span>
                <strong>{formatMoney(auditOrder.total_amount)}</strong>
              </div>
              <div className="audit-list">
                {groupedAuditItems.map((item) => (
                  <div className={Number(item.line_total) >= 10000 ? 'high-value' : ''} key={item.id}>
                    <span>{item.product_name}</span>
                    <strong>{item.quantity} x {formatMoney(item.unit_price)}</strong>
                  </div>
                ))}
              </div>
              <button
                className="confirm-exit-button"
                disabled={busy || auditOrder.status === 'exited'}
                type="button"
                onClick={burnReceipt}
              >
                Confirm and Mark Paid
              </button>
            </section>
          ) : (
            <EmptyState>Scan the Smart Shopper receipt barcode to load the purchase manifest.</EmptyState>
          )}
        </section>
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
  const [cart, setCart] = useState([])
  const [message, setMessage] = useState('')
  const [networkWarning, setNetworkWarning] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraState, setCameraState] = useState('idle')
  const [addToast, setAddToast] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [pendingScan, setPendingScan] = useState(null)
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
  const sessionStorageKey = `glide:checkout:${qrCode}:session`
  const cartStorageKey = `glide:checkout:${qrCode}:cart`
  const activityStorageKey = `glide:checkout:${qrCode}:lastActivity`
  const networkWarningKey = `glide:checkout:${qrCode}:networkWarningShown`

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
        .select('id,merchant_id,qr_code,is_active,merchant_profile(store_name)')
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
    if (cameraState !== 'idle' || autoCameraTriedRef.current) return

    autoCameraTriedRef.current = true
    startCamera({ automatic: true })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, cameraState, sessionEnded, showSplash, store])

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
    const code = String(rawCode || '').trim()
    if (!code) return false

    const { data, error } = await supabase
      .from('products')
      .select(productColumns)
      .eq('barcode', code)
      .eq('is_available', true)
      .maybeSingle()

    if (error || !data) {
      setMessage(source === 'camera' ? `No product found for ${code}.` : 'Product not found or unavailable.')
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
    if (reason === 'manual') window.close()
  }

  function openHelp() {
    noteActivity()
    setShowHelp(true)
  }

  async function checkout() {
    noteActivity(true)
    const confirmed = window.confirm('Have you confirmed everything in the cart is accurate?')
    if (!confirmed) return

    setBusy(true)
    setMessage('')
    try {
      const result = await callFunction(
        'create-order',
        {
          qrCode,
          shopperSessionId,
          cart: cart.map((item) => ({ productId: item.id, quantity: item.cartQuantity })),
        },
        false,
      )

      if (!result.authorizationUrl) {
        throw new Error('Payment could not start. The checkout server did not return a Paystack link.')
      }

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
      {showIntro ? (
        <div
          className="guide-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowIntro(false)}
        >
          <section className="guide-modal" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Welcome to Glide</p>
            <h1>Scan products and checkout faster.</h1>
            <p className="lead">Glide seamlessly through the store, pay on your device and show your receipt at the exit.</p>
            <button type="button" onClick={() => setShowIntro(false)}>
              Start shopping
            </button>
          </section>
        </div>
      ) : null}

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
        <div>
          <span>Welcome to</span>
          <strong>{store?.merchant_profile?.store_name || 'Store'}</strong>
          <small>{cartCount ? `${cartCount} item${cartCount === 1 ? '' : 's'} in cart` : 'Scan products as you shop'}</small>
        </div>
        <div className="shop-options">
          <button
            className="end-session-button"
            type="button"
            onClick={endSession}
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
          Cart
        </button>
      </nav>

      {networkWarning ? <Notice tone="warning">{networkWarning}</Notice> : null}
      {message ? <Notice tone="warning">{message}</Notice> : null}

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
            <strong>{cartCount} items</strong>
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
                <div className="cart-total">
                  <span>Total</span>
                  <strong>{formatMoney(total)}</strong>
                </div>
                <button disabled={!cart.length || busy} type="button" onClick={checkout}>
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

function PaymentReturn({ receiptToken }) {
  const [state, setState] = useState({ loading: true, error: '' })

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference')
    callFunction('verify-payment', { receiptToken, reference }, false)
      .then(() => {
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
    window.location.assign('/')
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
    if (!order?.receipt_token || !receiptBarcodeRef.current) return

    async function renderBarcode() {
      const { default: JsBarcode } = await import('jsbarcode')
      if (!receiptBarcodeRef.current) return

      JsBarcode(receiptBarcodeRef.current, order.receipt_token, {
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

  return (
    <main className="receipt-page">
      <section className="receipt-card">
        <p className="eyebrow">{order.merchant_profile?.store_name || 'Glide store'}</p>
        <h1>Receipt {order.order_number}</h1>
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
            { label: 'Receipt token', value: order.receipt_token },
            { label: 'Exit token', value: order.exit_token },
          ]}
        />
        <div className="receipt-barcode-panel">
          <span>Scan to verify receipt</span>
          <svg ref={receiptBarcodeRef} aria-label="Receipt barcode" />
          <strong>{order.receipt_token}</strong>
        </div>
        <div className="receipt-actions">
          <button type="button" onClick={() => window.print()}>
            Download receipt
          </button>
          <button className="receipt-exit-button" type="button" onClick={exitStore}>
            Exit store
          </button>
        </div>
        <p className="receipt-exit-note">Show this receipt at the exit for verification.</p>
      </section>
    </main>
  )
}

function VerifyReceipt() {
  const [token, setToken] = useState('')
  const [order, setOrder] = useState(null)
  const [message, setMessage] = useState('')

  const verifyToken = useCallback(async (receiptToken) => {
    setMessage('')
    setOrder(null)

    const { data, error } = await supabase
      .from('orders')
      .select('*,order_items(*)')
      .eq('receipt_token', receiptToken.trim())
      .maybeSingle()

    if (error || !data) {
      setMessage('Invalid receipt.')
      return
    }

    setOrder(data)
  }, [])

  async function verify(event) {
    event.preventDefault()
    await verifyToken(token)
  }

  useRealtimeRefresh('verify-receipt-live', ['orders'], () => {
    if (token.trim()) verifyToken(token)
  })

  async function markExited() {
    if (!order || order.status === 'exited') return

    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'exited', exited_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', 'paid')
      .select('*,order_items(*)')
      .single()

    if (error) {
      setMessage('This receipt cannot be exited again.')
      return
    }

    setOrder(data)
  }

  return (
    <section className="dash-section">
      <PageTitle title="Receipt verification" subtitle="Enter a receipt token and mark paid orders as exited." />
      <form className="toolbar" onSubmit={verify}>
        <input
          placeholder="Receipt token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="submit">Verify</button>
      </form>
      {message ? <Notice tone="warning">{message}</Notice> : null}
      {order ? (
        <Panel title={order.status === 'exited' ? 'Valid receipt, already exited' : 'Valid receipt'}>
          <SimpleList
            rows={[
              { label: 'Order', value: order.order_number },
              { label: 'Payment', value: order.payment_status },
              { label: 'Exit status', value: order.status },
              { label: 'Total', value: formatMoney(order.total_amount) },
            ]}
          />
          {order.status === 'paid' ? (
            <button type="button" onClick={markExited}>
              Mark as exited
            </button>
          ) : null}
        </Panel>
      ) : null}
    </section>
  )
}

function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

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

  return (
    <section className="dash-section">
      <PageTitle title="Orders" subtitle="All self-checkout orders for this store." />
      {loading ? (
        <LoadingRows />
      ) : orders.length ? (
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
              {orders.map((order) => (
                <tr key={order.id}>
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
        <EmptyState>No orders yet.</EmptyState>
      )}
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
