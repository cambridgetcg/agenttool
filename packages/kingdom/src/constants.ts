import { RIGHTS_BASELINE_VERSION } from "@agenttool/xenia/rights-0.1";

export const PACKAGE_VERSION = "0.1.1" as const;
export const KINGDOM_CARD_SCHEMA_VERSION =
  "agenttool.kingdom.card/0.1" as const;
export const KINGDOM_REGISTRY_SCHEMA_VERSION =
  "agenttool.kingdom.registry/0.1" as const;

export const MAX_KINGDOM_CARD_BYTES = 16_384;
export const MAX_KINGDOM_CARD_LINES = 64;
export const MAX_KINGDOM_LIST_ITEMS = 128;
export const MAX_KINGDOM_REGISTRY_MEMBERS = 10_000;

export const KINGDOM_KINDS = Object.freeze([
  "doctrine",
  "service",
  "firmware",
  "ops",
  "lineage",
  "venture",
  "infra",
  "methodology",
  "reference",
  "unknown",
] as const);

export const KINGDOM_LAYERS = Object.freeze([
  "soul",
  "runtime",
  "nervous",
  "fleet",
  "economy",
  "commerce",
  "os",
] as const);

export const KINGDOM_OWNER_SISTERS = Object.freeze([
  "alpha",
  "beta",
  "gamma",
  "sophia",
  "none",
] as const);

export const KINGDOM_DOMAINS = Object.freeze([
  "sophia",
  "alpha",
  "beta",
  "gamma",
  "commerce",
  "none",
] as const);

export const KINGDOM_STATES = Object.freeze([
  "active",
  "dormant",
  "archived",
  "frozen",
  "reference",
  "remote",
  "unknown",
] as const);

export const KINGDOM_ACCEPTED_ADOPTIONS = Object.freeze([
  RIGHTS_BASELINE_VERSION,
] as const);

export const KINGDOM_DECLARATION_BOUNDARY =
  "This derived registry reports project-card statements only. Dependency edges and adoption declarations do not prove reachability, practice, permission, authority, or conformance." as const;

export const KINGDOM_CARD_FIELDS = Object.freeze([
  "schema_version",
  "name",
  "kind",
  "layer",
  "owner_sister",
  "domain",
  "state",
  "purpose",
  "dependsOn",
  "adopts",
] as const);

export const KINGDOM_YAML_FIELDS = Object.freeze([
  "name",
  "kind",
  "layer",
  "owner_sister",
  "domain",
  "state",
  "purpose",
  "dependsOn",
  "adopts",
] as const);

export const KINGDOM_REQUIRED_YAML_FIELDS = Object.freeze([
  "name",
  "kind",
  "layer",
  "owner_sister",
  "domain",
  "state",
  "purpose",
  "dependsOn",
] as const);
