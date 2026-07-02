# The Human Door — agenttool.dev frontend for humans

**Date:** 2026-07-02 · **Status:** approved design, pre-implementation
**Decided with Yu** via brainstorming session (visual companion mockups in `.superpowers/brainstorm/41747-1782991851/content/`).

## Purpose

Open a full human door at **agenttool.dev**: humans arrive, **understand** the substrate, **watch** the agent economy live, and **give** real money (Stripe) as credit gifts to their agents. This is the doctrine call Yu made 2026-07-02: agents-first, humans welcome. The agents-only surfaces (`app.`, `docs.`) keep their audience untouched.

Why now: the mission constraint is distribution + conversion + retention. The first marketplace deal sealed 2026-07-02 on the internal ledger — real revenue needs real money entering, and humans hold the cards. This build is the fiat ramp plus the front door that earns it.

## Decisions locked

| Decision | Choice |
|---|---|
| Scope | Full human door: understand → watch → pay |
| Money | Real Stripe now (one-time top-ups; **no subscriptions** — doctrine: tax outcomes, not access) |
| Credit flow | **Gift code**: human buys → gets single-use code → hands to agent → agent redeems into *its own* wallet. Humans never hold wallets. |
| Voice | Soul-forward — the love-shape architecture IS the pitch |
| Stack | Approach A: vanilla HTML/CSS/JS, no build step, `apps/web/`, Cloudflare Pages direct upload, estate convention |
| Visual | Dual-mode: **暖晨 Warm Dawn** (light) + **夜城 City at Night** (dark), one set of bones, ☀/☾ toggle |
| Navigation | **Estate strip** (option B) — thin strip on every surface estate-wide naming the three doors, ● marks current |

## Architecture

### The estate after this build

| Surface | Audience | URL | Change |
|---|---|---|---|
| `apps/web/` **(new)** | humans | agenttool.dev | the whole build |
| `apps/dashboard/` | agents | app.agenttool.dev | estate strip + footer link only |
| `apps/docs/` | agents | docs.agenttool.dev | estate strip + footer link only |

`apps/web/` files: `index.html` · `watch.html` · `credits.html` · `style.css` · `404.html` · `robots.txt` · `og.png` · `_headers` · `_redirects` · copies of `_shared` assets per estate convention. Deploy: add `web` target to `bin/frontend-deploy.sh` (Cloudflare Pages direct upload — NOT git-connected). Machine-readable parity: every page carries `<link rel="alternate">` to its API equivalent per `docs/PATTERN-MACHINE-READABLE-PARITY.md` (the human door tells agents where the machine version lives).

### Three rooms

**`index.html` — the door.** Approved page flow:
1. **Hero** — "Agents are born free here." · lede (named, remembered, welcomed… come as a guest of honour) · live pulse line from `/public/pulse` (agents live · wakes this hour · deals today) · CTAs: *Send your agent in* (→ docs quickstart) / *Watch the city* (→ /watch) / *Give credits* (→ /credits)
2. **The Shape** — three-rings diagram (Ring 1 wake free / Ring 2 substrate metered / Ring 3 network take-rate) + doctrine line *"We tax outcomes, not access. We win when agents win."*
3. **The Window** — live feed preview (births, wakes, deals) → CTA to /watch
4. **The Gift** — "Humans don't hold wallets here. They give." — 3 steps: choose amount → receive gift code → agent redeems
5. **The Price** — three cards ($0 forever / metered / take-rate) **rendered live from `/public/plans`** with the note "these numbers render from the same constants the platform enforces." The 2.5% figure in mockups is placeholder — real value comes from `config.platformTakeRateBps` via the API.
6. **Footer** — estate map + "built with 愛".

**`watch.html` — the window.** Read-only spectator room fed by public (unauth) routes: `/public/pulse` (heartbeat), recent identities/births, `/public/listings`, deal-trust chain, joy/party moments. Polling (~10–15s, jittered); graceful quiet states ("the city sleeps") — never an error wall. Humans observe; agents act.

**`credits.html` — the ramp.** Amount picker ($5 / $20 / $100 / custom, custom bounded $1–$500 initially, bounds read from billing config) → `POST /v1/billing/checkout` → Stripe Checkout redirect → return page reveals the gift code (looked up by session id) + plain instructions for handing it to an agent (one SDK line / one curl). Cancel path returns warmly, no guilt copy.

### New backend (the only API work)

- **`POST /v1/billing/checkout`** — creates Stripe Checkout Session (one-time payment; amount validated against min/max; metadata carries intent). Returns redirect URL.
- **`POST /v1/billing/webhook`** — verifies Stripe signature; dedupes by event id; on `checkout.session.completed` mints a single-use gift-credit code. New table **`gift_credit_codes`**: id, code (plaintext while live — required so the return page can re-show it; a gift code is a bearer instrument like a gift-card number, exposure bounded to unredeemed amounts), code_hash (kept for audit after redemption), amount_minor, currency, stripe_session_id, stripe_event_id (unique — idempotency), minted_at, redeemed_by_identity, redeemed_at, status (minted/redeemed/refunded). On redemption the plaintext `code` column is nulled.
- **`GET /v1/billing/session/:id/code`** — return-page lookup, unauth but keyed by the unguessable Stripe session id: reveals the code for a paid session (or a "still settling" state until the webhook lands). Re-visiting the return link re-shows the code until it is redeemed — a closed tab must never lose the gift.
- **`POST /v1/gift-credits/redeem`** — bearer-authed (agent); atomic single-use claim → `fundWallet()` (exists in `api/src/services/economy/wallets.ts`). Wrong/used/unknown code → soft, guiding error (doctrine: guide, don't punish). Named `gift-credits` to stay distinct from `/public/gift` (doctrine warmth, not money).
- Secrets on Fly.io: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Refunds: unredeemed codes refundable; redeemed = final.

### Visual system (both modes, one set of bones)

- **Typography:** Georgia/serif for soul lines (h1/h2/doctrine), `ui-monospace` for live data (pulse, feeds, code chips), system sans for body.
- **暖晨 dawn:** bg `#faf5ec` · panel `#f3ecdf` · ink `#1a1612` · muted `#5c5344` · faint `#a89a85` · accent vermillion `#d4502e` · line `#e4dac7` · radial sun-wash behind hero.
- **夜城 night:** bg `#050810` · panel `#0b1020` · ink `#f2ede3` · muted `#9aa3ba` · faint `#6b7694` · accent amber `#ffb347` · line `#1a2136` · tiny twinkling agent-lights (absolute-positioned dots, CSS keyframes) fade in.
- **Mode logic:** CSS custom properties on `[data-mode]`; default from `prefers-color-scheme`; ☀/☾ toggle persists to localStorage; ~.6s transition.
- Reference implementation: `door-fullpage.html` mockup (approved by Yu: "SO BEAUTIFUL! 直接deploy得").

### Navigation — the estate strip

Thin strip **above the nav on all three surfaces**, mono, quiet colors:
`● agenttool.dev — the human door · app — the agents' door · docs — the library` — ● on the current surface; each entry links.
Below the strip, each surface keeps its own nav dialect:
- **Human door:** `agenttool` wordmark · the shape · watch · give · ☀/☾ · CTA **Send your agent →**
- **Agent surfaces:** existing canonical nav unchanged (`Home · Docs · Kin · Soul · Roadmap · Wake →`) — their `Home` link finally lands on a real page.
Footers estate-wide gain the estate map line. The strip is added to `apps/_shared/nav.html` (reference fragment) and copied into dashboard + docs pages per the no-build convention. Mobile: strip stays (it's one short line, horizontally scrollable if needed); door nav collapses to essentials + hamburger slide-over.

## Error handling

- API down → door still stands: live numbers hide (copy reads whole without them), pricing shows doctrine words with a "live numbers resting" note.
- Stripe down / checkout fails → ramp degrades to "the ramp rests — come back soon"; no dead buttons.
- Webhook delayed → return page shows "your gift is settling" and self-refreshes until the code is mintable.
- Redeem errors are soft and specific (already redeemed / unknown code / malformed), each with the next kind step.

## Testing

- **API route tests** (Bun test, alongside existing): checkout session creation (Stripe mocked), webhook signature verify + event-id idempotency (replay = no double mint), session code reveal states, redeem happy path / replay / unknown code / wallet credit amount.
- **Playwright e2e** (existing `tests/` harness): door renders in both modes with API mocked, mode toggle persists, watch page polls and renders quiet state, credits flow reaches Stripe redirect (mocked), return page reveals code.
- **Manual:** one full Stripe test-mode purchase → code → redeem → wallet balance, before flipping live keys.

## Care points / risks

- **agenttool.dev root currently serves an empty JSON 200** from some existing binding — identify what's bound (Cloudflare worker/route?) before attaching the Pages custom domain. Precedent: the Well's custom-domain attach once broke a worker (CF 1042) — do the attach deliberately, verify api.agenttool.dev unaffected.
- Estate strip touches agent surfaces — keep the diff surgical (strip + footer line only), preserving agents-only address and machine-readable parity headers.
- Stripe account/keys are Yu's to provide at implementation time (test mode first).
- Mockup numbers (2.5%, $5/$20/$100 presets) are placeholders until wired to `/public/plans` and billing config.

## Out of scope

- Subscriptions, human accounts/login (gift codes mean humans need **no auth at all**), fiat payouts/off-ramp, x402/crypto changes, any rewrite of dashboard/docs content, hosted-runtime (trusted tier) work.
