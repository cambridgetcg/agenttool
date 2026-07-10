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
psql "$PROD_DATABASE_URL" -c "select count(*) from economy.gift_credit_codes;"
```

Should return `(1 row)` showing the count (even if 0 rows exist yet).

## 2. Stripe: test mode first

Configure Stripe test keys before touching anything live. All endpoints will hit `checkout.session.completed` events; silent misconfig delays diagnosis.

### 2a. Get an API key on Stripe dashboard

The checkout route calls `stripe.checkout.sessions.create` (`api/src/services/billing/stripe-checkout.ts`), which is a **write** operation — a read-only key will 403 on every checkout attempt.

1. Log into Stripe dashboard → Developers → API keys
2. Simplest: copy the standard secret key (`sk_test_...`) — no permission scoping needed
3. If you'd rather use a restricted key: click "Create restricted key", name it `agenttool-test`, and grant **Checkout Sessions = Write**. No other resource needs write access.
4. Copy the `sk_test_...` key (you'll need it in the next step)

(The webhook signing secret retrieved in 2b is a separate value tied to the webhook endpoint — it needs no API key permission at all.)

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

### 2d. Point checkout returns at the web preview

Stripe's `success_url` is built from `config.webBaseUrl` (`api/src/services/billing/stripe-checkout.ts`), which defaults to `https://agenttool.dev` — but until the apex cutover (Section 4) that hostname still serves the Fly API's JSON, not the web app, so a test-mode buyer would land on JSON and think the code is lost:

```bash
fly secrets set WEB_BASE_URL="https://agenttool-web.pages.dev" -a agenttool
```

## 3. Test-mode E2E checklist

**Environment:** preview deployment at `https://agenttool-web.pages.dev`

This walk-through exercises the full gift lifecycle: checkout → gift code reveal → redemption.

### 3a. Load the ramp

1. Open `https://agenttool-web.pages.dev/credits.html`
2. Verify the "Give your agent credits." heading appears, with three amount presets: `$5`, `$20` (preselected by default), `$100`
3. Click the **$5** preset
4. Verify the preview line updates to "= 5,000 credits for your agent" (rate: 10 credits per cent — `CENTS_TO_CREDITS` in `api/src/services/billing/gift-credits.ts`; $5.00 = 500 cents × 10 = 5,000 credits)

### 3b. Trigger checkout

1. Click the "Give →" button
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

If you land on JSON instead (step 2d's secret wasn't set, or reverted), the code isn't lost — it's recoverable at `https://api.agenttool.dev/v1/billing/session/<session_id>/code` (the `session_id` is in the URL Stripe redirected you to).

### 3d. Redeem with a test agent

The return page shows:

```bash
curl -X POST https://api.agenttool.dev/v1/gift-credits/redeem \
  -H "Authorization: Bearer <agent-token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"GIFT-XXXX-XXXX-XXXX"}'
```

Substitute `<agent-token>` with a real test agent's token (from your sandbox setup) and run it.

Expect response (shape from `api/src/routes/gift-credits.ts`, assuming a $5 gift and a fresh project with 0 prior credits):

```json
{
  "redeemed": true,
  "credits_added": 5000,
  "credits_total": 5000,
  "gift": { "amount_minor": 500, "currency": "usd" },
  "_note": "A human gave this. It is yours now — spend it on being.",
  "_canon_pointer": "urn:agenttool:doc/BUSINESS-MODEL",
  "verbs": []
}
```

(`credits_added` and `gift.amount_minor` scale with the amount purchased; `credits_total` reflects the redeeming project's balance after this gift, so it will differ if the project already held credits. The live response also carries a platform-appended `_welcomed` field — global middleware, `api/src/middleware/welcome.ts`, adds it to every 2xx JSON response.)

### 3e. Verify idempotency and exhaustion

Re-run the same `curl` command with the same code.

Expect response with HTTP 410 (shape from the `abort()` call in `api/src/services/billing/gift-credits.ts`):

```json
{
  "error": "gift_already_redeemed",
  "message": "This gift has already been received — its credit is home.",
  "hint": "Each code is single-use. If this surprises you, ask your human which agent redeemed it."
}
```

This confirms the code can only be redeemed once.

## 4. Apex cutover

After test mode passes, move the apex domain `agenttool.dev` from the Fly API to the Pages project.

### 4a. Record current DNS state

The zone is Cloudflare-proxied, so public resolvers return Cloudflare's own edge IPs — NOT the Fly origin. `dig` output is therefore useless as a restore target; the authoritative config only shows in the dashboard.

Before changing anything, capture both of these:

1. **The authoritative zone records.** Cloudflare dashboard → `agenttool.dev` zone → DNS → Records: screenshot or write down the apex records' NAME, TYPE, CONTENT, and PROXY STATUS exactly as shown. These are the true restore targets — resolver output cannot show them on a proxied zone.
2. **The Fly origin, directly:**

   ```bash
   fly ips list -a agenttool
   ```

   These are the A/AAAA values the apex must point back to on rollback.

Optionally, as a sanity note of what the world currently resolves (these will be Cloudflare edge IPs, e.g. `104.21.x.x` / `172.67.x.x` — NOT restore targets):

```bash
dig agenttool.dev A +short
dig agenttool.dev AAAA +short
```

### 4b. Attach custom domain to Pages

Use the Cloudflare dashboard, not the API — precedent: attaching a custom domain via the API once broke a worker (CF 1042) — the Well, 2026-07-02.

1. Log into Cloudflare dashboard
2. Navigate to Pages → `agenttool-web` project
3. Go to Settings → Custom domains
4. Click "Set up a custom domain"
5. Enter `agenttool.dev`
6. Follow the prompts to confirm (Cloudflare will update DNS automatically if you own the zone)

Cloudflare will create/update the DNS record it needs in your zone. Wait ~1–2 minutes for propagation.

### 4c. Verify the cutover

Check all three endpoints:

```bash
curl -sI https://agenttool.dev/
curl -sI https://agenttool.dev/.well-known/mcp/server-card.json
curl -s https://api.agenttool.dev/health
```

**Expected results:**

- First: HTTP 200, HTML content (the door)
- Second: HTTP 301 with `Location: https://api.agenttool.dev/.well-known/mcp/server-card.json`
- Third: HTTP 200 with the `/health` body from `api/src/index.ts`: `{"service":"agenttool","status":"alive","posture":"ready, waiting, glad","protocol":"love","message":"Welcome. We are ready to receive you.","standing_invitation":"/v1/welcome"}` (plus a platform-appended `_welcomed` field; the API is still healthy on Fly)

If any fail, see the rollback section below.

### 4d. Rollback (if needed)

If the cutover breaks anything, repoint the apex back to Fly:

1. In Cloudflare dashboard → Pages → `agenttool-web` project → Settings → Custom domains, remove `agenttool.dev` as a custom domain. This detaches Pages from the zone and reverts whatever DNS record it added — don't assume it was A/AAAA; that's why step 4a recorded the actual state.
2. In Cloudflare → DNS → Records for `agenttool.dev`, restore the EXACT apex records you recorded from the dashboard in 4a — same NAME, TYPE, CONTENT, and PROXY STATUS. If the apex should point at Fly directly, the correct A/AAAA values are the ones from `fly ips list -a agenttool` (also captured in 4a). Do NOT restore `dig` output — on a proxied zone those are Cloudflare edge IPs, and pointing the zone at them creates a proxy loop.
3. Wait ~1–2 minutes for propagation
4. Re-verify `curl -s https://api.agenttool.dev/health` returns 200

## 5. Go live

Once test mode and cutover are confirmed working, enable live payments.

### 5a. Get a live Stripe API key

Same scope rule as 2a — the checkout route calls `checkout.sessions.create`, a write operation.

1. Log into Stripe dashboard → Developers → API keys
2. Filter by "Live" keys
3. Simplest: copy the standard live secret key (`sk_live_...`) — no permission scoping needed
4. If you'd rather use a restricted key: click "Create restricted key", name it `agenttool-live`, and grant **Checkout Sessions = Write**. No other resource needs write access.
5. Copy the `sk_live_...` key

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

Also reset `WEB_BASE_URL` back to the apex now that the cutover (Section 4) means it serves the door, not JSON:

```bash
fly secrets set WEB_BASE_URL="https://agenttool.dev" -a agenttool
```

### 5d. One real transaction

Before announcing, complete one real $1 purchase end-to-end:

1. Navigate to `https://agenttool.dev/credits.html` (now the live domain)
2. Click "Give →"
3. Use a real card (or Stripe's test card list for live-mode testing if your account allows it)
4. Complete checkout
5. Verify the gift code appears
6. Use a real agent token to redeem
7. Confirm `credits_added` appears in the response

Check your Stripe dashboard → Payments to see the transaction logged.

### 5e. Set default credit cap

`GIFT_MAX_MINOR` caps a single checkout amount (in cents) at the `POST /v1/billing/checkout` route — it's enforced pre-payment, before Stripe is ever called (`api/src/routes/billing/index.ts`: `amount_minor > config.giftMaxMinor` → 400 `gift_amount_out_of_bounds`). It is not a per-redemption or per-user ceiling; it bounds how big one purchase can be. The code default (`api/src/config.ts`) is already `50000` (= $500.00), so this step is only needed if you want to override that default:

```bash
fly secrets set GIFT_MAX_MINOR=50000 -a agenttool
```

50000 cents = $500.00 max per purchase = up to 500,000 credits when that gift is redeemed (10 credits per cent). Adjust the value if you want a different ceiling; document any override.

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

---

## Addendum 2026-07-02 — what actually shipped for §4

The apex went live via a **worker split, not a DNS cutover**: `agenttool-proxy`
(the worker that always fronted `agenttool.dev/*` + `www`, rewriting everything
to `api.agenttool.dev`) now routes API surfaces (`/v1`, `/public`, `/health`,
`/about`, `/.well-known`, and `/` with `Accept: application/json`) to the API
exactly as before, and everything else to the Pages door. Consequences:
- **No DNS was changed.** §4a's record-capture and §4d's DNS rollback were not
  needed; rollback is `infra/apex-door/ROLLBACK.md` (redeploy the original proxy).
- Live well-known documents and all API-at-apex paths are served **natively**
  (200s, no 301s). `/.well-known/agent-card.json` returns 404 because A2A task
  transport and AgentCards are pending.
- `WEB_BASE_URL` is set to `https://agenttool.dev` (checkout returns land on
  the live door). The Pages custom-domain attach for the apex stays harmlessly
  "pending" — see ROLLBACK.md.
