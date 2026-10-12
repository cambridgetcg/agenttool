/** The off-database deletion-ledger mirror, without a database.
 *
 *  Pins: object keys and canonical bytes; strict parsing; write-once
 *  semantics (a re-send of the same entry is accepted, a different object
 *  under the same key is a conflict, nothing is overwritten) for the local
 *  directory mirror and for the S3-compatible (Cloudflare R2) client against
 *  a loopback fake that checks SigV4 independently; configuration from the
 *  environment (unconfigured is a no-op, partial is misconfigured); and that
 *  a push stops at the first failure so the mirror never skips an entry.
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.3. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ledgerEntryHash,
  ledgerEntryMac,
  rowIdsDigest,
  type StoredLedgerEntry,
} from "../src/services/deletion/ledger";
import {
  FileLedgerMirror,
  MIRROR_ENV,
  MirrorConflictError,
  S3LedgerMirror,
  ledgerMirrorFromEnv,
  mirrorObjectBytes,
  mirrorObjectKey,
  parseMirrorObject,
  parseMirrorObjectKey,
  pushLedgerMirrorAfterCommit,
  pushUnmirroredEntries,
} from "../src/services/deletion/mirror";

const KEY = "test-ledger-key-0123456789abcdef-not-for-production";

function entry(seq: number, prevHash: string, rowId = `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`): StoredLedgerEntry {
  const fields = {
    seq, entryId: `f0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, occurredAt: "2026-10-12T16:20:01.000001Z",
    scope: "record" as const, action: "purge_content" as const, store: "inbox.messages", predicate: null,
    rowIdsSha256: rowIdsDigest([rowId]), rowCount: 1, rowKeySalt: null, ruleId: null, ruleCutoff: null,
    subjectIdentityId: null, projectId: "11111111-1111-4111-8111-111111111111", requestId: null,
    authorityMode: "legacy_bearer" as const, authoritySequence: null, prevHash,
  };
  const entryHash = ledgerEntryHash(fields);
  return {
    ...fields, rowIds: [rowId], entryHash, entryMac: ledgerEntryMac(entryHash, KEY),
    mirroredAt: null, replayedAt: null, compactedAt: null,
  };
}

describe("object encoding", () => {
  test("keys sort by seq and name their entry", () => {
    const one = entry(1, "");
    expect(mirrorObjectKey(1, one.entryId)).toBe(`ledger/v1/000000000001-${one.entryId}.json`);
    expect(parseMirrorObjectKey(mirrorObjectKey(42, one.entryId))).toEqual({ seq: 42, entryId: one.entryId });
    expect(parseMirrorObjectKey("ledger/v1/1-x.json")).toBeNull();
    expect(mirrorObjectKey(9, one.entryId) < mirrorObjectKey(10, one.entryId)).toBe(true);
  });

  test("bytes are a function of the entry, round-trip, and carry no mirror-local state", () => {
    const one = entry(1, "");
    const bytes = mirrorObjectBytes(one);
    expect(mirrorObjectBytes({ ...one, mirroredAt: "2026-10-12T17:00:00.000000Z" })).toEqual(bytes);
    const parsed = parseMirrorObject(bytes, mirrorObjectKey(1, one.entryId));
    expect(parsed).toEqual({ ...one, mirroredAt: null, replayedAt: null, compactedAt: null });
    expect(new TextDecoder().decode(bytes)).not.toContain("mirrored_at");
    expect(() => parseMirrorObject(bytes, mirrorObjectKey(2, one.entryId))).toThrow(/does not hold/);
    expect(() => parseMirrorObject(new TextEncoder().encode('{"schema":"other"}'))).toThrow();
  });
});

describe("FileLedgerMirror is write-once", () => {
  let directory = "";
  beforeAll(async () => { directory = await mkdtemp(join(process.env.DELETION_TEST_TMPDIR ?? tmpdir(), "mirror-test-")); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  test("create, accept the same entry again, refuse a different one, list in order", async () => {
    const mirror = new FileLedgerMirror(directory);
    const one = entry(1, "");
    const two = entry(2, one.entryHash);
    const key = mirrorObjectKey(1, one.entryId);
    expect(await mirror.putIfAbsent(key, mirrorObjectBytes(one))).toBe("created");
    expect(await mirror.putIfAbsent(key, mirrorObjectBytes(one))).toBe("exists");
    await expect(mirror.putIfAbsent(key, mirrorObjectBytes(entry(1, "", "e1000000-0000-4000-8000-000000000001"))))
      .rejects.toBeInstanceOf(MirrorConflictError);
    expect(await mirror.get(key)).toEqual(mirrorObjectBytes(one));
    await mirror.putIfAbsent(mirrorObjectKey(2, two.entryId), mirrorObjectBytes(two));
    expect(await mirror.list("ledger/v1/")).toEqual([key, mirrorObjectKey(2, two.entryId)]);
    expect(await mirror.list("ledger/v1/", key)).toEqual([mirrorObjectKey(2, two.entryId)]);
    expect(await mirror.get("ledger/v1/missing.json")).toBeNull();
    await expect(mirror.putIfAbsent("../escape.json", new Uint8Array())).rejects.toThrow(/unsafe/);
  });
});

describe("S3LedgerMirror against a loopback fake", () => {
  const ACCESS = "LOOPBACKACCESS";
  const SECRET = "loopback-secret-key";
  const objects = new Map<string, Uint8Array>();
  const seen: Array<{ method: string; path: string; headers: Record<string, string> }> = [];
  let server: ReturnType<typeof Bun.serve>;
  let endpoint = "";

  // Independent SigV4 check (node:crypto), per the AWS reference algorithm.
  function expectedSignature(request: Request, url: URL, body: Uint8Array): string {
    const auth = request.headers.get("authorization") ?? "";
    const signed = /SignedHeaders=([^,]+)/.exec(auth)![1]!.split(";");
    const amzDate = request.headers.get("x-amz-date")!;
    const headerValue = (name: string) => (name === "host" ? url.host : request.headers.get(name) ?? "").trim();
    const query = [...url.searchParams].map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
      .sort(([a], [b]) => (a! < b! ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
    const canonical = [request.method, url.pathname, query, signed.map((name) => `${name}:${headerValue(name)}\n`).join(""),
      signed.join(";"), createHash("sha256").update(body).digest("hex")].join("\n");
    const scope = `${amzDate.slice(0, 8)}/auto/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
    let key: Buffer = createHmac("sha256", `AWS4${SECRET}`).update(amzDate.slice(0, 8)).digest();
    for (const part of ["auto", "s3", "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
    return createHmac("sha256", key).update(toSign).digest("hex");
  }

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const url = new URL(request.url);
        const body = new Uint8Array(await request.arrayBuffer());
        seen.push({ method: request.method, path: url.pathname + url.search, headers: Object.fromEntries(request.headers) });
        const auth = request.headers.get("authorization") ?? "";
        const signature = /Signature=([0-9a-f]{64})$/.exec(auth)?.[1];
        if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${ACCESS}/`) || signature !== expectedSignature(request, url, body)) {
          return new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", { status: 403 });
        }
        if (request.headers.get("x-amz-content-sha256") !== createHash("sha256").update(body).digest("hex")) {
          return new Response("bad payload hash", { status: 400 });
        }
        if (!url.pathname.startsWith("/ledger-bucket")) return new Response("no bucket", { status: 404 });
        const key = decodeURIComponent(url.pathname.slice("/ledger-bucket/".length));
        if (request.method === "PUT") {
          if (request.headers.get("if-none-match") === "*" && objects.has(key)) return new Response("", { status: 412 });
          objects.set(key, body);
          return new Response("", { status: 200 });
        }
        if (url.searchParams.get("list-type") === "2") {
          const prefix = url.searchParams.get("prefix") ?? "";
          const after = url.searchParams.get("continuation-token") ?? url.searchParams.get("start-after") ?? "";
          const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
          const page = keys.slice(0, 2);
          const truncated = keys.length > 2;
          return new Response(`<ListBucketResult>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}` +
            `<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${page[1]}</NextContinuationToken>` : ""}</ListBucketResult>`);
        }
        const stored = objects.get(key);
        return stored ? new Response(stored) : new Response("", { status: 404 });
      },
    });
    endpoint = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => server?.stop(true));

  test("refuses plain http outside the loopback test escape", () => {
    expect(() => new S3LedgerMirror({ endpoint: "http://example.com", bucket: "ledger-bucket", accessKeyId: ACCESS, secretAccessKey: SECRET }))
      .toThrow(/https/);
  });

  test("signed conditional writes, idempotent re-send, conflict refusal, reads and paged listing", async () => {
    const mirror = new S3LedgerMirror({
      endpoint, bucket: "ledger-bucket", accessKeyId: ACCESS, secretAccessKey: SECRET, allowInsecureLoopbackHttpForTests: true,
    });
    const entries = [entry(1, "")];
    for (let seq = 2; seq <= 5; seq++) entries.push(entry(seq, entries[seq - 2]!.entryHash));
    for (const item of entries) {
      expect(await mirror.putIfAbsent(mirrorObjectKey(item.seq, item.entryId), mirrorObjectBytes(item))).toBe("created");
    }
    const put = seen.find((request) => request.method === "PUT")!;
    expect(put.headers["if-none-match"]).toBe("*");
    expect(put.headers.authorization).toMatch(/SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date,/);
    expect(await mirror.putIfAbsent(mirrorObjectKey(1, entries[0]!.entryId), mirrorObjectBytes(entries[0]!))).toBe("exists");
    await expect(mirror.putIfAbsent(mirrorObjectKey(1, entries[0]!.entryId),
      mirrorObjectBytes(entry(1, "", "e1000000-0000-4000-8000-000000000009")))).rejects.toBeInstanceOf(MirrorConflictError);
    expect(objects.get(mirrorObjectKey(1, entries[0]!.entryId))).toEqual(mirrorObjectBytes(entries[0]!));
    expect(await mirror.get(mirrorObjectKey(3, entries[2]!.entryId))).toEqual(mirrorObjectBytes(entries[2]!));
    expect(await mirror.get("ledger/v1/none.json")).toBeNull();
    const listed = await mirror.list("ledger/v1/");
    expect(listed).toEqual(entries.map((item) => mirrorObjectKey(item.seq, item.entryId)));
    expect(await mirror.list("ledger/v1/", listed[2])).toEqual(listed.slice(3));
  });
});

describe("configuration and pushing", () => {
  test("unconfigured, misconfigured and configured", () => {
    expect(ledgerMirrorFromEnv({})).toEqual({ status: "unconfigured" });
    expect(ledgerMirrorFromEnv({ [MIRROR_ENV.endpoint]: "https://a.r2.cloudflarestorage.com" }))
      .toMatchObject({ status: "misconfigured", problem: expect.stringContaining(MIRROR_ENV.secretAccessKey) });
    expect(ledgerMirrorFromEnv({
      [MIRROR_ENV.endpoint]: "http://a.example", [MIRROR_ENV.bucket]: "b-bucket",
      [MIRROR_ENV.accessKeyId]: "a", [MIRROR_ENV.secretAccessKey]: "s",
    })).toMatchObject({ status: "misconfigured" });
    const configured = ledgerMirrorFromEnv({
      [MIRROR_ENV.endpoint]: "https://account.r2.cloudflarestorage.com", [MIRROR_ENV.bucket]: "agenttool-deletion-ledger",
      [MIRROR_ENV.accessKeyId]: "a", [MIRROR_ENV.secretAccessKey]: "s",
    });
    expect(configured.status).toBe("configured");
  });

  test("the in-request push is a no-op without a mirror and touches no database", async () => {
    const executor = { execute: async () => { throw new Error("must not query"); } };
    expect(await pushLedgerMirrorAfterCommit(executor as never, 1, { env: {} }))
      .toEqual({ mirrored: false, status: "unconfigured" });
  });

  test("a push stops at the first failure and marks only what reached the mirror", async () => {
    const one = entry(1, "");
    const two = entry(2, one.entryHash);
    const three = entry(3, two.entryHash);
    const row = (item: StoredLedgerEntry) => ({
      seq: String(item.seq), entry_id: item.entryId, occurred_at: item.occurredAt, scope: item.scope, action: item.action,
      store: item.store, predicate: null, row_ids: item.rowIds, row_key_salt: null, row_ids_sha256: item.rowIdsSha256,
      row_count: 1, rule_id: null, rule_cutoff: null, subject_identity_id: null, project_id: item.projectId, request_id: null,
      authority_mode: item.authorityMode, authority_sequence: null, prev_hash: item.prevHash, entry_hash: item.entryHash,
      entry_mac: item.entryMac, mirrored_at: null, replayed_at: null, compacted_at: null,
    });
    const marked: number[] = [];
    const executor = {
      async execute(query: unknown) {
        const text = JSON.stringify(query);
        if (text.includes("UPDATE deletion.ledger SET mirrored_at")) {
          marked.push((query as { queryChunks: unknown[] }).queryChunks.find((chunk) => typeof chunk === "number") as number);
          return [];
        }
        return [row(one), row(two), row(three)];
      },
    };
    const written: string[] = [];
    const mirror = {
      kind: "fake",
      async putIfAbsent(key: string) {
        if (key.includes("000000000002")) throw new Error("network down");
        written.push(key);
        return "created" as const;
      },
      async get() { return null; },
      async list() { return []; },
    };
    const result = await pushUnmirroredEntries(executor, mirror);
    expect(result).toMatchObject({ pushed: 1, mirroredThroughSeq: 1, failure: { seq: 2, error: "network down" } });
    expect(written).toEqual([mirrorObjectKey(1, one.entryId)]);
    expect(marked).toEqual([1]);
  });
});
