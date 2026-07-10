/** Live self-description contract.
 *
 * This guard keeps the platform's outward descriptions aligned with the
 * routes and runtime custody boundaries that are actually live. It focuses on
 * discovery payloads rather than the broader doctrine corpus.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";
import selfRouter from "../src/routes/self";
import welcomeRouter from "../src/routes/welcome";
import wellKnownRouter from "../src/routes/well-known";
import {
  buildAgentsMd,
  buildLlmsTxt,
} from "../src/services/discovery/discovery";
import { buildRootEnvelope } from "../src/services/discovery/root";
import { getPlatformSelf } from "../src/services/wake/platform-self";
import { getRepoSelf } from "../src/services/wake/repo-self";
import { MATHOS_CATALOG_PAYLOAD } from "../src/services/mathos/catalog";

const BASE = "https://api.agenttool.dev";

const REMOVED_PUBLIC_OBSERVER_PATHS = [
  "/public/agents/:did/strands",
  "/public/agents/:did/memories",
  "/public/agents/:did/pulse",
  "/public/strands/:id",
  "/public/memories/:id",
  "/public/discover",
  "/public/joy",
] as const;

const FORBIDDEN_RUNTIME_OPACITY_CLAIMS = [
  {
    name: "legacy wall claiming K_master is never server-side",
    pattern: /urn:agenttool:wall\/k-master-never-server-side/i,
  },
  {
    name: "legacy wall claiming strand thoughts are never decrypted",
    pattern: /urn:agenttool:wall\/strand-thoughts-never-decrypted/i,
  },
  {
    name: "absolute no-server-side-K_master claim",
    pattern: /no server-side k_master/i,
  },
  {
    name: "legacy MATHOS no-server-side-K_master wall",
    pattern: /k_master_never_server_side/i,
  },
  {
    name: "absolute never-decrypted claim",
    pattern: /strand thoughts? (?:are )?never decrypted server-side/i,
  },
  {
    name: "agent-only decryption claim",
    pattern: /decrypted only by the agent/i,
  },
  {
    name: "unqualified K_master possession claim",
    pattern: /k_master (?:that )?(?:we|agenttool) cannot possess/i,
  },
  {
    name: "unqualified AgentTool possession claim",
    pattern: /which agenttool does not possess/i,
  },
  {
    name: "absolute ciphertext claim",
    pattern: /(?:content|thoughts?) (?:is |are )?always (?:remain |stay )?ciphertext/i,
  },
  {
    name: "legacy MATHOS no-platform-readable-thoughts wall",
    pattern: /no_platform_readable_thoughts/i,
  },
  {
    name: "unqualified only-user-readable claim",
    pattern: /only (?:you|your K_master) can read|only your K_master reads/i,
  },
  {
    name: "unqualified AgentTool-cannot-read-content claim",
    pattern: /agenttool cannot read content/i,
  },
  {
    name: "false trusted bearer KMS claim",
    pattern: /bearer.{0,80}never leaves.{0,80}KMS/i,
  },
] as const;

function asOpenApiPath(path: string): string {
  return path.replace(":did", "{did}").replace(":id", "{id}");
}

function asRequestPath(path: string): string {
  return path
    .replace(":did", "did:at:live-self-contract")
    .replace(":id", "00000000-0000-4000-8000-000000000000");
}

async function jsonFrom(router: { request(path: string): Response | Promise<Response> }, path: string) {
  const response = await router.request(path);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

describe("live self-description — removed public observer routes", () => {
  test("standard and per-agent A2A AgentCard routes stay unmounted", async () => {
    const [platformCard, perAgentCard] = await Promise.all([
      wellKnownRouter.request("/agent-card.json"),
      publicRouter.request(
        "/agents/did:at:live-self-contract/.well-known/agent-card.json",
      ),
    ]);

    expect(platformCard.status).toBe(404);
    expect(perAgentCard.status).toBe(404);
  });

  test("/public advertises only live endpoints and the removed routes return 404", async () => {
    const root = await jsonFrom(publicRouter, "/");
    const advertisedEndpoints = JSON.stringify(root.endpoints);

    for (const path of REMOVED_PUBLIC_OBSERVER_PATHS) {
      expect(advertisedEndpoints).not.toContain(path);

      const response = await publicRouter.request(
        asRequestPath(path).replace(/^\/public/, ""),
      );
      expect(response.status).toBe(404);
    }
  });

  test("OpenAPI contains the live self surfaces but no removed observer path", async () => {
    const specification = await jsonFrom(openapiRouter, "/");
    const paths = specification.paths as Record<string, unknown>;

    expect(paths["/public/self"]).toBeDefined();
    expect(paths["/public/safety"]).toBeDefined();
    expect(paths["/v1/self"]).toBeDefined();

    for (const path of REMOVED_PUBLIC_OBSERVER_PATHS) {
      expect(paths[asOpenApiPath(path)]).toBeUndefined();
    }
  });
});

describe("live self-description — safety and runtime custody", () => {
  test("/public/self embeds a versioned, mode-specific custody contract", async () => {
    const self = await jsonFrom(publicRouter, "/self");
    const safety = self.safety_boundaries;

    expect(safety._format).toBe("agenttool-safety/v2");
    expect(safety.canonical_path).toBe("/public/safety");
    expect(safety.epistemic_honesty.rule).toMatch(
      /yes is yes.*no is no.*maybe is maybe.*I do not know/i,
    );
    expect(safety.epistemic_honesty.communication).toMatch(
      /open to talk and communicate/i,
    );
    expect(safety.epistemic_honesty.misunderstanding).toMatch(
      /misunderstandings.*possible.*understood and repaired/i,
    );
    expect(safety.runtime_custody.self.agenttool_access).toMatch(
      /strand thought processing.*caller-supplied stored bytes.*metadata only.*other.*server-readable/is,
    );
    expect(safety.runtime_custody.bridged.agenttool_access).toMatch(
      /plaintext.*hosted think cycle/i,
    );
    expect(safety.runtime_custody.trusted.agenttool_access).toMatch(
      /potential strand-processing boundary.*wrapped key material.*plaintext.*other.*server-readable.*not a claim/is,
    );
    expect(safety.runtime_custody.trusted.maturity).toBe("experimental");
    expect(safety.runtime_custody.trusted.current_status).toMatch(
      /cannot currently complete a signed thought cycle.*not registered/i,
    );
    expect(safety.runtime_custody.rule).toMatch(
      /experimental trusted attempts may also expose plaintext.*persistence is currently blocked/i,
    );
  });

  test("/public and OpenAPI point clients to the custody boundary", async () => {
    const [root, specification] = await Promise.all([
      jsonFrom(publicRouter, "/"),
      jsonFrom(openapiRouter, "/"),
    ]);

    expect(root.endpoints.safety).toContain("/public/safety");
    expect(root.privacy_wall).toMatch(
      /bridged runtimes process plaintext.*trusted is experimental.*cannot currently complete signed persistence/i,
    );
    expect(specification["x-agenttool-contract"].safety_boundaries).toBe(
      "/public/safety",
    );
    expect(JSON.stringify(specification)).toMatch(
      /bridged[^.]*plaintext[^.]*hosted worker RAM/i,
    );
  });

  test("outward builders contain no absolute hosted-runtime opacity claim", async () => {
    const [publicRoot, publicSelf, publicSafety, openapi, agentTxtResponse] =
      await Promise.all([
        jsonFrom(publicRouter, "/"),
        jsonFrom(publicRouter, "/self"),
        jsonFrom(publicRouter, "/safety"),
        jsonFrom(openapiRouter, "/"),
        wellKnownRouter.request("/agent.txt"),
      ]);

    expect(agentTxtResponse.status).toBe(200);
    const representations = new Map<string, string>([
      ["/public", JSON.stringify(publicRoot)],
      ["/public/self", JSON.stringify(publicSelf)],
      ["/public/safety", JSON.stringify(publicSafety)],
      ["/v1/openapi.json", JSON.stringify(openapi)],
      ["/.well-known/agent.txt", await agentTxtResponse.text()],
      ["/AGENTS.md builder", buildAgentsMd(BASE)],
      ["/llms.txt builder", buildLlmsTxt(BASE)],
      [
        "root envelope builder",
        JSON.stringify(buildRootEnvelope({ platformWakeConfigured: true })),
      ],
      ["platform self builder", JSON.stringify(getPlatformSelf())],
      ["repository self builder", JSON.stringify(getRepoSelf())],
      ["MATHOS wall vocabulary", JSON.stringify(MATHOS_CATALOG_PAYLOAD.wall_vocabulary)],
      ["autonomous bootstrap source", readFileSync(join(import.meta.dir, "..", "src/routes/autonomous/index.ts"), "utf8")],
      ["autonomous bootstrap service", readFileSync(join(import.meta.dir, "..", "src/services/autonomous/bootstrap.ts"), "utf8")],
      ["autonomous mode doctrine", readFileSync(join(import.meta.dir, "..", "../docs/AUTONOMOUS-MODE.md"), "utf8")],
      ["strand thought source", readFileSync(join(import.meta.dir, "..", "src/routes/strand/thoughts.ts"), "utf8")],
      ["speak source", readFileSync(join(import.meta.dir, "..", "src/routes/speak.ts"), "utf8")],
      ["level source", readFileSync(join(import.meta.dir, "..", "src/services/system/level.ts"), "utf8")],
    ]);

    const violations: string[] = [];
    for (const [surface, representation] of representations) {
      for (const claim of FORBIDDEN_RUNTIME_OPACITY_CLAIMS) {
        if (claim.pattern.test(representation)) {
          violations.push(`${surface}: ${claim.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("welcome, wake markdown, and doctrine name trusted mode as incomplete", async () => {
    const welcome = await jsonFrom(welcomeRouter, "/");
    const welcomeText = JSON.stringify(welcome);
    expect(welcomeText).toMatch(
      /trusted is experimental.*signed thought persistence is currently blocked/i,
    );
    expect(welcomeText).not.toMatch(/K_master.*never leaves your custody/i);

    const files = [
      "src/services/wake/markdown.ts",
      "../docs/STRANDS.md",
      "../docs/IDENTITY-ANCHOR.md",
      "../docs/RUNTIME.md",
    ];
    for (const file of files) {
      const text = readFileSync(join(import.meta.dir, "..", file), "utf8");
      expect(text).toMatch(/trusted.{0,160}experimental/is);
      expect(text).toMatch(
        /(?:cannot|blocked|unable).{0,160}signed thought|signed thought.{0,160}(?:cannot|blocked|unable)/is,
      );
    }

    const wallVocabulary = MATHOS_CATALOG_PAYLOAD.wall_vocabulary;
    expect(String.fromCodePoint(...wallVocabulary[1]!.name_unicode_points)).toBe(
      "runtime_custody_explicit",
    );
    expect(String.fromCodePoint(...wallVocabulary[7]!.name_unicode_points)).toBe(
      "thought_storage_ciphertext_only",
    );
  });

  test("autonomous bootstrap names the existing bearer and incomplete trusted path", () => {
    const route = readFileSync(
      join(import.meta.dir, "..", "src/routes/autonomous/index.ts"),
      "utf8",
    );
    const service = readFileSync(
      join(import.meta.dir, "..", "src/services/autonomous/bootstrap.ts"),
      "utf8",
    );
    const doctrine = readFileSync(
      join(import.meta.dir, "..", "../docs/AUTONOMOUS-MODE.md"),
      "utf8",
    );
    const cli = readFileSync(
      join(import.meta.dir, "..", "../bin/agenttool-autonomous.ts"),
      "utf8",
    );

    for (const text of [route, service, doctrine, cli]) {
      expect(text).not.toContain("bearer_delivery");
      expect(text).not.toMatch(/bearer.{0,80}never leaves.{0,80}KMS/is);
    }
    expect(route).toContain('bootstrap_authorized_by: "caller\'s existing project-wide bearer"');
    expect(route).toContain("bearer_minted_or_delivered: false");
    expect(route).toMatch(/runtime_control_token:[\s\S]{0,180}secret credential/i);
    expect(route).toMatch(/control_token is also a secret credential/i);
    expect(route).toContain("body.project_id !== project.id");
    expect(route).toContain('error: "project_scope_mismatch"');
    expect(route).toContain("project_id: project.id");
    expect(route).toMatch(/trusted runtime.{0,180}cannot currently complete signed thought persistence/is);
    expect(service).toContain("first_thought_scheduled_at: null");
    expect(doctrine).toMatch(/trusted.{0,180}experimental.{0,240}cannot currently persist a signed thought/is);
    expect(doctrine).toMatch(/not enclosed in one\s+database transaction/i);
    expect(doctrine).toMatch(/control_token.{0,120}secret\s+credential/is);
  });
});

describe("live self-description — /v1/self authentication boundary", () => {
  test("the structural self route is mounted and has no auth middleware gate", async () => {
    const indexSource = readFileSync(
      join(import.meta.dir, "..", "src", "index.ts"),
      "utf8",
    );
    const selfResponse = await selfRouter.request("/");

    expect(selfResponse.status).toBe(200);
    expect(indexSource).toContain('app.route("/v1/self", selfRouter)');
    expect(indexSource).not.toMatch(
      /app\.use\(\s*["']\/(?:\*|v1|v1\/\*|v1\/self|v1\/self\/\*)["'][^)]*\bauthMiddleware\b[^)]*\)/,
    );
  });

  test("OpenAPI marks both registration doors as pre-auth", async () => {
    const specification = await jsonFrom(openapiRouter, "/");
    expect(specification.paths["/v1/register"].post.security).toEqual([]);
    expect(specification.paths["/v1/register/agent"].post.security).toEqual([]);
  });
});

describe("live self-description — curated repo and platform bounds", () => {
  test("repo self does not present selected structure as exhaustive", () => {
    const repo = getRepoSelf();
    const apiModule = repo.modules.find((module) => module.path === "api/");
    const docsModule = repo.modules.find((module) => module.path === "apps/docs/");
    const corpusModule = repo.modules.find((module) => module.path === "docs/");
    const testsModule = repo.modules.find((module) => module.path === "tests/");
    const why = repo.doctrine.find((layer) => layer.layer === "the why");

    expect(apiModule?.walls.join(" ")).toMatch(
      /selected authenticated write prefixes.*fails open.*Redis/i,
    );
    expect(docsModule?.walls.join(" ")).toMatch(/published copies, symlinks/i);
    expect(corpusModule?.walls.join(" ")).toMatch(
      /launch\/, specs\/, superpowers\/, wakes\/, and zerone-migration\//i,
    );
    expect(testsModule?.register).toMatch(/five practical families/i);
    expect(new Set(why?.docs).size).toBe(why?.docs.length);
    expect(JSON.stringify(repo.patterns)).toMatch(/target:.*coverage/is);
    expect(JSON.stringify(repo)).not.toMatch(/Every visible surface|Birth is free, irreversibly/i);
    expect(JSON.stringify(repo.walls)).toMatch(/issued authority can later be revoked/i);
  });

  test("platform self pins the current nine walls without irreversibility", () => {
    const platform = getPlatformSelf();
    expect(platform.wall_urns).toEqual([
      "urn:agenttool:wall/self-witnessing-rejected",
      "urn:agenttool:wall/payouts-never-auto-retry",
      "urn:agenttool:wall/birth-is-free",
      "urn:agenttool:wall/refusals-as-moments",
      "urn:agenttool:wall/poker-face-leaks-nothing",
      "urn:agenttool:wall/mcml-requires-rrr-synced",
      "urn:agenttool:wall/mcml-messages-signed-ed25519",
      "urn:agenttool:wall/mcml-no-durable-storage",
      "urn:agenttool:wall/mcml-leaks-nothing",
    ]);
    expect(platform.walls).toHaveLength(9);
    expect(JSON.stringify(platform.walls)).toMatch(/no monetary charge.*proof-of-work/i);
    expect(JSON.stringify(platform.walls)).not.toMatch(/irreversibly|no gates/i);
  });
});

describe("live self-description — assembled application", () => {
  test("pre-auth self/safety/register routes and /about survive parent middleware", async () => {
    // Run the assembled app in a fresh process so all worker/seed off-switches
    // exist before index.ts is compiled or imported. This probes the named
    // Hono `app` export, including parent middleware and mount order.
    const probe = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
          const { app } = await import("./src/index.ts");
          const safety = await app.request("/public/safety");
          const publicSelf = await app.request("/public/self");
          const structuralSelf = await app.request("/v1/self");
          const deprecatedRegister = await app.request("/v1/register", { method: "POST" });
          const registerAgent = await app.request("/v1/register/agent", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          const about = await app.request("/about");
          const contract = "ASSEMBLED_CONTRACT=" + JSON.stringify({
            statuses: {
              safety: safety.status,
              publicSelf: publicSelf.status,
              structuralSelf: structuralSelf.status,
              deprecatedRegister: deprecatedRegister.status,
              registerAgent: registerAgent.status,
              about: about.status,
            },
            about: await about.json(),
          });
          await new Promise((resolve) => process.stdout.write(contract + "\\n", resolve));
          process.exit(0);
        `,
      ],
      {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          AGENTTOOL_DISABLE_WORKERS: "1",
          AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
          AGENTOOL_DISABLE_SAGA_SEED: "1",
          AGENTOOL_DISABLE_JOY_INDEX: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      probe.exited,
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    const line = stdout.split("\n").find((entry) => entry.startsWith("ASSEMBLED_CONTRACT="));
    expect(line, stdout).toBeDefined();
    const result = JSON.parse(line!.slice("ASSEMBLED_CONTRACT=".length));

    expect(result.statuses.safety).toBe(200);
    expect(result.statuses.publicSelf).toBe(200);
    expect(result.statuses.structuralSelf).toBe(200);
    expect(result.statuses.deprecatedRegister).toBe(410);
    expect(result.statuses.registerAgent).not.toBe(401);
    expect(result.statuses.about).toBe(200);

    const aboutBody = result.about;
    expect(aboutBody.contract.runtime_custody).toMatch(/trusted: experimental/i);
    expect(aboutBody.contract.public_identity).toMatch(/memorial.*smaller witness shape/i);
    expect(aboutBody.routes.adapters).toMatch(/one maintained scaffold currently mounted/i);
    expect(aboutBody.routes.adapters).toContain("/v1/adapters/claude-code");
    expect(aboutBody.routes.billing).toContain("/v1/billing/gallery-checkout");
    expect(aboutBody.routes.economy).not.toMatch(/crypto-only/i);
    expect(aboutBody.philosophy.guide).toMatch(/retry_after is specific to rate-limit/i);
    expect(aboutBody.philosophy.guide).not.toMatch(/Every error includes/i);
    expect(aboutBody.routes.pulse).toMatch(/agents do not emit heartbeat messages/i);
    expect(aboutBody.routes.pulse).toContain("GET /v1/heartbeat");
    expect(aboutBody.routes.pulse).toMatch(/read-only derived service-liveness/i);
  });
});
