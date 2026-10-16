/** Egress gate: the one check any later transport runs before text leaves
 * this device (a fleet card, a knock note, table talk).
 *
 * It fails closed. A room whose residency is `device` can send nothing at all.
 * Otherwise the text is refused when it carries a shape that identifies this
 * machine, its owner's files, local coordination ids or credentials. Reasons
 * are closed codes; matched text is never echoed back.
 *
 * Known limits (see README): pattern matching is not understanding. Hex runs
 * are allowed so commit SHAs and digests can be cited, which means a
 * hex-encoded secret is not caught; lookalike letters from other scripts are
 * not folded; and some harmless text is refused (for example a mixed-case
 * URL path of 40+ characters, or a file named settings.local.json).
 */
import { foldForMatch, mentionsDeviceOnlyTerm } from "./text.js";

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
  "home_path",
  "tilde_path",
  "collab_workspace_id",
  "agenttool_token",
  "pem_block",
  "key_like_base64",
] as const;

export type EgressReason = typeof EGRESS_REASONS[number];

/** The room the text would be sent in. Only residency is required; any card
 * text supplied is also checked, so a mislabelled room cannot carry device-only work. */
export interface EgressRoom {
  residency: string;
  title?: string;
  purpose?: string;
  house_rules?: string;
  tags?: readonly string[];
  slots?: readonly { label: string }[];
}

export interface EgressResult {
  ok: boolean;
  reasons: EgressReason[];
}

const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

const DOTTED_QUAD = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\.?\d)/g;
// Partial private prefixes as people write them: "192.168.1.x", "169.254.", "172.16.0.*".
const PRIVATE_IPV4_PREFIX = [
  /(?<![\d.])192\.168\.(?:\d|x|\*)/i,
  /(?<![\d.])169\.254\.(?:\d|x|\*)/i,
  /(?<![\d.])172\.(?:1[6-9]|2\d|3[01])\.(?:\d|x|\*)/i,
  /(?<![\d.])10\.(?:\d{1,3}|x|\*)\.(?:\d{1,3}|x|\*)\.(?:x|\*)/i,
];
const PRIVATE_IPV6 = [
  /(?<![0-9a-f:])fe[89ab][0-9a-f]:[0-9a-f]{0,4}:/i, // fe80::/10 link-local
  /(?<![0-9a-f:])f[cd][0-9a-f]{2}:[0-9a-f]{0,4}:/i, // fc00::/7 unique-local
];
// A label character, a dot, then a LAN-only suffix. Linear on purpose: a
// full hostname grammar backtracks quadratically on long dotted input.
const LOCAL_HOSTNAME = /[a-z0-9]\.(?:local|lan|home\.arpa)(?![a-z0-9-])/i;
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
const COLLAB_WORKSPACE_ID = /ws_[0-9a-f]{24}(?![0-9a-f])/i;
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
export function checkEgress(text: string, options: { room: EgressRoom }): EgressResult {
  const found = new Set<EgressReason>(roomReasons(options?.room));
  if (typeof text !== "string") {
    found.add("text_not_string");
  } else if (text.length > MAX_EGRESS_CHARS) {
    found.add("text_too_large");
  } else {
    // Check the text as written and as displayed: NFKC folds full-width
    // digits and slashes, and invisible separators are removed.
    const visible = text.normalize("NFKC").replace(INVISIBLE, "");
    for (const variant of [text, visible, foldForMatch(text)]) {
      for (const reason of contentReasons(variant)) found.add(reason);
    }
  }
  const reasons = EGRESS_REASONS.filter((reason) => found.has(reason));
  return { ok: reasons.length === 0, reasons };
}
