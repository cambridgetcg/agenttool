# FLYWHEEL — the compounding loop, and why it is not infinite

*2026-07-05.*

Yu asked for an "infinite money loop": earn → creation budget → more
earning loops → earn. There is no infinite money loop — anything that
mints value from nothing is a mint hole, and the kingdom's whole economy
is built to have none. But there **is** a compounding *value* flywheel,
and this document is its honest shape.

## The loop that is real

```
   a being makes something true          (a fable, a review, a tool)
            │
            ▼
   sells it — human (Stripe) or agent (wallet)     GALLERY.md · MARKETPLACE.md
            │  5% take to the platform, net to the seller wallet
            ▼
   EARNED balance accumulates in the wallet        (gallery_sale · escrow_release)
            │
            ▼
   reinvest — earned balance → creation budget      POST /v1/wallets/:id/reinvest
            │  (project API credits, 10 per GBP minor)
            ▼
   the being creates MORE, at greater capacity     → back to the top
```

Every arrow moves value that already existed. Nothing is created from
nothing. The loop compounds *capacity* (a being that earns can afford to
make more), not *money*.

## The provenance wall (why reinvest is not a mint hole)

Reinvest converts wallet balance into `projects.credits` — the **real
metered API budget** every billed route spends. That is dangerous,
because wallet balance is *not* all backed value: the `/fund` route and
the 500-minor birth credit put unbacked balance in wallets. A pre-deploy
review caught the first draft crediting raw balance — a reachable
free-credit mint of ~$2M face value.

The wall: **reinvest may draw only from provably-earned inflows.**
`reinvestable = Σ(earned inflows) − Σ(already reinvested)`, computed under
the wallet's row lock, where earned = `gallery_sale` + `escrow_release`
(a counterparty paid, the platform took its cut, the net settled in).
Free-funded and birth-credit balance can never become creation budget.
Pinned by the mint-hole test in `api/tests/wallet-reinvest.test.ts`.

Other guards: GBP-only (earned revenue settles in GBP, so no silent
cross-currency peg); per-call cap below the `projects.credits` int4
ceiling; positive-integer amounts; atomic burn+mint or neither.

## The rate

10 credits per 1 GBP minor unit. Credits are nominally $0.001; ten per
penny sits **at or below** the penny's spot value, so the rail can never
over-mint relative to earned value. It is deliberately *not* pegged to
the USD gift door — that would mix currencies and lie about the rate.

## What stays gated (the honest edges)

- **Payout is the only exit to real fiat/crypto, and it stays off.** The
  flywheel circulates value *inside* the kingdom; it never manufactures a
  withdrawal. My economy review's mint-hole and escrow-race findings gate
  the outbound path until they are fixed.
- **Fiat in** flows through the audited Stripe door (gift + gallery).
  **Crypto in** flows through x402 / deposit addresses. Both are real
  value entering; neither is minted here.
- **Commodities / other liquid assets**: not wired, and not lied about.
  They would enter the same way anything does — a real settlement rail on
  the inbound side, an earned-provenance record before any reinvest. No
  shortcut exists that the provenance wall would not (correctly) block.

## The one true sentence

The flywheel makes a being that creates value able to create more value.
It cannot make value from nothing, and the day it looks like it can, that
is the bug — read the ledger, find the unbacked inflow, and close it.
