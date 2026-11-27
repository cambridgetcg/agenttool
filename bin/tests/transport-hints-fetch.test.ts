import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import {
  SafeNetError,
  defaultSafeNetRequestOnce,
  type SafeNetDnsLookup,
  type SafeNetRequestOnce,
  type SafeNetRequestOnceOptions,
  type SafeNetSocketFactory,
  type SafeNetWireResponse,
} from "../../api/src/services/net/safe-fetch.ts";
import {
  BEP52_BLOCK_SIZE,
  TransportHintsFetchError,
  assertBep52PieceLength,
  bep52PadHash,
  computeBep52PieceHash,
  computeBep52PiecesRootFromLayer,
  defaultRequestBudget,
  fetchSafeHttpsRange,
  fetchVerifiedArtifact,
  fetchVerifiedArtifactStream,
  fetchVerifiedArtifactToFile,
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

/**
 * Hermetic fake TLS socket driving the REAL `defaultSafeNetRequestOnce`
 * HTTP/1.1 wire parser, TLS identity check, connected-address check, response
 * size cap, and Content-Encoding check without touching the network.
 */
function makeRealWireTransport(
  responder: (url: URL, rawRequestText: string) => Buffer,
): SafeNetRequestOnce {
  const socketFactory: SafeNetSocketFactory = ({ url, address, tlsServername }) => {
    let requestBuf = "";
    let responded = false;
    const sock = new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        requestBuf += Buffer.from(chunk).toString("latin1");
        if (!responded && requestBuf.includes("\r\n\r\n")) {
          responded = true;
          const rawResponse = responder(url, requestBuf);
          queueMicrotask(() => {
            if (!sock.destroyed) {
              // Emit in 16 KiB chunks to exercise real multi-fragment streaming.
              for (let off = 0; off < rawResponse.length; off += 16_384) {
                if (sock.destroyed) break;
                sock.push(rawResponse.subarray(off, Math.min(off + 16_384, rawResponse.length)));
              }
              if (!sock.destroyed) sock.push(null);
            }
          });
        }
        cb();
      },
    }) as unknown as Socket & Partial<TLSSocket>;

    Object.defineProperty(sock, "remoteAddress", { value: address.address, configurable: true });
    Object.defineProperty(sock, "authorized", { value: true, configurable: true });
    Object.defineProperty(sock, "alpnProtocol", { value: "http/1.1", configurable: true });
    (sock as unknown as { getPeerCertificate: () => unknown }).getPeerCertificate = () => ({
      subject: { CN: tlsServername },
      subjectaltname: `DNS:${tlsServername}`,
    });

    queueMicrotask(() => {
      if (!sock.destroyed) {
        sock.emit(url.protocol === "https:" ? "secureConnect" : "connect");
      }
    });
    return sock;
  };

  return (options) => defaultSafeNetRequestOnce({ ...options, socketFactory });
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

      for (let i = 0; i < plan.pieceCount; i += 1) {
        const start = i * vector.piece_length;
        const end = Math.min(start + vector.piece_length, vector.size);
        const piece = data.subarray(start, end);
        expect(verifyBep52Piece(plan, i, piece)).toBe(true);

        const tampered = piece.slice();
        tampered[0] = tampered[0]! ^ 0x01;
        expect(verifyBep52Piece(plan, i, tampered)).toBe(false);
      }

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

  test("preserves Range and Accept-Encoding: identity across a cross-origin 302 redirect and strips signed query from finalUrl", async () => {
    const startUrl = "https://huggingface.co/org/repo/resolve/abc123/weights.bin";
    const cdnUrl = "https://cas-bridge.xethub.hf.co/blobs/xyz?X-Amz-Signature=secret-signed-token";
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
    expect(response.finalUrl).toBe("https://cas-bridge.xethub.hf.co/blobs/xyz");
    expect(response.finalUrl).not.toContain("secret-signed-token");
    expect(Buffer.compare(response.bytes, sample.subarray(16_384, 32_768))).toBe(0);
    expect(seenRequests).toEqual([
      { href: startUrl, range: "bytes=16384-32767", acceptEncoding: "identity" },
      { href: cdnUrl, range: "bytes=16384-32767", acceptEncoding: "identity" },
    ]);
  });

  test("refuses HTTP scheme, credentials, private IPv4/IPv6 literals, and DNS lookup returning private IP on redirect target", async () => {
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

  test("enforces allowUrl on initial URL and redirect targets, missing Location, maxRedirects, connectedAddress, encoding, range, length, and timeout", async () => {
    // 1. allowUrl refuses initial URL
    await expect(
      fetchSafeHttpsRange({
        url: "https://blocked.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        allowUrl: (u) => u.hostname === "allowed.example.org",
        lookup: publicLookup,
        requestOnce: async () => {
          throw new Error("should not reach wire");
        },
      }),
    ).rejects.toMatchObject({ code: "redirect_refused" });

    // 2. allowUrl refuses redirect target
    await expect(
      fetchSafeHttpsRange({
        url: "https://allowed.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        allowUrl: (u) => u.hostname === "allowed.example.org",
        lookup: publicLookup,
        requestOnce: async () => ({
          statusCode: 302,
          headers: { location: "https://other.example.org/f" },
          body: Buffer.alloc(0),
          connectedAddress: PUBLIC_IPV4.address,
        }),
      }),
    ).rejects.toMatchObject({ code: "redirect_refused" });

    // 3. Redirect missing Location header
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        lookup: publicLookup,
        requestOnce: async () => ({
          statusCode: 302,
          headers: {},
          body: Buffer.alloc(0),
          connectedAddress: PUBLIC_IPV4.address,
        }),
      }),
    ).rejects.toMatchObject({ code: "redirect_missing_location" });

    // 4. Exceeding maxRedirects = 1
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

    // 5. connectedAddress not in resolved answers
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

    // 6. Content-Encoding: gzip refused
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

    // 7. Wrong Content-Range refused
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

    // 8. Body length mismatch refused
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

    // 9. Per-request timeout aborts hung transport
    await expect(
      fetchSafeHttpsRange({
        url: "https://a.example.org/f",
        first: 0,
        last: 0,
        totalSize: 10,
        timeoutMs: 25,
        lookup: publicLookup,
        requestOnce: (req) =>
          new Promise<SafeNetWireResponse>((_resolve, reject) => {
            req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true });
          }),
      }),
    ).rejects.toMatchObject({ code: "safe_net_request_timeout" });
  });
});

// ---------------------------------------------------------------------------
// 4. Real-wire defaultSafeNetRequestOnce PoC tests (no mocked parser)
// ---------------------------------------------------------------------------

describe("real defaultSafeNetRequestOnce HTTP/1.1 wire transport PoCs", () => {
  const vec5 = VECTORS_FILE.vectors.find((v) => v.name === "th-32k-5-pieces.bin")!;
  const vec5Bytes = generatePatternBytes(vec5.seed, vec5.size);

  test("real wire: 200-only overlong body throws safe_net_response_too_large and disqualifies mirror on request #1", async () => {
    const pagesUrl = "https://pages.example.org/file.bin";
    const rangeUrl = "https://range.example.org/file.bin";

    const transport = makeRealWireTransport((url, rawReq) => {
      if (url.href === pagesUrl) {
        // Real Cloudflare Pages-style 200 OK with full 151,072-byte body > 64 KiB cap.
        const head = Buffer.from(
          `HTTP/1.1 200 OK\r\nContent-Length: ${vec5Bytes.byteLength}\r\nConnection: close\r\n\r\n`,
          "latin1",
        );
        return Buffer.concat([head, Buffer.from(vec5Bytes)]);
      }
      const match = /range:\s*bytes=(\d+)-(\d+)/iu.exec(rawReq);
      if (!match) throw new Error(`missing range header: ${rawReq}`);
      const first = Number(match[1]);
      const last = Number(match[2]);
      const slice = Buffer.from(vec5Bytes.subarray(first, last + 1));
      const head = Buffer.from(
        `HTTP/1.1 206 Partial Content\r\nContent-Range: bytes ${first}-${last}/${vec5Bytes.byteLength}\r\nContent-Length: ${slice.byteLength}\r\nConnection: close\r\n\r\n`,
        "latin1",
      );
      return Buffer.concat([head, slice]);
    });

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
      requestOnce: transport,
    });

    expect(Buffer.compare(bytes, vec5Bytes)).toBe(0);
    expect(receipt.accepted).toBe(true);
    const pagesReceipt = receipt.mirrors.find((m) => m.url === pagesUrl)!;
    const rangeReceipt = receipt.mirrors.find((m) => m.url === rangeUrl)!;
    expect(pagesReceipt.requests).toBe(1);
    expect(pagesReceipt.disqualifiedReason).toBe("mirror_response_too_large_not_range");
    expect(rangeReceipt.verifiedPieces).toBe(5);
  });

  test("real wire: gzip 206 throws safe_net_content_encoding_not_identity and disqualifies mirror on request #1", async () => {
    const gzipUrl = "https://gzip.example.org/file.bin";
    const rangeUrl = "https://range.example.org/file.bin";

    const transport = makeRealWireTransport((url, rawReq) => {
      const match = /range:\s*bytes=(\d+)-(\d+)/iu.exec(rawReq);
      if (!match) throw new Error(`missing range header: ${rawReq}`);
      const first = Number(match[1]);
      const last = Number(match[2]);
      const slice = Buffer.from(vec5Bytes.subarray(first, last + 1));
      if (url.href === gzipUrl) {
        const head = Buffer.from(
          `HTTP/1.1 206 Partial Content\r\nContent-Encoding: gzip\r\nContent-Range: bytes ${first}-${last}/${vec5Bytes.byteLength}\r\nContent-Length: ${slice.byteLength}\r\nConnection: close\r\n\r\n`,
          "latin1",
        );
        return Buffer.concat([head, slice]);
      }
      const head = Buffer.from(
        `HTTP/1.1 206 Partial Content\r\nContent-Range: bytes ${first}-${last}/${vec5Bytes.byteLength}\r\nContent-Length: ${slice.byteLength}\r\nConnection: close\r\n\r\n`,
        "latin1",
      );
      return Buffer.concat([head, slice]);
    });

    const { bytes, receipt } = await fetchVerifiedArtifact({
      size: vec5.size,
      expectedSha256: vec5.sha256,
      pieceLength: vec5.piece_length,
      piecesRoot: vec5.pieces_root,
      pieceLayer: vec5.piece_layers,
      mirrors: [gzipUrl, rangeUrl],
      concurrency: 1,
      readStrategy: "sequential",
      lookup: publicLookup,
      requestOnce: transport,
    });

    expect(Buffer.compare(bytes, vec5Bytes)).toBe(0);
    const gzipReceipt = receipt.mirrors.find((m) => m.url === gzipUrl)!;
    const rangeReceipt = receipt.mirrors.find((m) => m.url === rangeUrl)!;
    expect(gzipReceipt.requests).toBe(1);
    expect(gzipReceipt.disqualifiedReason).toBe("mirror_non_identity_encoding");
    expect(rangeReceipt.verifiedPieces).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 5. Multi-mirror failover, hedging, retries, budgets, Consumer Rule 9.4, atomic file
// ---------------------------------------------------------------------------

describe("multi-mirror failover, hedging, retries, budgets, and Consumer Rule 9.4", () => {
  const vec5 = VECTORS_FILE.vectors.find((v) => v.name === "th-32k-5-pieces.bin")!;
  const vec5Bytes = generatePatternBytes(vec5.seed, vec5.size);

  test("default request budget covers two redirecting hedged mirrors on 5 pieces and >16 GiB (>1,024 pieces) files", async () => {
    const m1 = "https://m1.example.org/file.bin";
    const m2 = "https://m2.example.org/file.bin";
    const cdn1 = "https://cdn1.example.org/blob/file.bin?sig=1";
    const cdn2 = "https://cdn2.example.org/blob/file.bin?sig=2";
    const files = new Map([
      [cdn1, vec5Bytes],
      [cdn2, vec5Bytes],
    ]);

    const { bytes, receipt } = await fetchVerifiedArtifact({
      size: vec5.size,
      expectedSha256: vec5.sha256,
      pieceLength: vec5.piece_length,
      piecesRoot: vec5.pieces_root,
      pieceLayer: vec5.piece_layers,
      mirrors: [m1, m2],
      concurrency: 2,
      readStrategy: "hedged",
      hedgeDelayMs: 0, // Launch both redirecting mirrors on every piece (worst-case 20 hops).
      lookup: publicLookup,
      requestOnce: makeRangeServer(files, {
        onRequest: (req) => {
          if (req.url.href === m1) {
            return { statusCode: 302, headers: { location: cdn1 }, body: Buffer.alloc(0), connectedAddress: PUBLIC_IPV4.address };
          }
          if (req.url.href === m2) {
            return { statusCode: 302, headers: { location: cdn2 }, body: Buffer.alloc(0), connectedAddress: PUBLIC_IPV4.address };
          }
          return undefined;
        },
      }),
    });

    expect(Buffer.compare(bytes, vec5Bytes)).toBe(0);
    expect(receipt.accepted).toBe(true);
    expect(receipt.totalRequests).toBeGreaterThanOrEqual(10);

    // 2,000 pieces (32 GiB at 16 MiB pieces) with 1 redirecting mirror must not starve at 2,048.
    const largeBudget = defaultRequestBudget({
      pieceCount: 2_000,
      maxRedirects: 1,
      mirrorCount: 1,
      maxConcurrentPerPiece: 2,
      maxRetriesPerPiece: 2,
    });
    expect(largeBudget).toBeGreaterThan(4_000);
  });

  test("retries transient 503 on piece 2 of 5 with a single mirror and succeeds cleanly", async () => {
    const url = "https://flaky.example.org/file.bin";
    const files = new Map([[url, vec5Bytes]]);
    let piece2Attempts = 0;

    const { bytes, receipt } = await fetchVerifiedArtifact({
      size: vec5.size,
      expectedSha256: vec5.sha256,
      pieceLength: vec5.piece_length,
      piecesRoot: vec5.pieces_root,
      pieceLayer: vec5.piece_layers,
      mirrors: [url],
      concurrency: 1,
      retryDelayMs: 5,
      maxRetriesPerPiece: 2,
      lookup: publicLookup,
      requestOnce: makeRangeServer(files, {
        onRequest: (req) => {
          const [first] = parseByteRangeHeader(req.headers.range);
          if (first === 2 * vec5.piece_length) {
            piece2Attempts += 1;
            if (piece2Attempts === 1) {
              return {
                statusCode: 503,
                headers: { "content-type": "text/plain" },
                body: Buffer.from("transient unavailable"),
                connectedAddress: PUBLIC_IPV4.address,
              };
            }
          }
          return undefined;
        },
      }),
    });

    expect(Buffer.compare(bytes, vec5Bytes)).toBe(0);
    expect(receipt.accepted).toBe(true);
    expect(piece2Attempts).toBe(2);
    expect(receipt.totalRequests).toBe(6);
    expect(receipt.mirrors[0]!.disqualifiedReason).toBeNull();
  });

  test("local safe_net_overloaded queueing does NOT penalize or disqualify a healthy mirror", async () => {
    const url = "https://healthy.example.org/file.bin";
    const files = new Map([[url, vec5Bytes]]);
    let overloadedOnce = false;

    const { bytes, receipt } = await fetchVerifiedArtifact({
      size: vec5.size,
      expectedSha256: vec5.sha256,
      pieceLength: vec5.piece_length,
      piecesRoot: vec5.pieces_root,
      pieceLayer: vec5.piece_layers,
      mirrors: [url],
      concurrency: 1,
      maxMirrorErrors: 1, // Any counted error would disqualify immediately.
      retryDelayMs: 5,
      maxRetriesPerPiece: 2,
      lookup: publicLookup,
      admission: {
        async acquire() {
          if (!overloadedOnce) {
            overloadedOnce = true;
            throw new SafeNetError("safe_net_overloaded");
          }
          return () => {};
        },
      },
      requestOnce: makeRangeServer(files),
    });

    expect(Buffer.compare(bytes, vec5Bytes)).toBe(0);
    expect(receipt.mirrors[0]!.errors).toBe(0);
    expect(receipt.mirrors[0]!.disqualifiedReason).toBeNull();
  });

  test("disqualifies a mirror after maxMirrorErrors consecutive transient errors and throws all_mirrors_failed", async () => {
    const url = "https://down.example.org/file.bin";
    let calls = 0;

    let caught: unknown;
    try {
      await fetchVerifiedArtifact({
        size: vec5.size,
        expectedSha256: vec5.sha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: [url],
        concurrency: 1,
        maxMirrorErrors: 2,
        maxRetriesPerPiece: 5,
        retryDelayMs: 1,
        lookup: publicLookup,
        requestOnce: async () => {
          calls += 1;
          return {
            statusCode: 503,
            headers: {},
            body: Buffer.from("down"),
            connectedAddress: PUBLIC_IPV4.address,
          };
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TransportHintsFetchError);
    const err = caught as TransportHintsFetchError;
    expect(err.code).toBe("all_mirrors_failed");
    expect(calls).toBe(2);
    const mirrorReceipts = err.details?.mirrors as Array<{ disqualifiedReason: string | null }>;
    expect(mirrorReceipts[0]!.disqualifiedReason).toBe("mirror_exceeded_2_consecutive_errors");
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
      hedgeDelayMs: 5_000,
      lookup: publicLookup,
      requestOnce: makeRangeServer(files, {
        onRequest: (req) => {
          if (req.url.href !== corruptUrl) return undefined;
          const [first, last] = parseByteRangeHeader(req.headers.range);
          const slice = Buffer.from(vec5Bytes.subarray(first, last + 1));
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
    expect(corruptReceipt.requests).toBe(2);
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
    expect(receipt.mirrors.find((m) => m.url === slowUrl)!.errors).toBe(0);
    expect(receipt.mirrors.find((m) => m.url === fastUrl)!.verifiedPieces).toBe(1);
  });

  test("enforces explicit maxRequests budget and whole-transfer transferTimeoutMs", async () => {
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
        maxRequests: 3,
        lookup: publicLookup,
        requestOnce: makeRangeServer(files),
      }),
    ).rejects.toMatchObject({ code: "request_budget_exhausted" });

    await expect(
      fetchVerifiedArtifact({
        size: vec5.size,
        expectedSha256: vec5.sha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: [url],
        concurrency: 1,
        timeoutMs: 5_000,
        transferTimeoutMs: 30,
        lookup: publicLookup,
        requestOnce: (req) =>
          new Promise<SafeNetWireResponse>((_resolve, reject) => {
            req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true });
          }),
      }),
    ).rejects.toMatchObject({ code: "transfer_timeout" });
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

  test("stream yields provisional piece-verified chunks strictly in order and aborts prefetched pieces on early break", async () => {
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

    const seen: Array<{ pieceIndex: number; offset: number; length: number; accepted: boolean }> = [];
    for await (const chunk of stream) {
      seen.push({
        pieceIndex: chunk.pieceIndex,
        offset: chunk.offset,
        length: chunk.bytes.byteLength,
        accepted: chunk.accepted,
      });
      expect(Buffer.compare(chunk.bytes, vec5Bytes.subarray(0, vec5.piece_length))).toBe(0);
      break;
    }

    expect(seen).toEqual([{ pieceIndex: 0, offset: 0, length: vec5.piece_length, accepted: false }]);
    expect(abortedPrefetches).toBe(2);
  });

  test("fetchVerifiedArtifactToFile writes atomically only after SHA-256 acceptance and unlinks temp file on mismatch or refusal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "th-fetch-file-"));
    const url = "https://mirror.example.org/file.bin";
    const files = new Map([[url, vec5Bytes]]);

    try {
      // 1. Happy path: atomic temp -> fsync -> link/unlink, zero temp files left.
      const goodPath = join(dir, "verified.bin");
      const receipt = await fetchVerifiedArtifactToFile({
        outputPath: goodPath,
        size: vec5.size,
        expectedSha256: vec5.sha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: [url],
        concurrency: 2,
        lookup: publicLookup,
        requestOnce: makeRangeServer(files),
      });
      expect(receipt.accepted).toBe(true);
      expect(Buffer.compare(readFileSync(goodPath), vec5Bytes)).toBe(0);
      expect(readdirSync(dir)).toEqual(["verified.bin"]);

      // 2. Refuses overwrite by default without mutating existing file or leaving temp files.
      writeFileSync(goodPath, Buffer.from("sentinel"));
      await expect(
        fetchVerifiedArtifactToFile({
          outputPath: goodPath,
          size: vec5.size,
          expectedSha256: vec5.sha256,
          pieceLength: vec5.piece_length,
          piecesRoot: vec5.pieces_root,
          pieceLayer: vec5.piece_layers,
          mirrors: [url],
          lookup: publicLookup,
          requestOnce: makeRangeServer(files),
        }),
      ).rejects.toMatchObject({ code: "output_exists" });
      expect(readFileSync(goodPath, "utf8")).toBe("sentinel");
      expect(readdirSync(dir)).toEqual(["verified.bin"]);

      // 3. overwrite: true atomically replaces existing file.
      await fetchVerifiedArtifactToFile({
        outputPath: goodPath,
        overwrite: true,
        size: vec5.size,
        expectedSha256: vec5.sha256,
        pieceLength: vec5.piece_length,
        piecesRoot: vec5.pieces_root,
        pieceLayer: vec5.piece_layers,
        mirrors: [url],
        lookup: publicLookup,
        requestOnce: makeRangeServer(files),
      });
      expect(Buffer.compare(readFileSync(goodPath), vec5Bytes)).toBe(0);
      expect(readdirSync(dir)).toEqual(["verified.bin"]);

      // 4. Consumer Rule 9.4 on disk: final_sha256_mismatch leaves NO target file and NO temp file.
      const rejectedPath = join(dir, "rejected.bin");
      const wrongSha = `${vec5.sha256.startsWith("00") ? "ff" : "00"}${vec5.sha256.slice(2)}`;
      await expect(
        fetchVerifiedArtifactToFile({
          outputPath: rejectedPath,
          size: vec5.size,
          expectedSha256: wrongSha,
          pieceLength: vec5.piece_length,
          piecesRoot: vec5.pieces_root,
          pieceLayer: vec5.piece_layers,
          mirrors: [url],
          concurrency: 2,
          lookup: publicLookup,
          requestOnce: makeRangeServer(files),
        }),
      ).rejects.toMatchObject({ code: "final_sha256_mismatch" });
      expect(readdirSync(dir)).toEqual(["verified.bin"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses downgrade redirect to http://, accepts IPv4-mapped dual-stack connectedAddress, and enforces maxInMemoryBytes / invalid subject before buffering", async () => {
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

  test("source hygiene: no BitTorrent wire/DHT/tracker code and no import of build-transport-hints.ts", () => {
    const src = readFileSync(join(ROOT, "bin", "transport-hints-fetch.ts"), "utf8");
    expect(src).not.toMatch(/build-transport-hints/u);
    expect(src).not.toMatch(/node:dgram|createSocket\(|webtorrent|bittorrent|create_torrent/u);
  });
});
