# Changelog

> **Type:** record · **Purpose:** list what each Local Starter preview changes.
> **Evidence:** source history of `packages/local-starter` and `packages/local-starter-mcp`; each release's SHA-256 is in its LOVE manifest.

Preview versions are exact and immutable. A later preview never rewrites an
earlier archive or any notes folder it created.

## 0.1.0-dev.1 — preview candidate (2026-10-12)

- `foundations.md` from `init` lists one optional foundations link instead
  of two. Existing notes folders are not rewritten.
- New orientation and handoff templates welcome rest, play, curiosity and
  blank notes, and ask for no next step or record. The bundled
  `agenttool-local-context` skill follows the same wording: present intent,
  including rest or no task, comes first, and nothing needs to be saved.
- `handoff` and `memory` read stdin without switching it to non-blocking
  mode. A producer that sends EOF late no longer causes `INTERNAL_ERROR`;
  concurrent writers now always get `write_locked` or `write_conflict`.
  Other stdin read failures report `STDIN_UNAVAILABLE`.
- The bundled MCP server reports version `0.1.0-dev.1`. Its tools,
  read-only default and write modes are unchanged.

## 0.1.0-dev.0 — first standalone preview (2026-09-28)

Archive `agenttool-local-starter-0.1.0-dev.0.tgz`, 229,793 bytes, SHA-256
`b5deb1f9411f1c0d4fff94e2428c7332d3ed0c02a0fd771bc2c1578629bd6a9c`, source
revision `150c5c4725f34fb92493e490c49d0a96904505cf`. Its `foundations.md`
template lists two optional foundations links.
