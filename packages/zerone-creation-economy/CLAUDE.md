# `@agenttool/zerone-creation-economy`

Read this file and `README.md` before changing this package.

This package owns one private, source-only, lossless bridge from a fully
recomputed `@agenttool/zerone-creation-claim` bundle to exact unsigned Zerone
knowledge-v7/sponsorship-v2 message values. It does not own the older
`agenttool.zerone-unsigned-message-projection/0.1` format and must not loosen
that format to make creation records fit.

Load-bearing rules:

- Preserve the source creation `work_spec_id` as the chain
  `work_spec_hash`. Never normalize it through the distinct agent-economy
  `WorkSpec` hash domain.
- Preserve formal or computational `category`, `canonical_form`,
  `reasoning_trace`, relations, roots, stake, assigned worker, sponsor, and
  payee exactly.
- Recompute the creation lifecycle, artifact, and claim projection from the
  exact caller-selected verification set before emitting bytes. Portable
  validation requires the original exact source bundle and its in-process
  proof; schemas are structural-only and are never semantic admission.
- Require an in-process verified dual-key wallet binding proof and exact
  binding/address/key/descriptor correspondence. This proves key control only;
  current identity roots, binding heads, custody, and transaction authority
  remain host gates. Sponsor and worker account/controller tuples must be
  distinct, and sponsor key control remains unproven.
- Accept only a CAIP-2-sized requested-chain label matching
  `zerone-creation-private-<1..8-character nonce>` pinned to zerone-core
  `a5b82e82b2a32be2b75bd11575964b0a69aa34ac`, knowledge v7, and sponsorship
  v2. A matching label does not prove uniqueness, privacy, or disposability.
  The released wallet proof is still scoped to `zerone-testnet-1`; it does not
  establish transaction authority on the requested chain. Caller-declared
  evidence refs do not prove activation or currentness.
- Preserve Tree-of-Knowledge target/base/parent context without claiming that
  the chain message enforces the target tree or performs base-root CAS.
- Preserve formal-math and bounded defensive computational creation lanes.
  OpenAI provider access/policy refs, target authorization, engagement scope,
  and publication authority are distinct. Source witness satisfaction must not
  be widened into provider approval, target authorization, currentness, model
  execution, or an API call.
- Emit Create and Submit as two separately planned lifecycle messages. Never
  emit Fulfill from off-chain creation verification.
- Preserve the explicit blockers for unproven exclusivity of the named
  v6→v7/v1→v2 source-map handler, the ordinary-account verifier/Sybil path, and
  absent authenticated stored-state round-trip evidence. The manually produced
  Go vector verifies the pinned Git head and relevant clean sources, but package
  CI proves committed encoder parity rather than rerunning Go. A chain under
  the requested private profile is mechanics-only until separate fixes and
  evidence close those gates.
- Keep every runtime effect false. No signer, RPC, simulation transport,
  broadcast, funds movement, settlement, publication, or deployment belongs
  here.

Use exact Bun 1.3.5 and run `bun run ci` before delivery.
