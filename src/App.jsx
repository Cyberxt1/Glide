import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import QRCode from 'qrcode'
import './App.css'
import { callFunction } from './lib/api'
import { formatDateTime, formatMoney } from './lib/format'
import { getConfigMessage, isSupabaseConfigured, supabase } from './lib/supabase'

const productColumns =
  'id,name,barcode,sku,category,price,quantity,low_stock_threshold,is_available,track_inventory,created_at'

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
  window.dispatchEvent(new PopStateEvent('popstate'))
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

  if (path === '/cashier') {
    if (!sessionLoaded) return <main className="auth-page"><LoadingRows /></main>
    if (!session) return <Login />
    return <CashierPage session={session} />
  }

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
    <main className="public-page narrow">
      <p className="eyebrow">Glide pilot</p>
      <h1>Self-checkout built for real stores.</h1>
      <p className="lead">
        Run one store, one QR code, real products, real payments and verified
        exits without adding checkout complexity.
      </p>
      <div className="action-row">
        <Link className="primary-action" href="/signup">
          Create store account
        </Link>
        <Link className="primary-action" href="/login">
          Merchant login
        </Link>
        <Link className="secondary-action" href="/dash">
          Open dashboard
        </Link>
      </div>
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

  useEffect(() => {
    callFunction('dashboard-summary')
      .then((data) => setState({ loading: false, error: '', data }))
      .catch(() => {
        loadDashboardSummaryFromClient()
          .then((data) => setState({ loading: false, error: '', data }))
          .catch((error) =>
            setState({ loading: false, error: error.message, data: null }),
          )
      })
  }, [])

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
            <Link href="/dash/products" className="primary-action">
              Add product
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

function Products() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [editing, setEditing] = useState(null)

  async function loadProducts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('products')
      .select(productColumns)
      .order('created_at', { ascending: false })

    setLoading(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setProducts(data || [])
  }

  useEffect(() => {
    loadProducts()
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

  return (
    <section className="dash-section">
      <PageTitle title="Products" subtitle="Manage stock, prices, barcodes and availability." />
      {message ? <Notice tone="warning">{message}</Notice> : null}
      <ProductForm
        product={editing || emptyProduct}
        onDone={() => {
          setEditing(null)
          loadProducts()
        }}
        onCancel={() => setEditing(null)}
      />
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
      {loading ? (
        <LoadingRows />
      ) : filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Barcode</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.barcode}</td>
                  <td>{product.sku || 'Not set'}</td>
                  <td>{product.category || 'Uncategorised'}</td>
                  <td>{formatMoney(product.price)}</td>
                  <td>
                    {product.track_inventory ? product.quantity : 'Not tracked'}
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
                    <button type="button" onClick={() => setEditing(product)}>
                      Edit
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

  async function loadStaff() {
    setLoading(true)
    const { data, error } = await supabase
      .from('staff_members')
      .select('*')
      .order('created_at', { ascending: false })

    setLoading(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setStaff(data || [])
  }

  useEffect(() => {
    loadStaff()
  }, [])

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
        {isEdit ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
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

  async function loadQr() {
    setLoading(true)
    const { data, error } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('is_active', true)
      .maybeSingle()

    setLoading(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setQr(data)
    if (data) {
      const url = `${window.location.origin}/s/${data.qr_code}`
      setImage(await QRCode.toDataURL(url, { margin: 1, width: 280 }))
    }
  }

  useEffect(() => {
    loadQr()
  }, [])

  async function regenerate() {
    const newCode = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    await supabase.from('qr_codes').update({ is_active: false }).eq('is_active', true)
    const { error } = await supabase.from('qr_codes').insert({ qr_code: newCode, is_active: true })
    if (error) {
      setMessage(error.message)
      return
    }
    loadQr()
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
  const [showGuide, setShowGuide] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [activeTab, setActiveTab] = useState('scan')
  const [showOptions, setShowOptions] = useState(false)
  const [hasShownCameraGuide, setHasShownCameraGuide] = useState(false)
  const [barcode, setBarcode] = useState('')
  const [cart, setCart] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraState, setCameraState] = useState('idle')
  const [addToast, setAddToast] = useState(null)
  const videoRef = useRef(null)
  const toastTimerRef = useRef(null)
  const cartRef = useRef(cart)
  const scannerControlsRef = useRef(null)
  const scannerReaderRef = useRef(null)
  const scanProcessingRef = useRef(false)
  const lastDetectedRef = useRef({ code: '', time: 0 })
  const sessionStorageKey = `glide:checkout:${qrCode}:session`
  const cartStorageKey = `glide:checkout:${qrCode}:cart`

  useEffect(() => {
    let nextSessionId = sessionStorage.getItem(sessionStorageKey)
    if (!nextSessionId) {
      nextSessionId = crypto.randomUUID()
      sessionStorage.setItem(sessionStorageKey, nextSessionId)
    }

    setShopperSessionId(nextSessionId)

    async function loadStore() {
      const { data, error } = await supabase
        .from('qr_codes')
        .select('id,qr_code,is_active,merchant_profile(store_name)')
        .eq('qr_code', qrCode)
        .maybeSingle()

      if (error || !data || !data.is_active) {
        setInactive(true)
        return
      }

      setStore(data)
    }
    loadStore()
  }, [qrCode, sessionStorageKey])

  useEffect(() => {
    if (!store) return undefined

    const splashTimer = window.setTimeout(() => {
      setShowSplash(false)
      if (!hasShownCameraGuide) {
        setShowGuide(true)
        setHasShownCameraGuide(true)
      }
    }, 2000)

    return () => window.clearTimeout(splashTimer)
  }, [hasShownCameraGuide, store])

  useEffect(
    () => () => {
      stopCamera()
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    cartRef.current = cart
    if (cart.length) {
      sessionStorage.setItem(cartStorageKey, JSON.stringify(cart))
    } else {
      sessionStorage.removeItem(cartStorageKey)
    }
  }, [cart, cartStorageKey])

  async function addBarcodeFromValue(rawCode, source = 'manual') {
    setMessage('')
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
      return false
    }

    const existing = cartRef.current.find((item) => item.id === data.id)
    const nextQuantity = (existing?.cartQuantity || 0) + 1
    if (data.track_inventory && nextQuantity > data.quantity) {
      setMessage('This item is out of stock.')
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
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setAddToast(null)
    }, 1800)
    setBarcode('')
    return true
  }

  async function addBarcode(event) {
    event.preventDefault()
    await addBarcodeFromValue(barcode)
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
  const cartCount = cart.reduce((sum, item) => sum + item.cartQuantity, 0)

  async function startCamera() {
    setMessage('')

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
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        videoRef.current,
        async (result) => {
          const exactCode = result?.getText?.()?.trim()
          const now = Date.now()

          if (
            !exactCode ||
            scanProcessingRef.current ||
            (lastDetectedRef.current.code === exactCode &&
              now - lastDetectedRef.current.time <= 1800)
          ) {
            return
          }

          scanProcessingRef.current = true
          lastDetectedRef.current = { code: exactCode, time: now }
          try {
            await addBarcodeFromValue(exactCode, 'camera')
          } finally {
            scanProcessingRef.current = false
          }
        },
      )

      setCameraState('scanning')
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
    scannerControlsRef.current?.stop()
    scannerControlsRef.current = null
    scannerReaderRef.current = null
    scanProcessingRef.current = false

    if (videoRef.current) videoRef.current.srcObject = null
    setCameraState((current) => (current === 'scanning' || current === 'requesting' ? 'idle' : current))
  }

  async function clearCheckoutCache() {
    sessionStorage.removeItem(sessionStorageKey)
    sessionStorage.removeItem(cartStorageKey)
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

  async function endSession() {
    stopCamera()
    setCart([])
    setBarcode('')
    setMessage('')
    setAddToast(null)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setShowOptions(false)
    setShowHelp(false)
    setHasShownCameraGuide(false)
    setActiveTab('scan')
    await clearCheckoutCache()
    setShopperSessionId('')
    setSessionEnded(true)
    window.close()
  }

  function openHelp() {
    setShowOptions(false)
    setShowHelp(true)
  }

  async function checkout() {
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

  return (
    <main className="shop-page">
      {showSplash && store ? (
        <div className="shop-splash">
          <span>Welcome to</span>
          <strong>{store.merchant_profile?.store_name || 'Store'}</strong>
        </div>
      ) : null}

      {showGuide ? (
        <div className="guide-backdrop" role="dialog" aria-modal="true">
          <section className="guide-modal">
            <p className="eyebrow">Start shopping</p>
            <h1>Allow camera access to start scanning products and check out on your device.</h1>
            <div className="action-row">
              <button
                type="button"
                onClick={() => {
                  setShowGuide(false)
                  setActiveTab('scan')
                  startCamera()
                }}
              >
                Allow camera access
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGuide(false)
                  setActiveTab('manual')
                }}
              >
                Enter barcode instead
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showHelp ? (
        <div className="guide-backdrop" role="dialog" aria-modal="true">
          <section className="guide-modal">
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
            className="options-button"
            type="button"
            aria-expanded={showOptions}
            onClick={() => setShowOptions((current) => !current)}
          >
            Menu
          </button>
          {showOptions ? (
            <div className="options-menu">
              <button type="button" onClick={openHelp}>
                Help
              </button>
              <button type="button" onClick={endSession}>
                End session
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="shop-tabs" aria-label="Checkout tabs">
        <button
          className={activeTab === 'scan' ? 'active' : ''}
          type="button"
          onClick={() => setActiveTab('scan')}
        >
          Scan
        </button>
        <button
          className={activeTab === 'manual' ? 'active' : ''}
          type="button"
          onClick={() => setActiveTab('manual')}
        >
          Manual
        </button>
        <button
          className={activeTab === 'cart' ? 'active' : ''}
          type="button"
          onClick={() => setActiveTab('cart')}
        >
          Cart
        </button>
      </nav>

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
          <div className={`scanner-window ${cameraState}`}>
            <video ref={videoRef} muted playsInline />
            <div className="scan-frame">
              <span />
            </div>
            <p>
              {cameraState === 'requesting'
                ? 'Allow camera access in your browser'
                : cameraState === 'scanning'
                  ? 'Hold barcode inside the frame'
                  : 'Tap Start camera to scan'}
            </p>
          </div>
          <div className="action-row">
            <button type="button" onClick={startCamera}>
              {cameraState === 'scanning' ? 'Scanning' : 'Start camera'}
            </button>
            <button type="button" onClick={stopCamera}>
              Stop camera
            </button>
          </div>
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

      {activeTab !== 'cart' ? (
        <button className="cart-fab" type="button" onClick={() => setActiveTab('cart')}>
          <span>{cartCount}</span>
          <strong>{formatMoney(total)}</strong>
        </button>
      ) : null}
    </main>
  )
}

function PaymentReturn({ receiptToken }) {
  const [state, setState] = useState({ loading: true, error: '', receipt: null })
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference')
    callFunction('verify-payment', { receiptToken, reference }, false)
      .then((data) => setState({ loading: false, error: '', receipt: data }))
      .catch((error) => setState({ loading: false, error: error.message, receipt: null }))
  }, [receiptToken])

  async function saveEmail(event) {
    event.preventDefault()
    setMessage('')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage('Enter a valid email address.')
      return
    }

    setBusy(true)
    try {
      await callFunction('save-receipt-email', { receiptToken, email }, false)
      setMessage('Receipt email saved.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="payment-page">
      {state.loading ? <LoadingRows /> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.receipt ? (
        <section className="payment-card">
          <p className="eyebrow">Payment complete</p>
          <h1>Payment confirmed.</h1>
          <p className="lead">Enter your email if you want it saved with this receipt, then show the receipt at the exit.</p>
          {message ? (
            <Notice tone={message.includes('saved') ? 'success' : 'warning'}>{message}</Notice>
          ) : null}
          <form className="receipt-email-form" onSubmit={saveEmail}>
            <label>
              Email for receipt
              <input
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button disabled={busy} type="submit">
              {busy ? 'Saving...' : 'Save email'}
            </button>
          </form>
          <Link className="primary-action" href={`/receipt/${receiptToken}`}>
            View receipt
          </Link>
        </section>
      ) : null}
    </main>
  )
}

function ReceiptPage({ token }) {
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const receiptBarcodeRef = useRef(null)

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
        <SimpleList
          rows={order.order_items.map((item) => ({
            label: `${item.product_name} x ${item.quantity}`,
            value: formatMoney(item.line_total),
          }))}
        />
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
        <Notice tone="success">Show this receipt at the exit for verification.</Notice>
      </section>
    </main>
  )
}

function VerifyReceipt() {
  const [token, setToken] = useState('')
  const [order, setOrder] = useState(null)
  const [message, setMessage] = useState('')

  async function verify(event) {
    event.preventDefault()
    setMessage('')
    setOrder(null)

    const { data, error } = await supabase
      .from('orders')
      .select('*,order_items(*)')
      .eq('receipt_token', token.trim())
      .maybeSingle()

    if (error || !data) {
      setMessage('Invalid receipt.')
      return
    }

    setOrder(data)
  }

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

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
      setOrders(data || [])
      setLoading(false)
    }
    load()
  }, [])

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
