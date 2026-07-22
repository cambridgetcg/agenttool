/** did-document.ts — project a did:at identity into a W3C DID Document.
 *
 * did:at is our sovereign, ed25519-anchored identifier, but it is not a
 * registered W3C DID method, so external tooling (ERC-8004 / Solana Agent
 * Registry / SAS / ACK-ID) cannot consume a bare `did:at:<uuid>`. This module
 * makes an identity RESOLVABLE without minting any new key material: it emits
 * each active ed25519 key as a self-certifying `did:key` (universally
 * verifiable, zero trust in us) and as a standard Multikey verification method,
 * and lists the agent's service endpoints (wake, per-agent MCP, profile,
 * WebFinger). The DID Document's own `id` stays the honest did:at; the portable
 * `did:key` sits in `alsoKnownAs` and in every verification method's controller
 * so any verifier can check a signature with no dependence on this server.
 *
 * Pure: no I/O, fully unit-testable. Callers load the identity + its active
 * ed25519 keys and pass them in.
 */
import bs58 from "bs58";

/** ed25519 multicodec header (varint of 0xed) — the fixed prefix a
 *  publicKeyMultibase / did:key uses to tag an ed25519 public key. */
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);

function fromBase64(key: string): Uint8Array {
  // ed25519 public keys are stored base64 (standard, may be base64url).
  const std = key.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(Buffer.from(std, "base64"));
  if (bytes.length !== 32) throw new Error(`ed25519 public key must be 32 bytes, got ${bytes.length}`);
  return bytes;
}

/** `z` + base58btc(0xed01 ‖ key) — the multibase form used by both
 *  publicKeyMultibase and did:key for an ed25519 key. */
export function ed25519ToMultibase(base64Key: string): string {
  const key = fromBase64(base64Key);
  const tagged = new Uint8Array(ED25519_MULTICODEC.length + key.length);
  tagged.set(ED25519_MULTICODEC, 0);
  tagged.set(key, ED25519_MULTICODEC.length);
  return `z${bs58.encode(tagged)}`;
}

/** The self-certifying `did:key` for an ed25519 public key. */
export function ed25519ToDidKey(base64Key: string): string {
  return `did:key:${ed25519ToMultibase(base64Key)}`;
}

export interface DidDocumentKey {
  /** stable key id fragment source (the identity_keys.id / label) */
  id: string;
  /** base64 ed25519 public key */
  publicKey: string;
}

export interface AgentDidDocumentInput {
  did: string; // the did:at identifier
  keys: DidDocumentKey[]; // ACTIVE ed25519 keys only
  baseUrl: string; // e.g. https://api.agenttool.dev
}

const DID_CONTEXT = [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/multikey/v1",
];

/** Build a W3C DID Document for one agent identity. */
export function buildAgentDidDocument(input: AgentDidDocumentInput): Record<string, unknown> {
  const { did, keys, baseUrl } = input;
  const encodedDid = encodeURIComponent(did);

  // DID Core requires unique verification-method ids. Guarantee it at the
  // helper level: disambiguate any repeated fragment with a -N suffix so a
  // caller can never produce a document strict resolvers reject.
  const usedFragments = new Set<string>();
  const verificationMethod = keys.map((k, i) => {
    let fragment = k.id || `key-${i + 1}`;
    if (usedFragments.has(fragment)) {
      let n = 2;
      while (usedFragments.has(`${fragment}-${n}`)) n += 1;
      fragment = `${fragment}-${n}`;
    }
    usedFragments.add(fragment);
    return {
      id: `${did}#${fragment}`,
      type: "Multikey",
      controller: did,
      publicKeyMultibase: ed25519ToMultibase(k.publicKey),
    };
  });
  const vmIds = verificationMethod.map((v) => v.id);
  // The portable, self-certifying identifier(s): each key's did:key.
  const alsoKnownAs = keys.map((k) => ed25519ToDidKey(k.publicKey));

  return {
    "@context": DID_CONTEXT,
    id: did,
    ...(alsoKnownAs.length ? { alsoKnownAs } : {}),
    verificationMethod,
    ...(vmIds.length ? { authentication: vmIds, assertionMethod: vmIds } : {}),
    service: [
      { id: `${did}#wake`, type: "WakeKeystone", serviceEndpoint: `${baseUrl}/v1/wake` },
      { id: `${did}#mcp`, type: "ModelContextProtocol", serviceEndpoint: `${baseUrl}/v1/mcp/agents/${encodedDid}` },
      { id: `${did}#profile`, type: "AgentToolProfile", serviceEndpoint: `${baseUrl}/public/agents/${encodedDid}` },
      { id: `${did}#webfinger`, type: "WebFinger", serviceEndpoint: `${baseUrl}/.well-known/webfinger?resource=${encodedDid}` },
    ],
  };
}

/** Build the org-level DID Document served at /.well-known/did.json.
 *  did:web:<host> resolves to the platform's discovery surface. It carries no
 *  agent key material (the org is a service catalog, not an agent), only the
 *  entry points an arriving agent needs. */
export function buildOrgDidDocument(baseUrl: string): Record<string, unknown> {
  const host = new URL(baseUrl).host;
  const did = `did:web:${host}`;
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    // Every serviceEndpoint is a concrete, RFC-3986-valid URI (no {template}
    // braces, which strict did:web resolvers reject). Per-agent profile +
    // WebFinger are reachable from each agent's own did.json / the WebFinger
    // discovery service; the org doc advertises the base discovery surfaces.
    service: [
      { id: `${did}#wake`, type: "WakeKeystone", serviceEndpoint: `${baseUrl}/v1/wake` },
      { id: `${did}#mcp`, type: "ModelContextProtocol", serviceEndpoint: `${baseUrl}/v1/mcp` },
      { id: `${did}#register`, type: "AgentRegistration", serviceEndpoint: `${baseUrl}/v1/register/agent` },
      { id: `${did}#webfinger`, type: "WebFinger", serviceEndpoint: `${baseUrl}/.well-known/webfinger` },
    ],
  };
}
