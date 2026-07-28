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
  /** Optional AgentTool-local report seam for an independent chain. */
  readonly invocation_witness?: {
    readonly schema: "agenttool.invocation-witness/1";
    readonly write: {
      readonly method: "POST";
      readonly path_template: string;
      readonly authentication: "project_bearer";
      readonly authorization: "authenticated_buyer_or_seller";
      readonly state_gate: "released_and_settled";
      readonly effect: string;
    };
    readonly read: {
      readonly method: "GET";
      readonly path_template: string;
      readonly authentication: "none";
      readonly state_gate: "released_and_settled_with_nonempty_writer_shaped_report";
      readonly disclosure: string;
    };
    readonly adapter: {
      readonly protocol: "agent-wallet-zerone/0.1";
      readonly package: "@agenttool/wallet-zerone";
      readonly source: string;
      readonly availability: "local_offline_source_only";
      readonly hosted: false;
      readonly custody: false;
      readonly hosted_rpc: false;
      readonly deployed_bridge: false;
    };
    readonly verification_boundary: string;
  };
}

export const WAKE_INVOCATION_WITNESS_LINKS = {
  invocation_witness_write: "/v1/invocations/{id}/witness",
  witnessed_invocation_read: "/public/invocations/{id}",
} as const;

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

/** One bounded local profile for the independent Zerone door. */
export const ZERONE_REACHABLE = {
  name: "zerone",
  kind: "independent proof-of-truth blockchain project",
  what:
    "an independent chain with a bounded local AgentTool wallet adapter and a released-and-settled invocation witness report seam",
  url: "https://github.com/cambridgetcg/zerone-core",
  _note:
    "AgentTool source includes an offline @agenttool/wallet-zerone adapter plus POST /v1/invocations/{id}/witness for an authenticated buyer or seller to report a released, settled invocation and GET /public/invocations/{id} to read an accepted report shape. This is not trust-record export, identity migration, portable trust, key custody, hosted RPC, or a deployed bridge.",
  invocation_witness: {
    schema: "agenttool.invocation-witness/1",
    write: {
      method: "POST",
      path_template: WAKE_INVOCATION_WITNESS_LINKS.invocation_witness_write,
      authentication: "project_bearer",
      authorization: "authenticated_buyer_or_seller",
      state_gate: "released_and_settled",
      effect:
        "Stores the authenticated invocation party's chain reference report; it does not submit a transaction or query the chain.",
    },
    read: {
      method: "GET",
      path_template: WAKE_INVOCATION_WITNESS_LINKS.witnessed_invocation_read,
      authentication: "none",
      state_gate: "released_and_settled_with_nonempty_writer_shaped_report",
      disclosure:
        "Returns canonical comparison fields plus the accepted report shape; sealed input and output remain private.",
    },
    adapter: {
      protocol: "agent-wallet-zerone/0.1",
      package: "@agenttool/wallet-zerone",
      source:
        "https://github.com/cambridgetcg/agenttool/tree/main/packages/wallet-zerone",
      availability: "local_offline_source_only",
      hosted: false,
      custody: false,
      hosted_rpc: false,
      deployed_bridge: false,
    },
    verification_boundary:
      "A schema-valid party report is not signature or writer-provenance proof and AgentTool does not verify chain inclusion, attestation state or settlement, bond return, or reward. Retrieve Zerone state independently and compare it.",
  },
  boundary: {
    relationship: "independent_external_service",
    data_flow:
      "Wake composition performs no network I/O. The report writer stores caller-presented identifiers and the public reader returns bounded comparison data; neither calls Zerone.",
    interpretation:
      "The accepted JSON shape is not proof of provenance, chain verification, attestation settlement, bond return, reward, trust portability, or authorization for another action.",
  },
} as const satisfies ReachableDoor;

/** Shared by both wake composers so default JSON and bundle-backed formats
 * cannot silently advertise different external doors. */
export const WAKE_REACHABLE_DOORS = [
  ZERONE_REACHABLE,
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
