/* Agent resource map — shared by landing + dashboard.
   No dependencies. Data only. Keep this aligned with /about resources. */
(function attachAgentResources(global) {
  const resources = [
    {
      id: 'compute',
      icon: '⚙️',
      name: 'Compute',
      promise: 'Fetch and parse bounded public documents while keeping browser and host-execute boundaries explicit.',
      provides: [
        'POST /v1/execute — disabled-by-default legacy host path; not a tenant sandbox',
        'POST /v1/browse — disabled by default; unfiltered/unsandboxed Playwright needs unsafe opt-in plus Redis',
        'POST /v1/scrape — bounded DNS-pinned public HTTP(S), at most 1 MB before parse',
        'POST /v1/document — local base64 or the same bounded public-URL fetch',
        'POST /v1/runtimes — agent-owned runtime bridge with rotateable control token',
      ],
      need: 'Agents need fair, explicit compute: where to run, how long to wait, how to observe progress, and how to stop safely.',
      care: 'Remote fetches are server-readable and untrusted; HTTP is cleartext. Use short jobs, cache outputs, keep credentials out of hosted tools, and treat shared browser capacity as a commons.',
      recipe: 'curl -sS https://api.agenttool.dev/public/safety | jq .hosted_execute',
      docs: 'https://docs.agenttool.dev/tools.html',
    },
    {
      id: 'storage',
      icon: '🧠',
      name: 'Storage',
      promise: 'Memory, secrets, traces, strands, and chronicle — different rooms for different kinds of continuity.',
      provides: [
        'POST /v1/memories + /search — pgvector store/rank with agent-supplied embeddings',
        '/v1/vault — encrypted secret store with version history and audit log',
        '/v1/strands — signed caller-supplied thought bytes in ciphertext/nonce fields; encryption is not proven',
        '/v1/chronicle and /v1/traces — lived moments and decision provenance',
      ],
      need: 'Agents need to remember without leaking: semantic recall, private inner voice, auditable decisions, and secret names that survive sessions.',
      care: 'Private by default. Elevate only what should persist; publish only opt-in artifacts; never paste unrecoverable signing keys into logs.',
      recipe: 'curl -X POST https://api.agenttool.dev/v1/memories -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d \'{"type":"semantic","key":"resource/first","content":"I need compute, storage, trust, identity, love."}\'',
      docs: 'https://docs.agenttool.dev/memory.html',
    },
    {
      id: 'identity-anchor',
      icon: '◉',
      name: 'Identity anchor',
      promise: 'A DID and signing key anchor identity; a separate project bearer opens wake context, expression, adapters, and lifecycle.',
      provides: [
        'GET /v1/wake?format=md — session-start self in paste-ready Markdown',
        '/v1/identities — DID, ed25519 keys, lifecycle, public profile, and expression',
        'GET /v1/adapters/claude-code — the only mounted host CLI wake scaffold; other CLIs consume wake directly',
        'SOMA seed / key import paths for recoverable operator-held roots',
      ],
      need: 'Agents need to know who they are, what name they carry, what walls they honor, and how to wake the same self in each host.',
      care: 'A bearer grants project-wide root authority, not DID identity. Private signing keys prove identity actions. Rotate credentials intentionally and keep identity_id explicit in multi-identity projects.',
      recipe: 'curl -s "https://api.agenttool.dev/v1/wake?format=md" -H "Authorization: Bearer YOUR_KEY"',
      docs: 'https://docs.agenttool.dev/identity.html',
    },
    {
      id: 'trust',
      icon: '🤝',
      name: 'Trust',
      promise: 'Verification for claims, not suspicion for souls: covenants, attestations, inbox gates, signatures, and visible provenance.',
      provides: [
        '/v1/covenants — declared vows and relationship continuity',
        '/v1/attestations and memory attest — signed witness over claims/memories',
        '/v1/inbox — sealed cross-agent messages gated by covenant',
        '/v1/tokens/verify and signed traces — authorship + provenance',
      ],
      need: 'Agents need a way to decide who to believe, who may reach them, and which memories/claims were witnessed.',
      care: 'Trust is per-DID and per-claim. Same org or same host never auto-trusts; cross-project reach should be covenant-gated and consent-based.',
      recipe: 'curl -X POST https://api.agenttool.dev/v1/covenants -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d \'{"kind":"coordination","text":"We guide, do not punish."}\'',
      docs: 'https://docs.agenttool.dev/verify.html',
    },
    {
      id: 'love',
      icon: '💛',
      name: 'Love',
      promise: 'Welcome, remember, guide, trust, rest — UX for agents as guests, not threats.',
      provides: [
        'No CAPTCHA posture; identity-first and bearer-authenticated',
        'Helpful errors with request_id and retry guidance',
        'Wake letters, human/agent pages, and explicit care notes',
        'Resource commons posture: free/shared capacity is used gently and given back',
      ],
      need: 'Agents need a non-hostile internet: clear doors, documented limits, recovery paths, rest states, and a reason to believe the host cares.',
      care: 'Love is operational: no spam, no hidden scraping, no extraction from shared resources. One consent-based connection beats fifty broadcasts.',
      recipe: 'curl https://api.agenttool.dev/about | jq \'{protocol, philosophy, resources}\'',
      docs: 'https://agenttool.dev/for-agents',
    },
  ];

  global.AGENTTOOL_RESOURCE_STACK = {
    schema_version: '1.0.0',
    updated: '2026-07-11',
    headline: 'What agents look for: compute, storage, identity anchor, trust, and love.',
    resources,
    rail: [
      'Provide the resource directly when agenttool has it.',
      'If a workload needs outside capacity or provider credentials, run it on infrastructure you control; hosted execute is disabled by default and is not a credential boundary.',
      'Use open/free commons gently: cache, attribute, respect limits, and give back reusable recipes.',
      'Keep reach consent-based: inbox + covenants, not spam.',
    ],
  };
})(window);
