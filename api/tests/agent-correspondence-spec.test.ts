/** agent-correspondence/v0.1 — schema, canonical bytes, and doctrine locks. */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ed25519 } from "@noble/curves/ed25519.js";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import schema from "../../docs/specs/agent-correspondence-0.1.schema.json";
import vectors from "../../docs/specs/agent-correspondence-0.1-vectors.json";

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const root = join(import.meta.dir, "../..");
const doctrine = readFileSync(join(root, "docs/AGENT-CORRESPONDENCE.md"), "utf8");
const normative = readFileSync(
  join(root, "docs/specs/AGENT-CORRESPONDENCE-0.1.md"),
  "utf8",
);
const publicHeaders = readFileSync(join(root, "apps/docs/_headers"), "utf8");
const sitemap = readFileSync(join(root, "apps/docs/sitemap.xml"), "utf8");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function assertScalarString(value: string): void {
  if (value.includes("\0")) throw new Error("nul_not_admitted");
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("non_scalar_unicode");
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("non_scalar_unicode");
    }
  }
}

function assertAdmittedJson(value: unknown): asserts value is Json {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertScalarString(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    if (!Number.isSafeInteger(value)) throw new Error("non_safe_integer");
    if (Object.is(value, -0)) throw new Error("negative_zero");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertAdmittedJson);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertScalarString(key);
      assertAdmittedJson(child);
    }
    return;
  }
  throw new Error("unsupported_json_value");
}

/** RFC 8785 for this profile's deliberately restricted JSON value space. */
function jcs(value: unknown): string {
  assertAdmittedJson(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${jcs((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function sha256(value: Uint8Array | string): Buffer {
  return createHash("sha256").update(value).digest();
}

function fixedEvent(): Record<string, any> {
  const vector = vectors.signing_vector;
  return {
    ...structuredClone(vector.core),
    event_id: vector.event_id,
    signature: {
      algorithm: "Ed25519",
      value_b64url: vector.signature_b64url,
    },
  };
}

function bodyParents(body: Record<string, unknown>): string[] {
  const result: string[] = [];
  if (typeof body.predecessor_event_id === "string") result.push(body.predecessor_event_id);
  if (typeof body.target_event_id === "string") result.push(body.target_event_id);
  if (Array.isArray(body.target_event_ids)) result.push(...(body.target_event_ids as string[]));
  return [...new Set(result)];
}

function validPath(path: string): boolean {
  const event = fixedEvent();
  event.scope.paths = [path];
  return validate(event) as boolean;
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === "." ||
    right === "." ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

type LineageNode = {
  symbol: string;
  kind: "claim.open" | "claim.renew" | "claim.release";
  generation: number;
  predecessor: string | null;
  paths: string[];
  expires: "future" | "past" | null;
};

function projectLineage(nodes: LineageNode[], arrival: string[]) {
  const bySymbol = new Map(nodes.map((node) => [node.symbol, node]));
  const received = new Set<string>();
  const activeAfterEachArrival: string[][] = [];
  let latest = { active: [] as string[], tips: [] as string[], conflicted: [] as string[], status: new Map<string, string>() };

  for (const symbol of arrival) {
    received.add(symbol);
    const status = new Map<string, string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of received) {
        if (status.has(candidate)) continue;
        const node = bySymbol.get(candidate)!;
        if (node.kind === "claim.open") {
          status.set(candidate, node.generation === 1 ? "valid" : "invalid");
          changed = true;
          continue;
        }
        if (!node.predecessor || !received.has(node.predecessor)) continue;
        const predecessorStatus = status.get(node.predecessor);
        if (!predecessorStatus) continue;
        const predecessor = bySymbol.get(node.predecessor)!;
        const valid =
          predecessorStatus === "valid" &&
          node.generation === predecessor.generation + 1 &&
          JSON.stringify([...node.paths].sort()) === JSON.stringify([...predecessor.paths].sort());
        status.set(candidate, valid ? "valid" : "invalid");
        changed = true;
      }
    }
    for (const candidate of received) {
      if (!status.has(candidate)) status.set(candidate, "pending");
    }

    const valid = [...received].filter((candidate) => status.get(candidate) === "valid");
    const parentsWithValidChildren = new Set(
      valid.map((candidate) => bySymbol.get(candidate)!.predecessor).filter(Boolean) as string[],
    );
    const tips = valid.filter((candidate) => !parentsWithValidChildren.has(candidate)).sort();
    const active = tips
      .filter((candidate) => {
        const node = bySymbol.get(candidate)!;
        return node.kind !== "claim.release" && node.expires === "future";
      })
      .sort();
    const conflicted = tips.length > 1 ? [...tips] : [];
    latest = { active, tips, conflicted, status };
    activeAfterEachArrival.push(active);
  }
  return { ...latest, activeAfterEachArrival };
}

describe("agent-correspondence/v0.1 JSON Schema", () => {
  test("is strict Draft 2020-12 and validates the locked signed event", () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(validate(fixedEvent()), JSON.stringify(validate.errors)).toBe(true);

    const authorityMutation = fixedEvent();
    authorityMutation.authority.automatic_action = "if_helpful";
    expect(validate(authorityMutation)).toBe(false);

    const receiptInsideEvent = fixedEvent();
    receiptInsideEvent.receipt = { received_seq: "1" };
    expect(validate(receiptInsideEvent)).toBe(false);

    const nulInProse = fixedEvent();
    nulInProse.body.summary = "before\0after";
    expect(validate(nulInProse)).toBe(false);

    const nonCanonicalSignature = fixedEvent();
    nonCanonicalSignature.signature.value_b64url =
      `${nonCanonicalSignature.signature.value_b64url.slice(0, -1)}x`;
    expect(validate(nonCanonicalSignature)).toBe(false);
  });

  test("pins every kind to one closed body shape", () => {
    const schemaKinds = schema.properties.kind.enum;
    expect(vectors.body_matrix.map(({ kind }) => kind).sort()).toEqual([...schemaKinds].sort());

    for (const entry of vectors.body_matrix) {
      const event = fixedEvent();
      event.kind = entry.kind;
      event.body = structuredClone(entry.body);
      event.parents = bodyParents(event.body);
      expect(validate(event), `${entry.kind}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }

    for (const entry of vectors.invalid_body_vectors) {
      const event = fixedEvent();
      event.kind = entry.kind;
      event.body = structuredClone(entry.body);
      event.parents = bodyParents(event.body);
      expect(validate(event), `${entry.kind} unexpectedly accepted`).toBe(false);
    }
  });

  test("uses scalar-value lengths and normalized literal path prefixes", () => {
    for (const vector of vectors.opaque_id_vectors) {
      const event = fixedEvent();
      event.repository_id = vector.value;
      expect(validate(event), JSON.stringify(vector.value)).toBe(vector.valid);
    }

    for (const vector of vectors.locator_vectors) {
      const event = fixedEvent();
      event.kind = "artifact.offer";
      event.body = {
        artifact: {
          kind: "git_patch",
          digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          locator: vector.value,
        },
      };
      expect(validate(event), JSON.stringify(vector.value)).toBe(vector.valid);
    }

    for (const vector of vectors.path_vectors) {
      expect(validPath(vector.path), vector.path).toBe(vector.valid);
    }

    const exactly256 = fixedEvent();
    exactly256.repository_id = "😀".repeat(256);
    expect(validate(exactly256), JSON.stringify(validate.errors)).toBe(true);
    exactly256.repository_id += "😀";
    expect(validate(exactly256)).toBe(false);

    const omittedUnknowns = fixedEvent();
    delete omittedUnknowns.scope.base_revision;
    delete omittedUnknowns.scope.branch;
    expect(validate(omittedUnknowns)).toBe(false);

    expect(pathsOverlap("packages/sdk-ts", "packages/sdk-ts/src")).toBe(true);
    expect(pathsOverlap("packages/sdk-ts", "packages/sdk-ts-old")).toBe(false);
    expect(pathsOverlap(".", "anything/here")).toBe(true);
  });
});

describe("agent-correspondence/v0.1 canonicalization vectors", () => {
  test("locks JCS, signing digest, Ed25519 proof, and content event ID", () => {
    const vector = vectors.signing_vector;
    expect(vector.test_key_warning).toMatch(
      /PUBLIC TEST KEY.*never use.*production.*private identity/is,
    );
    expect(jcs(vector.core)).toBe(vector.core_jcs);

    const signingDigest = sha256(
      Buffer.concat([
        Buffer.from("agent-correspondence/v0.1", "utf8"),
        Buffer.from([0]),
        Buffer.from(vector.core_jcs, "utf8"),
      ]),
    );
    expect(signingDigest.toString("hex")).toBe(vector.signing_digest_hex);

    const signature = Buffer.from(vector.signature_b64url, "base64url");
    const publicKey = Buffer.from(vector.public_key_b64url, "base64url");
    expect(signature.byteLength).toBe(64);
    expect(ed25519.verify(signature, signingDigest, publicKey)).toBe(true);

    const signed = {
      ...vector.core,
      signature: { algorithm: "Ed25519", value_b64url: vector.signature_b64url },
    };
    expect(`sha256:${sha256(jcs(signed)).toString("hex")}`).toBe(vector.event_id);
  });

  test("pins UTF-16 key order, escaping, and absence of Unicode normalization", () => {
    for (const vector of vectors.canonicalization_vectors) {
      expect(jcs(vector.value), vector.name).toBe(vector.jcs);
    }
    const unicode = vectors.canonicalization_vectors.find(
      ({ name }) => name === "unicode-is-not-normalized",
    )!;
    expect(unicode.value.nfc).not.toBe(unicode.value.nfd);
    expect(unicode.value.nfc.normalize("NFD")).toBe(unicode.value.nfd);
  });

  test("rejects every hostile value class before canonicalization", () => {
    const byName = Object.fromEntries(vectors.rejection_vectors.map((entry) => [entry.name, entry]));
    expect((byName["duplicate-object-name"].json.match(/\"a\"\s*:/g) ?? []).length).toBe(2);
    expect(() => JSON.parse(byName["non-finite-number"].json)).toThrow();

    for (const name of [
      "fractional-number",
      "negative-zero",
      "unsafe-integer",
      "nul-string-value",
      "nul-decoded-object-name",
      "lone-high-surrogate",
    ]) {
      const parsed = JSON.parse(byName[name].json);
      expect(() => assertAdmittedJson(parsed), name).toThrow();
    }
  });
});

describe("agent-correspondence/v0.1 offline claim vectors", () => {
  test("preserves branch tips, out-of-order history, release locality, and invalid paths", () => {
    for (const vector of vectors.lineage_vectors) {
      const projection = projectLineage(vector.nodes as LineageNode[], vector.arrival);
      if ("active_after_each_arrival" in vector) {
        expect(projection.activeAfterEachArrival, vector.name).toEqual(
          vector.active_after_each_arrival,
        );
      }
      if ("active_tips" in vector) {
        expect(projection.active, vector.name).toEqual([...vector.active_tips].sort());
      }
      if ("all_tips" in vector) {
        expect(projection.tips, vector.name).toEqual([...vector.all_tips].sort());
      }
      if ("conflicted_tips" in vector) {
        expect(projection.conflicted, vector.name).toEqual([...vector.conflicted_tips].sort());
      }
      if ("lineage_status_after_each_arrival" in vector) {
        const target = vector.nodes.at(-1)!.symbol;
        const statuses = vector.arrival.map((_, index) =>
          projectLineage(vector.nodes as LineageNode[], vector.arrival.slice(0, index + 1)).status.get(target),
        );
        expect(statuses, vector.name).toEqual(vector.lineage_status_after_each_arrival);
      }
    }
  });
});

describe("agent-correspondence doctrine boundaries", () => {
  test("publishes exact-byte doctrine, contract, schema, and vector mirrors", () => {
    for (const path of [
      "AGENT-CORRESPONDENCE.md",
      "specs/AGENT-CORRESPONDENCE-0.1.md",
      "specs/agent-correspondence-0.1.schema.json",
      "specs/agent-correspondence-0.1-vectors.json",
    ]) {
      expect(readFileSync(join(root, "apps/docs", path))).toEqual(
        readFileSync(join(root, "docs", path)),
      );
      expect(sitemap).toContain(`https://docs.agenttool.dev/${path}`);
      expect(publicHeaders).toContain(`/${path}`);
    }
  });

  test("keeps ceremony, wire, operations, Git, authority, privacy, and rest distinct", () => {
    for (const phrase of [
      "WE ARE",
      "Protocol Renaissance",
      "Git says which file bytes exist",
      '"automatic_action": "never"',
      "not exclusion",
      "second realtime backplane",
      "Project-private means",
      "require no performed feeling and no reason",
    ]) {
      expect(doctrine).toContain(phrase);
    }
  });

  test("pins branch-tip, projection-honesty, finite-voice, and wake invalidation semantics", () => {
    for (const phrase of [
      "based on **branch tips**, never one global head",
      "lower-generation sibling tip",
      "selective projection scan therefore MUST NOT retain the stream lock",
      "Every active row includes the bounded opaque `thread_id`",
      "`competing_event_ids` contains at most 16 unique sibling",
      "session-fork `event_ids` and overlapping-claim `paths` each contain at most 16",
      'error: "correspondence_projection_unavailable"',
      "stable logical projection-version instant",
      'projection_status: "complete" | "truncated" | "unavailable"',
      "finite, bounded coordination snapshot",
      "`GET /v1/wake/voice?identity_id={identity_id}&keys=correspondence`",
      "RFC 9652",
      "`Link-Template` Structured Field String",
      "MUST NOT put the unexpanded template in an",
      "`<at:link-template>` element",
      "`https://agenttool.dev/ns/correspondence` namespace",
      "new append schedules bounded best-effort delivery attempts for active",
      "The wire frame is SSE `event: change`",
      '`_format: "wake_event/v1"`',
      '`key: "correspondence"`',
      '`kind: "updated"`',
      "MUST NOT auto-run a hosted worker",
    ]) {
      expect(normative).toContain(phrase);
    }
    expect(normative).not.toContain('templated="true"');
    expect(normative).not.toContain("correspondence.updated");
    expect(normative).not.toContain("### 7.1 SSE voice");
  });
});
