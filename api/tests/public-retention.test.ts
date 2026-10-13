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
  ALREADY_DELETED_CONTENT,
  ALREADY_DELETED_PURGE,
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
    expect(RETENTION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
    const versions = RETENTION_DISCLOSURE.versions.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toContain("2026-10-12");
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

describe("wave 2 publishes today's truth", () => {
  test("inbox and vault deletes erase their content", () => {
    expect(byId("inbox").after_delete).toMatch(/erases the sealed body.*cannot be restored/s);
    expect(byId("vault.secrets").after_delete).toMatch(/zeroes every stored version/);
    expect(DELETE_RESPONSE_RETENTION.inbox.content_retained).toBe(false);
    expect(DELETE_RESPONSE_RETENTION.vault.content_retained).toBe(false);
  });

  test("identity backup blobs are erased on delete", () => {
    expect(byId("identity.backups").after_delete).toMatch(/erases its blob, nonce and metadata/);
    expect(DELETE_RESPONSE_RETENTION.identity_backup.blob_retained).toBe(false);
  });

  test("expired working memory leaves the memory service's reads and is purged by rule; paid-witness memory is erased in place", () => {
    const memory = byId("memory.content");
    expect(memory.live).toMatch(/memory service's reads stop returning it \(by id, by key, list/);
    expect(memory.live).toMatch(/24 hours after expiry/);
    // Surfaces that read memory rows directly are named, not hidden behind "every read".
    for (const text of [memory.live, memory.after_delete]) {
      expect(text).toContain("per-agent MCP memory list and fork carry-over");
      expect(text).not.toMatch(/every read|any read/);
    }
    expect(memory.after_delete).toMatch(/paid witness receipt points at is erased in place/);
    expect(memory.after_delete).not.toMatch(/409/);
  });

  test("vault-audit addresses are nulled after 30 days", () => {
    expect(byId("vault.audit").after_delete).toMatch(/vault_audit_ip_30d.*30 days/s);
    const vaultIp = RETENTION_DISCLOSURE.ip_addresses.find((entry) => entry.where === "Vault audit rows");
    expect(vaultIp?.value).toMatch(/NULL 30 days later/);
  });

  test("money records still say 6 years declared with no purge job", () => {
    const money = byId("money");
    expect(money.basis).toBe("declared");
    expect(money.after_delete).toMatch(/6 years.*No purge job/s);
    expect(byId("gift_codes").after_delete).toMatch(/6 years declared, no purge job/);
  });

  test("backups, the ledger and the announced purge of already-deleted content are stated", () => {
    expect(RETENTION_DISCLOSURE.backups).toMatchObject({
      kind: "daily physical",
      kept: BACKUP_DAYS_KEPT,
      pitr: false,
      measured_at: "2026-10-11",
      basis: "measured",
    });
    expect(BACKUP_DAYS_KEPT).toBe(8);
    const ledger = RETENTION_DISCLOSURE.deletion_ledger;
    expect(ledger.status).toBe("built");
    expect(ledger.what).toMatch(/does not happen/);
    expect(ledger.compaction).toMatch(/15 days/);
    expect(ledger.mirror.window).toMatch(/^30 days/);
    expect(ledger.mirror_configured).toMatchObject({ basis: "unknown" });
    expect(ledger.voided_entries).toBe(0);
    expect(ledger.rules.map((rule) => rule.id)).toEqual([
      "expired_working_memory_24h", "vault_audit_ip_30d", "ledger_compaction_15d",
    ]);
    const already = RETENTION_DISCLOSURE.already_deleted_content;
    expect(already.purge_not_before).toBe(ALREADY_DELETED_PURGE.not_before);
    expect(already.min_days_after_announcement).toBeGreaterThanOrEqual(30);
    expect(already.notice).toContain(`on or after ${ALREADY_DELETED_PURGE.not_before}`);
    expect(already.notice).toMatch(/restored message is not purged/);
    for (const note of Object.values(DELETE_RESPONSE_RETENTION)) {
      expect(note.already_deleted).toBe(ALREADY_DELETED_CONTENT);
    }
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

describe("the human privacy page agrees with the disclosure", () => {
  const privacy = readFileSync(join(API_ROOT, "..", "apps", "web", "privacy.html"), "utf8");
  const text = privacy.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  test("gift codes: plain text until redeemed or refunded, then only the hash", () => {
    const phrase = "plain text until it is redeemed or refunded";
    expect(text).toContain(phrase);
    expect(byId("gift_codes").live).toContain(phrase);
    expect(text).toContain("only its hash, for 6 years");
    expect(text).not.toContain("stored only as a hash");
    expect(text).not.toMatch(/shown to you once and not kept/);
  });

  test("IP addresses: no request logs; the checkout limiter holds them only in memory", () => {
    expect(text).toContain("Our API writes no request logs.");
    expect(RETENTION_DISCLOSURE.logs[0]).toMatchObject({ where: "AgentTool API" });
    expect(RETENTION_DISCLOSURE.logs[0].value).toStartWith("no request logger");
    expect(text).toContain("holds your IP only in server memory");
    expect(RETENTION_DISCLOSURE.ip_addresses[0].value).toContain("only in server memory");
    expect(text).toMatch(/Cloudflare, Fly\.io, Supabase\) process IP addresses under their own retention/);
    for (const where of ["Fly.io platform logs", "Supabase platform logs"]) {
      expect(RETENTION_DISCLOSURE.logs.find((entry) => entry.where === where)?.value).toBe("unknown");
    }
    expect(text).not.toContain("30 days in logs");
  });

  test("backups: deleted data can remain for the same number of days", () => {
    expect(text).toContain(`daily database backups for up to ${RETENTION_DISCLOSURE.backups.kept} days`);
    expect(privacy).toContain('href="https://api.agenttool.dev/public/retention"');
  });

  test("the version moved, and the earlier text is published under /privacy/versions/", () => {
    expect(privacy).toContain('Version <span class="mono">2026-10-12</span>');
    expect(privacy).toContain('href="/privacy/versions/"');
    expect(privacy).not.toContain("public source history");
    const earlier = readFileSync(
      join(API_ROOT, "..", "apps", "web", "privacy", "versions", "2026-08-29.html"),
      "utf8",
    );
    expect(earlier).toContain('Version <span class="mono">2026-08-29</span>');
    expect(earlier).toContain("Gift code — stored only as a hash");
    expect(earlier).toContain('<link rel="canonical" href="https://agenttool.dev/privacy/versions/2026-08-29" />');
    expect(earlier).toContain("kept for the record");
    const index = readFileSync(join(API_ROOT, "..", "apps", "web", "privacy", "versions", "index.html"), "utf8");
    expect(index).toContain('href="/privacy/versions/2026-08-29"');
    expect(index).toContain('href="/privacy">2026-10-12</a>');
  });

  test("the exit-door sentence matches the release state: source only, not yet published", () => {
    expect(text).toContain("github.com/cambridgetcg/agenttool-packages ; not yet in a published SDK release");
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
