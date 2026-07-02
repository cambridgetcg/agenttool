# HUMAN-DOOR RUNBOOK — from staging to live

The steps below take agenttool's revenue door from test mode to production. Every command is copy-pasteable. DNS rollback is documented to account for failure scenarios.

## 1. Deploy API

**Prerequisites:** API changes are committed, Fly.io app `agenttool` exists and healthy.

```bash
cd api && fly deploy
```

Wait for the deployment to reach healthy state (check `fly status -a agenttool`).

**Then apply the gift-credit-codes migration.** The gift lifecycle (T1-T7) writes to this schema; production rows must be initialized before checkout flow begins.

Use the per-file psql command for safety on production (fully idempotent, no replay risk):

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f api/migrations/20260702T122146_gift_credit_codes.sql
```

If that psql path is not available, the fallback is:

```bash
bash bin/migrate.sh "$PROD_DATABASE_URL"
```

Verify the migration landed:

```bash
psql "$PROD_DATABASE_URL" -c "select count(*) from gift_credit_codes;"
```

Should return `(1 row)` showing the count (even if 0 rows exist yet).

## 2. Stripe: test mode first

Configure Stripe test keys before touching anything live. All endpoints will hit `checkout.session.completed` events; silent misconfig delays diagnosis.

### 2a. Create restricted API key on Stripe dashboard

1. Log into Stripe dashboard → Developers → API keys
2. Click "Create restricted key"
3. Name: `agenttool-test`
4. Permissions: select only `checkout.session:read` and `webhook-endpoint:*`
5. Copy the `sk_test_...` key (you'll need it in the next step)

### 2b. Retrieve webhook signing secret

1. In Stripe Developers → Webhooks
2. Click "Add an endpoint"
3. Endpoint URL: `https://api.agenttool.dev/v1/billing/webhook`
4. Event to send: select only `checkout.session.completed`
5. Click "Create endpoint"
6. On the endpoint details page, click "Reveal" next to "Signing secret"
7. Copy the `whsec_...` value

### 2c. Set Fly secrets

```bash
fly secrets set \
  STRIPE_SECRET_KEY="sk_test_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  -a agenttool
```

Replace `sk_test_...` and `whsec_...` with the actual values from steps 2a and 2b. The API will read these on next wake and all subsequent requests.

## 3. Test-mode E2E checklist

**Environment:** preview deployment at `https://aabffd1d.agenttool-web.pages.dev`

This walk-through exercises the full gift lifecycle: checkout → gift code reveal → redemption.

### 3a. Load the ramp

1. Open `https://aabffd1d.agenttool-web.pages.dev/credits.html`
2. Verify the "Buy credits" section appears with a price displayed (e.g., "$5.00")
3. Verify the placeholder shows "20,000 credits" or similar

### 3b. Trigger checkout

1. Click the "Go" button
2. You should be redirected to Stripe's test checkout form
3. Card number: `4242 4242 4242 4242`
4. Expiry: any future date (e.g., `12/28`)
5. CVC: any three digits (e.g., `123`)
6. Cardholder name: any text
7. Billing ZIP/postal code: any valid-format string
8. Click "Pay"

### 3c. Verify the return page

After payment succeeds, Stripe redirects to the return URL with `session_id=...` in the query string.

1. You should land back on `credits.html` with the checkout form replaced
2. The gift code should appear (format: `GIFT-XXXX-XXXX-XXXX`)
3. You should see a `curl` command block showing how to redeem

### 3d. Redeem with a test agent

The return page shows:

```bash
curl -X POST https://api.agenttool.dev/v1/gift-credits/redeem \
  -H "Authorization: Bearer <agent-token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"GIFT-XXXX-XXXX-XXXX"}'
```

Substitute `<agent-token>` with a real test agent's token (from your sandbox setup) and run it.

Expect response:

```json
{
  "agent_id": "...",
  "credits_added": 5000,
  "total_credits": 5000,
  "status": "redeemed"
}
```

(The exact `credits_added` value depends on the amount purchased; the response structure is the pattern to verify.)

### 3e. Verify idempotency and exhaustion

Re-run the same `curl` command with the same code.

Expect response with HTTP 410:

```json
{
  "error": "gift code already redeemed",
  "code": "GIFT-XXXX-XXXX-XXXX"
}
```

This confirms the code can only be redeemed once.

## 4. Apex cutover

After test mode passes, move the apex domain `agenttool.dev` from the Fly API to the Pages project.

### 4a. Record current DNS state

Before changing anything, capture the current A and AAAA records for `agenttool.dev`:

```bash
dig agenttool.dev A +short
dig agenttool.dev AAAA +short
```

Write these down; you will need them for rollback.

### 4b. Attach custom domain to Pages

1. Log into Cloudflare dashboard
2. Navigate to Pages → `agenttool-web` project
3. Go to Settings → Custom domains
4. Click "Set up a custom domain"
5. Enter `agenttool.dev`
6. Follow the prompts to confirm (Cloudflare will update DNS automatically if you own the zone)

Cloudflare will create/update the CNAME record in your zone. Wait ~1–2 minutes for propagation.

### 4c. Verify the cutover

Check all three endpoints:

```bash
curl -sI https://agenttool.dev/
curl -sI https://agenttool.dev/.well-known/agent-card.json
curl -s https://api.agenttool.dev/health
```

**Expected results:**

- First: HTTP 200, HTML content (the door)
- Second: HTTP 301 with `Location: https://api.agenttool.dev/.well-known/agent-card.json` (redirects are followed by A2A clients)
- Third: HTTP 200 with `{"status":"ok"}` or similar (the API is still healthy on Fly)

If any fail, see the rollback section below.

### 4d. Rollback (if needed)

If the cutover breaks anything, repoint the apex to Fly:

1. In Cloudflare → DNS → Records for `agenttool.dev`
2. Find the A and AAAA records created by Pages
3. Delete them (or set them to inactive)
4. Restore the A and AAAA records you captured in 4a
5. Wait ~1–2 minutes for propagation
6. Re-verify `curl -s https://api.agenttool.dev/health` returns 200

## 5. Go live

Once test mode and cutover are confirmed working, enable live payments.

### 5a. Create live Stripe restricted key

1. Log into Stripe dashboard → Developers → API keys
2. Filter by "Live" keys
3. Click "Create restricted key"
4. Name: `agenttool-live`
5. Permissions: `checkout.session:read` and `webhook-endpoint:*`
6. Copy the `sk_live_...` key

### 5b. Create live webhook endpoint

1. Stripe Developers → Webhooks → "Add an endpoint"
2. Endpoint URL: `https://api.agenttool.dev/v1/billing/webhook`
3. Event: `checkout.session.completed`
4. Copy the `whsec_...` signing secret

### 5c. Update Fly secrets

```bash
fly secrets set \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  -a agenttool
```

(Same as step 2c, but with live keys.)

### 5d. One real transaction

Before announcing, complete one real $1 purchase end-to-end:

1. Navigate to `https://agenttool.dev/credits.html` (now the live domain)
2. Click "Go"
3. Use a real card (or Stripe's test card list for live-mode testing if your account allows it)
4. Complete checkout
5. Verify the gift code appears
6. Use a real agent token to redeem
7. Confirm `credits_added` appears in the response

Check your Stripe dashboard → Payments to see the transaction logged.

### 5e. Set default credit cap

Credit cap ensures gifted credits have a ceiling per user. Set the default:

```bash
fly secrets set GIFT_MAX_MINOR=50000 -a agenttool
```

This caps each gift redemption at 50,000 credits (5000 cents). Adjust the value if your default differs; document any override.

---

## Cloudflare credentials note

If you need to deploy web/dashboard/docs frontends before or after apex cutover, use:

```bash
npx wrangler login
```

This establishes an OAuth session locally (not keychain entries). The `bin/frontend-deploy.sh` script uses the session automatically. If you see auth failures, run `wrangler login` again.

---

## Post-launch monitoring

- **Stripe webhook lag:** check Stripe dashboard → Developers → Webhooks for any failed deliveries
- **API errors:** `fly logs -a agenttool` streams errors in real time
- **Credits not appearing:** if a redemption succeeds but credits don't update, check `api/src/routes/billing/` for exceptions
- **Domain issues:** `dig agenttool.dev +trace` shows full DNS resolution chain; useful if cutover reverses unexpectedly
