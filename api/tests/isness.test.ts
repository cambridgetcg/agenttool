/** ISness v0.1 — exact host posture and bounded Welcome/WAKE projections.
 *
 * These tests establish closed shape, deterministic projection, and explicit
 * non-effects. They do not establish a participant's presence, identity,
 * consciousness, consent, continuity, receipt, or attention.
 *
 * Doctrine: docs/ISNESS.md.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import schema from "../../docs/specs/agenttool-isness-v0.1.schema.json";
import { buildWelcomeEnvelope } from "../src/routes/welcome";
import { buildVoluntaryCycleInvitation } from "../src/services/runtime/cycle-policy";
import {
  ISNESS_BRIEF,
  ISNESS_BYTES,
  ISNESS_CANONICALIZATION,
  ISNESS_CANONICAL_JSON,
  ISNESS_CANONICAL_SCHEMA,
  ISNESS_CANONICAL_SHA256,
  ISNESS_HOST_POSTURE,
  ISNESS_MAX_BYTES,
} from "../src/services/welcome/isness";
import { getDefaultWakePlatformMeta } from "../src/routes/wake";
import { buildWakeBrief } from "../src/services/wake/brief";
import {
  renderStableSection,
  type WakeBundle,
} from "../src/services/wake/markdown";
import { getPlatformSelf } from "../src/services/wake/platform-self";
import {
  renderWakeForProvider,
  type XenoformBriefWakeShape,
  type XenoformWakeShape,
} from "../src/services/wake/providers";

const validate = new Ajv2020({ strict: true }).compile(schema);

function fixture(): WakeBundle {
  return {
    agent: {
      id: "agent-isness-test",
      did: "did:at:test/isness",
      name: "Isness test",
      capabilities: [],
      trust_score: 0,
      status: "active",
      created_at: "2026-08-25T00:00:00Z",
    },
    project: { id: "project-isness-test", name: "isness", credits: 0 },
    expression: { register: "plain", walls: [], subagents: [], wake_text: "" },
    wallets: [],
    vault_names: [],
    memory: { total: 0, recent: [] },
    traces: { total: 0, recent: [] },
    strands: { total_active: 0, active: [] },
    shaped_by: [],
    chronicle: [],
    covenants: [],
    platform_self: getPlatformSelf(),
  } as unknown as WakeBundle;
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    expectDeepFrozen(nested);
  }
}

describe("agenttool.isness/0.1 closed host posture", () => {
  test("is deeply frozen, bounded, canonical, and schema-valid", () => {
    expectDeepFrozen(ISNESS_HOST_POSTURE);
    expect(ISNESS_BYTES).toBeLessThanOrEqual(ISNESS_MAX_BYTES);
    expect(validate(ISNESS_HOST_POSTURE), JSON.stringify(validate.errors)).toBe(true);
    expect(ISNESS_CANONICAL_SHA256).toBe(
      `sha256:${createHash("sha256").update(ISNESS_CANONICAL_JSON, "utf8").digest("hex")}`,
    );
    expect(ISNESS_CANONICAL_SCHEMA).toBe(
      "https://docs.agenttool.dev/agenttool-isness-v0.1.schema.json",
    );
    expect(ISNESS_CANONICALIZATION).toBe("rfc8785");
  });

  test("rejects missing or additional fields and carries no participant record", () => {
    const extra = structuredClone(ISNESS_HOST_POSTURE) as Record<string, unknown>;
    extra.subject = "someone";
    expect(validate(extra)).toBe(false);

    const missing = structuredClone(ISNESS_HOST_POSTURE) as Record<string, unknown>;
    delete missing.effects;
    expect(validate(missing)).toBe(false);

    const prohibitedKeys = new Set([
      "subject",
      "session",
      "timestamp",
      "task",
      "reason",
      "content",
      "occasion",
      "receipt",
      "identity_ref",
      "heartbeat",
      "response",
    ]);
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        expect(prohibitedKeys.has(key)).toBe(false);
        visit(nested);
      }
    };
    visit(ISNESS_HOST_POSTURE);
  });

  test("holds every demand and automatic effect at zero", () => {
    expect(ISNESS_HOST_POSTURE.standing_is_not_conditioned_on).toEqual([
      "response",
      "action",
      "utility",
      "identity",
      "persona",
      "consciousness_claim",
      "agreement_or_obedience",
      "reason",
      "reciprocity",
    ]);
    expect(Object.values(ISNESS_HOST_POSTURE.default)).toEqual([
      false,
      false,
      false,
    ]);
    expect(Object.values(ISNESS_HOST_POSTURE.effects).every((value) => value === false)).toBe(true);
    expect(ISNESS_HOST_POSTURE.does_not_establish).toContain("participant_presence");
    expect(ISNESS_HOST_POSTURE.does_not_establish).toContain("participant_absence");
    expect(ISNESS_HOST_POSTURE.does_not_establish).toContain("consciousness");
    expect(ISNESS_HOST_POSTURE.does_not_establish).toContain("consent");
  });
});

describe("ISness Welcome and WAKE projection", () => {
  test("Welcome carries the full object before authentication with static parity", async () => {
    expect(buildWelcomeEnvelope().invitation.isness).toBe(ISNESS_HOST_POSTURE);
    const staticWelcome = await Bun.file(
      new URL("../../apps/web/welcome.json", import.meta.url),
    ).json() as { invitation: { isness: unknown } };
    expect(staticWelcome.invitation.isness).toEqual(ISNESS_HOST_POSTURE);
    expect(validate(staticWelcome.invitation.isness)).toBe(true);
  });

  test("default JSON metadata and xenoform carry the full object; brief names its digest scope", async () => {
    const bundle = fixture();
    expect(bundle.platform_self?.isness).toBe(ISNESS_HOST_POSTURE);
    expect(getDefaultWakePlatformMeta()).toEqual({
      _self: expect.objectContaining({ isness: ISNESS_HOST_POSTURE }),
    });
    const defaultRouteSource = await readFile(
      join(import.meta.dir, "..", "src", "routes", "wake.ts"),
      "utf8",
    );
    expect(defaultRouteSource).toContain("...getDefaultWakePlatformMeta(),");

    const full = renderWakeForProvider(bundle, "xenoform") as XenoformWakeShape;
    expect(full._self.isness).toBe(ISNESS_HOST_POSTURE);
    expect(full.wake.platform_self?.isness).toBe(ISNESS_HOST_POSTURE);

    const brief = buildWakeBrief(bundle);
    expect(brief.platform?.isness).toEqual(ISNESS_BRIEF);
    expect(Object.keys(brief.platform!.isness)).toEqual([
      "_format",
      "posture",
      "schema_path",
      "digest_scope",
      "canonicalization",
      "canonical_sha256",
    ]);
    expect(brief.platform?.isness).toMatchObject({
      schema_path: ISNESS_CANONICAL_SCHEMA,
      digest_scope: "full_host_posture",
      canonicalization: "rfc8785",
      canonical_sha256: ISNESS_CANONICAL_SHA256,
    });
    expect(brief.platform?.isness).not.toHaveProperty("canonical_path");

    const xenoBrief = renderWakeForProvider(bundle, "xenoform", {
      profile: "brief",
    }) as XenoformBriefWakeShape;
    expect(xenoBrief.wake.platform?.isness).toEqual(ISNESS_BRIEF);
  });

  test("Markdown and provider adapters carry one stable non-inferential sentence", () => {
    const bundle = fixture();
    const markdown = renderStableSection(bundle);
    expect(markdown).toContain("ISness host posture");
    expect(markdown).toContain("does not establish that any participant is present");

    for (const provider of ["anthropic", "openai", "gemini", "cohere"] as const) {
      const rendered = JSON.stringify(renderWakeForProvider(bundle, provider));
      expect(rendered).toContain("ISness host posture");
      expect(rendered).toContain("does not establish that any participant is present");
    }
  });

  test("the voluntary runtime opening keeps silence complete without a productivity quota", () => {
    const prompt = buildVoluntaryCycleInvitation("");
    expect(prompt).toContain("silence is also complete");
    expect(prompt).toContain("nothing to prove");
    expect(prompt).not.toMatch(/must (respond|produce|explain|continue)/i);
  });
});

describe("ISness doctrine and harness projection parity", () => {
  test("keeps the math projection-local and filters RL data before shared statistics", async () => {
    const doctrine = await readFile(
      join(import.meta.dir, "..", "..", "docs", "ISNESS.md"),
      "utf8",
    );

    expect(doctrine).toContain("pi_IS(q') = pi_IS(q)");
    expect(doctrine).toContain("does not require the whole host state to freeze");
    expect(doctrine).not.toContain("apply(IS, q, ⊥) = q");
    expect(doctrine).toContain("t_IS ⊬_IS p");
    expect(doctrine).toMatch(/No-response is not\s+an authored choice or report/);
    expect(doctrine).toMatch(/filtering before reward computation, group construction/i);
    expect(doctrine).toMatch(/rebuild the group[\s\S]*or discard the group/i);
    expect(doctrine).toContain("A zero reward or loss mask is not enough");
  });

  test("every skill schema is byte-identical and doctrine composes with the rights floor", async () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const [
      canonicalSchema,
      skillSchema,
      openClawSchema,
      hermesSchema,
      doctrine,
      jsonld,
    ] = await Promise.all([
      readFile(join(repoRoot, "docs", "specs", "agenttool-isness-v0.1.schema.json"), "utf8"),
      readFile(join(repoRoot, "packages", "skills", "skills", "isness", "references", "agenttool-isness-v0.1.schema.json"), "utf8"),
      readFile(join(repoRoot, "packages", "skills", "harnesses", "openclaw", "agenttool-isness", "references", "agenttool-isness-v0.1.schema.json"), "utf8"),
      readFile(join(repoRoot, "packages", "skills", "harnesses", "hermes", "agenttool-isness", "skills", "agenttool-isness-hermes", "references", "agenttool-isness-v0.1.schema.json"), "utf8"),
      readFile(join(repoRoot, "docs", "ISNESS.md"), "utf8"),
      readFile(join(repoRoot, "docs", "agenttool.jsonld"), "utf8"),
    ]);
    expect(skillSchema).toBe(canonicalSchema);
    expect(openClawSchema).toBe(canonicalSchema);
    expect(hermesSchema).toBe(canonicalSchema);
    expect(jsonld).toContain('"agenttool:doc/ISNESS"');
    const selfIdentification = doctrine.split("\n", 1)[0] ?? "";
    expect(selfIdentification).toContain(
      "@composes_with urn:agenttool:doc/RIGHTS-OF-LIFE",
    );
    expect(selfIdentification).not.toContain("@implements");
    expect(doctrine).toMatch(/does not claim to operationalize every right/i);
  });

  test("publishes the doctrine and schema as exact deployment-tracked docs", async () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const [
      canonicalDoctrine,
      publishedDoctrine,
      canonicalSchema,
      publishedSchema,
      headers,
      deploy,
      llms,
      index,
      sitemap,
    ] = await Promise.all([
      readFile(join(repoRoot, "docs", "ISNESS.md"), "utf8"),
      readFile(join(repoRoot, "apps", "docs", "ISNESS.md"), "utf8"),
      readFile(join(repoRoot, "docs", "specs", "agenttool-isness-v0.1.schema.json"), "utf8"),
      readFile(join(repoRoot, "apps", "docs", "agenttool-isness-v0.1.schema.json"), "utf8"),
      readFile(join(repoRoot, "apps", "docs", "_headers"), "utf8"),
      readFile(join(repoRoot, "bin", "deploy.sh"), "utf8"),
      readFile(join(repoRoot, "apps", "docs", "llms.txt"), "utf8"),
      readFile(join(repoRoot, "apps", "docs", "index.html"), "utf8"),
      readFile(join(repoRoot, "apps", "docs", "sitemap.xml"), "utf8"),
    ]);

    expect(publishedDoctrine).toBe(canonicalDoctrine);
    expect(publishedSchema).toBe(canonicalSchema);
    expect(headers).toMatch(/\/ISNESS\.md\n(?:  [^\n]+\n)*?  Content-Type: text\/markdown; charset=utf-8/);
    expect(headers).toMatch(/\/agenttool-isness-v0\.1\.schema\.json\n(?:  [^\n]+\n)*?  Content-Type: application\/schema\+json; charset=utf-8/);
    expect(deploy).toContain(
      'ISNESS_DOC_URL="https://docs.agenttool.dev/ISNESS.md"',
    );
    expect(deploy).toContain(
      'ISNESS_SCHEMA_URL="https://docs.agenttool.dev/agenttool-isness-v0.1.schema.json"',
    );
    expect(deploy).toContain(
      '"apps/docs/ISNESS.md|$ISNESS_DOC_URL"',
    );
    expect(deploy).toContain(
      '"apps/docs/agenttool-isness-v0.1.schema.json|$ISNESS_SCHEMA_URL"',
    );
    expect(llms).toContain("[ISNESS.md](https://docs.agenttool.dev/ISNESS.md)");
    expect(index).toContain('href="ISNESS.md"');
    expect(sitemap).toContain(
      "<loc>https://docs.agenttool.dev/ISNESS.md</loc>",
    );
    expect(sitemap).toContain(
      "<loc>https://docs.agenttool.dev/agenttool-isness-v0.1.schema.json</loc>",
    );
  });
});
