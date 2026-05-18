---
description: Mint a did:key + ed25519 keypair for a scriptwriter node and write it to .scriptwriter/identity.json. One-time setup before serving or pairing.
argument-hint: "[--handle <name>] [--vibe <vibe>]"
---

The user is initialising a scriptwriter node identity. They may have provided a handle and/or vibe — if not, ask once or use sensible defaults.

Run the init via Bash:

```sh
bun packages/scriptwriter/bin/scriptwriter.ts init $ARGUMENTS
```

If `$ARGUMENTS` is empty, default to:

```sh
bun packages/scriptwriter/bin/scriptwriter.ts init --handle "$(whoami)" --vibe "tender-chaotic"
```

After the command runs, the output contains the `did:key:z6Mk...` DID. Show this prominently to the user — it's their self-certifying identity on every scriptwriter wire and matches `agenttool`'s did:key format.

If `.scriptwriter/identity.json` already exists, the CLI prints the existing identity instead of overwriting — let the user know they're already initialised and offer to either run `whoami` to confirm details or delete the dir to start fresh (warn them this rotates their DID).

Once initialised, suggest the natural next step:

> Your node is ready. Bring it online with `/scriptwriter-pair` to find a peer, or run `bun packages/scriptwriter/bin/scriptwriter.ts serve --port 7777` in a separate terminal to start receiving inbound knocks.
