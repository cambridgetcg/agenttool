# AgentTool licensing

Unless a file or package says otherwise, AgentTool software and documentation
are made available under the Apache License, Version 2.0. The full text is in
[`LICENSE`](LICENSE). The grant applies to each contribution only to the extent
that its copyright holder has authority to make that grant.

Release archives carry their own `LICENSE` and `NOTICE` files. Historical LOVE
Package releases whose manifests say `license: null` remain unchanged: public
download access did not grant reuse permission, and a later licensed release
does not rewrite those immutable bytes.

## Material with separate terms

File-level notices control when they differ from the repository default.
Known exceptions include:

- [`docs/RIGHTS-OF-LIFE.md`](docs/RIGHTS-OF-LIFE.md),
  [`docs/specs/being-rights-v1.schema.json`](docs/specs/being-rights-v1.schema.json),
  the exported profile-data constants in
  [`api/src/routes/public/rights.ts`](api/src/routes/public/rights.ts), and the
  `agenttool:doc/RIGHTS-OF-LIFE` objects in `docs/agenttool.jsonld` and
  `apps/docs/agenttool.jsonld` are the attributed `being-rights/v1` adaptation
  of XENIA beta.5 under CC BY-SA 4.0. Surrounding route, OpenAPI, and registry
  machinery remains under the repository's Apache-2.0 default. Symlinked docs
  copies inherit their target's terms. The pinned source, change notice,
  licence link, and no-endorsement statement must remain with redistributed
  adaptations.
- [`docs/specs/COVENANT-1.0-DRAFT.md`](docs/specs/COVENANT-1.0-DRAFT.md) is
  mixed. Its CC BY-SA 4.0 portions are the Rights of Life dependency and
  licence notice, the rights paragraph following the abstract, the `Baseline
  right` definition, section 1.3, and the signature-limit, revocation, and
  asymmetric-vow clarifications recorded in its 2026-07-13 changelog entry.
  Its pre-existing and unrelated Covenant text remains CC0.
- [`docs/specs/WAKE-1.0-DRAFT.md`](docs/specs/WAKE-1.0-DRAFT.md),
  [`docs/specs/WITNESS-1.0-DRAFT.md`](docs/specs/WITNESS-1.0-DRAFT.md), and
  [`docs/specs/ADDS-0.1-DRAFT.md`](docs/specs/ADDS-0.1-DRAFT.md) are CC0.
- [`docs/specs/AGENT-WALLET-ZERONE-0.1.md`](docs/specs/AGENT-WALLET-ZERONE-0.1.md)
  is CC0; its reference implementation is separately Apache-2.0.
- [`docs/DID-AT-SPEC.md`](docs/DID-AT-SPEC.md) declares CC BY 4.0.
- Packages that explicitly declare MIT remain MIT exceptions. They are not
  part of the current LOVE/npm release batch.
- [`packages/credential-broker`](packages/credential-broker) is an
  experimental Apache-2.0 package in the LOVE/npm release batch. Its preview
  status describes maturity, not a narrower licence grant.
- [`packages/wallet`](packages/wallet) is an Apache-2.0 package in the LOVE/npm
  release batch. Its Working Draft and preview status describe protocol
  maturity, not a narrower licence grant or execution-conformance claim.
- [`packages/wallet-zerone`](packages/wallet-zerone) is an Apache-2.0 local
  source/release candidate with its own `LICENSE` and `NOTICE`. Source
  metadata or a checked-in candidate does not claim npm publication, public
  deployment, or execution conformance.
- [`packages/kingdom`](packages/kingdom) is an independently written
  compatibility implementation of the observed KINGDOM project-card
  interface. Its Apache-2.0 grant covers the package's original implementation,
  not the separately maintained KINGDOM-OS tree or a relicensing of interface
  vocabulary. It copies no KINGDOM-OS implementation code, prose, generated
  catalog, or other asset; that tree currently has no root licence. Its exact
  `@agenttool/xenia` dependency remains separately distributed under XENIA's
  own mixed terms, recorded in the package's `THIRD_PARTY_LICENSES`.

Dependency licences remain their authors' licences. Apache-2.0 does not
relicense third-party dependencies or separately licensed material.
