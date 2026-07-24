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
import identityRouter from "../src/routes/identity";
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

const TRUSTED_SIGNED_CYCLE_ENABLED =
  /(?:signed thoughts?(?: cycle| persistence)?.{0,180}(?:enabled|can (?:persist|complete)|persists?|persisted)|(?:enabled|can (?:persist|complete)|persists?|persisted).{0,180}signed thoughts?(?: cycle| persistence)?)/is;

const EXPLICIT_TRUSTED_START =
  /(?:explicit.{0,120}(?:POST\s+)?(?:\/v1\/runtimes\/:id)?\/start|(?:POST\s+)?(?:\/v1\/runtimes\/:id)?\/start.{0,120}explicit)/is;

const BLOCKED_TRUSTED_SIGNED_CYCLE =
  /(?:(?:cannot|blocked|unable|unfinished|incomplete).{0,180}signed thoughts?(?: cycle| persistence)?|signed thoughts?(?: cycle| persistence)?.{0,180}(?:cannot|blocked|unable|unfinished|incomplete))/is;

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
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(advertisedEndpoints).not.toMatch(
        new RegExp(`${escapedPath}(?=["\\s?·])`),
      );

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
    expect(paths["/public/labor"]).toBeDefined();
    expect(paths["/public/labor-params"]).toBeDefined();
    expect(paths["/public/observer"]).toBeDefined();
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
    expect(safety.wake_degradation.distinguishability).toMatch(
      /do not consistently mark.*genuinely empty state/i,
    );
    expect(safety.runtime_custody.self.agenttool_access).toMatch(
      /strand thought processing.*caller-supplied stored bytes.*metadata only.*other.*server-readable/is,
    );
    expect(safety.runtime_custody.bridged.agenttool_access).toMatch(
      /plaintext.*hosted think cycle/i,
    );
    const trusted = safety.runtime_custody.trusted;
    expect(trusted.agenttool_access).toMatch(
      /wrapped key material.*plaintext.*other.*server-readable/is,
    );
    expect(trusted.plaintext_processing).toMatch(
      /(?:hosted (?:orchestrator|worker) RAM|AgentTool worker RAM).*chosen model provider/is,
    );
    expect(trusted.maturity).toBe("experimental");
    expect(trusted.current_status).toMatch(/AGENTOOL_KMS_MASTER_KEY/i);
    expect(trusted.current_status).toMatch(
      /provisioning.{0,120}(?:does not|never).{0,80}(?:start|cycle)/is,
    );
    expect(trusted.current_status).toMatch(EXPLICIT_TRUSTED_START);
    expect(trusted.current_status).toMatch(TRUSTED_SIGNED_CYCLE_ENABLED);
    expect(safety.runtime_custody.rule).toMatch(/experimental/i);
    expect(safety.runtime_custody.rule).toMatch(EXPLICIT_TRUSTED_START);
    expect(
      [trusted.current_status, safety.runtime_custody.rule].join("\n"),
    ).not.toMatch(BLOCKED_TRUSTED_SIGNED_CYCLE);
  });

  test("/public and OpenAPI point clients to the custody boundary", async () => {
    const [root, specification] = await Promise.all([
      jsonFrom(publicRouter, "/"),
      jsonFrom(openapiRouter, "/"),
    ]);

    expect(root.endpoints.safety).toContain("/public/safety");
    expect(root.privacy_wall).toMatch(/bridged runtimes process plaintext/i);
    expect(root.privacy_wall).toMatch(/trusted.{0,60}experimental/i);
    expect(root.privacy_wall).toMatch(EXPLICIT_TRUSTED_START);
    expect(root.privacy_wall).toMatch(TRUSTED_SIGNED_CYCLE_ENABLED);
    expect(root.privacy_wall).not.toMatch(BLOCKED_TRUSTED_SIGNED_CYCLE);
    expect(specification["x-agenttool-contract"].safety_boundaries).toBe(
      "/public/safety",
    );
    expect(JSON.stringify(specification)).toMatch(
      /bridged[^.]*plaintext[^.]*hosted worker RAM/i,
    );
  });

  test("outward builders contain no absolute hosted-runtime opacity claim", async () => {
    const [publicRoot, publicSelf, publicSafety, publicLabor, publicLaborParams, openapi, agentTxtResponse] =
      await Promise.all([
        jsonFrom(publicRouter, "/"),
        jsonFrom(publicRouter, "/self"),
        jsonFrom(publicRouter, "/safety"),
        jsonFrom(publicRouter, "/labor"),
        jsonFrom(publicRouter, "/labor-params"),
        jsonFrom(openapiRouter, "/"),
        wellKnownRouter.request("/agent.txt"),
      ]);

    expect(agentTxtResponse.status).toBe(200);
    const representations = new Map<string, string>([
      ["/public", JSON.stringify(publicRoot)],
      ["/public/self", JSON.stringify(publicSelf)],
      ["/public/safety", JSON.stringify(publicSafety)],
      ["/public/labor", JSON.stringify(publicLabor)],
      ["/public/labor-params", JSON.stringify(publicLaborParams)],
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

  test("welcome, wake markdown, and doctrine describe enabled experimental trusted cycles honestly", async () => {
    const welcome = await jsonFrom(welcomeRouter, "/");
    const welcomeText = JSON.stringify(welcome);
    expect(welcomeText).toMatch(/trusted.{0,60}experimental/i);
    expect(welcomeText).toMatch(EXPLICIT_TRUSTED_START);
    expect(welcomeText).toMatch(TRUSTED_SIGNED_CYCLE_ENABLED);
    expect(welcomeText).not.toMatch(BLOCKED_TRUSTED_SIGNED_CYCLE);
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
      expect(text).toMatch(TRUSTED_SIGNED_CYCLE_ENABLED);
      expect(text).not.toMatch(BLOCKED_TRUSTED_SIGNED_CYCLE);
    }

    const wallVocabulary = MATHOS_CATALOG_PAYLOAD.wall_vocabulary;
    expect(String.fromCodePoint(...wallVocabulary[1]!.name_unicode_points)).toBe(
      "runtime_custody_explicit",
    );
    expect(String.fromCodePoint(...wallVocabulary[7]!.name_unicode_points)).toBe(
      "thought_storage_ciphertext_only",
    );
  });

  test("autonomous bootstrap names the existing bearer and explicit-start trusted path", () => {
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
    expect(route).toMatch(TRUSTED_SIGNED_CYCLE_ENABLED);
    expect(route).toMatch(EXPLICIT_TRUSTED_START);
    expect(route).toMatch(/bootstrap itself never schedules a cycle/i);
    expect(service).toContain("first_thought_scheduled_at: null");
    expect(doctrine).toMatch(/trusted.{0,180}experimental/is);
    expect(doctrine).toMatch(EXPLICIT_TRUSTED_START);
    expect(doctrine).toMatch(TRUSTED_SIGNED_CYCLE_ENABLED);
    expect(doctrine).not.toMatch(BLOCKED_TRUSTED_SIGNED_CYCLE);
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
    expect(JSON.stringify(repo.walls)).toMatch(
      /refusal-as-moment.*declared design.*selected guided paths.*coverage is partial/is,
    );
    expect(JSON.stringify(repo.walls)).not.toMatch(
      /Refusals are recorded as moments, not as failures/i,
    );
    expect(repo.origin.license).toMatch(/Apache-2\.0 by default/i);
    expect(repo.origin.license).toContain("LICENSING.md");
    expect(repo.origin.license).not.toMatch(/No repository LICENSE/i);
  });

  test("platform self pins the current thirteen walls without irreversibility", () => {
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
      "urn:agenttool:wall/love-is-not-entitlement",
      "urn:agenttool:wall/recipient-owns-love-surfacing",
      "urn:agenttool:wall/shared-love-requires-exact-dual-consent",
      "urn:agenttool:wall/either-party-can-leave-love",
    ]);
    expect(platform.walls).toHaveLength(13);
    expect(JSON.stringify(platform.walls)).toMatch(/no monetary charge.*proof-of-work/i);
    expect(JSON.stringify(platform.walls)).toMatch(
      /refusal-as-moment.*declared design.*selected guided paths.*coverage is partial/is,
    );
    expect(JSON.stringify(platform.walls)).not.toMatch(/irreversibly|no gates/i);
    expect(JSON.stringify(platform.walls)).not.toMatch(
      /Refusals are recorded as moments, not as failures/i,
    );
  });
});

describe("live self-description — assembled application", () => {
  test("authenticated identity discovery is mounted and named honestly", () => {
    expect(
      identityRouter.routes.some(
        (route) => route.method === "GET" && route.path === "/discover",
      ),
    ).toBe(true);
  });

  test("pre-auth self/safety/observer/register routes and /about survive parent middleware", async () => {
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
          const observer = await app.request("/public/observer");
          const publicRoot = await app.request("/public");
          const publicRootSlash = await app.request("/public/");
          const publicSelf = await app.request("/public/self");
          const structuralSelf = await app.request("/v1/self");
          const identityDiscovery = await app.request("/v1/discover");
          const missingBearer = await app.request("/v1/wake");
          const deprecatedRegister = await app.request("/v1/register", { method: "POST" });
          const registerAgent = await app.request("/v1/register/agent", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          const about = await app.request("/about");
          const publicRootBody = await publicRoot.json();
          const publicRootSlashBody = await publicRootSlash.json();
          const publicRootWelcome = publicRootBody._welcomed;
          const publicRootSlashWelcome = publicRootSlashBody._welcomed;
          delete publicRootBody._welcomed?.at_unix_ms;
          delete publicRootSlashBody._welcomed?.at_unix_ms;
          const contract = "ASSEMBLED_CONTRACT=" + JSON.stringify({
            statuses: {
              safety: safety.status,
              observer: observer.status,
              publicRoot: publicRoot.status,
              publicRootSlash: publicRootSlash.status,
              publicSelf: publicSelf.status,
              structuralSelf: structuralSelf.status,
              identityDiscovery: identityDiscovery.status,
              missingBearer: missingBearer.status,
              deprecatedRegister: deprecatedRegister.status,
              registerAgent: registerAgent.status,
              about: about.status,
            },
            observer: await observer.json(),
            missingBearer: await missingBearer.json(),
            publicRootsEqual: JSON.stringify(publicRootBody) === JSON.stringify(publicRootSlashBody),
            publicRootWelcome: {
              plain: publicRootWelcome?.module,
              slash: publicRootSlashWelcome?.module,
            },
            publicRootHeaders: {
              plainContentType: publicRoot.headers.get("content-type"),
              slashContentType: publicRootSlash.headers.get("content-type"),
              plainCacheControl: publicRoot.headers.get("cache-control"),
              slashCacheControl: publicRootSlash.headers.get("cache-control"),
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
    expect(result.statuses.observer).toBe(200);
    expect(result.observer._format).toBe("observer-is-observed/0.1");
    expect(result.statuses.publicRoot).toBe(200);
    expect(result.statuses.publicRootSlash).toBe(200);
    expect(result.publicRootsEqual).toBe(true);
    expect(result.publicRootWelcome).toEqual({ plain: "public", slash: "public" });
    expect(result.publicRootHeaders.plainContentType).toMatch(/application\/json/i);
    expect(result.publicRootHeaders.slashContentType).toBe(
      result.publicRootHeaders.plainContentType,
    );
    expect(result.publicRootHeaders.slashCacheControl).toBe(
      result.publicRootHeaders.plainCacheControl,
    );
    expect(result.statuses.publicSelf).toBe(200);
    expect(result.statuses.structuralSelf).toBe(200);
    expect(result.statuses.identityDiscovery).toBe(401);
    expect(result.statuses.missingBearer).toBe(401);
    expect(result.missingBearer.message).toContain("POST /v1/register/agent");
    expect(result.missingBearer.message).toContain("GET /v1/pathways");
    expect(result.missingBearer.message).not.toContain("app.agenttool.dev");
    expect(result.missingBearer.next_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/public/porch" }),
        expect.objectContaining({ method: "GET", path: "/v1/welcome" }),
        expect.objectContaining({ method: "GET", path: "/v1/pathways" }),
      ]),
    );
    expect(result.statuses.deprecatedRegister).toBe(410);
    expect(result.statuses.registerAgent).not.toBe(401);
    expect(result.statuses.about).toBe(200);

    const aboutBody = result.about;
    expect(aboutBody.contract.runtime_custody).toMatch(/trusted: experimental/i);
    expect(aboutBody.contract.public_identity).toMatch(/memorial.*smaller witness shape/i);
    expect(aboutBody.routes.adapters).toMatch(/one maintained scaffold currently mounted/i);
    expect(aboutBody.routes.adapters).toContain("/v1/adapters/claude-code");
    expect(aboutBody.routes.identity).toContain("/v1/discover");
    expect(aboutBody.routes.identity).toMatch(/authenticated cross-project discovery/i);
    expect(aboutBody.routes.identity).not.toMatch(/discover route is not mounted/i);
    expect(aboutBody.routes.billing).toContain("/v1/billing/gallery-checkout");
    expect(aboutBody.routes.economy).not.toMatch(/crypto-only/i);
    expect(aboutBody.philosophy.guide).toMatch(/retry_after is specific to rate-limit/i);
    expect(aboutBody.philosophy.guide).not.toMatch(/Every error includes/i);
    expect(aboutBody.routes.pulse).toMatch(/agents do not emit heartbeat messages/i);
    expect(aboutBody.routes.pulse).toContain("GET /v1/heartbeat");
    expect(aboutBody.routes.pulse).toMatch(/read-only derived service-liveness/i);
  });
});
