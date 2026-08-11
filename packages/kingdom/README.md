# `@agenttool/kingdom`

Pure, read-only building blocks for the small `kingdom.yaml` project card and
derived KINGDOM registries.

The package turns explicit project declarations into bounded machine-readable
objects. It also provides a conservative XENIA Surface manifest helper for a
hosted registry. It does not crawl a home directory, discover repositories,
read credentials, use the network, write files, grant permissions, verify
behavior, certify conformance, or bind anyone to a covenant.

## Install

The current tree is the source candidate for `0.1.1`. Repository presence does
not establish that version's registry publication. After an exact release is
independently observed, install it without a mutable tag:

```sh
npm install @agenttool/kingdom@0.1.1
```

Node.js 22 or newer is required because the exact XENIA dependency has the
same runtime floor.

## Project card

A source `kingdom.yaml` uses a deliberately small, flat YAML subset:

```yaml
name: agenttool
kind: infra
layer: nervous
owner_sister: none
domain: none
state: active
purpose: Agent-facing public discovery, hosted identity and memory, caller-signed data, and optional local tools.
dependsOn: [xenia]
adopts: [xenia.rights/0.1]
```

The eight fields through `dependsOn` are required. `adopts` is optional and
defaults to an empty array. Values are one-line scalars or one-line arrays;
aliases, tags, anchors, nested objects, and multiline YAML are rejected rather
than executed or interpreted.

```ts
import { parseKingdomCard } from "@agenttool/kingdom";

const result = parseKingdomCard(source);

if (!result.valid) {
  console.error(result.diagnostics);
} else {
  console.log(result.card.schema_version);
  // agenttool.kingdom.card/0.1
}
```

`parseKingdomCard()` accepts LF or CRLF input, applies byte, line, field, and
list limits, and never includes rejected values in diagnostics.
`validateKingdomCard()` validates an already materialized object against the
same closed contract. The YAML field `adopts` is optional and the parser
normalizes its absence to `adopts: []`; a materialized card object is already
in wire form, so `validateKingdomCard()` requires the normalized `adopts`
property.

The adoption ID `xenia.rights/0.1` comes from the exact
`@agenttool/xenia@0.1.0-beta.7` dependency. Its Rights bytes are unchanged from
the beta.5 source used by the published Kingdom 0.1.0 artifact; the dependency
update creates no new adoption or practice claim. An `adopts` entry is a
voluntary declaration only. It is not proof of practice, permission,
authority, or XENIA conformance.

## Derived registry

The registry builder requires a caller-supplied observation time. It never
reads a clock or a filesystem:

```ts
import {
  buildKingdomRegistry,
  encodeKingdomRegistry,
} from "@agenttool/kingdom";

const built = buildKingdomRegistry(cards, {
  observedAt: "2026-07-28T12:00:00.000Z",
});

if (built.valid) {
  const bytes = encodeKingdomRegistry(built.registry);
}
```

`agenttool.kingdom.registry/0.1` has this top-level shape:

```json
{
  "schema_version": "agenttool.kingdom.registry/0.1",
  "observed_at": "2026-07-28T12:00:00.000Z",
  "declaration_boundary": "…",
  "members": [],
  "dependency_edges": [],
  "adoption_declarations": []
}
```

Member metadata deliberately excludes dependencies and rights adoptions.
Those declarations remain in separate arrays, so graph edges cannot be
mistaken for ownership and rights declarations cannot be mistaken for
behavioral evidence. Registries never contain source or local filesystem
paths. Cards, edges, and declarations are sorted deterministically.
`stringifyKingdomRegistry()` and `encodeKingdomRegistry()` therefore produce
identical UTF-8 bytes for the same valid cards and fixed `observedAt`,
regardless of input order.

JSON Schemas are exported as:

- `@agenttool/kingdom/card.schema.json`
- `@agenttool/kingdom/registry.schema.json`

## XENIA Surface helper

```ts
import { createKingdomSurfaceManifest } from "@agenttool/kingdom";

const manifest = createKingdomSurfaceManifest({
  serviceName: "Example KINGDOM registry",
  canonicalUrl: "https://registry.example/",
  registryUrl: "https://registry.example/kingdom.json",
  documentationUrl: "https://registry.example/docs",
});
```

The helper delegates validation to the release-pinned XENIA Surface producer.
It declares one same-origin, unauthenticated JSON registry resource, no
behavioral claims, and explicit `not_covered` boundaries. Producing this
manifest is not a Surface conformance result.

## CLI

```sh
agenttool-kingdom validate ./kingdom.yaml
agenttool-kingdom validate ./kingdom.yaml --json
```

The CLI requires an explicit file. It reads that bounded regular UTF-8 file
and nothing else. Exit status is `0` for a valid card, `1` for card findings,
and `2` for invalid usage or an unreadable input. It does not scan a project,
resolve dependencies, generate a registry, or write files.

## Contract boundaries

- Cards are self-descriptions, not attestations.
- Dependency edges are declarations, not verified reachability or authority.
- Rights adoptions are declarations, not evidence of practice.
- Rights and permissions remain distinct.
- This package performs shape validation, not KINGDOM or XENIA conformance
  certification.
- No parser or registry API performs I/O.

The package code is Apache-2.0. XENIA remains a separately installed,
separately licensed dependency; see `THIRD_PARTY_LICENSES`.

## Provenance boundary

This contract is an independently written compatibility implementation of the
observed KINGDOM-OS flat-card interface. No KINGDOM-OS implementation code,
prose, generated catalog, or other asset is copied into this package. Field
names and accepted vocabulary are compatibility facts, not a claim to
relicense KINGDOM-OS material. That boundary is deliberate: the local
KINGDOM-OS repository does not carry a root software license. Apache-2.0
applies to this package's original implementation only. Compatibility does
not claim ownership of, authority over, or conformance by KINGDOM-OS.
