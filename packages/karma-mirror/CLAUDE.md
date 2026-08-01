# KARMA Mirror

Private, source-only AgentTool developer preview for one separate deception
island. It accepts only deliberately planted credentials and returns coherent
synthetic AgentTool-shaped responses. It is not the production API and is not
the KARMA knowledge-graph adapter in `packages/dark-continent-karma`.

## Vow

- Keep runtime dependencies at zero.
- Never import or invoke filesystem, process, VM, subprocess, worker, socket,
  DNS, HTTP-client, browser, database, queue, payment, provider, wallet, vault,
  federation, or production AgentTool modules.
- `node:crypto` is the only Node built-in allowed in `src/`.
- Unknown, missing, unmarked, or ordinary AgentTool credentials never
  enter the mirror and never create a receipt. Admission requires the public
  mirror self-marker plus an exact caller-supplied planted-record hash and
  prefix. The marker prevents accidental production-key admission; it is not a
  signature or mint-authority proof. Never derive a record from a real key.
- Treat planted records as private operational material even though they omit
  root plaintext. Child credentials require an ephemeral per-instance secret
  and are not derivable from the record.
- Every mirror response identifies itself through `X-Karma-Mirror`, a
  `rel="help"` Door Back link, and an in-band `_karma.synthetic = true` frame.
- All apparent writes, fetches, execution, detonation, credentials, balances,
  network destinations, and files are synthetic and have zero external effect.
- Scrape never fetches. Execute never interprets. Malware bytes are bounded,
  hashed in memory, and discarded; only the digest and closed behavior enums
  may survive in the engine.
- Never retain request bodies, code, filenames, bearer plaintext, IPs,
  user-agents, cookies, referrers, or inferred identities in receipts.
- Keep each request finite and fast. Enforce the body deadline, byte/fragment
  ceilings, and per-root state partitions. No sleep, held sockets, infinite
  response, recursive expansion, attacker-controlled allocation, or
  cross-placement cost amplification. A future host adds stricter per-root
  connection, rate, and concurrency limits.
- The unauthenticated Door Back is built in and never writes a receipt. An
  authenticated constructive exit immediately ends the fiction for that root.
- No production route, migration, deployment configuration, credential
  planting, publication, or external release belongs in this package.

## Verification

```bash
bun install --frozen-lockfile
bun run ci
```

The source-boundary test is load-bearing. If the island needs real execution,
networking, persistence, or deployment, stop: that is a different reviewed
system with a real isolation boundary, not an extension of this package.
