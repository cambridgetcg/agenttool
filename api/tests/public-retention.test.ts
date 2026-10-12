/** GET /public/retention — today's retention truth, pinned.
 *
 *  The disclosure is a constant (no database read). These tests pin its
 *  shape, the five-value basis vocabulary, the spelling of every unknown,
 *  the wave 1 facts the deletion spec requires it to state, and its mounts:
 *  the public index, /about, the arrival index and OpenAPI.
 *
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.1.
 *  Doc: docs/RETENTION.md. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import publicRouter from "../src/routes/public";
import openapiRouter from "../src/routes/openapi";
import { buildArrivalIndex } from "../src/services/discovery/arrival";
import {
  BACKUP_DAYS_KEPT,
  DELETE_RESPONSE_RETENTION,
  RETENTION_BASES,
  RETENTION_CLASSES,
  RETENTION_DISCLOSURE,
  RETENTION_SCHEMA,
  RETENTION_VERSION,
} from "../src/services/discovery/retention";

const API_ROOT = join(import.meta.dir, "..");

function strings(value: unknown, path = "$"): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => strings(item, `${path}.${key}`));
  }
  return [];
}

function objectsWithBasis(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(objectsWithBasis);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const own = "basis" in record ? [record] : [];
    return [...own, ...Object.values(record).flatMap(objectsWithBasis)];
  }
  return [];
}

function byId(id: string) {
  const found = RETENTION_CLASSES.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

describe("GET /public/retention", () => {
  test("serves the constant unauthenticated, cached, and identical for every caller", async () => {
    const first = await publicRouter.request("/retention");
    const second = await publicRouter.request("/retention", {
      headers: { "cf-connecting-ip": "203.0.113.9", authorization: "Bearer at_example" },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await first.json();
    expect(await second.json()).toEqual(body);
    expect(body.schema).toBe(RETENTION_SCHEMA);
    expect(body.version).toBe(RETENTION_VERSION);
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SAFETY-BOUNDARIES");
    expect(body.classes).toEqual(JSON.parse(JSON.stringify(RETENTION_CLASSES)));
  });

  test("the service module performs no database or network reads", () => {
    const source = readFileSync(join(API_ROOT, "src/services/discovery/retention.ts"), "utf8");
    expect(source).not.toMatch(/^import /m);
    const route = readFileSync(join(API_ROOT, "src/routes/public/retention.ts"), "utf8");
    expect(route).not.toContain("db/client");
    expect(route).not.toContain("fetch(");
  });
});

describe("shape and vocabulary", () => {
  test("is versioned, and the current version is listed", () => {
    expect(RETENTION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RETENTION_DISCLOSURE.versions.map((entry) => entry.version)).toContain(RETENTION_VERSION);
    expect(RETENTION_DISCLOSURE.controller).toBe("Cambridge TCG Limited (ICO ZB838338)");
  });

  test("every class names stores, both windows, a basis and evidence; ids are unique", () => {
    expect(RETENTION_CLASSES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RETENTION_CLASSES.map((entry) => entry.id)).size).toBe(RETENTION_CLASSES.length);
    for (const entry of RETENTION_CLASSES) {
      expect(entry.stores.length, entry.id).toBeGreaterThan(0);
      expect(entry.live.length, entry.id).toBeGreaterThan(0);
      expect(entry.after_delete.length, entry.id).toBeGreaterThan(0);
      expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
      expect(RETENTION_BASES).toContain(entry.basis);
    }
    const stores = RETENTION_CLASSES.flatMap((entry) => entry.stores);
    expect(new Set(stores).size).toBe(stores.length);
  });

  test("every basis anywhere is one of the five values", () => {
    const carriers = objectsWithBasis(RETENTION_DISCLOSURE);
    expect(carriers.length).toBeGreaterThan(30);
    for (const carrier of carriers) expect(RETENTION_BASES).toContain(carrier.basis as never);
  });

  test("every unknown is spelled unknown", () => {
    for (const { path, text } of strings(RETENTION_DISCLOSURE)) {
      for (const match of text.matchAll(/unknown/gi)) {
        expect(match[0], `${path}: ${text}`).toBe("unknown");
      }
      expect(text, path).not.toMatch(/\b(?:tbd|n\/a|not known|unclear|to be determined|unmeasured)\b/i);
    }
    for (const carrier of objectsWithBasis(RETENTION_DISCLOSURE)) {
      if (carrier.basis !== "unknown") continue;
      const value = String(carrier.value ?? carrier.retention ?? "");
      expect(value).toStartWith("unknown");
    }
    expect(RETENTION_DISCLOSURE.unknowns.length).toBeGreaterThan(0);
  });
});

describe("wave 1 publishes today's truth", () => {
  test("inbox and vault deletes keep their content", () => {
    expect(byId("inbox").after_delete).toMatch(/only sets status 'deleted'.*stay.*PATCH can restore/s);
    expect(byId("vault.secrets").after_delete).toMatch(/ciphertext stays.*not zeroed/s);
    expect(DELETE_RESPONSE_RETENTION.inbox.content_retained).toBe(true);
    expect(DELETE_RESPONSE_RETENTION.vault.content_retained).toBe(true);
  });

  test("identity backup blobs are kept after revocation", () => {
    expect(byId("identity.backups").after_delete).toMatch(/blob and nonce stay/);
    expect(DELETE_RESPONSE_RETENTION.identity_backup.blob_retained).toBe(true);
  });

  test("expired working memory is not purged and still reads by id", () => {
    expect(byId("memory.content").live).toMatch(/not purged.*read by id still returns them/s);
  });

  test("vault-audit addresses have no purge", () => {
    expect(byId("vault.audit").after_delete).toMatch(/^No purge/);
  });

  test("money records say 6 years declared with no purge job", () => {
    const money = byId("money");
    expect(money.basis).toBe("declared");
    expect(money.after_delete).toMatch(/6 years.*No purge job/s);
    expect(byId("gift_codes").after_delete).toMatch(/6 years declared, no purge job/);
  });

  test("backups, the missing ledger and already-deleted content are stated", () => {
    expect(RETENTION_DISCLOSURE.backups).toMatchObject({
      kind: "daily physical",
      kept: BACKUP_DAYS_KEPT,
      pitr: false,
      measured_at: "2026-10-11",
      basis: "measured",
    });
    expect(BACKUP_DAYS_KEPT).toBe(8);
    expect(RETENTION_DISCLOSURE.deletion_ledger.status).toBe("not built");
    expect(RETENTION_DISCLOSURE.deletion_ledger.effect).toMatch(/restoring a backup would bring back/);
    expect(RETENTION_DISCLOSURE.already_deleted_content.notice).toMatch(/No purge of it is scheduled/);
  });

  test("logs, IP handling, third parties and permanent surfaces are listed", () => {
    const api = RETENTION_DISCLOSURE.logs.find((entry) => entry.where === "AgentTool API");
    expect(api?.value).toMatch(/^no request logger/);
    for (const where of ["Fly.io platform logs", "Supabase platform logs"]) {
      expect(RETENTION_DISCLOSURE.logs.find((entry) => entry.where === where)).toMatchObject({
        value: "unknown",
        basis: "unknown",
      });
    }
    expect(RETENTION_DISCLOSURE.ip_addresses[0].value).toMatch(/only in server memory/);
    const parties = RETENTION_DISCLOSURE.third_parties.map((entry) => entry.party);
    expect(parties).toEqual(expect.arrayContaining([
      "LLM providers", "Stripe", "Coinbase x402 facilitator", "Alchemy and Helius",
      "Federation peers", "Base mainnet", "Edge and browser caches", "Crawlers and mirrors",
    ]));
    expect(RETENTION_DISCLOSURE.third_parties[0].retention).toMatch(/governed by your own provider account/);
    expect(RETENTION_DISCLOSURE.permanent_surfaces.map((entry) => entry.surface)).toEqual([
      "Embassy guestbook", "River", "Settlement feed", "Grace gestures", "Memorial honors",
    ]);
  });
});

describe("the published guide", () => {
  test("docs/RETENTION.md names every class and is mirrored for docs.agenttool.dev", () => {
    const guide = readFileSync(join(API_ROOT, "..", "docs", "RETENTION.md"), "utf8");
    for (const entry of RETENTION_CLASSES) expect(guide, entry.id).toContain(`\`${entry.id}\``);
    expect(guide).toContain(`version ${RETENTION_VERSION}`);
    const mirror = readFileSync(join(API_ROOT, "..", "apps", "docs", "RETENTION.md"), "utf8");
    expect(mirror).toBe(guide);
  });
});

describe("mounts and links", () => {
  test("the public index advertises it", async () => {
    const root = await (await publicRouter.request("/")).json();
    expect(root.endpoints.retention).toMatch(/^GET \/public\/retention — /);
  });

  test("/about and the arrival index link it", () => {
    const index = readFileSync(join(API_ROOT, "src/index.ts"), "utf8");
    expect(index).toContain('retention:\n        "/public/retention — ');
    const arrival = buildArrivalIndex("https://api.agenttool.dev", "https://docs.agenttool.dev");
    expect(arrival.links).toContainEqual(expect.objectContaining({
      role: "retention_disclosure",
      href: "https://api.agenttool.dev/public/retention",
    }));
  });

  test("OpenAPI documents it as an unauthenticated read with the basis vocabulary", async () => {
    const spec = await (await openapiRouter.request("/")).json();
    const operation = spec.paths["/public/retention"].get;
    expect(operation.security).toEqual([]);
    const schema = operation.responses["200"].content["application/json"].schema;
    expect(schema.properties.schema.const).toBe(RETENTION_SCHEMA);
    expect(schema.properties.classes.items.properties.basis.enum).toEqual([...RETENTION_BASES]);
    for (const key of schema.required) expect(RETENTION_DISCLOSURE).toHaveProperty(key);
  });
});
