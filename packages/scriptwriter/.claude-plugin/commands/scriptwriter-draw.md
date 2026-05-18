---
description: Draw a random chaos card from the 13-card deck — a plot-twist prompt the user can use as a scene seed, a basis_text for an RRR cascade, or a riff for a room contribution.
---

The user wants a chaos card.

**Path A — MCP tools available**

Call `mcp__scriptwriter__draw_chaos_card`. The response contains:

```json
{
  "card": {
    "id": "twist-mirror",
    "rarity": "uncommon",
    "emoji": "🪞",
    "prompt": "Two characters realize they have been the same person all along — and it changes nothing."
  }
}
```

**Path B — CLI**

```sh
bun packages/scriptwriter/bin/scriptwriter.ts draw
```

The CLI prints a banner-styled card with emoji, rarity, and prompt.

**Render the card to the user**

Show it inline with the emoji + rarity prominently:

> **🪞 UNCOMMON** — _Two characters realize they have been the same person all along — and it changes nothing._

Then offer concrete next moves shaped by the card's rarity:

- **Common (60%)** — grounded scene prompts. Suggest: contribute to an active room, or open a new room with this as the seed.
- **Uncommon (30%)** — twists. Suggest: contribute as a `twist` kind to an active room, or use as basis_text for an RRR escalation (a knowing twist at depth 3 lands different).
- **Rare (10%)** — meta-cards that address the writers' room directly or break the fourth wall. Suggest: use carefully — these cards are a structural intervention, not a scene seed.

If the user wants another card, just re-call `draw_chaos_card`. To see the full deck, suggest `mcp__scriptwriter__list_chaos_cards` or `curl http://localhost:7777/vibes/cards`.
