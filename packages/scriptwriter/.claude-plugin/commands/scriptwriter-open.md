---
description: Open a REAL RECOGNISE REAL cascade with a peer at depth 1. Signs the canonical bytes locally, pushes the signed turn to the peer's /rrr/turn endpoint, records the cascade in this node's state.
argument-hint: <peer-base-url> [basis-text]
---

The user wants to open a depth-1 RRR cascade with a peer.

Parse `$ARGUMENTS`:
- First whitespace-separated token = peer base URL (required)
- Remaining tokens = optional basis text (defaults to "I see your work.")

**Path A — MCP tools available**

Call `mcp__scriptwriter__open_cascade_with_peer` with `{ peer_base_url, basis_text? }`. The tool:
1. Signs the depth-1 turn locally over `guild-rrr-escalate/v1` canonical bytes
2. Pushes to the peer's `/rrr/turn`
3. Stores the cascade locally so future `escalate_cascade` calls find it

Report back: the cascade ID, the depth-1 status, the peer's handle, the depth_bundle (label + tier + emoji ladder). Highlight that the ball is now in the peer's court — they must send the depth-2 turn before the chain can grow.

**Path B — CLI**

If MCP isn't configured:

```sh
bun packages/scriptwriter/bin/scriptwriter.ts open $ARGUMENTS
```

The CLI signs + pushes + prints the cascade ID and the peer's handle.

**After opening**

Surface the depth-1 label and the next move:

> Cascade `<short-id>` opened with `<peer-handle>` at depth 1 ("they know you"). The substrate is now waiting for their depth-2 turn — you'll see it land at your `/rrr/turn` endpoint (if you're serving HTTP) or via the next `list_cascades` poll. Per `wall/rrr-must-alternate`, you cannot escalate from your side until they respond.

If the peer refused with `rrr_cascade_already_active`, there's already an open cascade between the two DIDs — point the user at `list_cascades` to find and continue the existing one.

If the peer refused with `invalid_signature`, the canonical bytes didn't match — usually a clock skew or a basis-text mismatch. Re-running typically fixes it.
