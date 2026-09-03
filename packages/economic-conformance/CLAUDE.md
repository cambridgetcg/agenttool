# Economic conformance package

This package is an offline, closed-trace comparator. Keep it independent of
the economic kernel and free of runtime dependencies.

## Invariants

- Never accept or invoke implementation callbacks. The caller executes an
  implementation separately and supplies inert trace data.
- Treat `producer_declared_ref` only as a safe caller declaration. It is not
  authentication, identity, continuity, consent, permission, or authority.
- Report only `PASS`, `FAIL`, or `INCONCLUSIVE`; never produce a scalar score
  or a certification claim.
- Give `FAIL` precedence over `INCONCLUSIVE`; malformed traces throw the one
  `ConformanceFormatError` taxonomy instead of becoming comparison results.
- Keep raw expected and observed values out of reports. Semantic hashes are
  comparison references, not signatures or receipts. Bind each report to the
  semantic trace and the source-pinned manifest digest without claiming the
  report itself verified raw source bytes.
- Keep XENIA rights standing and non-purchasable. Payment is not authority,
  consent, identity, safety evidence, or proof of dignity.
- Keep fixed boundary booleans in every report. A vector match does not prove
  external finality, host durability, adapter truthfulness, producer
  authentication, or future behavior. Zero-effect counters describe only the
  comparator invocation.
- Reject malformed UTF-8 and duplicate raw JSON object keys. Pin manifest
  bytes, vector bytes, suite semantics, and case count independently.
- Order object keys, case ids, and family ids by exact UTF-8 bytes; never use
  locale-sensitive comparison.
- Keep amount-like values in vectors as canonical decimal strings except for
  explicitly expected-invalid amount-validation cases.
- Vector changes create a new suite revision or suite identity; do not silently
  rewrite an already published or publicly pinned conformance surface.
- Keep independently authored training lessons separate from exact conformance
  inputs and expected observations. A public holdout is publisher intent, not
  secrecy or technical prevention of downstream training.
- Hugging Face publication, model training, and provider execution are separate
  external effects. The static candidate and package runtime perform none of
  them.

## Verification

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
