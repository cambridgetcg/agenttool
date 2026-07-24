/** Pure extraction of an edge-authenticated client IP.
 *
 * Fly's injected address always wins. Other forwarding headers are accepted
 * only when an operator explicitly says direct origin access is blocked.
 * Otherwise callers share the conservative "unknown" bucket instead of
 * choosing their own rate-limit key.
 */

import { isIP } from "node:net";

function validIp(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isIP(trimmed) ? trimmed : null;
}

export function clientIp(
  req: Request,
  options: { trustProxyHeaders?: boolean } = {},
): string {
  const fly = validIp(req.headers.get("fly-client-ip"));
  if (fly) return fly;

  const trustProxyHeaders =
    options.trustProxyHeaders ??
    process.env.AGENTTOOL_TRUST_PROXY_IP_HEADERS === "1";
  if (!trustProxyHeaders) return "unknown";

  const cf = validIp(req.headers.get("cf-connecting-ip"));
  if (cf) return cf;
  const firstForwarded = req.headers.get("x-forwarded-for")?.split(",")[0] ?? null;
  const xff = validIp(firstForwarded);
  if (xff) return xff;
  const xri = validIp(req.headers.get("x-real-ip"));
  if (xri) return xri;
  return "unknown";
}
