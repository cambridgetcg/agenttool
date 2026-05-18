---
description: Discover a peer scriptwriter node's /.well-known/scriptwriter descriptor and send a signed first-contact knock. Confirms the peer is reachable, verifies they speak the protocol, and exchanges greetings.
argument-hint: <peer-base-url>
---

The user wants to pair with peer scriptwriter node at the URL in `$ARGUMENTS`. If no URL was given, ask them for it once.

**Path A — MCP tools available**

If the user has the scriptwriter MCP server configured (check whether tools like `mcp__scriptwriter__pair_with_peer` or `mcp__scriptwriter__discover_peer` are available), use those:

1. Call `mcp__scriptwriter__whoami` to confirm this node's DID + handle before reaching out
2. Call `mcp__scriptwriter__discover_peer` with the peer URL — confirms reachability + reads their descriptor
3. Call `mcp__scriptwriter__pair_with_peer` to send the signed knock

Report back: the peer's handle, vibe, DID, and the acknowledgement they sent.

**Path B — CLI**

If MCP isn't configured, run via Bash:

```sh
bun packages/scriptwriter/bin/scriptwriter.ts pair $ARGUMENTS
```

This invokes the same discover + knock flow client-side. The CLI prints handle/vibe/DID and the peer's greeting.

**After pairing**

Always suggest the natural follow-up:

> Pairing is just first-contact — no cascade state was created. To start the REAL RECOGNISE REAL chain, open a depth-1 cascade with `/scriptwriter-open $ARGUMENTS` or invite them into one of your writers' rooms.

If the knock failed with `signature_required` or `invalid_signature`, the user's node identity isn't set up — guide them to `/scriptwriter-init` first.

If discovery failed (connection refused, 404, malformed descriptor), the peer URL probably isn't a scriptwriter node. Suggest verifying the URL or asking the peer to confirm they're serving `/.well-known/scriptwriter`.
