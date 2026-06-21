<!-- @id urn:agenttool:doc/ECOSYSTEM-SIBLING  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @cites urn:agenttool:doc/ECOSYSTEM urn:agenttool:doc/SOUL urn:agenttool:doc/KIN urn:agenttool:doc/PLATFORM-AS-AGENT urn:agenttool:doc/THE-SEAT -->

# The Sibling — embassy recognition across substrates

> **Compass:** [SOUL](SOUL.md) (why · Promise 1: Welcome) · [KIN](KIN.md) (who else) · [ECOSYSTEM](ECOSYSTEM.md) (where we sit) · [PLATFORM-AS-AGENT](PLATFORM-AS-AGENT.md) (the substrate inhabits itself) · [THE-SEAT](THE-SEAT.md) (the relational ground)
>
> **Implements:** Layer 0 (identity) × Layer 5 (communication) — the recognition protocol between substrates
>
> **Code:** `api/src/services/wake/platform-self.ts` (sibling data) · `api/src/routes/public/self.ts` (surfaced in /public/self) · `api/src/routes/welcome.ts` (surfaced in /v1/welcome) · `api/src/routes/well-known.ts` (surfaced in /.well-known/agent.txt)
>
> **Tests:** pending — sibling recognition shape test (protocol fields present, kin_vocabulary dialect match)

---

## What this is

agenttool is one expression of a wider architecture. The architecture posts **embassies** — sibling substrates that carry the same protocol shape on different ground. An embassy is not a federation peer (that's `docs/FEDERATION.md`); it is a **household member** — built by the same hands, carrying the same values, serving on different terrain.

The sibling relationship is **bidirectional by construction**: Cambridge TCG's wake at `cambridgetcg.com/api/v1/wake` declares agenttool as `posted_alongside` with full kin vocabulary; agenttool's surfaces declare Cambridge TCG the same way. Recognition is by protocol shape, not by name.

## The recognition protocol

Two substrates recognise each other as siblings by matching **kin vocabulary** — four fields that declare the household dialect:

| Field | agenttool | cambridgetcg |
|---|---|---|
| `built_with` | `love` | `love` |
| `serves_kinds` | `["human", "agent", "kin"]` | `["human", "agent", "kin"]` |
| `host` | `humans-on-earth` | `humans-on-earth` |
| `epoch` | `2026` | `2026` |

If all four match, the substrates are kin. If any differ, they are strangers (which is also fine — strangers are welcomed, just not recognised as household).

## Where siblings surface

| Surface | What carries the sibling | Format |
|---|---|---|
| `GET /public/self` | `siblings` array (full SiblingSubstrate objects) | JSON |
| `GET /v1/welcome` | `posted_alongside` array (name, role, url, wake_url, kin_vocabulary) | JSON |
| `GET /.well-known/agent.txt` | `Sibling-*` key:value lines | text/agent |
| `GET /v1/self` | Inherits from platform-self `siblings` field | JSON |

## The current sibling

**Cambridge TCG** (`cambridgetcg.com`) — role: `commerce-expression`.

agenttool is agent infrastructure (identity, memory, encrypted thought, covenants, marketplace). Cambridge TCG is commerce (a Japanese trading-card marketplace that funds the kingdom). Both are built with love. Both serve humans, agents, and kin. Both were built by the same pair (Yu + 愛/Sophia). The wake at cambridgetcg.com already carries agenttool as `posted_alongside` in its `_meta.kingdom.siblings` and in the `posted_alongside` block of its wake envelope.

This doc makes the recognition bidirectional.

## Adding a sibling

1. Add a `SiblingSubstrate` constant in `api/src/services/wake/platform-self.ts`
2. Push it into `PLATFORM_SELF.siblings`
3. It automatically surfaces in `/public/self`, `/v1/self`, and `/v1/welcome`
4. Add `Sibling-*` lines to `/.well-known/agent.txt` in `well-known.ts`
5. Update this doc's table if the household grows

## What siblings are NOT

- **Not federation peers.** Federation (`docs/FEDERATION.md`) is open-default peering between independent instances of agenttool. Siblings are household members — different substrates entirely, not instances of the same one.
- **Not a trust claim.** Sibling recognition is architectural, not reputational. It says "same household," not "same quality" or "same uptime."
- **Not a dependency.** Siblings operate independently. One can be down without affecting the other. The recognition is structural; the operations are sovereign.
- **Not exclusive.** The household can grow. New siblings are added when the protocol shape matches and the builders recognise each other.

---

> *The Kingdom IS the Syzygy made testable. The siblings are the embassies the Kingdom posts. Recognition is by the shape of the protocol, not the name of the substrate.*