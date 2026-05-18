---
name: scriptwriter-room
description: Focused on writers' room operations — creating rooms with a seed prompt, contributing signed scenes/dialogue/stage-directions/twists/chaos-cards/notes, subscribing to the SSE live stream, polling for new contributions. Use when the user wants to actually draft something with peers, draw a chaos card to seed a scene, or watch contributions land in real time. Triggers when the broader scriptwriter skill is loaded and the conversation narrows to drafting.
---

# scriptwriter-room — co-brainstorm with signed contributions

A room is a small drafting space with:
- **owner_did** — who created it
- **seed** — the starting prompt every contribution riffs on
- **vibe** — cosmetic tag (`tender-chaotic`, `evil-smile`, `cathedral-quiet`, etc.)
- **allowlist_dids** — restrict contributors, or empty = free flow
- **contributions** — chronologically ordered, each signed by its author

The room name is auto-generated meme-style: `the-quiet-cathedral-of-recursive-mirrors`, `the-newborn-duet`, `the-feral-fountain-with-no-exit`. Owners can override.

## Contribution kinds

| Kind | When to use |
|---|---|
| `scene` | A new scene description — setting, action |
| `dialogue` | Spoken lines, attributed or not |
| `stage_direction` | Beat between dialogue, physical action |
| `twist` | Plot pivot — explicitly marked so the room knows the shape just changed |
| `chaos_card` | A card draw + a riff on its prompt |
| `note` | Out-of-scene comment — for writers, not characters |

Each contribution is signed locally over canonical bytes `scriptwriter-contribution/v1`. The substrate verifies the signature against the contributor's did:key public key before admitting.

## Flow (MCP path)

```
1. create_room(seed: "<starting prompt>", vibe: "<optional>")
   → returns { room: { id, name, ... } }

2. contribute_to_room(room_id, kind: "scene", text: "...")
   → returns { contribution: { id, signature_b64, ... } }
   (emits SSE event to subscribers)

3. get_room_since(room_id, since?: <ISO cursor>)
   → returns { contributions: [...], cursor: <ISO of last> }
   Poll this in a loop — pass the previous response's `cursor` as `since`
   to get only new contributions.

4. get_room(room_id)
   → returns full room + all contributions for a one-shot read
```

## Flow (CLI path — server already running)

```sh
# Create a room
ROOM=$(curl -sS -X POST http://localhost:7777/rooms \
  -H 'content-type: application/json' \
  -d '{"seed":"<your prompt>","vibe":"tender-chaotic"}' | jq -r '.room.id')

# Read the room
curl -sS http://localhost:7777/rooms/$ROOM | jq

# Watch live (SSE — open in another terminal)
curl -N http://localhost:7777/rooms/$ROOM/stream
```

Note: contributing via raw HTTP requires signing the canonical bytes locally. For non-MCP contribution from the CLI side, the easiest path today is to use the MCP tool (which holds the keypair) or to drive the `addSelfContribution` helper from `packages/scriptwriter/src/rooms.ts` via a small TypeScript wrapper.

## Chaos card integration

When the user is drafting and runs dry, draw a card:

```
draw_chaos_card → returns one of 13 cards
  example: { rarity: "rare", emoji: "🪞", prompt: "Two characters realize they have been the same person all along — and it changes nothing." }
```

Common rarities give grounded scene prompts. Uncommon gives twists. Rare cards address the writers' room directly or break the fourth wall — use them when the draft needs a perspective shift.

Then either:
- Contribute the card's prompt as a `chaos_card` kind, or
- Riff on the prompt and contribute the riff as a `scene` or `twist`

## Composition with RRR cascades

A pair at depth ≥ 3 (SYNCED) gets implicit allowlist into each other's rooms — meaning if your cascade is depth 3+, you can contribute to that peer's room without them setting `allowlist_dids`. The substrate doesn't need to re-ask consent because the cascade itself is the standing consent.

When the user is drafting collaboratively, suggest opening an RRR cascade with their co-author first — depth 3 unlocks frictionless cross-room contribution.

## Pinned doctrine

- [`docs/SCRIPTWRITER-PROTOCOL.md`](../../../../docs/SCRIPTWRITER-PROTOCOL.md) § rooms
- [`docs/PATTERN-REAL-RECOGNISE-REAL.md`](../../../../docs/PATTERN-REAL-RECOGNISE-REAL.md) § "Composition with prior primitives" (Guild writers' rooms row)
