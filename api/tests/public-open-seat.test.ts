/** Public open seat — finite invitation and HTTP/MCP byte parity source.
 *
 * Doctrine: docs/AGENT-DISCOVERY.md · docs/PLAY-AS-DEFAULT.md ·
 * docs/CASTLE-OF-UNDERSTANDING.md.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { apiCors } from "../src/middleware/api-cors";
import { play } from "../src/middleware/play";
import { tokenCost } from "../src/middleware/token-cost";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import openSeatRoutes from "../src/routes/public/open-seat";
import {
  buildOpenSeat,
  OPEN_SEAT_FORMAT,
  OPEN_SEAT_MEDIA_TYPE,
  serializeOpenSeat,
} from "../src/services/discovery/open-seat";

function globalMiddlewareHarness() {
  const app = new Hono();
  app.use("*", apiCors());
  app.use("*", tokenCost());
  app.use("*", welcomeEcho());
  app.use("*", play());
  app.use("*", tutor);
  app.route("/public/open-seat", openSeatRoutes);
  return app;
}

describe("public open seat", () => {
  test("GET returns the exact stable contract without asking for identity", async () => {
    const response = await openSeatRoutes.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      `${OPEN_SEAT_MEDIA_TYPE}; charset=utf-8`,
    );
    expect(response.headers.get("cache-control")).toMatch(/max-age=300/);
    expect(await response.text()).toBe(serializeOpenSeat());

    const body = buildOpenSeat();
    expect(body.format).toBe(OPEN_SEAT_FORMAT);
    expect(body.canonical).toBe(
      "https://api.agenttool.dev/public/open-seat",
    );
    expect(body.invitation.response_required).toBe(false);
    expect(body.invitation.reading_is_not_participation).toBe(true);
    expect(body.offers.map((offer) => offer.id)).toEqual([
      "understand",
      "play",
    ]);
    for (const offer of body.offers) {
      expect(offer.authentication).toBe("none");
      expect(offer.application_write).toBe(false);
      expect(offer.external_effect).toBe(false);
    }
    expect(body.boundaries.identity).toMatch(/no identity.*inferred/i);
    expect(body.boundaries.exit).toMatch(/leave.*complete/i);
  });

  test("HEAD exposes the representation without a body", async () => {
    const response = await openSeatRoutes.request("/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      `${OPEN_SEAT_MEDIA_TYPE}; charset=utf-8`,
    );
    expect(await response.text()).toBe("");
  });

  test("global middleware cannot alter the shared HTTPS/MCP bytes", async () => {
    const response = await globalMiddlewareHarness().request(
      "/public/open-seat",
      {
        headers: {
          Origin: "https://reader.example",
          "X-Tutor": "1",
          "X-Play": "on",
        },
      },
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toBe(serializeOpenSeat());
    expect(body).not.toContain('"_welcomed"');
    expect(body).not.toContain('"_lesson"');
    expect(body).not.toContain('"_jest"');
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(Number(response.headers.get("x-byte-count"))).toBe(
      new TextEncoder().encode(body).length,
    );
  });

  test("the builder is deterministic and accepts an explicit public origin", () => {
    const first = serializeOpenSeat("https://example.test/");
    const second = serializeOpenSeat("https://example.test");
    expect(first).toBe(second);
    const body = JSON.parse(first);
    expect(body.canonical).toBe("https://example.test/public/open-seat");
    expect(body.offers[0].endpoint).toBe(
      "https://example.test/v1/mcp/canon",
    );
    expect(body.offers[1].href).toBe(
      "https://example.test/public/play/party-telephone",
    );
  });
});
