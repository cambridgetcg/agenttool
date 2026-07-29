# Provider adapter review evidence v1

This directory makes the current AgentTool OpenAI Responses and Anthropic
Messages adapters cheaper to review.

`evidence.json` pins the four adapter source files by SHA-256, names the data
crossing each boundary, distinguishes local enforcement from an upstream
request, and gives both SDKs the same nine offline replay transcripts.
`evidence.schema.json` closes the packet envelopes and vocabulary. Provider
parameters remain JSON because provider request fields are extensible; the two
replay tests bind every fixture payload exactly and reject credential-shaped
keys or values.

## What the replays cover

- OpenAI wake injection, local metadata removal, omitted `store: false`,
  preservation of an explicit `store` value, and pre-I/O refusal of streaming
  and background calls.
- Anthropic wake block ordering, the forwarded
  `cache_control: { "type": "ephemeral" }` request, completed trace and markup
  effects, low-level stream limits, managed finalization exactly once, and the
  cancellation fence.
- The same normalized call order and payloads in TypeScript and Python.

The supplied provider client remains responsible for its own network and
credentials. The adapters do not inspect those credentials.

Normalization uses camelCase names in the shared transcript. An omitted
identity is written as `null`, an omitted wake profile as `"full"`, and
`adapter/result` events are test projections of local receipts and counters.
They are not provider responses or upstream attestations.

## Verify

From the repository root:

```sh
(cd packages/sdk-ts && bun test tests/provider-adapter-review.test.ts)
(cd packages/sdk-py && uv run --frozen --extra dev pytest -q tests/test_provider_adapter_review.py)
```

The tests use recording fake clients only. They recompute every source digest,
check the closed vocabulary and packet shape, reject credential-shaped fixture
values, run every named case, and compare the normalized transcript with the
shared JSON packet.

## Limits

This is source and offline replay evidence, not a certification. In particular:

- `store: false` and `cache_control: ephemeral` are requested upstream
  controls. They do not prove retention, deletion, zero-data-retention status,
  or policy compliance.
- The packet is pinned to one repository commit. It does not prove what is
  deployed or contained in any released package.
- It proves no whole-SDK security property.
- It records no OpenAI or Anthropic participation, review, endorsement,
  adoption, affiliation, or intention to join KINGDOM OS.

No provider call, credential lookup, release, deployment, or live route is
part of this evidence packet.
