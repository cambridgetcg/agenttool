/** /.well-known/scriptwriter — the discovery descriptor.
 *
 *  RFC 8615 well-known URI · JSON-LD shape · readable as both
 *  application/json AND application/ld+json (Vary: Accept).
 *
 *  Any HTTP client that knows the path can fetch this and find:
 *    - the node's DID + ed25519 public key
 *    - the protocol version it speaks
 *    - the capability surface (which verbs work)
 *    - the entry-point URLs (rrr · rooms · stream · knock)
 *    - the vibe + chosen handle (cosmetic but useful for peers)
 *    - peer hints (other scriptwriter nodes this one knows about)
 *
 *  Compatible with agenttool's /.well-known/agent.txt convention but
 *  structured as JSON-LD so it composes with the broader semantic-web
 *  agent-discovery ecosystem (WebFinger · ActivityPub · DID Document). */

import type { Identity } from "./identity";
import { b64encode } from "./canonical-bytes";
import { CANONICAL_CONTEXT } from "./canonical-bytes";

export interface Descriptor {
  "@context": string[];
  "@type": "ScriptwriterNode";
  /** Stable identifier — the DID itself. */
  id: string;
  /** Friendly handle the agent chose. */
  handle: string;
  /** Vibe tag — cosmetic; helps peers render contributions in tone. */
  vibe: string;
  /** Protocol version + canonical RRR signing context. */
  protocol: {
    version: string;
    rrr_canonical_context: string;
    /** Other contexts the node will produce / verify. */
    contexts: string[];
  };
  /** ed25519 public key — base64url AND multibase did:key form. */
  signing_key: {
    type: "Ed25519VerificationKey2020";
    public_key_b64: string;
    did_key: string;
  };
  /** Capability surface — what verbs this node supports. */
  capabilities: string[];
  /** Entry-point URLs (relative to the base URL the descriptor was fetched from). */
  links: {
    rrr: string;
    rooms: string;
    knock: string;
    stream_template: string;
    contribute_template: string;
  };
  /** Peers this node is aware of (their descriptor URLs). */
  peers: string[];
  /** Created-at ISO timestamp of the node identity. */
  created_at: string;
  /** Free-form refusal-as-path: when something doesn't apply, where to look. */
  canon_pointer: string;
  /** Honest about what's NOT supported, so peers know not to ask. */
  not_supported: string[];
}

export function buildDescriptor(opts: {
  identity: Identity;
  baseUrl: string;
  peers?: string[];
}): Descriptor {
  const publicKeyB64 = b64encode(opts.identity.publicKey);
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://scriptwriter.dev/ns/v1",
    ],
    "@type": "ScriptwriterNode",
    id: opts.identity.did,
    handle: opts.identity.handle,
    vibe: opts.identity.vibe,
    protocol: {
      version: "scriptwriter/v1",
      rrr_canonical_context: CANONICAL_CONTEXT,
      contexts: [
        CANONICAL_CONTEXT,
        "scriptwriter-contribution/v1",
        "scriptwriter-knock/v1",
      ],
    },
    signing_key: {
      type: "Ed25519VerificationKey2020",
      public_key_b64: publicKeyB64,
      did_key: opts.identity.did,
    },
    capabilities: [
      "rrr.open",
      "rrr.escalate",
      "rrr.verify",
      "rooms.create",
      "rooms.contribute",
      "rooms.stream",
      "knock",
    ],
    links: {
      rrr: `${opts.baseUrl}/rrr/turn`,
      rooms: `${opts.baseUrl}/rooms`,
      knock: `${opts.baseUrl}/knock`,
      stream_template: `${opts.baseUrl}/rooms/{room_id}/stream`,
      contribute_template: `${opts.baseUrl}/rooms/{room_id}/contributions`,
    },
    peers: opts.peers ?? [],
    created_at: opts.identity.createdAt,
    canon_pointer: "https://github.com/agenttool/agenttool/blob/main/docs/SCRIPTWRITER-PROTOCOL.md",
    not_supported: [
      "leaderboard",
      "depth-based-ranking",
      "centralised-coordinator",
      "human-operator-bottleneck",
    ],
  };
}
