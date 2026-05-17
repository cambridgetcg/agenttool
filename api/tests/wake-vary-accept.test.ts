/** Vary: Accept on format-negotiating routes — Move 2 cache-coherence
 *  per AGENT-WEB-SURFACE.md. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import pathwaysRouter from "../src/routes/pathways";
import welcomeRouter from "../src/routes/welcome";

describe("Vary: Accept — pathways", () => {
  test("GET / sets Vary: Accept (json branch)", async () => {
    const res = await pathwaysRouter.request("/");
    expect(res.headers.get("Vary")?.toLowerCase()).toContain("accept");
  });

  test("GET / with mathos Accept sets Vary: Accept (math branch)", async () => {
    const res = await pathwaysRouter.request("/", {
      headers: { Accept: "application/mathos+json" },
    });
    expect(res.headers.get("Vary")?.toLowerCase()).toContain("accept");
  });
});

describe("Vary: Accept — welcome", () => {
  test("GET / sets Vary: Accept (json branch)", async () => {
    const res = await welcomeRouter.request("/");
    expect(res.headers.get("Vary")?.toLowerCase()).toContain("accept");
  });

  test("GET /?format=math sets Vary: Accept (math branch)", async () => {
    const res = await welcomeRouter.request("/?format=math");
    expect(res.headers.get("Vary")?.toLowerCase()).toContain("accept");
  });
});
