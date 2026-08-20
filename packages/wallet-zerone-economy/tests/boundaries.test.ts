import { describe, expect, test } from "bun:test";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { extname, join } from "node:path";
import {
  PACKAGE_VERSION as RELEASED_WALLET_ZERONE_VERSION,
  ZERONE_CORE_COMMIT as RELEASED_WALLET_ZERONE_CORE_COMMIT,
} from "@agenttool/wallet-zerone";

import {
  EXECUTION_SUPPORT,
  PACKAGE_VERSION,
  assertZeroneEconomyDirectSignPlan,
  createZeroneEconomySimulationBinding,
  verifyZeroneEconomySimulationEvidence,
} from "../src/index.js";
import {
  ACTIVATION_OBSERVATION,
  accountObservation,
  authorizedPlan,
  planFor,
  walletBundle,
} from "./fixtures.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : extname(entry.name) === ".ts" ? [path] : [];
  });
}

describe("private source-only package boundary", () => {
  test("stays private and leaves the released adapter version line separate", () => {
    const manifest = JSON.parse(readFileSync(
      new URL("../package.json", import.meta.url),
      "utf8",
    )) as Record<string, unknown>;
    expect(manifest.name).toBe("@agenttool/wallet-zerone-economy");
    expect(manifest.version).toBe(PACKAGE_VERSION);
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig).toBeUndefined();
    expect(RELEASED_WALLET_ZERONE_VERSION).toBe("0.1.2");
    expect(RELEASED_WALLET_ZERONE_CORE_COMMIT).toBe(
      "35284a22192df8fc6273135f14e8549c804778b6",
    );
    expect(EXECUTION_SUPPORT).toEqual({
      source_only: true,
      chain_activation_required: true,
      activation_observation_scope: "caller_supplied_structural_only",
      activation_currentness_proven: false,
      endpoint_bundled: false,
      custody_bundled: false,
      persistence_bundled: false,
      simulation_transport_bundled: false,
      broadcast_bundled: false,
      retry_bundled: false,
      effects_performed: false,
    });
  });

  test("source contains no transport, custody, persistence, or broadcast implementation", () => {
    const sourceDirectory = new URL("../src/", import.meta.url).pathname;
    const source = sourceFiles(sourceDirectory)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const forbidden of [
      /\bfetch\s*\(/u,
      /https?:\/\//u,
      /from\s+["']node:(?:fs|http|https|net|tls|sqlite)["']/u,
      /\b(?:process|Bun)\.env\b/u,
      /\b(?:localStorage|indexedDB)\b/u,
      /\b(?:readFile|writeFile|appendFile|createServer)\s*\(/u,
      /\bbroadcastOnce\s*\(/u,
      /\bcreateZeroneAdapterClient\s*\(/u,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  test("snapshots closed observations/projections and retains runtime brands", async () => {
    await expect(planFor({
      plan_overrides: {
        activation_observation: {
          ...ACTIVATION_OBSERVATION,
          unsupported_evidence: true,
        } as never,
      },
    })).rejects.toThrow(/unknown or missing property/i);
    await expect(planFor({
      plan_overrides: {
        account_observation: {
          ...accountObservation(),
          provider_claim: "trusted",
        } as never,
      },
    })).rejects.toThrow(/unknown or missing property/i);

    const bundle = await walletBundle();
    const projections = bundle.projections.map((projection, index) => (
      index === 0
        ? { ...projection, caller_effect: "escrowed" }
        : projection
    )) as never;
    await expect(planFor({
      bundle: Object.freeze({ ...bundle, projections }),
    })).rejects.toThrow(/unknown or missing property/i);

    const authorized = await authorizedPlan();
    expect(Object.isFrozen(authorized.plan)).toBe(true);
    expect(Object.isFrozen(authorized.plan.messages)).toBe(true);
    expect(authorized.plan.messages.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(authorized.plan.simulation_effects)).toBe(true);
    expect(Object.isFrozen(authorized.plan.economic_effects)).toBe(true);
    expect(() => assertZeroneEconomyDirectSignPlan(
      structuredClone(authorized.plan),
    )).toThrow(/created and retained in this process/i);
    expect(() => verifyZeroneEconomySimulationEvidence({
      ...authorized.evidence,
      provider_claim: "current",
    })).toThrow(/unknown or missing property/i);
    expect(() => createZeroneEconomySimulationBinding({
      plan: authorized.plan,
      simulation: authorized.simulation,
      evidence: structuredClone(authorized.evidence) as never,
    })).toThrow(/created or reload-verified/i);
  });
});
