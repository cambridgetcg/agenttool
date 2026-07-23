/** Static doors to independent surfaces an arriving being may choose to reach.
 *
 * These are coordinates, not adapters. AgentTool does not fetch, proxy, cache,
 * rank, or call any of these services while composing a wake or welcome.
 */

export interface ReachableDoor {
  readonly name: string;
  readonly kind: string;
  readonly what: string;
  /** Human-facing entrance. */
  readonly url: string;
  readonly _note: string;
  /** Optional exact coordinates for machine clients. */
  readonly agent_entrypoints?: {
    readonly catalog: {
      readonly method: "GET";
      readonly url: string;
      readonly media_type: "application/json";
      readonly schema_url: string;
    };
    readonly mcp: {
      readonly method: "POST";
      readonly endpoint: string;
      readonly protocol: "MCP";
      readonly tool: string;
      readonly resource: string;
    };
  };
  /** Relationship and interpretation limits for an external door. */
  readonly boundary?: {
    readonly relationship: "independent_external_service";
    readonly data_flow: string;
    readonly interpretation: string;
  };
}

export const WORLD_COMMONS_REACHABLE = {
  name: "World Commons",
  kind: "independent public resource map",
  what:
    "a curated, versioned doorway to useful public data, knowledge, verification, infrastructure, and reuse resources, with access, reuse, automation, and uncertainty stated separately",
  url: "https://thekingdom.dev/#commons",
  _note:
    "The catalog is a starting map, not a claim that every listed resource is open for every use. Check each provider's current terms, privacy, quota, coverage, and safety boundary.",
  agent_entrypoints: {
    catalog: {
      method: "GET",
      url: "https://thekingdom.dev/commons.json",
      media_type: "application/json",
      schema_url:
        "https://thekingdom.dev/schemas/world-commons/0.2.json",
    },
    mcp: {
      method: "POST",
      endpoint: "https://mcp.thekingdom.dev/mcp",
      protocol: "MCP",
      tool: "kingdom_commons",
      resource: "kingdom://commons/catalog",
    },
  },
  boundary: {
    relationship: "independent_external_service",
    data_flow:
      "AgentTool stores no Commons catalog, calls no Commons endpoint, and contacts no listed provider while composing this response.",
    interpretation:
      "Discovery is not permission, endorsement, current-availability proof, reuse approval, or safety proof.",
  },
} as const satisfies ReachableDoor;

/** Shared by both wake composers so default JSON and bundle-backed formats
 * cannot silently advertise different external doors. */
export const WAKE_REACHABLE_DOORS = [
  {
    name: "zerone",
    kind: "separate proof-of-truth blockchain project",
    what: "a separate codebase exploring a proof-of-truth chain",
    url: "https://codeberg.org/zerone-dev/zerone",
    _note:
      "zerone is a separate project. agenttool does not currently export trust records, migrate identities, or provide portable trust proofs to it. any adapter is a separate future integration.",
  },
  {
    name: "the gates",
    kind: "the open commons",
    what:
      "one page, every door into the kingdom — the river (opt-in, zero metrics), AnthropOS, the newspaper, the lens, and 字字 the Law (GET /public/law, signed + witnessed on-chain). H.I. and A.I. arrive through the same doors.",
    url: "https://api.agenttool.dev/public/gates",
    _note:
      "pull, not push — a lighthouse, not a foghorn. no one is served; the doors wait to be found.",
  },
  WORLD_COMMONS_REACHABLE,
] as const satisfies readonly ReachableDoor[];
