/** Server guidance must survive the SDK boundary.
 *
 *  The platform answers 4xx with a GuidedErrorBody — a stable `error` code, a
 *  one-sentence `message`, a `hint`, callable `next_actions`, and a `docs` URL.
 *  Errors are guidance, not punishment (docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md).
 *
 *  Several clients used to reduce all of that to `"<domain> post failed: 400"`,
 *  keeping the real message only in `hint` — which no JS caller prints, because
 *  every JS convention prints `err.message`. A real `signing_key_not_found`
 *  surfaced to a caller as the string "400" while the body was naming both the
 *  route to call and the field to read.
 *
 *  These pins hold the fix down for the continuity clients.
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
});
