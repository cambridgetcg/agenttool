/**
 * Synthetic lobby packets in the lobby's exact layout
 * (JSON.stringify(packet, null, 2) + "\n", keys in the lobby's order).
 * Every id, key and signature here is freshly random: no real ids, hosts,
 * addresses or keys. Fingerprints are computed as packages/lobby pins.ts does
 * (first 16 hex of sha256 over the raw 32-byte ed25519 key).
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";

export const ORIGIN = "https://api.agenttool.dev";
export const ENROLL_FORMAT = "agenttool-lobby-enrollment-packet/v1";
export const JOIN_FORMAT = "agenttool-lobby-join/v1";

export interface KeyFacts {
  raw: Buffer;
  b64: string;
  b64url: string;
  hex: string;
  fp: string;
}

export function newKey(): KeyFacts {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const raw = Buffer.from(der.subarray(der.length - 32));
  return {
    raw,
    b64: raw.toString("base64"),
    b64url: raw.toString("base64url"),
    hex: raw.toString("hex"),
    fp: createHash("sha256").update(raw).digest("hex").slice(0, 16),
  };
}

/** Every way a key or fingerprint could leak, for case-insensitive search. */
export function needles(...keys: KeyFacts[]): string[] {
  return keys.flatMap((k) => [k.fp, k.b64, k.b64.replace(/=+$/, ""), k.b64url, k.hex]);
}

export function containsNeedle(hay: string, list: string[]): string | null {
  const lower = hay.toLowerCase();
  for (const n of list) if (lower.includes(n.toLowerCase())) return n;
  return null;
}

const hex64 = () => randomBytes(32).toString("hex");

export interface EnrollOptions {
  kind?: "enroll" | "renew";
  desk?: KeyFacts;
  now?: Date;
  validMs?: number;
  displayName?: string;
}

export function enrollPacket(opts: EnrollOptions = {}): { text: string; desk: KeyFacts; packet: Record<string, unknown> } {
  const kind = opts.kind ?? "renew";
  const desk = opts.desk ?? newKey();
  const now = opts.now ?? new Date();
  const validMs = opts.validMs ?? (kind === "enroll" ? 5 * 60_000 : 30 * 60_000);
  const projectId = randomUUID();
  const identityId = randomUUID();
  const signingKeyId = randomUUID();
  const displayName = opts.displayName ?? "test desk";
  const request = kind === "enroll"
    ? {
      format: "agenttool-identity-enrollment-request/v1",
      origin: ORIGIN,
      method: "POST",
      request_target: "/v1/identities/enroll",
      body_utf8: JSON.stringify({
        format: "agenttool-identity-enrollment/v1",
        origin: ORIGIN,
        project_id: projectId,
        identity_id: identityId,
        signing_key_id: signingKeyId,
        display_name: displayName,
        capabilities: [],
        public_key: desk.b64,
        nonce: randomBytes(32).toString("base64url"),
        timestamp: now.toISOString(),
      }),
      headers: { "Content-Type": "application/json", "X-Agenttool-Enrollment-Signature": randomBytes(64).toString("base64url") },
    }
    : null;
  const packet = {
    format: ENROLL_FORMAT,
    kind,
    origin: ORIGIN,
    project_id: projectId,
    identity_id: identityId,
    signing_key_id: signingKeyId,
    public_key: desk.b64,
    fingerprint: desk.fp,
    display_name: displayName,
    directory_token_sha256: hex64(),
    issued_at: now.toISOString(),
    valid_until: new Date(now.getTime() + validMs).toISOString(),
    enrollment_request: request,
    packet_sig: randomBytes(64).toString("hex"),
  };
  return { text: `${JSON.stringify(packet, null, 2)}\n`, desk, packet };
}

export function joinPacket(opts: { desk?: KeyFacts; door?: KeyFacts } = {}): { text: string; desk: KeyFacts; door: KeyFacts } {
  const desk = opts.desk ?? newKey();
  const door = opts.door ?? newKey();
  const missionId = randomUUID();
  const packet = {
    format: JOIN_FORMAT,
    origin: ORIGIN,
    project_id: randomUUID(),
    door: { public_key: door.b64, fingerprint: door.fp },
    directory: { mission_id: missionId, mission_digest: `sha256:${hex64()}` },
    invitation_template: {
      format: "agenttool-mission-invitation-template/v1",
      origin: ORIGIN,
      mission_id: missionId,
      grant_id: randomUUID(),
      identity_id: randomUUID(),
      signing_key_id: randomUUID(),
      public_key: desk.b64,
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      token_sha256: hex64(),
    },
  };
  return { text: `${JSON.stringify(packet, null, 2)}\n`, desk, door };
}

/** A renew packet padded through display_name to exactly `size` bytes. */
export function paddedPacket(size: number): string {
  const base = enrollPacket({ kind: "renew", displayName: "x" });
  const extra = size - Buffer.byteLength(base.text);
  if (extra < 0) throw new Error("base packet too large");
  const packet = { ...base.packet, display_name: "x".repeat(1 + extra) };
  const text = `${JSON.stringify(packet, null, 2)}\n`;
  if (Buffer.byteLength(text) !== size) throw new Error("padding miscounted");
  return text;
}

/** Refusal corpus for the enrollment check, shared by the gate and the client. */
export function badEnrollCorpus(): { name: string; bytes: Buffer }[] {
  const good = enrollPacket({ kind: "renew" }).text;
  const withName = (raw: Buffer) => {
    const [a, b] = good.split('"test desk"');
    return Buffer.concat([Buffer.from(`${a}"test `), raw, Buffer.from(`desk"${b}`)]);
  };
  const lines = good.split("\n");
  const extraKey = good.replace('  "kind": ', '  "extra": 1,\n  "kind": ');
  const missingKey = lines.filter((l) => !l.startsWith('  "display_name"')).join("\n");
  const join = joinPacket().text;
  return [
    { name: "65537 bytes", bytes: Buffer.from(paddedPacket(65_537)) },
    { name: "an \\xff inside display_name", bytes: withName(Buffer.from([0xff])) },
    { name: "NUL", bytes: withName(Buffer.from([0x00])) },
    { name: "CR", bytes: Buffer.from(good.replace("\n", "\r\n")) },
    { name: "ESC", bytes: withName(Buffer.from([0x1b])) },
    { name: "DEL", bytes: withName(Buffer.from([0x7f])) },
    { name: "a BOM", bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(good)]) },
    { name: "truncated JSON", bytes: Buffer.from(good.slice(0, Math.floor(good.length / 2))) },
    { name: "an extra key", bytes: Buffer.from(extraKey) },
    { name: "a missing key", bytes: Buffer.from(missingKey) },
    { name: "a join packet", bytes: Buffer.from(join) },
    { name: "a wrong format line", bytes: Buffer.from(good.replace(ENROLL_FORMAT, "agenttool-lobby-enrollment-packet/v2")) },
    { name: "format not first", bytes: Buffer.from(good.replace(`  "format": "${ENROLL_FORMAT}",\n  "kind": "renew",`, `  "kind": "renew",\n  "format": "${ENROLL_FORMAT}",`)) },
    { name: "an empty file", bytes: Buffer.alloc(0) },
  ];
}
