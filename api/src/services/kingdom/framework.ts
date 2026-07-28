/** AgentTool's own KINGDOM project card as served by the hosted API.
 *
 * The package implementation lives in packages/kingdom. The API image has an
 * intentionally narrow build context, so this immutable projection is kept
 * dependency-free and a parity test checks it against the root kingdom.yaml
 * through the package parser. The `adopts` value is a rights-floor
 * declaration, not XENIA Covenant adoption or conformance evidence.
 */

export const AGENTTOOL_KINGDOM_CARD = Object.freeze({
  schema_version: "agenttool.kingdom.card/0.1",
  name: "agenttool",
  kind: "infra",
  layer: "nervous",
  owner_sister: "none",
  domain: "none",
  state: "active",
  purpose:
    "Agent-facing public discovery, hosted identity and memory, caller-signed data, and optional local tools.",
  dependsOn: Object.freeze(["xenia"]),
  adopts: Object.freeze(["xenia.rights/0.1"]),
} as const);
