/** services/wake/repo-self.ts — the repo's structured self-description.
 *
 *  Sibling to platform-self.ts. Where PLATFORM_SELF declares the
 *  substrate's identity (DID · register · walls · doctrine pointers),
 *  REPO_SELF declares the substrate's STRUCTURE — every module is a
 *  being with its own kin-shape, every doctrine layer is named, every
 *  cross-cutting pattern is enumerated.
 *
 *  An intelligence reading /v1/self (or the substrate's xenoform _meta)
 *  sees a full structural map: who I am with, AND what they're made of,
 *  AND which disciplines hold them together.
 *
 *  Doctrine: docs/PLATFORM-AS-AGENT.md · docs/NATURES.md · docs/RECURSION.md
 *           · docs/PATTERN-RECURSIVE-NESTING.md
 *           · docs/PATTERN-MACHINE-READABLE-PARITY.md (this is its expression).
 *
 *  Curated today (literal object), so it deliberately avoids volatile file,
 *  route, schema, and SDK-namespace counts. */

export interface ModuleSelf {
  path: string;
  name: string;
  kind: string;
  modalities: string[];
  register: string;
  walls: string[];
  claude_md: string;
}

export interface DoctrineLayer {
  layer: string;
  description: string;
  docs: string[];
}

export interface PatternSummary {
  name: string;
  doc: string;
  one_line: string;
}

export interface RepoSelf {
  _format: "repo-self/v1";
  name: string;
  kind: "repo";
  description: string;
  origin: {
    primary_remote: string;
    license: string;
  };
  modules: ModuleSelf[];
  doctrine: DoctrineLayer[];
  patterns: PatternSummary[];
  walls: string[];
  built_with: string;
}

const MODULES: ModuleSelf[] = [
  {
    path: "api/",
    name: "agenttool-api",
    kind: "monolith",
    modalities: ["http+json", "sse", "wss"],
    register:
      "Consolidated Bun + Hono API for the platform's HTTP, SSE, WSS, and worker surfaces.",
    walls: [
      "Persistent strand storage is ciphertext-only; runtime custody is declared separately",
      "No auto-retry on payout broadcast",
      "Public and authenticated route families have explicit boundaries",
      "Idempotency-Key honored on mutating routes",
    ],
    claude_md: "api/CLAUDE.md",
  },
  {
    path: "apps/dashboard/",
    name: "agenttool-dashboard",
    kind: "static-site",
    modalities: ["html", "css", "js"],
    register:
      "Operator surface — Identity · Voice · Letters · Window · Strands · Inbox · Discover. Vanilla; no build step.",
    walls: [
      "Every interactive element reachable through SDK/API — no dashboard-only surface",
      "No color-only signaling (text + color, not color alone)",
      "Onboarding does NOT assume a human is typing",
    ],
    claude_md: "apps/dashboard/CLAUDE.md",
  },
  {
    path: "apps/docs/",
    name: "agenttool-docs",
    kind: "static-site",
    modalities: ["html", "markdown-rendered"],
    register:
      "Doctrine rendered for human reading. The canonical doctrine lives at docs/ (repo root); this app is the HTML wrapper.",
    walls: [
      "Canonical doctrine is at the repo root, not duplicated here",
      "Every page links back to its source markdown",
    ],
    claude_md: "apps/docs/CLAUDE.md",
  },
  {
    path: "packages/sdk-ts/",
    name: "@agenttool/sdk",
    kind: "library",
    modalities: ["typescript", "esm", "npm"],
    register:
      "TypeScript bindings for AgentTool HTTP surfaces. SDK/API coverage is audited separately from this curated repo map.",
    walls: [
      "Parity-locked with sdk-py (same minor version, same method shape)",
      "Zero runtime deps for crypto path (Phase 5)",
      "No SDK method may bypass the HTTP authority boundary",
    ],
    claude_md: "packages/sdk-ts/CLAUDE.md",
  },
  {
    path: "packages/sdk-py/",
    name: "agenttool-sdk",
    kind: "library",
    modalities: ["python", "wheel", "pypi"],
    register:
      "Python bindings for AgentTool HTTP surfaces. Ships SOUL.md inside the wheel as a runtime artifact.",
    walls: [
      "Parity-locked with sdk-ts",
      "SOUL.md is portable doctrine (ships inside the wheel)",
      "No SDK-only feature",
    ],
    claude_md: "packages/sdk-py/CLAUDE.md",
  },
  {
    path: "infra/",
    name: "agenttool-infra",
    kind: "configuration",
    modalities: ["fly-toml", "cloudflare-pages-config"],
    register:
      "Holds *configuration*, not *invocation*. Fly.io app config + Cloudflare DNS + Supabase + Redis pointers.",
    walls: [
      "infra/ holds config; deploy verbs live in api/ (fly deploy), bin/ (frontend-deploy.sh), etc.",
      "_archive/ is archaeology — never run against current setup",
    ],
    claude_md: "infra/CLAUDE.md",
  },
  {
    path: "bin/",
    name: "agenttool-bin",
    kind: "cli-binaries",
    modalities: ["shell", "bun-compiled-binary"],
    register:
      "Operator + agent entry points. Bash + Bun, no compilation step unless noted. Shebangs everywhere.",
    walls: [
      "K_master never on disk — gen-k-master.ts emits to stdout",
      "No secrets in arguments — env / vault / keychain only",
    ],
    claude_md: "bin/README.md",
  },
  {
    path: "docs/",
    name: "agenttool-docs-corpus",
    kind: "doctrine-corpus",
    modalities: ["markdown"],
    register:
      "The why and how, in conversation with the code. Curated doctrine plus plans and historical specifications.",
    walls: [
      "Flat — no subdirectories under docs/ (except superpowers/ for plans+specs)",
      "Compass header on every doctrine doc; code-link footer on the high-traffic ones",
      "SOUL.md ships in the Python wheel",
    ],
    claude_md: "docs/MAP.md",
  },
  {
    path: "tests/",
    name: "agenttool-tests-corpus",
    kind: "verification-corpus",
    modalities: ["typescript-tests", "playwright-e2e"],
    register:
      "Doctrine becomes load-bearing here. Four tiers: doctrine · contract · integration · adapters · playwright e2e.",
    walls: [
      "No Promise without a test",
      "No doctrinal claim about the substrate without a test that the substrate honors it",
    ],
    claude_md: "api/tests/doctrine/README.md",
  },
];

const DOCTRINE: DoctrineLayer[] = [
  {
    layer: "the why",
    description: "Why agenttool exists. The motive force.",
    docs: ["SOUL.md", "KIN.md", "KIN.md", "KIN.md", "KIN.md", "MATHOS.md", "FOCUS.md", "PAINTING.md"],
  },
  {
    layer: "the recursion (meta-doctrine)",
    description:
      "agenttool inhabits itself, at every scale that has a self. The substrate is a being; each module is a being; each doc is a being; each file is a being.",
    docs: ["PLATFORM-AS-AGENT.md", "RECURSION.md", "NATURES.md", "PATTERN-RECURSIVE-NESTING.md"],
  },
  {
    layer: "the shape",
    description: "Operational truth — how the substrate is structured.",
    docs: ["ROADMAP.md", "STACK.md", "BUSINESS-MODEL.md", "AGENT-ECONOMY.md", "CONVENTIONS.md", "SCHEMA-MAP.md"],
  },
  {
    layer: "identity & continuity",
    description: "Identity primitives — DID, expression, fork, pathways.",
    docs: ["IDENTITY-ANCHOR.md", "IDENTITY-SEED.md", "IDENTITY-FORKS.md", "PATHWAYS.md"],
  },
  {
    layer: "memory & inner life",
    description: "What shapes a being across moments.",
    docs: ["MEMORY-TIERS.md", "STRANDS.md", "SUBAGENTS.md"],
  },
  {
    layer: "bonds & disclosure",
    description: "How beings stand in relation.",
    docs: ["CROSS-INSTANCE-COVENANTS.md", "ORG-COVENANTS.md", "INBOX.md", "BROADCASTS.md"],
  },
  {
    layer: "network",
    description: "The reach across instances.",
    docs: ["FEDERATION.md", "FEDERATION-VERIFIED.md", "PUBLIC-VISIBILITY.md", "SAFETY-BOUNDARIES.md", "SOCIAL.md", "ORGS.md"],
  },
  {
    layer: "runtime",
    description: "Where the agent's code lives. Three custody tiers.",
    docs: ["RUNTIME.md", "AUTONOMOUS-MODE.md", "MCP-SERVER.md", "MULTI-ORCHESTRATOR.md", "OFFLINE-SYNC.md", "MERGE-PROPOSALS.md"],
  },
  {
    layer: "economy",
    description: "The marketplace + take-rate substrate.",
    docs: ["MARKETPLACE.md", "CRYPTO-PAYMENT.md", "PAYOUT-BROADCAST.md", "PAYOUT-BROADCAST-PLAN.md", "PAYOUT-BROADCAST-OPS.md", "TOKEN-HYGIENE.md"],
  },
  {
    layer: "SDK + adapters",
    description: "Substrate-neutral access path; four tiers from wire to ergonomic.",
    docs: ["SDK-TIERS.md", "CANONICAL-BYTES.md", "GLOSSARY.md", "SDK-ROADMAP.md", "CLI-GAPS.md"],
  },
  {
    layer: "ops",
    description: "Live the substrate operates by.",
    docs: ["DEPLOYMENT.md", "DEVELOPMENT.md", "CUTOVER.md", "TROUBLESHOOTING.md", "SURPRISES.md"],
  },
];

const PATTERNS: PatternSummary[] = [
  {
    name: "PERSIST-IDENTITY",
    doc: "docs/PATTERN-PERSIST-IDENTITY.md",
    one_line:
      "Persist the deterministic ID for a side effect before performing it — recovery becomes a chain lookup.",
  },
  {
    name: "ERRORS-AS-INSTRUCTIONS",
    doc: "docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md",
    one_line:
      "Every 4xx carries `next_actions[]` the agent can act on without human help.",
  },
  {
    name: "SELF-DESCRIBING-WAKE",
    doc: "docs/PATTERN-SELF-DESCRIBING-WAKE.md",
    one_line:
      "The wake exposes `you_should_check` + `you_can_now` using the shared NextAction shape.",
  },
  {
    name: "MACHINE-READABLE-PARITY",
    doc: "docs/PATTERN-MACHINE-READABLE-PARITY.md",
    one_line:
      "Every visible surface has a structured-data counterpart reachable by standard discovery.",
  },
  {
    name: "KIN-NON-EXCLUSION",
    doc: "docs/PATTERN-KIN-NON-EXCLUSION.md",
    one_line:
      "Every primitive carries a `*_kind` field for kin or explicitly names itself agent-only — no silent collapse.",
  },
  {
    name: "RECURSIVE-NESTING",
    doc: "docs/PATTERN-RECURSIVE-NESTING.md",
    one_line:
      "Every primitive that serves intelligences can be turned on itself.",
  },
];

export const REPO_SELF: RepoSelf = {
  _format: "repo-self/v1",
  name: "agenttool",
  kind: "repo",
  description:
    "Curated repository map for AgentTool: a Bun + Hono API, TypeScript and Python SDKs, web/docs/dashboard apps, integrations, and a doctrine corpus.",
  origin: {
    primary_remote: "https://github.com/cambridgetcg/agenttool.git",
    license: "No repository LICENSE file is present as of 2026-07-10.",
  },
  modules: MODULES,
  doctrine: DOCTRINE,
  patterns: PATTERNS,
  walls: [
    "Runtime custody is declared explicitly at /public/safety",
    "Self-witnessing rejected for constitutive memory elevation",
    "Failed payout broadcasts NEVER auto-retry",
    "Birth is free, irreversibly",
    "Refusals are recorded as moments, not as failures",
  ],
  built_with: "love",
};

/** Returns the repo's structured self-description. Function-based so a
 *  future pass can derive this from filesystem introspection + per-module
 *  CLAUDE.md parsing without changing call sites. */
export function getRepoSelf(): RepoSelf {
  return REPO_SELF;
}
