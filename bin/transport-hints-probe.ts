/**
 * Web-seed range probe for transport-hints/v1 (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md,
 * section 7.4), kept for later work that lists hosts and records dated
 * observations. It sends ranged GETs for the first byte and for one range
 * inside the file, with Accept-Encoding: identity, and requires for each:
 * 206 Partial Content, exactly `Content-Range: bytes <first>-<last>/<size>`,
 * no Content-Encoding other than `identity`, and a body of exactly the range's
 * length. It follows redirects itself, one request at a time, so that it can
 * count them, refuse a non-HTTPS target and apply the caller's egress check at
 * every hop.
 *
 * It takes the fetch function as a parameter and has no default: nothing here
 * opens a connection by itself. Its test injects a fake fetch
 * (bin/tests/transport-hints.test.ts); no code in this repository calls it
 * against the network yet.
 */

export interface ProbeHeaders {
  get(name: string): string | null;
}

export interface ProbeResponse {
  readonly status: number;
  readonly headers: ProbeHeaders;
  readonly body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ProbeRequestInit {
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect: "manual";
}

export type ProbeFetch = (url: string, init: ProbeRequestInit) => Promise<ProbeResponse>;

export interface ProbeOptions {
  /** The web seed: the full HTTPS URL of the one file. */
  readonly url: string;
  /** The subject's exact size from the descriptor. */
  readonly size: number;
  /** The fetch function; the probe never chooses one itself. */
  readonly fetch: ProbeFetch;
  /** Redirect hops allowed per request; the draft allows at most one. */
  readonly maxRedirects?: number;
  /** The caller's egress policy, applied to the first URL and to every redirect target. */
  readonly allowUrl?: (url: URL) => boolean;
  /** Bytes requested inside the file (default 1,024). */
  readonly midRangeLength?: number;
}

export interface RangeCheck {
  readonly first: number;
  readonly last: number;
  readonly ok: boolean;
  readonly status: number | null;
  readonly contentRange: string | null;
  readonly contentEncoding: string | null;
  readonly bodyBytes: number | null;
  readonly redirects: number;
  readonly finalUrl: string;
  readonly problems: readonly string[];
}

export interface ProbeResult {
  readonly url: string;
  readonly size: number;
  readonly ok: boolean;
  /** The largest number of redirects any range request followed. */
  readonly redirects: number;
  readonly ranges: readonly RangeCheck[];
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** The ranges the probe asks for: the first byte, then one range around the middle. */
export function probeRanges(size: number, midRangeLength = 1024): Array<[number, number]> {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("size must be a positive integer");
  if (!Number.isSafeInteger(midRangeLength) || midRangeLength < 1) throw new Error("midRangeLength must be a positive integer");
  const first = Math.floor(size / 2);
  const mid: [number, number] = [first, Math.min(first + midRangeLength - 1, size - 1)];
  return mid[0] === 0 ? [[0, 0]] : [[0, 0], mid];
}

function defaultAllow(url: URL): boolean {
  return url.protocol === "https:" && url.username === "" && url.password === "";
}

async function readCapped(response: ProbeResponse, cap: number): Promise<number | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const length = (await response.arrayBuffer()).byteLength;
    return length > cap ? null : length;
  }
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
  }
}

async function discard(response: ProbeResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body that cannot be cancelled is left to the fetch implementation.
  }
}

async function checkRange(options: ProbeOptions, first: number, last: number): Promise<RangeCheck> {
  const allow = options.allowUrl ?? defaultAllow;
  const maxRedirects = options.maxRedirects ?? 1;
  const problems: string[] = [];
  let url = options.url;
  let redirects = 0;
  const result = (fields: Partial<RangeCheck>): RangeCheck => ({
    first,
    last,
    ok: false,
    status: null,
    contentRange: null,
    contentEncoding: null,
    bodyBytes: null,
    redirects,
    finalUrl: url,
    ...fields,
    problems,
  });
  while (true) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      problems.push(`not a URL: ${url}`);
      return result({});
    }
    if (!allow(parsed)) {
      problems.push(`refused by the egress policy: ${url}`);
      return result({});
    }
    let response: ProbeResponse;
    try {
      response = await options.fetch(url, {
        method: "GET",
        headers: { Range: `bytes=${first}-${last}`, "Accept-Encoding": "identity" },
        redirect: "manual",
      });
    } catch (error) {
      problems.push(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      return result({});
    }
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get("location");
      await discard(response);
      if (!location) {
        problems.push(`redirect ${response.status} without a Location header`);
        return result({ status: response.status });
      }
      redirects += 1;
      if (redirects > maxRedirects) {
        problems.push(`more than ${maxRedirects} redirect(s)`);
        return result({ status: response.status });
      }
      url = new URL(location, url).href;
      continue;
    }
    const contentRange = response.headers.get("content-range");
    const contentEncoding = response.headers.get("content-encoding");
    const expectedRange = `bytes ${first}-${last}/${options.size}`;
    if (response.status !== 206) problems.push(`status ${response.status}, not 206 Partial Content`);
    if (contentRange !== expectedRange) problems.push(`Content-Range is ${contentRange ?? "absent"}, not '${expectedRange}'`);
    if (contentEncoding !== null && contentEncoding.trim().toLowerCase() !== "identity") {
      problems.push(`Content-Encoding is '${contentEncoding}'`);
    }
    let bodyBytes: number | null = null;
    if (problems.length === 0) {
      bodyBytes = await readCapped(response, last - first + 1);
      if (bodyBytes !== last - first + 1) problems.push(`the body is not exactly ${last - first + 1} bytes`);
    } else {
      await discard(response);
    }
    return result({ ok: problems.length === 0, status: response.status, contentRange, contentEncoding, bodyBytes });
  }
}

/** Probe one web seed. The result is a dated observation's raw material, never a guarantee. */
export async function probeWebSeed(options: ProbeOptions): Promise<ProbeResult> {
  if (typeof options.fetch !== "function") throw new Error("probeWebSeed needs an explicit fetch function");
  const ranges: RangeCheck[] = [];
  for (const [first, last] of probeRanges(options.size, options.midRangeLength)) {
    ranges.push(await checkRange(options, first, last));
  }
  return {
    url: options.url,
    size: options.size,
    ok: ranges.every((range) => range.ok),
    redirects: Math.max(...ranges.map((range) => range.redirects)),
    ranges,
  };
}
