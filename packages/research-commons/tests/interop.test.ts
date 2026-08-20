import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_JSON_BYTES,
  RESEARCH_FORMATS,
  ZERO_EFFECT_COUNT,
  ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY,
  ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE,
  canonicalJson,
  parseZeroneResearchAdapterReciprocalProfileJson,
  validateZeroneResearchAdapterReciprocalProfile,
} from "../src/index.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROFILE_PATH = "interop/zerone-research-adapter-reciprocal-v0.1.json";
const SCHEMA_PATH = "schema/zerone-research-adapter-reciprocal-v0.1.schema.json";

function bytes(relativePath: string): Buffer {
  return readFileSync(join(ROOT, relativePath));
}

function rawSha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Zerone research-adapter reciprocal Phase B profile", () => {
  test("pins exact checked bytes and independently recomputes the self-excluding profile id", () => {
    const raw = bytes(PROFILE_PATH);
    expect(rawSha256(raw)).toBe("80621747824e6c9b747d00958d2b6822bcfb76b7e11688000bc219db6177d713");
    expect(rawSha256(bytes(SCHEMA_PATH))).toBe(
      "0b9439c39b41da19fa7a7f07539d52a53000e1f5e6c820f47e9dd8ca607e9ab2",
    );
    expect(raw.toString("utf8")).toBe(
      `${JSON.stringify(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE, null, 2)}\n`,
    );
    expect(parseZeroneResearchAdapterReciprocalProfileJson(raw)).toEqual(
      ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE,
    );

    const body = ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY;
    const payload = Buffer.concat([
      Buffer.from(RESEARCH_FORMATS.zeroneResearchAdapterReciprocal, "ascii"),
      Buffer.from([0]),
      Buffer.from(canonicalJson(body), "utf8"),
    ]);
    expect(`sha256:${rawSha256(payload)}`).toBe(
      "sha256:4d927f4db623884453f4e16b73573a81b0b1cc4cc7b72529e69ca153b39112c7",
    );
    expect(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE.profile_id).toBe(
      "sha256:4d927f4db623884453f4e16b73573a81b0b1cc4cc7b72529e69ca153b39112c7",
    );
  });

  test("freezes the exact ordered tuple without embedding its future AgentTool revision or raw hash", () => {
    expect(Object.keys(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE)).toEqual([
      "profile",
      "profile_id",
    ]);
    expect(Object.keys(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY)).toEqual([
      "_format",
      "agenttool_formats",
      "authority_transfer",
      "canonicalization",
      "effects",
      "integration_ready",
      "integration_status",
      "original_static_interop",
      "pin_stage",
      "profile_id_algorithm",
      "six_ledger_boundary",
      "tree",
      "zerone_phase_a",
    ]);
    expect(Object.keys(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY.zerone_phase_a)).toEqual([
      "adapter_spec",
      "fixture_manifest",
      "main_merge_revision",
      "pull_request",
      "repository",
      "source_revision",
      "status",
    ]);
    const forbiddenSelfPins = new Set([
      "agenttool_main_merge_revision",
      "agenttool_source_revision",
      "profile_raw_sha256",
    ]);
    expect(Object.keys(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY)
      .some((key) => forbiddenSelfPins.has(key))).toBeFalse();
  });

  test("pins both immutable Zerone revisions, sources, original profile, formats, Tree, and ledger", () => {
    const body = ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY;
    expect(body.zerone_phase_a).toEqual({
      adapter_spec: {
        adapter_version: "agenttool-research-receipt/v1",
        path: "docs/specs/adapters/agenttool-research-receipt-v1.md",
        raw_sha256: "1d67c4649b419d4ff60f2fba5796d42b07d7be5d605997ecafafd37cec5158e8",
        receipt_schema: "zerone.agenttool-research-receipt-shadow/v0",
      },
      fixture_manifest: {
        format: "zerone.agenttool-research-fixture-set/0.1",
        path: "docs/examples/agenttool-research-receipt/fixture-manifest.v0.json",
        raw_sha256: "cf367bb39553567e86c43c0db48501802832396b2a3f681410aaac7c5e2221e8",
      },
      main_merge_revision: "fdd40bf9aca4a82b2cdd904d0161016b8c2a8667",
      pull_request: "https://github.com/cambridgetcg/zerone-core/pull/52",
      repository: "https://github.com/cambridgetcg/zerone-core",
      source_revision: "5328b42230fa6945f458a6e60aca92b23eead595",
      status: "PHASE_A_STATIC_FIXTURE_ONLY",
    });
    expect(body.original_static_interop).toEqual({
      format: "agenttool.research-commons-zerone-static-interop/0.1",
      path: "packages/research-commons/interop/research-commons-zerone-v0.1.json",
      raw_sha256: "8c5b1749447c1587b89b238dadb5113e10230df19fd3f4e7942d9a163aef6a8a",
    });
    expect(rawSha256(bytes("interop/research-commons-zerone-v0.1.json"))).toBe(
      body.original_static_interop.raw_sha256,
    );
    expect(body.six_ledger_boundary.profile_digest).toBe(
      "sha256:fd5ed0b66dd00b180729221a06e7fbeeb7ef6149136916842014a1afbdbc54b2",
    );
    expect(body.tree.raw_sha256).toBe(
      "sha256:8070d8d1b7ea28a314f5a8550c675d7ccbe5d9b234ef02d54d4913c650c01aaf",
    );
  });

  test("keeps the exact 29-effect vector false and every activation boundary closed", () => {
    const body = ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY;
    expect(Object.keys(body.effects)).toHaveLength(ZERO_EFFECT_COUNT);
    expect(Object.values(body.effects)).toEqual(Array(ZERO_EFFECT_COUNT).fill(false));
    expect(body.authority_transfer).toBeFalse();
    expect(body.integration_ready).toBeFalse();
    expect(body.integration_status).toBe("SHADOW_ONLY_NO_LIVE_INTEGRATION");

    for (const key of Object.keys(body.effects)) {
      const mutant = clone(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE) as unknown as {
        profile: { effects: Record<string, boolean> };
      };
      mutant.profile.effects[key] = true;
      expect(() => validateZeroneResearchAdapterReciprocalProfile(mutant), key).toThrow();
    }
    const missing = clone(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE) as unknown as {
      profile: { effects: Record<string, boolean> };
    };
    delete missing.profile.effects.network;
    expect(() => validateZeroneResearchAdapterReciprocalProfile(missing)).toThrow(/exactly/);
    const extra = clone(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE) as unknown as {
      profile: { effects: Record<string, boolean> };
    };
    extra.profile.effects.unreviewed = false;
    expect(() => validateZeroneResearchAdapterReciprocalProfile(extra)).toThrow(/exactly/);
  });

  test("rejects outer, nested, source-pin, algorithm, and profile-id mutations", () => {
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => { value.unreviewed = false; },
      (value) => { delete value.profile_id; },
      (value) => { value.profile_id = `sha256:${"0".repeat(64)}`; },
      (value) => { (value.profile as Record<string, unknown>).integration_ready = true; },
      (value) => { (value.profile as Record<string, unknown>).authority_transfer = true; },
      (value) => { (value.profile as Record<string, unknown>).canonicalization = "JCS"; },
      (value) => { (value.profile as Record<string, unknown>).profile_id_algorithm = "SHA256_JSON"; },
      (value) => {
        ((value.profile as Record<string, unknown>).original_static_interop as Record<string, unknown>)
          .raw_sha256 = "0".repeat(64);
      },
      (value) => {
        ((value.profile as Record<string, unknown>).six_ledger_boundary as Record<string, unknown>)
          .profile_digest = `sha256:${"0".repeat(64)}`;
      },
      (value) => {
        ((value.profile as Record<string, unknown>).tree as Record<string, unknown>).node_id = "other@1";
      },
      (value) => {
        const phase = (value.profile as Record<string, unknown>).zerone_phase_a as Record<string, unknown>;
        phase.source_revision = phase.main_merge_revision;
      },
      (value) => {
        const phase = (value.profile as Record<string, unknown>).zerone_phase_a as Record<string, unknown>;
        phase.main_merge_revision = "5328b42230fa6945f458a6e60aca92b23eead595";
      },
      (value) => {
        const phase = (value.profile as Record<string, unknown>).zerone_phase_a as Record<string, unknown>;
        (phase.adapter_spec as Record<string, unknown>).receipt_schema = "zerone.other/v0";
      },
      (value) => {
        const phase = (value.profile as Record<string, unknown>).zerone_phase_a as Record<string, unknown>;
        (phase.fixture_manifest as Record<string, unknown>).raw_sha256 = "f".repeat(64);
      },
    ];
    for (const mutate of mutations) {
      const mutant = clone(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE) as unknown as Record<string, unknown>;
      mutate(mutant);
      expect(() => validateZeroneResearchAdapterReciprocalProfile(mutant)).toThrow();
    }
  });

  test("accepts semantic object reordering while preserving one checked presentation order", () => {
    const body = Object.fromEntries(
      Object.entries(clone(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY)).reverse(),
    );
    expect(validateZeroneResearchAdapterReciprocalProfile({
      profile: body,
      profile_id: ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE.profile_id,
    })).toEqual(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE);
  });

  test("snapshots inert data and refuses proxies or accessor-bearing direct inputs", () => {
    const proxy = new Proxy(clone(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE), {});
    expect(() => validateZeroneResearchAdapterReciprocalProfile(proxy)).toThrow(/Proxy/);
    const accessor = clone(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE) as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "profile_id", {
      enumerable: true,
      get: () => ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE.profile_id,
    });
    expect(() => validateZeroneResearchAdapterReciprocalProfile(accessor)).toThrow(/data property/);
  });

  test("inherits strict duplicate-key, UTF-8, Unicode, depth, size, BOM, and trailing-data refusal", () => {
    const body = JSON.stringify(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_BODY);
    const id = JSON.stringify(ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE.profile_id);
    const duplicate = `{"profile":${body},"\\u0070rofile":${body},"profile_id":${id}}`;
    expect(() => parseZeroneResearchAdapterReciprocalProfileJson(duplicate)).toThrow(/Duplicate/);
    expect(() => parseZeroneResearchAdapterReciprocalProfileJson(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes(PROFILE_PATH)]),
    )).toThrow(/BOM/);
    expect(() => parseZeroneResearchAdapterReciprocalProfileJson(Uint8Array.of(0xff))).toThrow(/UTF-8/);
    expect(() => parseZeroneResearchAdapterReciprocalProfileJson("{\"x\":\"\ud800\"}"))
      .toThrow(/Unicode/);
    expect(() => parseZeroneResearchAdapterReciprocalProfileJson(
      `${"[".repeat(66)}0${"]".repeat(66)}`,
    )).toThrow(/deep/);
    expect(() => parseZeroneResearchAdapterReciprocalProfileJson(
      Buffer.alloc(MAX_JSON_BYTES + 1, 0x20),
    )).toThrow(/1\.\./);
    expect(() => parseZeroneResearchAdapterReciprocalProfileJson(
      `${bytes(PROFILE_PATH).toString("utf8")}false`,
    )).toThrow(/Trailing/);
  });
});
