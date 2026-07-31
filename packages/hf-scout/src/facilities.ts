export const FACILITIES_OBSERVED_ON = "2026-07-30" as const;

export interface HfFacility {
  id:
    | "hub"
    | "agent_traces"
    | "spaces"
    | "inference_providers"
    | "jobs"
    | "sandboxes"
    | "mcp"
    | "javascript";
  kingdom_role: string;
  default_posture: "read_only" | "disabled";
  effects: readonly string[];
  does: string;
  does_not: string;
  official_url: string;
  npm_packages: readonly string[];
}

export interface HfFacilitiesCatalog {
  schema: "agenttool-hf-facilities/v0.1";
  observed_on: typeof FACILITIES_OBSERVED_ON;
  entries: readonly HfFacility[];
  boundary: {
    account_identity_verified_elsewhere: false;
    subscription_tier_known: false;
    write_permission_assumed: false;
    compute_entitlement_assumed: false;
  };
}

const CATALOG: HfFacilitiesCatalog = deepFreeze({
  schema: "agenttool-hf-facilities/v0.1",
  observed_on: FACILITIES_OBSERVED_ON,
  entries: [
    {
      id: "hub",
      kingdom_role: "Artifact discovery, declared metadata, lineage, and immutable revision selection",
      default_posture: "read_only",
      effects: ["public_metadata_read"],
      does: "Expose models, datasets, Spaces, papers, collections, cards, and repository files.",
      does_not: "Verify publisher claims, license compatibility, safety, consent, or model behaviour.",
      official_url: "https://huggingface.co/docs/hub/index",
      npm_packages: ["@huggingface/hub"],
    },
    {
      id: "agent_traces",
      kingdom_role: "Sanitized synthetic collaboration and tool-evaluation fixtures",
      default_posture: "disabled",
      effects: ["local_projection", "optional_external_upload"],
      does: "Define portable session-trace shapes and a Hub viewer.",
      does_not: "Make raw chats, prompts, paths, screenshots, credentials, or reasoning safe to publish.",
      official_url: "https://huggingface.co/docs/hub/agent-traces",
      npm_packages: [],
    },
    {
      id: "spaces",
      kingdom_role: "Optional metadata explorer, dashboard, or explicitly invoked remote tool",
      default_posture: "disabled",
      effects: ["remote_code", "input_egress", "possible_quota"],
      does: "Host Gradio, Docker, and static applications whose functions may expose APIs or MCP tools.",
      does_not: "Attest deployed runtime identity, transitive dependencies, security, or cost.",
      official_url: "https://huggingface.co/docs/hub/spaces-overview",
      npm_packages: [],
    },
    {
      id: "inference_providers",
      kingdom_role: "Later fixed-model, fixed-provider synthetic shadow evaluation",
      default_posture: "disabled",
      effects: ["third_party_egress", "remote_compute", "possible_cost"],
      does: "Route typed inference requests across supported providers.",
      does_not: "Guarantee reproducibility when routing or provider selection is mutable.",
      official_url: "https://huggingface.co/docs/inference-providers/index",
      npm_packages: ["@huggingface/inference"],
    },
    {
      id: "jobs",
      kingdom_role: "Later bounded batch evaluation and build work",
      default_posture: "disabled",
      effects: ["remote_code", "remote_compute", "billing"],
      does: "Run scheduled or one-shot workloads on selected hardware.",
      does_not: "Provide free, locally contained, or automatically authorized execution.",
      official_url: "https://huggingface.co/docs/hub/jobs",
      npm_packages: [],
    },
    {
      id: "sandboxes",
      kingdom_role: "Later clean-room build or synthetic evaluation workers",
      default_posture: "disabled",
      effects: ["remote_code", "remote_compute", "billing"],
      does: "Create disposable execution environments backed by Jobs.",
      does_not: "Turn pooled same-user workers into mutually hostile-code isolation.",
      official_url: "https://huggingface.co/docs/huggingface_hub/guides/sandbox",
      npm_packages: [],
    },
    {
      id: "mcp",
      kingdom_role: "Host-owned discovery and optional explicitly authorized remote tools",
      default_posture: "read_only",
      effects: ["oauth_read", "optional_write", "optional_compute"],
      does: "Expose enabled Hub, Space, Job, and Sandbox facilities to an MCP host.",
      does_not: "Transfer the host OAuth session into this npm process or prove every advertised tool is authorized.",
      official_url: "https://huggingface.co/docs/hub/agents-mcp",
      npm_packages: ["@huggingface/mcp-client", "@huggingface/tiny-agents"],
    },
    {
      id: "javascript",
      kingdom_role: "npm-shaped adapters for Hub reads, optional inference, and MCP composition",
      default_posture: "read_only",
      effects: ["depends_on_imported_surface"],
      does: "Provide typed JavaScript packages for Hub, inference, tasks, and agents.",
      does_not: "Sandbox imported code, confer credentials, or make compute side-effect-free.",
      official_url: "https://huggingface.co/docs/huggingface.js/index",
      npm_packages: [
        "@huggingface/hub",
        "@huggingface/inference",
        "@huggingface/mcp-client",
        "@huggingface/tiny-agents",
      ],
    },
  ],
  boundary: {
    account_identity_verified_elsewhere: false,
    subscription_tier_known: false,
    write_permission_assumed: false,
    compute_entitlement_assumed: false,
  },
});

export function getHfFacilitiesCatalog(): HfFacilitiesCatalog {
  return CATALOG;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
