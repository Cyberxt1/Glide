import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import QRCode from 'qrcode'
import './App.css'
import { callFunction } from './lib/api'
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
    if (!session) return <Login />
    return <PlatformAdminDashboard session={session} />
  }

  if (path === '/cashier') {
    if (!sessionLoaded) return <main className="auth-page"><LoadingRows /></main>
    if (!session) return <Login />
    return <CashierPage session={session} />
  }

  const smartAddMatch = path.match(/^\/smart-add\/([^/]+)$/)
  if (smartAddMatch) return <SmartAddPhone token={smartAddMatch[1]} />

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
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="brand" href="/">
          Glide
        </Link>
        <div>
          <Link href="/login">Login</Link>
          <Link className="primary-action" href="/signup">
            Start your store
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">Retail checkout, simplified</p>
          <h1>Self-checkout built for real stores.</h1>
          <p className="lead">
            Glide lets customers shop and pay from their phones while stores keep
            inventory, payments, orders and receipt verification in one calm
            operating system.
          </p>
          <div className="action-row">
            <Link className="primary-action" href="/signup">
              Start your store
            </Link>
            <Link className="secondary-action" href="/login">
              Merchant login
            </Link>
          </div>
        </div>
        <div className="landing-preview" aria-hidden="true">
          <div className="preview-phone">
            <span>Greenway Mart</span>
            <strong>₦8,450</strong>
            <p>3 items scanned</p>
            <div>
              <i />
              <b>Coca Cola 50cl</b>
              <em>₦500</em>
            </div>
            <div>
              <i />
              <b>Golden Penny Pasta</b>
              <em>₦1,250</em>
            </div>
            <button type="button">Checkout</button>
          </div>
          <div className="preview-ops">
            <span>Inventory updated</span>
            <span>Payment confirmed</span>
            <span>Receipt ready for exit</span>
          </div>
        </div>
      </section>

      <section className="landing-line">
        Built for supermarkets, minimarts, pharmacies, campus stores and
        neighbourhood retailers.
      </section>

      <section className="landing-split">
        <div>
          <p className="eyebrow">For shoppers</p>
          <h2>Walk into any Glide powered store and shop easily.</h2>
        </div>
        <ol className="landing-steps">
          <li>Scan the store QR.</li>
          <li>Scan products as you shop.</li>
          <li>Pay securely on your phone.</li>
          <li>Show your digital receipt at the exit.</li>
        </ol>
      </section>

      <section className="landing-split">
        <div>
          <p className="eyebrow">For stores</p>
          <h2>A retail operating system for everyday selling.</h2>
        </div>
        <div className="landing-copy">
          <p>
            Glide is a retail operating system that lets customers shop and
            check out from their phones while helping stores manage inventory,
            payments and orders.
          </p>
          <p>
            With Glide, store operations are unified and simplified: products,
            stock, checkout QR codes, receipts, cashier activity and exit
            verification all work from one place.
          </p>
        </div>
      </section>

      <section className="landing-statements" aria-label="What Glide improves">
        <p>Queues move faster.</p>
        <p>Inventory updates automatically.</p>
        <p>Receipts stay digital.</p>
        <p>Staff see paid orders instantly.</p>
        <p>Security verifies exits in seconds.</p>
      </section>

      <section className="landing-close">
        <h2>A better way for physical stores to sell.</h2>
        <Link className="primary-action" href="/signup">
          Start your store
        </Link>
      </section>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Glide</span>
        <div>
          <Link href="/dash">Product</Link>
          <a href="/docs">Documentation</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="mailto:hello@useglide.app">Contact</a>
        </div>
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
}

function PlatformAdminDashboard({ session }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [products, setProducts] = useState([])
  const [merchants, setMerchants] = useState([])
  const [query, setQuery] = useState('')
  const [productForm, setProductForm] = useState(emptyGlobalProduct)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadAdmin = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const [summaryResult, productResult, merchantResult] = await Promise.all([
        callFunction('platform-admin', { action: 'summary' }),
        callFunction('platform-admin', { action: 'list-products', query }),
        callFunction('platform-admin', { action: 'list-merchants' }),
      ])

      setSummary(summaryResult.summary)
      setProducts(productResult.products || [])
      setMerchants(merchantResult.merchants || [])
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    loadAdmin()
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

  function editProduct(product) {
    setActiveTab('products')
    setProductForm({
      id: product.id || '',
      barcode: product.barcode || '',
      name: product.name || '',
      category: product.category || '',
      size: product.size || '',
      label_text: product.label_text || '',
    })
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
      setProductForm(emptyGlobalProduct)
      setProducts((current) => {
        const exists = current.some((item) => item.id === result.product.id)
        return exists
          ? current.map((item) => (item.id === result.product.id ? result.product : item))
          : [result.product, ...current]
      })
      setMessage('Product database updated.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteGlobalProduct(product) {
    const confirmed = window.confirm(`Delete ${product.name} from the master product database?`)
    if (!confirmed) return

    try {
      await callFunction('platform-admin', { action: 'delete-product', id: product.id })
      setProducts((current) => current.filter((item) => item.id !== product.id))
      setMessage('Product removed from database.')
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
        <span>{session.user.email}</span>
        <nav>
          <button className={activeTab === 'overview' ? 'active' : ''} type="button" onClick={() => setActiveTab('overview')}>
            Overview
          </button>
          <button className={activeTab === 'products' ? 'active' : ''} type="button" onClick={() => setActiveTab('products')}>
            Product database
          </button>
          <button className={activeTab === 'merchants' ? 'active' : ''} type="button" onClick={() => setActiveTab('merchants')}>
            Stores
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
            </TwoColumn>
          </>
        ) : null}

        {activeTab === 'products' ? (
          <section className="admin-grid">
            <form className="product-form" onSubmit={saveGlobalProduct}>
              <h2>{productForm.id ? 'Edit master product' : 'Add master product'}</h2>
              <div className="form-grid">
                <label>
                  Barcode
                  <input required value={productForm.barcode} onChange={(event) => updateProductForm('barcode', event.target.value)} />
                </label>
                <label>
                  Product name
                  <input required value={productForm.name} onChange={(event) => updateProductForm('name', event.target.value)} />
                </label>
                <label>
                  Category
                  <input value={productForm.category} onChange={(event) => updateProductForm('category', event.target.value)} />
                </label>
                <label>
                  Size
                  <input value={productForm.size} onChange={(event) => updateProductForm('size', event.target.value)} />
                </label>
                <label className="wide-field">
                  Notes / label text
                  <textarea value={productForm.label_text} onChange={(event) => updateProductForm('label_text', event.target.value)} />
                </label>
              </div>
              <div className="action-row">
                <button disabled={saving} type="submit">
                  {saving ? 'Saving...' : 'Save master product'}
                </button>
                <button type="button" onClick={() => setProductForm(emptyGlobalProduct)}>
                  Clear
                </button>
              </div>
            </form>

            <section className="panel">
              <div className="modal-title-row">
                <h2>Master product database</h2>
                <StatusPill tone="warning">Premium source</StatusPill>
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
                <div className="table-wrap compact-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Barcode</th>
                        <th>Category</th>
                        <th>Size</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td>{product.barcode}</td>
                          <td>{product.category || 'General'}</td>
                          <td>{product.size || 'Not set'}</td>
                          <td>
                            <button type="button" onClick={() => editProduct(product)}>
                              Edit
                            </button>
                            <button type="button" onClick={() => deleteGlobalProduct(product)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState>No master products found.</EmptyState>
              )}
            </section>
          </section>
        ) : null}

        {activeTab === 'merchants' ? (
          <section className="panel">
            <h2>Stores on Glide</h2>
            {merchants.length ? (
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Store</th>
                      <th>Branch</th>
                      <th>Products</th>
                      <th>Orders</th>
                      <th>Paid revenue</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merchants.map((merchant) => (
                      <tr key={merchant.id}>
                        <td>{merchant.store_name}</td>
                        <td>{merchant.branch_name}</td>
                        <td>{merchant.products_count}</td>
                        <td>{merchant.orders_count}</td>
                        <td>{formatMoney(merchant.paid_revenue)}</td>
                        <td>{formatDateTime(merchant.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No stores yet.</EmptyState>
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
      <form className="auth-panel" onSubmit={submit}>
        <Link className="brand" href="/">
          Glide
        </Link>
        <h1>Merchant login</h1>
        <p>Manage the active store pilot.</p>
        {message ? <Notice tone="warning">{message}</Notice> : null}
        <label>
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
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
      <form className="auth-panel" onSubmit={submit}>
        <Link className="brand" href="/">
          Glide
        </Link>
        <h1>Create account</h1>
        <p>Sign up first, then create your store.</p>
        {message ? <Notice tone="warning">{message}</Notice> : null}
        <label>
          Email
          <input
            required
            type="email"
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
    ...(state.data || {}),
  }

  data.recentOrders = Array.isArray(data.recentOrders) ? data.recentOrders : []
  data.topProducts = Array.isArray(data.topProducts) ? data.topProducts : []

  return (
    <section className="dash-section">
      <div className="dashboard-hero">
        <PageTitle title="Store dashboard" subtitle="Operational view for one active store." />
        <div className="dashboard-status">
          <span>Today</span>
          <strong>{formatMoney(data.todayRevenue)}</strong>
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
            <Metric label="Total products" value={data.totalProducts} />
            <Metric label="Low stock products" value={data.lowStockCount} />
            <Metric label="Today's orders" value={data.todayPaidOrders} />
            <Metric label="Today's revenue" value={formatMoney(data.todayRevenue)} />
            <Metric label="Pending paid orders" value={data.pendingPaidOrders} />
            <Metric label="Completed exits" value={data.completedExits} />
            <Metric label="Average order value" value={formatMoney(data.averageOrderValue)} />
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
  ])

  const firstError = [
    productsResult.error,
    todayOrdersResult.error,
    pendingPaidResult.error,
    exitedResult.error,
    recentOrdersResult.error,
    paidOrdersWithItemsResult.error,
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
    ['Beverages', ['drink', 'juice', 'water', 'soda', 'cola', 'malt', 'milk', 'tea', 'coffee']],
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

function SmartAddDashboard() {
  const [state, setState] = useState({ loading: true, links: [], error: '', created: null })
  const [busy, setBusy] = useState(false)

  const loadLinks = useCallback(async (showLoading = true) => {
    if (showLoading) setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const data = await callFunction('smart-add', { action: 'list-links' })
      setState({ loading: false, links: data.links || [], error: '', created: null })
    } catch (error) {
      setState({ loading: false, links: [], error: error.message, created: null })
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
      setState((current) => ({ ...current, error: error.message }))
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
              { label: '2. Scan barcode', value: 'Checks shared database' },
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

  useEffect(() => {
    async function loadLink() {
      try {
        const data = await callFunction('smart-add', { action: 'get-link', token }, false)
        setState({ loading: false, error: '', link: data.link })
      } catch (error) {
        setState({ loading: false, error: error.message, link: null })
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
    const cleanBarcode = String(nextBarcode || '').trim()
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
      setMessage(error.message)
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
      setMessage(error.message || 'Camera could not scan. Enter the barcode manually.')
    }
  }

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
        <p className="eyebrow">Smart Add</p>
        <h1>{state.link?.store_name || 'Glide store'}</h1>
        <p className="lead">Scan barcode, enter the product details, save.</p>

        {message ? <Notice tone={message.includes('saved') || message.includes('found') ? 'success' : 'warning'}>{message}</Notice> : null}

        <div className="smart-scanner">
          <video ref={videoRef} muted playsInline />
          <div className="action-row">
            <button type="button" onClick={scanBarcode}>
              Scan barcode
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
          <div className="table-wrap compact-table">
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
                  <td>{product.sku || 'Not set'}</td>
                  <td>{formatMoney(product.price)}</td>
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
                  <td>
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

function CashierPage({ session }) {
  const [barcode, setBarcode] = useState('')
  const [cart, setCart] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  async function addBarcode(event) {
    event.preventDefault()
    const code = barcode.trim()
    if (!code) return

    setMessage('')
    const { data, error } = await supabase
      .from('products')
      .select(productColumns)
      .eq('barcode', code)
      .eq('is_available', true)
      .maybeSingle()

    if (error || !data) {
      setMessage('Product not found or unavailable.')
      return
    }

    const existing = cart.find((item) => item.id === data.id)
    const nextQuantity = (existing?.cartQuantity || 0) + 1
    if (data.track_inventory && nextQuantity > data.quantity) {
      setMessage('This item is out of stock.')
      return
    }

    setCart((current) =>
      existing
        ? current.map((item) =>
            item.id === data.id ? { ...item, cartQuantity: nextQuantity } : item,
          )
        : [...current, { ...data, cartQuantity: 1 }],
    )
    setBarcode('')
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

  const total = cart.reduce((sum, item) => sum + item.price * item.cartQuantity, 0)

  async function completeSale() {
    setBusy(true)
    setMessage('')

    try {
      const result = await callFunction('cashier-create-order', {
        cart: cart.map((item) => ({ productId: item.id, quantity: item.cartQuantity })),
      })
      navigate(`/receipt/${result.receiptToken}`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="cashier-page">
      <header className="cashier-header">
        <div>
          <span>Glide cashier</span>
          <strong>Counter checkout</strong>
          <small>{session.user.email}</small>
        </div>
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </header>

      {message ? <Notice tone="warning">{message}</Notice> : null}

      <form className="barcode-form" onSubmit={addBarcode}>
        <label>
          Scan or enter barcode
          <input
            autoFocus
            inputMode="numeric"
            placeholder="Barcode"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
          />
        </label>
        <button type="submit">Add</button>
      </form>

      <section className="cart-panel active cashier-cart">
        <div className="cart-title-row">
          <h1>Cashier cart</h1>
          <strong>{formatMoney(total)}</strong>
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
              <button disabled={busy} type="button" onClick={completeSale}>
                {busy ? 'Generating receipt...' : 'Mark paid and generate receipt'}
              </button>
            </div>
          </>
        ) : (
          <EmptyState>Scan or enter a product barcode to begin.</EmptyState>
        )}
      </section>
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
  const scanArmedRef = useRef(false)
  const scanProcessingRef = useRef(false)
  const lastDetectedRef = useRef({ code: '', time: 0 })
  const latestVisibleBarcodeRef = useRef({ code: '', time: 0 })
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
    const nextQuantity = (existing?.cartQuantity || 0) + 1
    if (data.track_inventory && nextQuantity > data.quantity) {
      setMessage('This item is out of stock.')
      setScanResult({ status: 'blocked', code, label: 'Out of stock' })
      return false
    }

    setCart((current) =>
      existing
        ? current.map((item) =>
            item.id === data.id ? { ...item, cartQuantity: nextQuantity } : item,
          )
        : [...current, { ...data, cartQuantity: 1 }],
    )
    setAddToast({
      name: data.name,
      price: data.price,
    })
    setScanResult({ status: 'added', code, label: data.name })
    playScanSound()
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setAddToast(null)
    }, 1800)
    setBarcode('')
    return true
  }

  function playScanSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return

      const audioContext = audioContextRef.current || new AudioContext()
      audioContextRef.current = audioContext
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(1320, audioContext.currentTime + 0.08)
      gain.gain.setValueAtTime(0.001, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.14)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start()
      oscillator.stop(audioContext.currentTime + 0.15)
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
      !scanArmedRef.current &&
      !scanProcessingRef.current &&
      (previous.code !== exactCode || now - previous.time > 1500)
    ) {
      setScanResult({ status: 'ready', code: exactCode, label: 'Barcode detected. Tap Scan.' })
    }

    return exactCode
  }

  async function processDetectedBarcode(rawCode, source = 'camera') {
    const exactCode = observeDetectedBarcode(rawCode)
    const now = Date.now()
    if (
      !exactCode ||
      !scanArmedRef.current ||
      scanProcessingRef.current ||
      (lastDetectedRef.current.code === exactCode && now - lastDetectedRef.current.time <= 1200)
    ) {
      return
    }

    scanArmedRef.current = false
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
            if (scanArmedRef.current) await processDetectedBarcode(exactCode, 'camera')
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
            : { status: 'ready', code: '', label: 'Camera ready. Point at a barcode, then tap Scan.' },
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
          if (scanArmedRef.current) await processDetectedBarcode(exactCode, 'camera')
        },
      )

      setCameraState('scanning')
      setScanResult((current) =>
        current?.status === 'reading'
          ? current
          : { status: 'ready', code: '', label: 'Camera ready. Point at a barcode, then tap Scan.' },
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

  async function armScanner() {
    noteActivity(true)
    setMessage('')
    scanArmedRef.current = true
    setScanResult({ status: 'reading', code: '', label: 'Looking for barcode' })

    if (cameraState !== 'scanning') {
      await startCamera()
    }

    const latest = latestVisibleBarcodeRef.current
    if (latest.code && Date.now() - latest.time <= 3500) {
      await processDetectedBarcode(latest.code, 'camera')
    }
  }

  function stopCamera() {
    scanArmedRef.current = false
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
          <small>{formatMoney(addToast.price)}</small>
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
                  ? 'Point at barcode, then tap Scan'
                  : 'Tap Scan below'}
            </p>
          </div>
          <button
            className="scan-action-button"
            type="button"
            onClick={armScanner}
          >
            {scanResult?.status === 'reading' ? 'Scanning...' : 'Scan'}
          </button>
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
