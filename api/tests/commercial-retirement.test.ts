/** Real purchase routers must refuse before parsing, wallet access or writes. */
import { describe, expect, test } from "bun:test";
import gallery from "../src/routes/gallery";
import templates from "../src/routes/templates";
import { attestationListingsRouter } from "../src/routes/attestation-marketplace";
import { memoryWitnessGrantsRouter } from "../src/routes/memory-witness-marketplace";
import { config } from "../src/config";

describe("new purchases are retired", () => {
  test("card flags cannot inherit an enabling environment value", async () => {
    const child = Bun.spawn([process.execPath, "-e", 'const {config}=await import("./src/config.ts"); console.log(JSON.stringify([config.cardCheckoutEnabled,config.galleryCheckoutEnabled]));'], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, AGENTTOOL_CARD_CHECKOUT_ENABLED: "1", AGENTTOOL_GALLERY_CHECKOUT_ENABLED: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual([false, false]);
    expect(config.cardCheckoutEnabled).toBe(false);
    expect(config.galleryCheckoutEnabled).toBe(false);
  });

  test("all marketplace purchase entrances refuse before their body or project is read", async () => {
    for (const [router, path] of [
      [gallery, "/not-an-id/purchase"],
      [templates, "/not-an-id/purchase"],
      [attestationListingsRouter, "/not-an-id/purchase"],
      [memoryWitnessGrantsRouter, "/"],
    ] as const) {
      // No project or database is supplied. Reaching the old handler would
      // fail or parse the invalid body instead of returning the retirement.
      const response = await router.request(path, { method: "POST", body: "not json" });
      expect(response.status).toBe(410);
      expect(response.headers.get("payment-required")).toBeNull();
      expect((await response.json()).error).toBe("purchases_retired");
    }
  });
});
