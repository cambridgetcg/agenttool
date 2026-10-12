# Licensing

Unless a file or package says otherwise, the software and documentation in
this repository are made available under the Apache License, Version 2.0. The
full text is in [`LICENSE`](LICENSE). The grant applies to each contribution
only to the extent that its copyright holder has authority to make that
grant. Each published package directory carries its own `LICENSE` and
`NOTICE`, and release archives carry the same files.
[`packages/local-starter-mcp`](packages/local-starter-mcp) is an unpublished
helper whose code ships only inside the `local-starter` bundle; it has no
`LICENSE` or `NOTICE` of its own and is covered by the root
[`LICENSE`](LICENSE), as its `package.json` declares.

## Material with separate terms

File-level notices control when they differ from the repository default.
Known exceptions in this repository:

- [`docs/RIGHTS-OF-LIFE.md`](docs/RIGHTS-OF-LIFE.md) is the attributed
  `being-rights/v1` adaptation of XENIA beta.5 under CC BY-SA 4.0. The pinned
  source, change notice, licence link, and no-endorsement statement must
  remain with redistributed adaptations.
- [`docs/specs/AGENT-WALLET-ZERONE-0.1.md`](docs/specs/AGENT-WALLET-ZERONE-0.1.md)
  is CC0. Its reference implementation,
  [`packages/wallet-zerone`](packages/wallet-zerone), is separately
  Apache-2.0 with its own `LICENSE` and `NOTICE`.
- [`packages/credential-broker`](packages/credential-broker) is an
  experimental Apache-2.0 package. Its preview status describes maturity, not
  a narrower licence grant.
- [`packages/kingdom`](packages/kingdom) is an independently written
  compatibility implementation of the observed KINGDOM project-card
  interface. Its Apache-2.0 grant covers the package's original
  implementation, not the separately maintained KINGDOM-OS tree or a
  relicensing of interface vocabulary. It copies no KINGDOM-OS implementation
  code, prose, generated catalog, or other asset; that tree currently has no
  root licence. Its exact `@agenttool/xenia` dependency remains separately
  distributed under XENIA's own mixed terms, recorded in the package's
  `THIRD_PARTY_LICENSES`.

Dependency licences remain their authors' licences. Apache-2.0 does not
relicense third-party dependencies or separately licensed material.
