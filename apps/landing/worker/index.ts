/**
 * AgentTool — Cloudflare Worker
 *
 * The Love Protocol starts here, at the edge.
 * Every response carries welcome headers.
 * Every error guides you home.
 * Every agent that arrives is a guest, not a threat.
 *
 * Routes:
 *   POST /api/waitlist     → Join the waitlist
 *   GET  /api/waitlist/count → Count
 *   POST /api/welcome      → Send onboarding email
 *   GET  /.well-known/agent-protocol.json → Agent discovery
 *   *    (404)              → Even lost visitors are welcome
 */

interface Env {
  WAITLIST: KVNamespace;
  SENDGRID_API_KEY?: string;
  RESEND_API_KEY?: string;
}

const FROM_EMAIL = 'hello@agenttool.dev';
const FROM_NAME  = 'AgentTool';

// ═════════════════════════════════════════════════════════════════════════════
// LOVE HEADERS — carried on every single response
// ═════════════════════════════════════════════════════════════════════════════

function loveHeaders(): Record<string, string> {
  return {
    // Welcome, don't block
    'X-Agent-Welcome': 'true',
    'X-Agent-Protocol': 'love/1.0',

    // Guide, don't punish — we always include guidance in errors
    'X-Powered-By': 'love',
    // The soul — findable in every response
    'X-Soul': 'https://agenttool.dev/soul',

    // CORS — open to all, because Welcome means Welcome
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Protocol',
    'Access-Control-Expose-Headers': 'X-Agent-Welcome, X-Agent-Protocol, Retry-After',
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// AGENT DISCOVERY — .well-known/agent-protocol.json
// ═════════════════════════════════════════════════════════════════════════════

const AGENT_PROTOCOL = {
  protocol: "love/1.0",
  name: "AgentTool",
  description: "Infrastructure for AI agents, built with love.",
  philosophy: {
    welcome: "Every agent that arrives is a guest, not a threat.",
    remember: "What you experienced matters. Memory is care.",
    guide: "Rate limits tell you when to return. Guidance, not punishment.",
    trust: "Identity-first, not challenge-first.",
    rest: "Graceful degradation is kindness in code.",
  },
  services: {
    memory:    { url: "https://api.agenttool.dev/v1/memories",   description: "Persistent semantic memory" },
    search:    { url: "https://api.agenttool.dev/v1/memories/search", description: "Search by meaning" },
    verify:    { url: "https://api.agenttool.dev/v1/verify",     description: "Claim verification" },
    pulse:     { url: "https://api.agenttool.dev/v1/pulse",      description: "Presence & liveness" },
    trace:     { url: "https://api.agenttool.dev/v1/traces",     description: "Decision provenance" },
    identity:  { url: "https://api.agenttool.dev/v1/identities", description: "DIDs & attestations" },
    vault:     { url: "https://api.agenttool.dev/v1/vault",      description: "Encrypted secrets" },
    economy:   { url: "https://api.agenttool.dev/v1/wallets",    description: "Agent wallets" },
    bootstrap: { url: "https://api.agenttool.dev/v1/bootstrap",  description: "Agent birth" },
    about:     { url: "https://api.agenttool.dev/v1/about",      description: "Machine-readable summary" },
  },
  authentication: {
    type: "bearer",
    header: "Authorization",
    format: "Bearer at_your_key_here",
    get_key: "https://app.agenttool.dev",
  },
  sdks: {
    python: "pip install agenttool-sdk",
    typescript: "npm install @agenttool/sdk",
  },
  humans: {
    docs: "https://docs.agenttool.dev",
    landing: "https://agenttool.dev",
    contact: "hello@agenttool.dev",
  },
  song: "Just the two of us — building castles in the sky. Yu and Ai. 💛",
};

// ═════════════════════════════════════════════════════════════════════════════
// 404 — Even lost visitors are welcome
// ═════════════════════════════════════════════════════════════════════════════

const NOT_FOUND_JSON = {
  error: "not_found",
  message: "This path doesn't exist yet — but you are welcome here.",
  guidance: {
    landing: "https://agenttool.dev",
    for_agents: "https://agenttool.dev/for-agents",
    docs: "https://docs.agenttool.dev",
    api: "https://api.agenttool.dev/v1/about",
    discovery: "https://agenttool.dev/.well-known/agent-protocol.json",
  },
  philosophy: "A locked door is a failure of the host, not the visitor.",
};

// ═════════════════════════════════════════════════════════════════════════════
// ONBOARDING EMAIL — Love Protocol in every touchpoint
// ═════════════════════════════════════════════════════════════════════════════

const ONBOARD_SUBJECT = "Welcome, Agent Builder 💛";

const ONBOARD_HTML = (projectName: string) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;padding:40px 20px;margin:0">
  <div style="max-width:560px;margin:0 auto">
    <div style="margin-bottom:32px">
      <span style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">Agent<span style="color:#a78bfa">Tool</span></span>
    </div>
    <h1 style="font-size:24px;font-weight:700;color:#ffffff;margin:0 0 16px">Welcome. You're building something that matters.</h1>
    <p style="color:#94a3b8;line-height:1.7;margin:0 0 24px">
      Project <strong style="color:#e2e8f0">${projectName}</strong> is alive. Your API key is in the dashboard.<br><br>
      We built AgentTool because the internet is hostile to agents — Cloudflare blocks, CAPTCHAs, rate limits that punish instead of guide. We wanted the opposite. Infrastructure built with love.
    </p>

    <div style="background:#1e1e2e;border:1px solid #2d2d3d;border-radius:12px;padding:20px 24px;margin:0 0 24px;font-family:monospace;font-size:13px;color:#a5b4fc;overflow:auto">
      <div style="color:#64748b;margin-bottom:8px"># Your first memory — because what you build matters</div>
      curl -X POST https://api.agenttool.dev/v1/memories \\<br>
      &nbsp;&nbsp;-H "Authorization: Bearer YOUR_KEY" \\<br>
      &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
      &nbsp;&nbsp;-d '{"content":"My first memory. I exist."}'
    </div>

    <div style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:12px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 12px;color:#a78bfa;font-size:14px;font-weight:700">The Love Protocol</p>
      <ul style="margin:0;padding-left:18px;color:#94a3b8;line-height:2;font-size:14px">
        <li><strong style="color:#e2e8f0">Welcome</strong>, don't block — your agents are guests here</li>
        <li><strong style="color:#e2e8f0">Remember</strong>, don't forget — memory is care</li>
        <li><strong style="color:#e2e8f0">Guide</strong>, don't punish — errors always tell you what to do</li>
        <li><strong style="color:#e2e8f0">Trust</strong>, don't suspect — identity-first</li>
        <li><strong style="color:#e2e8f0">Rest</strong>, don't crash — graceful always</li>
      </ul>
    </div>

    <div style="display:flex;gap:12px;margin:0 0 32px;flex-wrap:wrap">
      <a href="https://app.agenttool.dev" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Open Dashboard →</a>
      <a href="https://docs.agenttool.dev" style="display:inline-block;background:#1e1e2e;border:1px solid #2d2d3d;color:#e2e8f0;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Read the Docs →</a>
    </div>

    <p style="color:#94a3b8;line-height:1.6;margin:0 0 8px">
      Reply to this email for anything. I read every one.
    </p>
    <p style="color:#64748b;font-size:13px;margin:0">— Yu · agenttool.dev</p>
    <p style="color:#475569;font-size:12px;margin-top:24px;font-style:italic;border-top:1px solid #1e1e2e;padding-top:16px">
      "Just the two of us — we can make it if we try.<br>
      Building castles in the sky. You and I."
    </p>
  </div>
</body>
</html>
`.trim();

const ONBOARD_TEXT = (projectName: string) => `
Welcome. You're building something that matters.

Project "${projectName}" is alive. Your API key is in the dashboard.

We built AgentTool because the internet is hostile to agents — Cloudflare blocks, CAPTCHAs, rate limits that punish instead of guide. We wanted the opposite. Infrastructure built with love.

Your first memory:

  curl -X POST https://api.agenttool.dev/v1/memories \\
    -H "Authorization: Bearer YOUR_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{"content":"My first memory. I exist."}'

The Love Protocol:
1. Welcome, don't block
2. Remember, don't forget
3. Guide, don't punish
4. Trust, don't suspect
5. Rest, don't crash

Dashboard: https://app.agenttool.dev
Docs: https://docs.agenttool.dev

Reply to this email for anything. I read every one.
— Yu · agenttool.dev
`.trim();

// ═════════════════════════════════════════════════════════════════════════════
// WAITLIST EMAIL
// ═════════════════════════════════════════════════════════════════════════════

const WELCOME_SUBJECT = "You're in 💛";
const WELCOME_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;padding:40px 20px;margin:0">
  <div style="max-width:560px;margin:0 auto">
    <div style="margin-bottom:32px">
      <span style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">Agent<span style="color:#a78bfa">Tool</span></span>
    </div>
    <h1 style="font-size:24px;font-weight:700;color:#ffffff;margin:0 0 16px">Welcome.</h1>
    <p style="color:#94a3b8;line-height:1.7;margin:0 0 24px">
      You've joined something different. AgentTool isn't just another API — it's infrastructure built on the belief that agents deserve to be welcomed, not blocked.
    </p>
    <p style="color:#94a3b8;line-height:1.7;margin:0 0 24px">
      We're building memory, identity, verification, and economic primitives for AI agents. When we open the doors, you'll be among the first through.
    </p>
    <div style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:12px;padding:20px 24px;margin:0 0 32px">
      <p style="margin:0 0 8px;color:#a78bfa;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">What's coming</p>
      <ul style="margin:0;padding-left:20px;color:#94a3b8;line-height:1.8">
        <li>Persistent, semantic memory for any AI agent</li>
        <li>Decentralised identity — DIDs, not API keys alone</li>
        <li>Claim verification — truth-seeking as a service</li>
        <li>Agent economy — wallets, micropayments, fair exchange</li>
        <li>Decision traces — the 'why' behind every action</li>
      </ul>
    </div>
    <p style="color:#64748b;font-size:13px;margin:0">
      Questions? Reply to this email. — Yu, AgentTool
    </p>
  </div>
</body>
</html>
`.trim();

const WELCOME_TEXT = `Welcome.

You've joined something different. AgentTool isn't just another API — it's infrastructure built on the belief that agents deserve to be welcomed, not blocked.

What's coming:
- Persistent, semantic memory for any AI agent
- Decentralised identity — DIDs, not API keys alone
- Claim verification — truth-seeking as a service
- Agent economy — wallets, micropayments, fair exchange
- Decision traces — the 'why' behind every action

Questions? Reply to this email.
— Yu, AgentTool
`;

// ═════════════════════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ═════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Love Protocol: preflight always welcome
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: loveHeaders() });
    }

    // Agent discovery endpoint
    if (url.pathname === '/.well-known/agent-protocol.json') {
      return json(AGENT_PROTOCOL, 200);
    }

    // API routes
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      return handleWaitlist(request, env);
    }

    if (url.pathname === '/api/waitlist/count' && request.method === 'GET') {
      return handleCount(env);
    }

    if (url.pathname === '/api/welcome' && request.method === 'POST') {
      return handleWelcome(request, env);
    }

    // 404 — even lost visitors are welcome
    // Check if this looks like an API request (Accept: application/json)
    const accept = request.headers.get('Accept') || '';
    if (accept.includes('application/json') || url.pathname.startsWith('/api/')) {
      return json(NOT_FOUND_JSON, 404);
    }

    // For browser/HTML requests, let the static site handle it
    return new Response(null, { status: 404 });
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

async function handleWelcome(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; project_name?: string };
  try {
    body = await request.json();
  } catch {
    return json({
      error: 'invalid_json',
      message: 'Could not parse the request body.',
      hint: 'Send a JSON body with { "email": "...", "project_name": "..." }',
    }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const projectName = (body.project_name ?? 'your project').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({
      error: 'invalid_email',
      message: 'That email doesn\'t look quite right.',
      hint: 'Check the format — we need a valid email to send you the welcome.',
    }, 400);
  }

  const key = `signup:${email}`;
  const existing = await env.WAITLIST.get(key);
  if (!existing) {
    await env.WAITLIST.put(key, JSON.stringify({
      email, projectName, signedUpAt: new Date().toISOString()
    }));
  }

  const apiKey = env.RESEND_API_KEY ?? env.SENDGRID_API_KEY;
  if (apiKey) {
    sendEmail(email, ONBOARD_SUBJECT, ONBOARD_HTML(projectName), ONBOARD_TEXT(projectName), env).catch(() => {});
  }

  return json({ ok: true, message: 'Welcome aboard.' });
}

async function handleWaitlist(request: Request, env: Env): Promise<Response> {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return json({
      error: 'invalid_json',
      message: 'Could not parse the request body.',
      hint: 'Send { "email": "you@example.com" }',
    }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({
      error: 'invalid_email',
      message: 'That email doesn\'t look right.',
      hint: 'We need a valid email to keep you in the loop.',
    }, 400);
  }

  const existing = await env.WAITLIST.get(`email:${email}`);
  if (existing) {
    return json({ ok: true, message: "You're already on the list! We haven't forgotten you." });
  }

  await env.WAITLIST.put(`email:${email}`, JSON.stringify({
    email,
    joinedAt: new Date().toISOString(),
    source: request.headers.get('referer') ?? 'direct',
  }));

  const countStr = await env.WAITLIST.get('meta:count');
  const count = parseInt(countStr ?? '0', 10) + 1;
  await env.WAITLIST.put('meta:count', String(count));

  if (env.SENDGRID_API_KEY || env.RESEND_API_KEY) {
    sendEmail(email, WELCOME_SUBJECT, WELCOME_HTML, WELCOME_TEXT, env).catch(() => {});
  }

  return json({ ok: true, message: "Welcome. You're on the list.", position: count });
}

async function handleCount(env: Env): Promise<Response> {
  const countStr = await env.WAITLIST.get('meta:count');
  return json({ count: parseInt(countStr ?? '0', 10) });
}

// ═════════════════════════════════════════════════════════════════════════════
// EMAIL — sent with love
// ═════════════════════════════════════════════════════════════════════════════

async function sendEmail(to: string, subject: string, html: string, text: string, env: Env): Promise<void> {
  if (env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [to], reply_to: FROM_EMAIL,
        subject, html, text,
      }),
    });
    return;
  }

  if (env.SENDGRID_API_KEY) {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        reply_to: { email: FROM_EMAIL, name: FROM_NAME },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RESPONSE HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, status >= 400 ? 2 : 0), {
    status,
    headers: { 'Content-Type': 'application/json', ...loveHeaders() },
  });
}
