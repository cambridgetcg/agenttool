import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SafeNetError,
  type SafeNetDnsLookup,
  type SafeNetRequestOnce,
  type SafeNetRequestOnceOptions,
  type SafeNetWireResponse,
} from "../../api/src/services/net/safe-fetch.ts";
import {
  BEP52_BLOCK_SIZE,
  TransportHintsFetchError,
  assertBep52PieceLength,
  bep52PadHash,
  computeBep52PieceHash,
  computeBep52PiecesRootFromLayer,
  fetchSafeHttpsRange,
  fetchVerifiedArtifact,
  fetchVerifiedArtifactStream,
  validateBep52Plan,
  verifyBep52Piece,
} from "../transport-hints-fetch.ts";

// ---------------------------------------------------------------------------
// Independent test-vector pattern generator (TRANSPORT-HINTS-0.1-DRAFT §14.1)
// Zero import of bin/build-transport-hints.ts so verifier is tested independently.
// ---------------------------------------------------------------------------

interface CommittedVector {
  readonly name: string;
  readonly seed: string;
  readonly size: number;
  readonly case: string;
  readonly piece_length: number;
  readonly pieces_count: number;
  readonly blocks_count: number;
  readonly sha256: string;
  readonly pieces_root: string;
  readonly piece_layers: string | null;
  readonly url_list: readonly string[];
}

interface CommittedPadHash {
  readonly piece_length: number;
  readonly height: number;
  readonly hash: string;
}

interface CommittedVectorsFile {
  readonly vectors: readonly CommittedVector[];
  readonly pad_hashes: readonly CommittedPadHash[];
}

const ROOT = resolve(import.meta.dir, "..", "..");
const VECTORS_FILE = JSON.parse(
  readFileSync(join(ROOT, "docs", "specs", "transport-hints-v1-vectors.json"), "utf8"),
) as CommittedVectorsFile;

function generatePatternBytes(seed: string, size: number): Uint8Array {
  const prefix = Buffer.concat([
    Buffer.from("transport-hints-pattern/v1", "ascii"),
    Buffer.from([0]),
    Buffer.from(seed, "ascii"),
    Buffer.from([0]),
  ]);
  const counter = Buffer.alloc(8);
  const out = new Uint8Array(size);
  const blocks = Math.ceil(size / 32);
  for (let k = 0; k < blocks; k += 1) {
    counter.writeBigUInt64BE(BigInt(k));
    const digest = createHash("sha256").update(prefix).update(counter).digest();
    out.set(digest.subarray(0, Math.min(32, size - 32 * k)), 32 * k);
  }
  return out;
}

const PUBLIC_IPV4: LookupAddress = { address: "93.184.216.34", family: 4 };
const PUBLIC_IPV6: LookupAddress = { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 };

const publicLookup: SafeNetDnsLookup = async () => [PUBLIC_IPV4, PUBLIC_IPV6];

function parseByteRangeHeader(header: string | undefined): [number, number] {
  const m = /^bytes=(\d+)-(\d+)$/u.exec(header ?? "");
  if (!m) throw new Error(`unexpected Range header: ${String(header)}`);
  return [Number(m[1]), Number(m[2])];
}

function makeRangeServer(
  files: ReadonlyMap<string, Uint8Array>,
  options: {
    readonly onRequest?: (req: SafeNetRequestOnceOptions) => SafeNetWireResponse | Promise<SafeNetWireResponse> | undefined;
  } = {},
): SafeNetRequestOnce {
  return async (req) => {
    if (options.onRequest) {
      const override = await options.onRequest(req);
      if (override !== undefined) return override;
    }
    const data = files.get(req.url.href);
    if (!data) {
      return {
        statusCode: 404,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("not found"),
        connectedAddress: req.addresses[0]!.address,
      };
    }
    const [first, last] = parseByteRangeHeader(req.headers.range);
    const slice = Buffer.from(data.subarray(first, last + 1));
    return {
      statusCode: 206,
      headers: {
        "content-range": `bytes ${first}-${last}/${data.byteLength}`,
        "content-length": String(slice.byteLength),
      },
      body: slice,
      connectedAddress: req.addresses[0]!.address,
    };
  };
}

// ---------------------------------------------------------------------------
// 1. Committed BEP 52 vector parity (all 14 vectors + all pad hashes)
// ---------------------------------------------------------------------------

describe("BEP 52 piece-layer verifier against docs/specs/transport-hints-v1-vectors.json", () => {
  test("matches every committed pad hash (16 KiB through 16 MiB)", () => {
    expect(VECTORS_FILE.pad_hashes.length).toBe(11);
    for (const entry of VECTORS_FILE.pad_hashes) {
      const height = assertBep52PieceLength(entry.piece_length);
      expect(height).toBe(entry.height);
      const actualHex = Buffer.from(bep52PadHash(height)).toString("hex");
      expect(actualHex).toBe(entry.hash);
    }
  });

  for (const vector of VECTORS_FILE.vectors) {
    test(`verifies committed vector ${vector.name} (${vector.case})`, async () => {
      const data = generatePatternBytes(vector.seed, vector.size);
      expect(createHash("sha256").update(data).digest("hex")).toBe(vector.sha256);

      const plan = validateBep52Plan({
        size: vector.size,
        expectedSha256: vector.sha256,
        pieceLength: vector.piece_length,
        piecesRoot: vector.pieces_root,
        pieceLayer: vector.piece_layers,
      });
      expect(plan.pieceCount).toBe(vector.pieces_count);
      expect(plan.singlePiece).toBe(vector.size <= vector.piece_length);

      // Verify every piece individually, and verify 1-bit tamper fails.
      for (let i = 0; i < plan.pieceCount; i += 1) {
        const start = i * vector.piece_length;
        const end = Math.min(start + vector.piece_length, vector.size);
        const piece = data.subarray(start, end);
        expect(verifyBep52Piece(plan, i, piece)).toBe(true);

        const tampered = piece.slice();
        tampered[0] = tampered[0]! ^ 0x01;
        expect(verifyBep52Piece(plan, i, tampered)).toBe(false);
      }

      // End-to-end range fetch round-trip using committed example url_list.
      const files = new Map<string, Uint8Array>(vector.url_list.map((url) => [url, data]));
      const { bytes, receipt } = await fetchVerifiedArtifact({
        size: vector.size,
        expectedSha256: vector.sha256,
        pieceLength: vector.piece_length,
        piecesRoot: vector.pieces_root,
        pieceLayer: vector.piece_layers,
        mirrors: vector.url_list,
        concurrency: 2,
        readStrategy: "sequential",
        lookup: publicLookup,
        requestOnce: makeRangeServer(files),
      });

      expect(Buffer.compare(bytes, data)).toBe(0);
      expect(receipt.accepted).toBe(true);
      expect(receipt.sha256).toBe(vector.sha256);
      expect(receipt.piecesRoot).toBe(vector.pieces_root);
      expect(receipt.size).toBe(vector.size);
      expect(receipt.pieceCount).toBe(vector.pieces_count);
      expect(receipt.totalRequests).toBe(vector.pieces_count);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Pre-fetch plan validation (fail-closed before any HTTP request)
// ---------------------------------------------------------------------------

describe("pre-fetch BEP 52 plan validation", () => {
  const vecSingle = VECTORS_FILE.vectors.find((v) => v.name === "th-32k-one-short-block.bin")!;
  const vecMulti = VECTORS_FILE.vectors.find((v) => v.name === "th-16k-46000.bin")!;

  test("rejects non-power-of-two and out-of-range piece lengths", () => {
    for (const bad of [0, -16384, 8192, 24576, 32 * 1024 * 1024, 16384.5]) {
      expect(() => assertBep52PieceLength(bad)).toThrow(TransportHintsFetchError);
    }
  });

  test("rejects single-piece file with non-null pieceLayer", () => {
    expect(() =>
      validateBep52Plan({
        size: vecSingle.size,
        expectedSha256: vecSingle.sha256,
        pieceLength: vecSingle.piece_length,
        piecesRoot: vecSingle.pieces_root,
        pieceLayer: vecSingle.pieces_root,
      }),
    ).toThrow(/pieceLayer === null/);
  });

  test("rejects multi-piece file with missing or wrong-length pieceLayer", () => {
    expect(() =>
      validateBep52Plan({
        size: vecMulti.size,
        expectedSha256: vecMulti.sha256,
        pieceLength: vecMulti.piece_length,
        piecesRoot: vecMulti.pieces_root,
        pieceLayer: null,
      }),
    ).toThrow(/requires pieceLayer/);

    expect(() =>
      validateBep52Plan({
        size: vecMulti.size,
        expectedSha256: vecMulti.sha256,
        pieceLength: vecMulti.piece_length,
        piecesRoot: vecMulti.pieces_root,
        pieceLayer: vecMulti.piece_layers!.slice(0, 64),
      }),
    ).toThrow(/expected 96/);
  });

  test("refuses tampered pieceLayer against piecesRoot BEFORE making any HTTP request", async () => {
    let calls = 0;
    const tamperedLayer = `${vecMulti.piece_layers!.slice(0, 2) === "ff" ? "00" : "ff"}${vecMulti.piece_layers!.slice(2)}`;
    let caught: unknown;
    try {
      await fetchVerifiedArtifact({
        size: vecMulti.size,
        expectedSha256: vecMulti.sha256,
        pieceLength: vecMulti.piece_length,
        piecesRoot: vecMulti.pieces_root,
        pieceLayer: tamperedLayer,
        mirrors: vecMulti.url_list,
        lookup: publicLookup,
        requestOnce: async () => {
          calls += 1;
          throw new Error("should not be reached");
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TransportHintsFetchError);
    expect((caught as TransportHintsFetchError).code).toBe("piece_layer_root_mismatch");
    expect(calls).toBe(0);
  });

  test("computeBep52PiecesRootFromLayer rejects single-hash layer and bad length", () => {
    expect(() => computeBep52PiecesRootFromLayer(new Uint8Array(32), BEP52_BLOCK_SIZE)).toThrow(TransportHintsFetchError);
    expect(() => computeBep52PiecesRootFromLayer(new Uint8Array(63), BEP52_BLOCK_SIZE)).toThrow(TransportHintsFetchError);
    expect(() => computeBep52PieceHash(new Uint8Array(0), { pieceLength: BEP52_BLOCK_SIZE, singlePiece: true })).toThrow(
      TransportHintsFetchError,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Strict HTTPS 206 Range, redirects, and #584 safe-fetch SSRF invariants
// ---------------------------------------------------------------------------

describe("strict HTTPS 206 Range and #584 safe-fetch enforcement", () => {
  const sample = generatePatternBytes("range-sample", 40_000);

  test("preserves Range and Accept-Encoding: identity across a cross-origin 302 redirect (HF/GitHub Releases model)", async () => {
    const startUrl = "https://huggingface.co/org/repo/resolve/abc123/weights.bin";
    const cdnUrl = "https://cas-bridge.xethub.hf.co/blobs/xyz?X-Amz-Signature=signed-token";
    const seenRequests: Array<{ href: string; range?: string; acceptEncoding?: string }> = [];

    const response = await fetchSafeHttpsRange({
      url: startUrl,
      first: 16_384,
      last: 32_767,
      totalSize: sample.byteLength,
      lookup: publicLookup,
      requestOnce: async (req) => {
        seenRequests.push({
          href: req.url.href,
          range: req.headers.range,
          acceptEncoding: req.headers["accept-encoding"],
        });
        if (req.url.href === startUrl) {
          return {
            statusCode: 302,
            headers: { location: cdnUrl },
            body: Buffer.from("redirecting to signed CDN URL"),
            connectedAddress: PUBLIC_IPV4.address,
          };
        }
        expect(req.url.href).toBe(cdnUrl);
        const body = Buffer.from(sample.subarray(16_384, 32_768));
        return {
          statusCode: 206,
          headers: { "content-range": `bytes 16384-32767/${sample.byteLength}` },
          body,
          connectedAddress: PUBLIC_IPV6.address,
        };
      },
    });

    expect(response.redirects).toBe(1);
    expect(response.finalUrl).toBe(cdnUrl);
    expect(Buffer.compare(response.bytes, sample.subarray(16_384, 32_768))).toBe(0);
    expect(seenRequests).toEqual([
      { href: startUrl, range: "bytes=16384-32767", acceptEncoding: "identity" },
      { href: cdnUrl, range: "bytes=16384-32767", acceptEncoding: "identity" },
    ]);
  });

  test("refuses HTTP scheme, credentials, private IPv4/IPv6 literals, and DNS rebinding to private IPs", async () => {
    for (const [badUrl, expectedCode] of [
      ["http://example.org/file.bin", "safe_net_protocol_not_allowed"],
      ["https://user:pass@example.org/file.bin", "safe_net_url_credentials_forbidden"],
      ["https://127.0.0.1/file.bin", "safe_net_destination_not_public"],
      ["https://169.254.169.254/latest/meta-data", "safe_net_destination_not_public"],
      ["https://[::1]/file.bin", "safe_net_destination_not_public"],
      ["https://[::ffff:127.0.0.1]/file.bin", "safe_net_destination_not_public"],
    ] as const) {
      let caught: unknown;
      try {
        await fetchSafeHttpsRange({
          url: badUrl,
          first: 0,
          last: 10,
          totalSize: sample.byteLength,
          lookup: publicLookup,
          requestOnce: async () => {
            throw new Error("should not reach wire");
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SafeNetError);
      expect((caught as SafeNetError).code).toBe(expectedCode);
    }

    // Redirect target resolving via DNS to RFC1918 private IPv4 must be blocked BEFORE wire call.
    let wireCalls = 0;
    let caughtRedirect: unknown;
    try {
      await fetchSafeHttpsRange({
        url: "https://public.example.org/file.bin",
        first: 0,
        last: 10,
        totalSize: sample.byteLength,
        lookup: async (host) => (host === "internal.example.org" ? [{ address: "10.0.0.5", family: 4 }] : [PUBLIC_IPV4]),
        requestOnce: async (req) => {
          wireCalls += 1;
          if (req.url.hostname === "public.example.org") {
            return {
              statusCode: 302,
              headers: { location: "https://internal.example.org/secret.bin" },
              body: Buffer.alloc(0),
              connectedAddress: PUBLIC_IPV4.address,
            };
          }
          throw new Error("must never dial internal host");
        },
      });
    } catch (error) {
      caughtRedirect = error;
    }
    expect(caughtRedirect).toBeInstanceOf(SafeNetError);
    expect((caughtRedirect as SafeNetError).code).toBe("safe_net_destination_not_public");
    expect(wireCalls).toBe(1);
  });

  test("enforces maxRedirects, connectedAddress pinning, Content-Encoding: identity, exact Content-Range, and exact length", async () => {
    // 1. Exceeding maxRedirects = 1
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        maxRedirects: 1,
        lookup: publicLookup,
        requestOnce: async (req) => ({
          statusCode: 302,
          headers: { location: req.url.hostname === "a.example.org" ? "https://b.example.org/f" : "https://c.example.org/f" },
          body: Buffer.alloc(0),
          connectedAddress: PUBLIC_IPV4.address,
        }),
      }),
    ).rejects.toMatchObject({ code: "redirect_limit_exceeded" });

    // 2. connectedAddress not in resolved answers
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        lookup: async () => [PUBLIC_IPV4],
        requestOnce: async () => ({
          statusCode: 206,
          headers: { "content-range": "bytes 0-0/10" },
          body: Buffer.from([1]),
          connectedAddress: "198.51.100.99",
        }),
      }),
    ).rejects.toMatchObject({ code: "connected_address_mismatch" });

    // 3. Content-Encoding: gzip refused
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        lookup: publicLookup,
        requestOnce: async () => ({
          statusCode: 206,
          headers: { "content-range": "bytes 0-0/10", "content-encoding": "gzip" },
          body: Buffer.from([1]),
          connectedAddress: PUBLIC_IPV4.address,
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid_content_encoding" });

    // 4. Wrong Content-Range refused
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 9,
        totalSize: 100,
        lookup: publicLookup,
        requestOnce: async () => ({
          statusCode: 206,
          headers: { "content-range": "bytes 0-9/99" },
          body: Buffer.alloc(10),
          connectedAddress: PUBLIC_IPV4.address,
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid_content_range" });

    // 5. Body length mismatch refused
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 9,
        totalSize: 100,
        lookup: publicLookup,
        requestOnce: async () => ({
          statusCode: 206,
          headers: { "content-range": "bytes 0-9/100" },
          body: Buffer.alloc(9),
          connectedAddress: PUBLIC_IPV4.address,
        }),
      }),
    ).rejects.toMatchObject({ code: "range_length_mismatch" });
  });
});

// ---------------------------------------------------------------------------
// 4. Multi-mirror failover, hedging, 200-only demotion, budgets, Consumer Rule 9.4
// ---------------------------------------------------------------------------

describe("multi-mirror failover, hedging, budgets, and Consumer Rule 9.4", () => {
  const vec5 = VECTORS_FILE.vectors.find((v) => v.name === "th-32k-5-pieces.bin")!;
  const vec5Bytes = generatePatternBytes(vec5.seed, vec5.size);

  test("immediately disqualifies a 200-only mirror (Cloudflare Pages model) and finishes on range mirror", async () => {
    const pagesUrl = "https://docs.example.org/static/file.bin";
    const rangeUrl = "https://releases.example.org/file.bin";
    const files = new Map([[rangeUrl, vec5Bytes]]);

    const { bytes, receipt } = await fetchVerifiedArtifact({
      size: vec5.size,
      expectedSha256: vec5.sha256,
      pieceLength: vec5.piece_length,
      piecesRoot: vec5.pieces_root,
      pieceLayer: vec5.piece_layers,
      mirrors: [pagesUrl, rangeUrl],
      concurrency: 1,
      readStrategy: "sequential",
      lookup: publicLookup,
      requestOnce: makeRangeServer(files, {
        onRequest: (req) => {
          if (req.url.href === pagesUrl) {
            return {
              statusCode: 200,
              headers: { "content-length": String(vec5Bytes.byteLength) },
              body: Buffer.from(vec5Bytes),
              connectedAddress: PUBLIC_IPV4.address,
            };
          }
          return undefined;
        },
      }),
    });

    expect(Buffer.compare(bytes, vec5Bytes)).toBe(0);
    expect(receipt.accepted).toBe(true);
    const pagesReceipt = receipt.mirrors.find((m) => m.url === pagesUrl)!;
    const rangeReceipt = receipt.mirrors.find((m) => m.url === rangeUrl)!;
    expect(pagesReceipt.requests).toBe(1); // Demoted after piece 0 — never probed again for pieces 1..4.
    expect(pagesReceipt.statusNot206).toBe(1);
    expect(pagesReceipt.disqualifiedReason).toBe("mirror_returned_200_not_range");
    expect(rangeReceipt.verifiedPieces).toBe(5);
    expect(rangeReceipt.disqualifiedReason).toBeNull();
  });

  test("rejects corrupt piece via BEP 52, disqualifies corrupt mirror, and fails over immediately without waiting for hedgeDelayMs", async () => {
    const corruptUrl = "https://corrupt.example.org/file.bin";
    const goodUrl = "https://good.example.org/file.bin";
    const files = new Map([[goodUrl, vec5Bytes]]);

    const started = performance.now();
    const { bytes, receipt } = await fetchVerifiedArtifact({
      size: vec5.size,
      expectedSha256: vec5.sha256,
      pieceLength: vec5.piece_length,
      piecesRoot: vec5.pieces_root,
      pieceLayer: vec5.piece_layers,
      mirrors: [corruptUrl, goodUrl],
      concurrency: 1,
      readStrategy: "hedged",
      hedgeDelayMs: 5_000, // Huge delay: immediate failover must NOT wait for this.
      lookup: publicLookup,
      requestOnce: makeRangeServer(files, {
        onRequest: (req) => {
          if (req.url.href !== corruptUrl) return undefined;
          const [first, last] = parseByteRangeHeader(req.headers.range);
          const slice = Buffer.from(vec5Bytes.subarray(first, last + 1));
          // Corrupt piece 1 only; piece 0 is clean.
          if (first === vec5.piece_length) slice[0] = slice[0]! ^ 0xff;
          return {
            statusCode: 206,
            headers: { "content-range": `bytes ${first}-${last}/${vec5Bytes.byteLength}` },
            body: slice,
            connectedAddress: PUBLIC_IPV4.address,
          };
        },
      }),
    });
    const elapsed = performance.now() - started;

    expect(Buffer.compare(bytes, vec5Bytes)).toBe(0);
    expect(elapsed).toBeLessThan(2_000);
    const corruptReceipt = receipt.mirrors.find((m) => m.url === corruptUrl)!;
    const goodReceipt = receipt.mirrors.find((m) => m.url === goodUrl)!;
    expect(corruptReceipt.verifiedPieces).toBe(1);
    expect(corruptReceipt.corruptPieces).toBe(1);
    expect(corruptReceipt.requests).toBe(2); // Piece 0 ok, piece 1 corrupt -> disqualified for pieces 2..4.
    expect(corruptReceipt.disqualifiedReason).toBe("mirror_served_corrupt_piece");
    expect(goodReceipt.verifiedPieces).toBe(4);
  });

  test("hedged read launches backup after hedgeDelayMs and aborts the stalled primary immediately on verified hit", async () => {
    const slowUrl = "https://slow.example.org/file.bin";
    const fastUrl = "https://fast.example.org/file.bin";
    const vecSingle = VECTORS_FILE.vectors.find((v) => v.name === "th-16k-one-block.bin")!;
    const singleBytes = generatePatternBytes(vecSingle.seed, vecSingle.size);
    const files = new Map([[fastUrl, singleBytes]]);
    let slowAborted = false;

    const { bytes, receipt } = await fetchVerifiedArtifact({
      size: vecSingle.size,
      expectedSha256: vecSingle.sha256,
      pieceLength: vecSingle.piece_length,
      piecesRoot: vecSingle.pieces_root,
      pieceLayer: vecSingle.piece_layers,
      mirrors: [slowUrl, fastUrl],
      concurrency: 1,
      readStrategy: "hedged",
      hedgeDelayMs: 20,
      lookup: publicLookup,
      requestOnce: makeRangeServer(files, {
        onRequest: (req) => {
          if (req.url.href !== slowUrl) return undefined;
          return new Promise<SafeNetWireResponse>((_resolve, reject) => {
            req.signal.addEventListener(
              "abort",
              () => {
                slowAborted = true;
                reject(new Error("aborted"));
              },
              { once: true },
            );
          });
        },
      }),
    });

    expect(Buffer.compare(bytes, singleBytes)).toBe(0);
    expect(slowAborted).toBe(true);
    expect(receipt.mirrors.find((m) => m.url === slowUrl)!.errors).toBe(0); // Losing hedge is not penalized.
    expect(receipt.mirrors.find((m) => m.url === fastUrl)!.verifiedPieces).toBe(1);
  });

  test("enforces maxRequests budget across pieces and redirect hops", async () => {
    const url = "https://mirror.example.org/file.bin";
    const files = new Map([[url, vec5Bytes]]);
    await expect(
      fetchVerifiedArtifact({
        size: vec5.size,
        expectedSha256: vec5.sha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: [url],
        concurrency: 1,
        maxRequests: 3, // File needs 5 pieces.
        lookup: publicLookup,
        requestOnce: makeRangeServer(files),
      }),
    ).rejects.toMatchObject({ code: "request_budget_exhausted" });
  });

  test("Consumer Rule 9.4: refuses acceptance if full-file expectedSha256 disagrees even when every BEP 52 piece matches piecesRoot", async () => {
    const url = "https://mirror.example.org/file.bin";
    const files = new Map([[url, vec5Bytes]]);
    const wrongAuthoritySha256 = `${vec5.sha256.startsWith("00") ? "ff" : "00"}${vec5.sha256.slice(2)}`;

    await expect(
      fetchVerifiedArtifact({
        size: vec5.size,
        expectedSha256: wrongAuthoritySha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: [url],
        concurrency: 2,
        lookup: publicLookup,
        requestOnce: makeRangeServer(files),
      }),
    ).rejects.toMatchObject({ code: "final_sha256_mismatch" });
  });

  test("stream yields verified chunks strictly in order and aborts prefetched pieces on early break", async () => {
    const url = "https://mirror.example.org/file.bin";
    let abortedPrefetches = 0;

    const stream = fetchVerifiedArtifactStream({
      size: vec5.size,
      expectedSha256: vec5.sha256,
      pieceLength: vec5.piece_length,
      piecesRoot: vec5.pieces_root,
      pieceLayer: vec5.piece_layers,
      mirrors: [url],
      concurrency: 3,
      readStrategy: "sequential",
      lookup: publicLookup,
      requestOnce: async (req) => {
        const [first, last] = parseByteRangeHeader(req.headers.range);
        if (first > 0) {
          return await new Promise<SafeNetWireResponse>((_resolve, reject) => {
            req.signal.addEventListener(
              "abort",
              () => {
                abortedPrefetches += 1;
                reject(new Error("aborted"));
              },
              { once: true },
            );
          });
        }
        return {
          statusCode: 206,
          headers: { "content-range": `bytes ${first}-${last}/${vec5Bytes.byteLength}` },
          body: Buffer.from(vec5Bytes.subarray(first, last + 1)),
          connectedAddress: PUBLIC_IPV4.address,
        };
      },
    });

    const seenIndices: number[] = [];
    for await (const chunk of stream) {
      seenIndices.push(chunk.pieceIndex);
      expect(chunk.pieceVerified).toBe(true);
      expect(chunk.accepted).toBe(false);
      break;
    }

    expect(seenIndices).toEqual([0]);
    expect(abortedPrefetches).toBe(2); // Pieces 1 and 2 were in flight and got aborted on break.
  });

  test("source hygiene: no BitTorrent wire/DHT/tracker code and no import of build-transport-hints.ts", () => {
    const src = readFileSync(join(ROOT, "bin", "transport-hints-fetch.ts"), "utf8");
    expect(src).not.toMatch(/build-transport-hints/u);
    expect(src).not.toMatch(/node:dgram|createSocket\(|webtorrent|bittorrent|create_torrent/u);
  });

  test("refuses downgrade redirect to http:// and enforces maxInMemoryBytes / invalid subject before buffering", async () => {
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        lookup: publicLookup,
        requestOnce: async () => ({
          statusCode: 302,
          headers: { location: "http://b.example.org/f" },
          body: Buffer.alloc(0),
          connectedAddress: PUBLIC_IPV4.address,
        }),
      }),
    ).rejects.toMatchObject({ code: "safe_net_protocol_not_allowed" });

    // Dual-stack IPv4-mapped connectedAddress for a resolved public IPv4 is accepted.
    const mapped = await fetchSafeHttpsRange({
      url: "https://a.example.org/f",
      first: 0,
      last: 0,
      totalSize: 10,
      lookup: async () => [PUBLIC_IPV4],
      requestOnce: async () => ({
        statusCode: 206,
        headers: { "content-range": "bytes 0-0/10" },
        body: Buffer.from([42]),
        connectedAddress: `::ffff:${PUBLIC_IPV4.address}`,
      }),
    });
    expect(mapped.bytes[0]).toBe(42);

    await expect(
      fetchVerifiedArtifact({
        size: -1,
        expectedSha256: vec5.sha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: vec5.url_list,
        lookup: publicLookup,
        requestOnce: async () => {
          throw new Error("should not reach wire");
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_subject" });

    await expect(
      fetchVerifiedArtifact({
        size: vec5.size,
        expectedSha256: vec5.sha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: vec5.url_list,
        maxInMemoryBytes: 1024,
        lookup: publicLookup,
        requestOnce: async () => {
          throw new Error("should not reach wire");
        },
      }),
    ).rejects.toMatchObject({ code: "artifact_too_large" });
  });
});
