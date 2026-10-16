/** Egress gate: the one check any later transport runs before text leaves
 * this device (a fleet card, a knock note, table talk). Import it alone from
 * "@agenttool/lobby/egress"; it pulls in no MCP or transport code.
 *
 * It fails closed. A room whose residency is `device` can send nothing at all.
 * Otherwise the text is refused when it carries a shape that identifies this
 * machine, its owner's files, local coordination ids or credentials. Reasons
 * are closed codes; matched text is never echoed back.
 *
 * Known limits (see README): pattern matching is not understanding. Hex runs
 * are allowed so commit SHAs and digests can be cited, which means a
 * hex-encoded secret is not caught; lookalike letters from other scripts are
 * not folded; a dotted run of five or more numbers reads as a version and
 * dash-encoded addresses are not recognised; and some harmless text is
 * refused (for example a mixed-case URL path of 40+ characters, a URL path
 * containing /users/, or a file named settings.local.json).
 */
import { foldForMatch, mentionsDeviceOnlyTerm, visibleForm } from "./text.js";

export const MAX_EGRESS_CHARS = 65_536;

export const EGRESS_REASONS = [
  "room_context_missing",
  "room_residency_unknown",
  "room_residency_device",
  "room_device_only_term",
  "text_not_string",
  "text_too_large",
  "device_only_term",
  "private_ipv4",
  "private_ipv6",
  "local_hostname",
  "device_name",
  "local_device_name",
  "home_path",
  "tilde_path",
  "collab_workspace_id",
  "agenttool_token",
  "pem_block",
  "key_like_base64",
] as const;

export type EgressReason = typeof EGRESS_REASONS[number];

/** The room the text would be sent in. Only residency is required; any card
 * text supplied is also checked, so a mislabelled room cannot carry device-only work.
 *
 * The gate does not read `hostable`. It decides whether text may leave this
 * device at all; a transport that would put a room's text on a hosted service
 * must also refuse every room whose card says `hostable: false`. */
export interface EgressRoom {
  residency: string;
  title?: string;
  purpose?: string;
  house_rules?: string;
  tags?: readonly string[];
  slots?: readonly { label: string }[];
}

/** Optional context a transport adds: this machine's own names (for example
 * its hostname without `.local`). Each term is matched case-insensitively
 * after the same folding, with the separators between its words allowed to vary. */
export interface EgressOptions {
  room: EgressRoom;
  deviceTerms?: readonly string[];
}

export interface EgressResult {
  ok: boolean;
  reasons: EgressReason[];
}

// An address must not start in the middle of a longer number run such as the
// version 1.10.0.0.1: no digit right before it, and no "N." whose number is
// itself the start of a run. A hostname label before it ("app.", "v2.") does
// not excuse it, so wildcard-DNS names such as app.10.0.0.7.nip.io are caught.
const NOT_MID_NUMBER = String.raw`(?<!\d)(?<!(?:^|[^A-Za-z0-9-])\d+\.)`;
const DOTTED_QUAD = new RegExp(
  String.raw`${NOT_MID_NUMBER}(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\.?\d)`,
  "g",
);
// Partial private prefixes as people write them: "192.168.1.x", "169.254.", "172.16.0.*".
const PRIVATE_IPV4_PREFIX = [
  String.raw`192\.168\.(?:\d|x|\*)`,
  String.raw`169\.254\.(?:\d|x|\*)`,
  String.raw`172\.(?:1[6-9]|2\d|3[01])\.(?:\d|x|\*)`,
  String.raw`10\.(?:\d{1,3}|x|\*)\.(?:\d{1,3}|x|\*)\.(?:x|\*)`,
].map((pattern) => new RegExp(`${NOT_MID_NUMBER}${pattern}`, "i"));
const PRIVATE_IPV6 = [
  /(?<![0-9a-f:])fe[89ab][0-9a-f]:[0-9a-f]{0,4}:/i, // fe80::/10 link-local
  /(?<![0-9a-f:])f[cd][0-9a-f]{2}:[0-9a-f]{0,4}:/i, // fc00::/7 unique-local
];
// A label character, a dot, then a LAN-only suffix. Linear on purpose: a
// full hostname grammar backtracks quadratically on long dotted input.
const LOCAL_HOSTNAME = /[a-z0-9]\.(?:local|lan|home\.arpa)(?![a-z0-9-])/i;
// Device model words that default machine names carry ("Someones-MacBook-Pro").
// Matched on folded, lower-cased text.
const DEVICE_NAME = /macbook|(?<![a-z])imac(?![a-z])|mac[\s._-]?(?:mini|studio|pro)(?![a-z])|iphone|ipad(?![a-z])/;
const TERM_SEPARATOR = /[\s._-]+/;
const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/g;
const HOME_PATH = [
  /\/(?:users|home)\//i,
  /(?<![a-z])[a-z]:[\\/]+users[\\/]/i,
  /\/(?:private\/)?var\/folders\//i,
];
const TILDE_PATH = [
  /(?<![A-Za-z0-9_])~[A-Za-z0-9._-]{0,32}\//,
  /\$\{?HOME\}?(?![A-Za-z0-9_])/,
  /%USERPROFILE%/i,
];
// No trailing boundary: ws_ + 24 hex followed by more hex is still refused.
const COLLAB_WORKSPACE_ID = /ws_[0-9a-f]{24}/i;
const MISSION_TOKEN = /(?<![A-Za-z0-9])atcm_[A-Za-z0-9_-]{8,}/;
const BEARER_TOKEN = /(?<![A-Za-z0-9])at_([A-Za-z0-9_-]{8,})/g;
const PEM_BLOCK = /-----\s*BEGIN [A-Z0-9 ]{1,64}-----/i;
const BASE64_RUN = /[A-Za-z0-9+/_-]{40,}={0,2}/g;

function isPrivateIpv4(a: number, b: number): boolean {
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

function hasPrivateIpv4(text: string): boolean {
  for (const match of text.matchAll(DOTTED_QUAD)) {
    const octets = match.slice(1, 5).map((part) => Number.parseInt(part ?? "", 10));
    if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) continue;
    if (isPrivateIpv4(octets[0]!, octets[1]!)) return true;
  }
  return PRIVATE_IPV4_PREFIX.some((pattern) => pattern.test(text));
}

function hasAgentToolToken(text: string): boolean {
  if (MISSION_TOKEN.test(text)) return true;
  for (const match of text.matchAll(BEARER_TOKEN)) {
    // Random token material has capitals or digits; snake_case words such as
    // "at_least_once" do not.
    if (/[A-Z0-9]/.test(match[1] ?? "")) return true;
  }
  return false;
}

function hasKeyLikeBase64(text: string): boolean {
  for (const match of text.matchAll(BASE64_RUN)) {
    const run = match[0].replace(/=+$/, "");
    if (/^[0-9a-f]+$/i.test(run)) continue; // commit SHAs and digests stay citable
    if (/[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run)) return true;
  }
  return false;
}

function contentReasons(text: string): Set<EgressReason> {
  const reasons = new Set<EgressReason>();
  if (mentionsDeviceOnlyTerm(text)) reasons.add("device_only_term");
  if (hasPrivateIpv4(text)) reasons.add("private_ipv4");
  if (PRIVATE_IPV6.some((pattern) => pattern.test(text))) reasons.add("private_ipv6");
  if (LOCAL_HOSTNAME.test(text)) reasons.add("local_hostname");
  if (HOME_PATH.some((pattern) => pattern.test(text))) reasons.add("home_path");
  if (TILDE_PATH.some((pattern) => pattern.test(text))) reasons.add("tilde_path");
  if (COLLAB_WORKSPACE_ID.test(text)) reasons.add("collab_workspace_id");
  if (hasAgentToolToken(text)) reasons.add("agenttool_token");
  if (PEM_BLOCK.test(text)) reasons.add("pem_block");
  if (hasKeyLikeBase64(text)) reasons.add("key_like_base64");
  return reasons;
}

function deviceTermPatterns(terms: unknown): RegExp[] {
  if (!Array.isArray(terms)) return [];
  const patterns: RegExp[] = [];
  for (const term of terms) {
    if (typeof term !== "string") continue;
    const words = foldForMatch(term).split(TERM_SEPARATOR).filter((word) => word.length > 0);
    if (words.join("").length < 4) continue;
    const escaped = words.map((word) => word.replace(REGEX_SPECIAL, "\\$&"));
    patterns.push(new RegExp(escaped.join("[\\s._-]{0,3}")));
  }
  return patterns;
}

function roomReasons(room: unknown): EgressReason[] {
  if (room === null || typeof room !== "object" || Array.isArray(room)) return ["room_context_missing"];
  const value = room as EgressRoom;
  const reasons: EgressReason[] = [];
  if (value.residency === "device") reasons.push("room_residency_device");
  else if (value.residency !== "fleet" && value.residency !== "open") reasons.push("room_residency_unknown");
  const texts: unknown[] = [
    value.title,
    value.purpose,
    value.house_rules,
    ...(Array.isArray(value.tags) ? value.tags : []),
    ...(Array.isArray(value.slots) ? value.slots.map((slot) => slot?.label) : []),
  ];
  if (texts.some((text) => typeof text === "string" && mentionsDeviceOnlyTerm(text))) {
    reasons.push("room_device_only_term");
  }
  return reasons;
}

/** Decide whether `text` may leave this device in `room`. Fails closed. */
export function checkEgress(text: string, options: EgressOptions): EgressResult {
  const found = new Set<EgressReason>(roomReasons(options?.room));
  const devicePatterns = deviceTermPatterns(options?.deviceTerms);
  if (typeof text !== "string") {
    found.add("text_not_string");
  } else if (text.length > MAX_EGRESS_CHARS) {
    found.add("text_too_large");
  } else {
    // Check the text as written and as displayed: NFKC folds full-width
    // digits and slashes, and format and default-ignorable characters
    // (zero-width, variation selectors, tag characters) are removed.
    for (const variant of [text, visibleForm(text), foldForMatch(text)]) {
      for (const reason of contentReasons(variant)) found.add(reason);
    }
    const folded = foldForMatch(text);
    if (DEVICE_NAME.test(folded)) found.add("device_name");
    if (devicePatterns.some((pattern) => pattern.test(folded))) found.add("local_device_name");
  }
  const reasons = EGRESS_REASONS.filter((reason) => found.has(reason));
  return { ok: reasons.length === 0, reasons };
}
