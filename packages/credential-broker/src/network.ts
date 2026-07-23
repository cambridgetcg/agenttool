import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { HostResolver } from "./types.js";

export const systemResolver: HostResolver = {
  async resolve(hostname) {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
  },
};

function ipv4Bytes(input: string): number[] | null {
  if (isIP(input) !== 4) return null;
  const parts = input.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function ipv6Bytes(input: string): Uint8Array | null {
  const clean = input.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (isIP(clean) !== 6) return null;
  let source = clean.toLowerCase();
  let ipv4Tail: number[] | null = null;
  const lastColon = source.lastIndexOf(":");
  const tail = source.slice(lastColon + 1);
  if (tail.includes(".")) {
    ipv4Tail = ipv4Bytes(tail);
    if (!ipv4Tail) return null;
    source = `${source.slice(0, lastColon)}:${((ipv4Tail[0]! << 8) | ipv4Tail[1]!).toString(16)}:${((ipv4Tail[2]! << 8) | ipv4Tail[3]!).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    const value = Number.parseInt(groups[index]!, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffff) return null;
    out[index * 2] = value >>> 8;
    out[index * 2 + 1] = value & 0xff;
  }
  return out;
}

function inV4(bytes: number[], first: number, maskBits: number): boolean {
  const value = (((bytes[0]! << 24) >>> 0) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const network = first >>> 0;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (value & mask) === (network & mask);
}

function ipv4Number(a: number, b = 0, c = 0, d = 0): number {
  return (((a << 24) >>> 0) | (b << 16) | (c << 8) | d) >>> 0;
}

export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Bytes(address);
  if (v4) {
    const denied: Array<[number, number]> = [
      [ipv4Number(0), 8],
      [ipv4Number(10), 8],
      [ipv4Number(100, 64), 10],
      [ipv4Number(127), 8],
      [ipv4Number(169, 254), 16],
      [ipv4Number(172, 16), 12],
      [ipv4Number(192, 0), 24],
      [ipv4Number(192, 0, 2), 24],
      [ipv4Number(192, 88, 99), 24],
      [ipv4Number(192, 168), 16],
      [ipv4Number(198, 18), 15],
      [ipv4Number(198, 51, 100), 24],
      [ipv4Number(203, 0, 113), 24],
      [ipv4Number(224), 4],
      [ipv4Number(240), 4],
    ];
    return !denied.some(([network, bits]) => inV4(v4, network, bits));
  }

  const v6 = ipv6Bytes(address);
  if (!v6) return false;
  const allZero = v6.every((byte) => byte === 0);
  const loopback = v6.slice(0, 15).every((byte) => byte === 0) && v6[15] === 1;
  if (allZero || loopback) return false;
  // IPv4-mapped IPv6. Apply the IPv4 policy to the embedded address.
  if (v6.slice(0, 10).every((byte) => byte === 0) && v6[10] === 0xff && v6[11] === 0xff) {
    return isPublicAddress(`${v6[12]}.${v6[13]}.${v6[14]}.${v6[15]}`);
  }
  // Allow only global unicast 2000::/3, minus the conservative set of
  // non-global/reserved ranges in the IANA special-purpose registry. We deny
  // the whole 2001::/23 protocol-assignment block rather than trying to allow
  // its handful of more-specific anycast/overlay exceptions.
  if ((v6[0]! & 0xe0) !== 0x20) return false;
  if (v6[0] === 0x20 && v6[1] === 0x01 && (v6[2]! & 0xfe) === 0) return false; // 2001::/23
  if (v6[0] === 0x20 && v6[1] === 0x01 && v6[2] === 0x0d && v6[3] === 0xb8) return false; // 2001:db8::/32
  if (v6[0] === 0x20 && v6[1] === 0x02) return false; // 6to4
  if (v6[0] === 0x3f && v6[1] === 0xfe) return false; // returned 6bone space
  if (v6[0] === 0x3f && v6[1] === 0xff && (v6[2]! & 0xf0) === 0) return false; // documentation 3fff::/20
  return true;
}
