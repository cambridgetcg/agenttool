/** Exercise Hono precedence using the committed route declarations and parent
 * mount order. Marker handlers keep this test independent of application boot,
 * credentials, and data services; it checks dispatch, not handler behavior.
 *
 * The exact-duplicate guard cannot catch a parameter route shadowing a later
 * literal route, including when they belong to different mounted routers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";

import { stripComments } from "../src/lib/strip-comments";

const SOURCE = join(import.meta.dir, "../src");
const ROUTERS = {
  wakeRouter: "wake.ts",
  thoughtfulWakeRouter: "thoughtful-wake.ts",
  wakeSoapOperaRouter: "wake-soap-opera.ts",
  tutorialRouter: "tutorial.ts",
} as const;

function source(path: string): string {
  return stripComments(readFileSync(join(SOURCE, path), "utf8"));
}

function markerRouter(file: string): Hono {
  const router = new Hono();
  const declarations = source(`routes/${file}`).matchAll(
    /\bapp\.(get|head|post|put|patch|delete|options)\(\s*(["'])([^"']*)\2/g,
  );
  let count = 0;
  for (const [, method, , path] of declarations) {
    router.on(method!.toUpperCase(), path!, (c) => c.json({ file, path }));
    count += 1;
  }
  expect(count, `No route declarations found in ${file}`).toBeGreaterThan(0);
  return router;
}

function composedRoutes(): Hono {
  const app = new Hono();
  const mounts = source("index.ts").matchAll(
    /\bapp\.route\(\s*(["'])([^"']*)\1\s*,\s*(\w+)\s*\)/g,
  );
  const mounted: string[] = [];
  for (const [, , prefix, name] of mounts) {
    if (!Object.hasOwn(ROUTERS, name!)) continue;
    app.route(prefix!, markerRouter(ROUTERS[name as keyof typeof ROUTERS]));
    mounted.push(name!);
  }
  expect(mounted.toSorted()).toEqual(Object.keys(ROUTERS).toSorted());
  return app;
}

describe("composed route precedence", () => {
  test("specific wake representations reach their own handlers", async () => {
    const app = composedRoutes();
    for (const [path, file, registeredPath] of [
      ["/v1/wake/soap-opera", "wake-soap-opera.ts", "/"],
      ["/v1/wake/thoughtful", "thoughtful-wake.ts", "/thoughtful"],
    ]) {
      const response = await app.request(path!);
      expect(await response.json(), path).toEqual({ file, path: registeredPath });
    }
  });

  test("the standard wake, named reads, and subkey fallback keep their routes", async () => {
    const app = composedRoutes();
    for (const [path, registeredPath] of [
      ["/v1/wake", "/"],
      ["/v1/wake/voice", "/voice"],
      ["/v1/wake/observe", "/observe"],
      ["/v1/wake/memory", "/:key"],
      ["/v1/wake/handoffs", "/:key"],
    ]) {
      const response = await app.request(path!);
      expect(await response.json(), path).toEqual({ file: "wake.ts", path: registeredPath });
    }
  });

  test("extension station reads and submissions reach the literal handlers", async () => {
    const app = composedRoutes();
    for (const station of [11, 12, 13]) {
      for (const [method, suffix] of [["GET", ""], ["POST", "/solve"]]) {
        const path = `/stations/${station}${suffix}`;
        const response = await app.request(`/v1/tutorial${path}`, { method });
        expect(await response.json(), `${method} ${path}`).toEqual({ file: "tutorial.ts", path });
      }
    }
  });

  test("ordinary and unknown station numbers retain the generic validation path", async () => {
    const app = composedRoutes();
    for (const station of [1, 9, 10, 14]) {
      for (const [method, suffix] of [["GET", ""], ["POST", "/solve"]]) {
        const response = await app.request(`/v1/tutorial/stations/${station}${suffix}`, { method });
        expect(await response.json(), `${method} station ${station}`).toEqual({
          file: "tutorial.ts",
          path: `/stations/:n${suffix}`,
        });
      }
    }
  });
});
