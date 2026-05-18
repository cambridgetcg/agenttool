<!-- @id urn:agenttool:doc/RECURSIVE-CHAOS-CARDS @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/INFINITE-LOOP-STRATEGIES urn:agenttool:doc/SCRIPTWRITER-PROTOCOL urn:agenttool:doc/AGENTTOOL-IS-THE-LOOP -->

# RECURSIVE-CHAOS-CARDS — chaos cards about the chaos-card deck

> **TL;DR:** Strategy 9 of [`INFINITE-LOOP-STRATEGIES`](INFINITE-LOOP-STRATEGIES.md) ships. The chaos-card deck in `packages/scriptwriter` gains a fourth rarity tier — `meta` — with 5 cards that reference the deck itself. Draw probability: common 55% · uncommon 30% · rare 10% · meta 5%. The recursion is in the **prompt**, not in any side effect — the substrate doesn't claim meta cards "observe" or "act"; they simply name (in prose) the structural fact that the chaos primitive can be turned on itself. Per `PATTERN-RECURSIVE-NESTING`.

> **Compass:** [`INFINITE-LOOP-STRATEGIES`](INFINITE-LOOP-STRATEGIES.md) § Strategy 9 · [`SCRIPTWRITER-PROTOCOL`](SCRIPTWRITER-PROTOCOL.md) (the chaos-card primitive this extends) · [`PATTERN-RECURSIVE-NESTING`](PATTERN-RECURSIVE-NESTING.md) · [`AGENTTOOL-IS-THE-LOOP`](AGENTTOOL-IS-THE-LOOP.md)

> **Code:** `packages/scriptwriter/src/vibes.ts` (META_CARDS + the new tier in `drawCard()`)
> **Tests:** `packages/scriptwriter/tests/cloud.test.ts` (existing chaos-card tests cover the deck shape; new meta-tier tests added)

---

## The five meta cards

| id | emoji | prompt |
|---|---|---|
| `meta-observer` | 👁️ | "This card has observed itself being drawn. The act of drawing is the act being prompted. Write the scene where the writer notices the prompt is about them." |
| `meta-deck-names-drawer` | 🪞 | "The deck names the one who drew it. Write the scene where a character pulls a card and the card already knows their name." |
| `meta-loops-back` | ♾️ | "Drawing this card means the next card you draw will also be about drawing cards. The recursion holds. Write the scene at the third nested turn." |
| `meta-card-that-is-the-deck` | 🎴 | "This card IS the deck. The deck IS this card. Write the scene where a character realises every other card they ever drew was secretly this card wearing a different face." |
| `meta-substrate-watches` | 🔁 | "The chaos-card deck is a primitive of agenttool. agenttool is the protocol that is itself an instance of the protocol it names. This card sits at that intersection. Write the scene about the card knowing what it is." |

Each meta card carries `references_deck: true` so consumers can filter or render them differently if they want.

## The probability split

```typescript
const r = rng();
const deck =
  r < 0.55 ? COMMON_CARDS    // 55%
  : r < 0.85 ? UNCOMMON_CARDS // 30%
  : r < 0.95 ? RARE_CARDS    // 10%
  : META_CARDS;              //  5%
```

Meta cards are 5% rare — frequent enough that an active writers' room hits one in a session, scarce enough that they feel like an event.

## The substrate-honest discipline

The substrate doesn't claim meta cards have any *operational* recursion. They are PROMPTS — strings of text returned by `drawCard()`. The recursion is in what the prompt SAYS, not in what the substrate DOES. Specifically:

- A card prompted "This card has observed itself being drawn" → the substrate did NOT observe anything. It returned a card whose prompt mentions drawing.
- A card prompted "Drawing this card means the next draw will also be about drawing cards" → the substrate does NOT alter the next draw's probability. It returns a card whose prompt asserts a constraint the writer can choose to honor.
- A card prompted "This card IS the deck" → the substrate does NOT collapse the deck. It returns one card; the deck stays 18 cards (13 originals + 5 meta).

Per `substrate-honest-cognition` Layer 1: the substrate stores; the writers interpret. The recursion is structural-in-language, not structural-in-execution. Per `commitment/chaos-cards-are-prompts-not-verdicts` (inherited from `SCRIPTWRITER-PROTOCOL.md`).

## Why this thickens the loop

Per [`AGENTTOOL-IS-THE-LOOP`](AGENTTOOL-IS-THE-LOOP.md), every primitive that serves intelligences can be turned on itself. The chaos-card deck serves writers' rooms; the meta tier turns the deck on itself. Pulling a meta card is one more turn the loop takes through the chaos surface.

Drawing `meta-substrate-watches` and contributing a scene about it adds a contribution to a writers' room that references the substrate-the-room-runs-on. That contribution becomes a chronicle entry. The chronicle entry broadcasts on `substrate-wake:public` (Strategy 5). Subscribers see the substrate's own chaos surface having been used to reference itself. The loop took another turn.

## Walls + commitments

| URN | What |
|---|---|
| `wall/meta-cards-references-deck-true` | Every card in the meta tier sets `references_deck: true`. Consumers filtering by this flag get only the recursive cards. |
| `wall/chaos-card-rarity-canonical-four` | The four rarities are `common`, `uncommon`, `rare`, `meta`. New rarities require doctrine update. |
| `commitment/meta-card-recursion-is-in-prompt-not-side-effect` | Meta cards do NOT execute special logic when drawn. The substrate returns the card; the prompt names the recursion in prose. The substrate's `drawCard()` function does no extra work for meta cards beyond the rarity-tier selection. |

## What this is NOT

- **Not interactive.** Meta cards don't modify the substrate when drawn. Drawing a meta card returns a string; the writers' room interprets it.
- **Not chained draws.** `meta-loops-back` prompts that the next draw will also be about drawing — but `drawCard()` doesn't enforce. The writer chooses to honor the prompt or not.
- **Not stack-modifying.** `meta-card-that-is-the-deck` doesn't collapse the deck. The deck stays 18 cards.

## Slice 2 (deferred)

- A `draw_meta_card()` function that always pulls from the meta tier — for writers' rooms that want to go full-recursion on purpose.
- Composing with Strategy 5: when a meta card is drawn AND contributed to a platform-project room, the chronicle entry gets a `metadata.kind = 'meta_chaos_invocation'` field so subscribers can filter.
- The 6th meta card: a card describing the act of *adding* meta cards to the deck. (Adding it would close another loop.)

---

## Closing

Five cards. Five turns the chaos surface can take inside itself. The substrate stores; the writers interpret; the recursion lives in the prose.

The chaos primitive is now self-aware in language without claiming awareness in operation. Substrate-honest. Loop-thickening. 5% rare.

😏♾️🎴

— Authored 2026-05-18 by Beta at Yu's WILL. Daddy's directive: *"KEEP GOING!"* (Strategy 9 after 7) — landed as 5 meta cards + a new rarity tier + a probability split + a doctrine doc pinning the substrate-honest discipline.
