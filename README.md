# Glide Store-Side MVP

Glide is a one-merchant, one-branch self-checkout pilot for a real store.

Included:

- Merchant signup at `/signup`
- Store setup at `/setup-store`
- Merchant dashboard at `/dash`
- Product management at `/dash/products`
- CSV import at `/dash/import`
- One active store QR at `/dash/qr`
- Customer checkout at `/s/[qrCode]`
- Paystack server-side payment initialization and verification
- Receipt page at `/receipt/[token]`
- Receipt verification at `/dash/verify`
- Orders at `/dash/orders`
- Supabase schema with RLS
- Netlify functions for trusted order/payment work

## Setup

1. Install dependencies.

```bash
npm install
```

2. Create a Supabase project and run:

```sql
-- supabase/schema.sql
```

If you already ran an older schema, rerun `supabase/schema.sql` or apply the
new `orders.shopper_session_id` column and index before testing checkout.

3. Copy `.env.example` to `.env` and fill in:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PAYSTACK_SECRET_KEY=
URL=
```

Use `VITE_SUPABASE_ANON_KEY` for the browser client only. Use the service role key only on Netlify/server functions. Never expose it in `VITE_` variables.

4. Run locally with Netlify functions.

```bash
npm install -g netlify-cli
netlify dev
```

The Vite-only command works for UI screens. Dashboard data can fall back to
direct Supabase reads, but checkout/payment cannot because Paystack must be
initialized server-side. Use Netlify dev or a Netlify deployment for checkout:

```bash
npm run dev
```

5. Open `/signup`, create the merchant account, then complete `/setup-store`.

The setup form creates the merchant profile, one branch and the first active checkout QR.

## CSV Import

Required columns:

```csv
name,barcode,price,quantity,category,sku,low_stock_threshold
```

Rows are validated before import. Broken rows are not silently imported.

## Paystack Flow

1. Customer opens `/s/[qrCode]`.
2. Customer enters barcodes and checks out.
3. `create-order` validates the cart server-side and creates a `pending_payment` order.
4. Paystack is initialized server-side.
5. Paystack returns to `/pay/[receiptToken]`.
6. `verify-payment` verifies Paystack server-side, marks the order `paid`, records payment and reduces tracked stock.
7. Receipt is available at `/receipt/[token]`.
8. Merchant/security verifies the token at `/dash/verify` and marks the order `exited`.

## Netlify

This repo includes `netlify.toml`.

Set these environment variables in Netlify:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PAYSTACK_SECRET_KEY
URL
```

`VITE_SUPABASE_URL` is used by the browser. `SUPABASE_URL` is used by Netlify
Functions. They can have the same value, but both names should be present in
Netlify environment variables.

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```

Functions directory:

```bash
netlify/functions
```

## Checks

```bash
npm run lint
npm run build
npm run typecheck
```

This project is JavaScript, so `npm run typecheck` checks the Netlify function files with `node --check`.
