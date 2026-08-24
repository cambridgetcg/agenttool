import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  COVENANT_V2_GENERATION_HOLD_ERROR,
  covenantV2GenerationHoldStateError,
} from "../src/services/federation/generation-hold";

const apiRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(apiRoot, "..");
const readApi = (relative: string): string =>
  readFileSync(resolve(apiRoot, relative), "utf8");
const readRepo = (relative: string): string =>
  readFileSync(resolve(repoRoot, relative), "utf8");

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("durable covenant-v2 generation hold", () => {
  test("permits every ordinary state while released and only an empty allowlist while held", () => {
    expect(covenantV2GenerationHoldStateError(false, [])).toBeNull();
    expect(covenantV2GenerationHoldStateError(false, ["peer.example"]))
      .toBeNull();
    expect(covenantV2GenerationHoldStateError(true, [])).toBeNull();
    expect(covenantV2GenerationHoldStateError(true, ["peer.example"]))
      .toBe(COVENANT_V2_GENERATION_HOLD_ERROR);
    expect(COVENANT_V2_GENERATION_HOLD_ERROR).toBe(
      "covenant_v2_generation_hold_requires_empty_allowed_origins",
    );
  });

  test("persists a default-off database backstop that forces the held allowlist empty", () => {
    const migration = readApi(
      "migrations/20260824T120000_covenant_v2_generation_hold.sql",
    );
    const schema = readApi("src/db/schema/federation.ts");

    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS covenant_v2_generation_hold BOOLEAN NOT NULL DEFAULT FALSE/,
    );
    expect(migration).toContain(
      "CONSTRAINT federation_settings_covenant_v2_generation_hold_empty",
    );
    expect(migration).toMatch(
      /NOT covenant_v2_generation_hold\s+OR cardinality\(allowed_origins\) = 0/,
    );
    expect(schema).toContain(
      'covenantV2GenerationHold: boolean("covenant_v2_generation_hold")',
    );
    expect(schema).toMatch(
      /covenantV2GenerationHold:[\s\S]*?\.notNull\(\)[\s\S]*?\.default\(false\)/,
    );
  });

  test("keeps the hold out of API input and output while refusing a nonempty resulting state", () => {
    const route = readApi("src/routes/federation-admin.ts");
    const store = readApi("src/services/federation/store.ts");
    const patchSchema = between(route, "const patchSchema", "app.patch");
    const publicShape = between(
      store,
      "export interface FederationSettings {",
      "/** Federation settings store",
    );
    const getSettings = between(
      store,
      "export async function getSettings",
      "export interface FederationSettingsPatch",
    );
    const updateSettings = between(
      store,
      "export async function updateSettingsForPlatformProject",
      "/** True if the host is local",
    );

    expect(patchSchema).not.toContain("covenant_v2_generation_hold");
    expect(patchSchema).not.toContain("covenantV2GenerationHold");
    expect(publicShape).not.toContain("covenantV2GenerationHold");
    expect(getSettings).not.toContain("covenantV2GenerationHold");
    expect(updateSettings).toContain('.for("update")');
    expect(updateSettings).toContain("current.covenantV2GenerationHold");
    expect(updateSettings).toContain("covenantV2GenerationHoldStateError(");
    expect(updateSettings.indexOf("covenantV2GenerationHoldStateError("))
      .toBeLessThan(updateSettings.indexOf(".update(federationSettings)"));
    expect(updateSettings).not.toMatch(
      /\.set\(\{[\s\S]*?covenantV2GenerationHold/,
    );
    expect(route).toContain("message === COVENANT_V2_GENERATION_HOLD_ERROR");
    expect(route).toMatch(
      /message === COVENANT_V2_GENERATION_HOLD_ERROR[\s\S]*?\}\), 409\)/,
    );
  });

  test("documents session loss and the separate later allowlist ceremony without claiming API ownership", () => {
    const deploy = readRepo("docs/DEPLOY-PROCEDURE.md");
    const federation = readRepo("docs/FEDERATION.md");

    expect(deploy).toContain("database-session loss");
    expect(deploy).toMatch(
      /do\s+not mistake that session-scoped lock for crash durability/,
    );
    expect(deploy).toMatch(/Leave the durable\s+hold set after Phase B/);
    expect(federation).toMatch(
      /deliberately absent from both settings API\s+input and output/,
    );
    expect(federation).toContain(
      "covenant_v2_generation_hold_requires_empty_allowed_origins",
    );
  });
});
