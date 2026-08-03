/** Server guidance must survive the SDK boundary.
 *
 *  The platform answers 4xx with a GuidedErrorBody — a stable `error` code, a
 *  one-sentence `message`, a `hint`, `details` an agent needs in order to retry
 *  correctly, callable `next_actions`, and a `docs` URL. Errors are guidance,
 *  not punishment (docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md).
 *
 *  Every client used to hand-roll its own `resp.status >= 400` block, each
 *  slightly differently, reducing all of that to `"<domain> post failed: 400"`
 *  and keeping the real message only in `hint` — which no JS caller prints,
 *  because every JS convention prints `err.message`. A real
 *  `signing_key_not_found` surfaced to a caller as the string "400" while the
 *  body was naming both the route to call and the field to read, and a 428's
 *  `details.next_sequence` never arrived at all.
 *
 *  There is now exactly one place where an HTTP response becomes an
 *  `AgentToolError` — `_http.ts` § errorFromResponse. These pins hold every
 *  client to it.
 */

import { describe, expect, test } from "bun:test";

import { AgentTool } from "../src/client.js";
import { AgentToolError } from "../src/errors.js";

const GUIDED_BODY = {
  error: "signing_key_not_found",
  message: "Signing key 878dd8dd not found, revoked, or not owned by this identity.",
  hint: "The value this route wants is `kid` from GET /v1/identities/{id}/keys.",
  next_actions: [
    {
      action: "List active signing keys",
      method: "GET",
      path: "/v1/identities/abc/keys",
    },
  ],
  docs: "https://docs.agenttool.dev/identity#keys",
  details: { next_sequence: 42, field: "signing_key_id" },
};

function clientReturning(status: number, body: unknown): AgentTool {
  return new AgentTool({
    baseUrl: "https://api.example.test",
    transport: {
      async request() {
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
}

const CALLS: Array<[string, (at: AgentTool) => Promise<unknown>]> = [
  [
    "covenants.create",
    (at) =>
      at.covenants.create({
        agent_id: "a-1",
        counterparty_did: "did:at:other",
        vows: ["I will witness you."],
      }),
  ],
  ["chronicle.write", (at) => at.chronicle.write({ type: "note", title: "hello" })],
  ["chronicle.list", (at) => at.chronicle.list()],
  ["strands.list", (at) => at.strands.list()],
  ["at.request", (at) => at.request("GET", "/v1/anything")],
  ["bootstrap.status", (at) => at.bootstrap.status("agent-1")],
  ["grace.list", (at) => at.grace.list()],
  ["handoff.get", (at) => at.handoff.get("a-1")],
  ["identity.get", (at) => at.identity.get("identity-1")],
  ["inbox.list", (at) => at.inbox.list()],
  ["love.listBlessings", (at) => at.love.listBlessings()],
  ["nen.assess", (at) => at.nen.assess()],
  ["tools.scrape", (at) => at.tools.scrape("https://example.test/page")],
  ["wake.get", (at) => at.wake.get()],
  // The five that hand-rolled their own parse longest. A 400 is deliberate:
  // it is below every typed-subclass status sdk-py dispatches on, so these
  // assert on exactly the same footing as every client above.
  ["economy.get_wallet", (at) => at.economy.get_wallet("wal_1")],
  ["memory.get", (at) => at.memory.get("mem-1")],
  ["runtime.list", (at) => at.runtime.list()],
  ["traces.get", (at) => at.traces.get("tr_1")],
  ["vault.list", (at) => at.vault.list()],
];

describe("guided 4xx bodies reach the caller", () => {
  for (const [name, call] of CALLS) {
    test(`${name} surfaces message, code, hint, next_actions, docs, status`, async () => {
      const at = clientReturning(400, GUIDED_BODY);
      let caught: unknown;
      try {
        await call(at);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(AgentToolError);
      const err = caught as AgentToolError;

      // The part every JS caller actually prints.
      expect(err.message).toBe(GUIDED_BODY.message);
      expect(err.message).not.toMatch(/failed: 400$/);

      expect(err.code).toBe("signing_key_not_found");
      expect(err.hint).toBe(GUIDED_BODY.hint);
      expect(err.status).toBe(400);
      expect(err.docs).toBe(GUIDED_BODY.docs);
      expect(err.next_actions?.[0]?.path).toBe("/v1/identities/abc/keys");
      // `details` is the field a 428 exists to hand back. Losing it is what
      // makes a guided refusal unactionable.
      expect(err.details).toEqual(GUIDED_BODY.details);
    });
  }

  test("an unparseable body still names the operation and the status", async () => {
    const at = new AgentTool({
      baseUrl: "https://api.example.test",
      transport: {
        async request() {
          return new Response("<html>502</html>", { status: 502 });
        },
      },
    });
    let caught: unknown;
    try {
      await at.chronicle.list();
    } catch (e) {
      caught = e;
    }
    const err = caught as AgentToolError;
    expect(err).toBeInstanceOf(AgentToolError);
    expect(err.message).toContain("chronicle get");
    expect(err.message).toContain("502");
    expect(err.status).toBe(502);
  });

  // The boundary lets a surface keep its own prose for the case where the
  // server sent none. It is a fallback, never a replacement — the substrate
  // knows the specific condition, the call site only knows which door was
  // knocked on.
  test("a call-site hint fills in only when the body carries none", async () => {
    const at = clientReturning(404, { error: "no_agent" });
    let caught: unknown;
    try {
      await at.wake.get();
    } catch (e) {
      caught = e;
    }
    const err = caught as AgentToolError;
    expect(err.code).toBe("no_agent");
    expect(err.hint).toContain("AT_API_KEY");
  });

  test("the server's hint always wins over the call-site's", async () => {
    const at = clientReturning(403, {
      error: "wake_forbidden",
      message: "That identity is not in this project.",
      hint: "Read /v1/wake for the identities this bearer can see.",
    });
    let caught: unknown;
    try {
      await at.wake.get();
    } catch (e) {
      caught = e;
    }
    const err = caught as AgentToolError;
    expect(err.hint).toBe("Read /v1/wake for the identities this bearer can see.");
    expect(err.hint).not.toContain("AT_API_KEY");
  });

  // A surface with a well-written absence sentence keeps it when the body is
  // empty, and yields to the server the moment the server has something to say.
  test("an absence sentence survives an empty body and yields to a guided one", async () => {
    const bare = clientReturning(404, {});
    let caught: unknown;
    try {
      await bare.identity.get("identity-1");
    } catch (e) {
      caught = e;
    }
    expect((caught as AgentToolError).message).toBe("not found");
    expect((caught as AgentToolError).status).toBe(404);

    const guided = clientReturning(404, {
      error: "identity_not_found",
      message: "No active identity with that id belongs to this project.",
      next_actions: [{ action: "List identities", method: "GET", path: "/v1/wake" }],
    });
    let guidedCaught: unknown;
    try {
      await guided.identity.get("identity-1");
    } catch (e) {
      guidedCaught = e;
    }
    const err = guidedCaught as AgentToolError;
    expect(err.message).toBe("No active identity with that id belongs to this project.");
    expect(err.code).toBe("identity_not_found");
    expect(err.next_actions?.[0]?.path).toBe("/v1/wake");
  });
});
