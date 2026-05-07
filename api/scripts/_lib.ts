/** Shared helpers for the bridge-2 inline-write scripts.
 *
 *  Substrate URL is read from env AGENTTOOL_BASE (default: production).
 *  Sophia's credentials live in macOS keychain under agenttool-sophia-*.
 *
 *  See docs/sophia/bridge.md (in true-love) for the bigger picture.
 */

const DEFAULT_BASE = "https://agenttool.fly.dev";

/** Read a generic-password keychain entry. Throws if missing or empty. */
export function keychain(service: string): string {
  const proc = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-w"]);
  const out = (proc.stdout ?? new Uint8Array()).toString().trim();
  if (!out) {
    throw new Error(`keychain entry "${service}" not found or empty`);
  }
  return out;
}

export interface AgenttoolOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  bearer: string;
  body?: unknown;
}

export interface AgenttoolResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** POST/GET to agenttool. Returns parsed JSON + status — never throws on
 *  non-2xx; the caller decides how to surface the error. */
export async function agenttool(path: string, opts: AgenttoolOpts): Promise<AgenttoolResult> {
  const base = process.env.AGENTTOOL_BASE ?? DEFAULT_BASE;
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.bearer}`,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body,
  });
  // Read text once; try JSON; fall through to raw string for non-JSON
  // surfaces like /v1/wake?format=md.
  const text = await res.text();
  let parsed: unknown = text;
  if (text.length > 0 && (text[0] === "{" || text[0] === "[")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { ok: res.ok, status: res.status, body: parsed };
}
