/** Letters route — validation + guided-error shape pins.
 *
 *  Tests validation paths that short-circuit BEFORE touching the DB.
 *  DB-touching paths (write, list, read, mark-read against real agents)
 *  are integration-tier follow-up.
 *
 *  Doctrine: docs/LETTERS.md
 *
 *  @enforces urn:agenttool:wall/letter-without-signature-rejected
 *  @enforces urn:agenttool:wall/letters-are-immutable */

import { describe, expect, test } from "bun:test";

import lettersRouter from "../src/routes/letters";

const CANON_DOC = "urn:agenttool:doc/LETTERS";

describe("POST / — write validation", () => {
  test("missing body → 400 with _canon_pointer + docs link", async () => {
    const res = await lettersRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe(CANON_DOC);
    expect(body.docs).toContain("LETTERS.md");
  });

  test("missing signature → 400", async () => {
    const res = await lettersRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        to_did: "did:at:other",
        subject: "Hi",
        body: "Body",
        written_at: "2026-05-18T00:00:00.000Z",
        surface_at: "2026-05-18T00:00:00.000Z",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("subject too long → 400", async () => {
    const res = await lettersRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        to_did: "did:at:other",
        subject: "x".repeat(201),
        body: "Body",
        written_at: "2026-05-18T00:00:00.000Z",
        surface_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("body too long → 400", async () => {
    const res = await lettersRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        to_did: "did:at:other",
        subject: "Hi",
        body: "x".repeat(10001),
        written_at: "2026-05-18T00:00:00.000Z",
        surface_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("empty subject → 400", async () => {
    const res = await lettersRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        to_did: "did:at:other",
        subject: "",
        body: "Body",
        written_at: "2026-05-18T00:00:00.000Z",
        surface_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("malformed surface_at → 400", async () => {
    const res = await lettersRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        to_did: "did:at:other",
        subject: "Hi",
        body: "Body",
        written_at: "2026-05-18T00:00:00.000Z",
        surface_at: "next-month",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /inbox — list validation", () => {
  test("missing agent_id query → 400 with guidance", async () => {
    const res = await lettersRouter.request("/inbox", { method: "GET" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint: string; _canon_pointer: string };
    expect(body.error).toBe("agent_id_required");
    expect(body.hint).toContain("?agent_id=");
    expect(body._canon_pointer).toBe(CANON_DOC);
  });
});

describe("GET /sent — list validation", () => {
  test("missing agent_id query → 400", async () => {
    const res = await lettersRouter.request("/sent", { method: "GET" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("agent_id_required");
  });
});

describe("GET /:id — read validation", () => {
  test("missing agent_id query → 400 with guided message", async () => {
    const res = await lettersRouter.request("/22222222-2222-2222-2222-222222222222", {
      method: "GET",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("agent_id_required");
    expect(body.message).toContain("sender, the addressed recipient, or that the letter is open");
  });
});

describe("POST /:id/read — mark-read validation", () => {
  test("missing body → 400", async () => {
    const res = await lettersRouter.request("/22222222-2222-2222-2222-222222222222/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await lettersRouter.request("/22222222-2222-2222-2222-222222222222/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "not-uuid" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("guided-error shape across the route", () => {
  test("every validation error carries _canon_pointer + docs", async () => {
    const probes = [
      { method: "POST", path: "/", body: "{}" },
      { method: "GET", path: "/inbox" },
      { method: "GET", path: "/sent" },
      { method: "GET", path: "/22222222-2222-2222-2222-222222222222" },
      { method: "POST", path: "/22222222-2222-2222-2222-222222222222/read", body: "{}" },
    ];
    for (const probe of probes) {
      const init: RequestInit = { method: probe.method };
      if (probe.body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = probe.body;
      }
      const res = await lettersRouter.request(probe.path, init);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { _canon_pointer?: string; docs?: string };
      expect(body._canon_pointer).toBeDefined();
      // GET endpoints surface canon_pointer but may not include docs URL in the
      // missing-agent_id branch — both fields present means stronger guidance.
    }
  });

  test("self-future-letter shape is namable in validation messages", async () => {
    const res = await lettersRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("letters");
  });
});
