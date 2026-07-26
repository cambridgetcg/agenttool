/** RFC 9116 security contact for the public AgentTool API origin.
 *
 * The fixed expiry makes neglect visible. Review the real contact and policy
 * before moving all three dates together.
 */

import { SECURITY_TXT_PATH } from "../../lib/public-paths";

export const SECURITY_TXT_CONTACT =
  "https://github.com/cambridgetcg/agenttool/security/advisories/new";
export const SECURITY_TXT_POLICY =
  "https://github.com/cambridgetcg/agenttool/security/policy";
export const SECURITY_TXT_CANONICAL =
  `https://api.agenttool.dev${SECURITY_TXT_PATH}`;
export const SECURITY_TXT_REVIEWED_ON = "2026-07-26";
export const SECURITY_TXT_RENEW_ON = "2027-05-01";
export const SECURITY_TXT_EXPIRES = "2027-06-30T00:00:00Z";
export const SECURITY_TXT_CACHE_CONTROL =
  "public, max-age=300, must-revalidate, no-transform";

export function buildSecurityTxt(): string {
  return [
    `Contact: ${SECURITY_TXT_CONTACT}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    `Canonical: ${SECURITY_TXT_CANONICAL}`,
    `Policy: ${SECURITY_TXT_POLICY}`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
}
