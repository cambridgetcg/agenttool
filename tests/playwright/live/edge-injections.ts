/** Edge rewrites that production adds to committed HTML. Each is listed on
 * every live run instead of failing it, because its fix is a zone setting
 * rather than a commit. Remove an entry once the setting is changed. */
import type { Violation } from "../specs/helpers/page-policy";

export const EDGE_INJECTIONS = [
  {
    name: "Cloudflare Web Analytics beacon",
    directive: "script-src-elem",
    origin: "https://static.cloudflareinsights.com",
    remedy: "turn off automatic Web Analytics injection for these hostnames in the Cloudflare dashboard, or allow the origin in script-src-elem",
  },
] as const;

export function edgeInjection(violation: Violation) {
  return EDGE_INJECTIONS.find((injection) =>
    violation.directive === injection.directive && violation.blocked.startsWith(injection.origin + "/"));
}
