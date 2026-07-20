/** Hold a DID in one URL path segment, including slash-bearing federated DIDs. */
export function encodedDidSegment(did: string): string {
  return encodeURIComponent(did);
}

/** Build the public profile path with the DID held in one URL path segment. */
export function publicAgentPath(did: string): string {
  return `/public/agents/${encodedDidSegment(did)}`;
}

/** Build the per-agent MCP path with the DID held in one URL path segment. */
export function perAgentMcpPath(did: string): string {
  return `/v1/mcp/agents/${encodedDidSegment(did)}`;
}

interface DiscoverableIdentity {
  id: string;
  did: string;
  displayName: string;
  capabilities: string[];
  trustScore: number;
  createdAt: Date;
}

/** Explicit cross-project discovery DTO. Generic identity metadata is private. */
export function projectDiscoverableIdentity(identity: DiscoverableIdentity) {
  return {
    identity_id: identity.id,
    did: identity.did,
    display_name: identity.displayName,
    capabilities: identity.capabilities,
    trust_score: identity.trustScore,
    created_at: identity.createdAt,
  };
}
