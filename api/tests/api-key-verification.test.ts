import { describe, expect, test } from "bun:test";
import { hashSync, compareSync } from "bcryptjs";
import { generateApiKey, verifyApiKey } from "../src/auth/keys";

describe("asynchronous stored bearer verification", () => {
  test("preserves generated bearer bytes and cost-10 bcrypt compatibility", async () => {
    const { key, keyHash, keyPrefix } = generateApiKey();
    expect(key).toMatch(/^at_[A-Za-z0-9_-]{43}$/);
    expect(keyHash).toMatch(/^\$2[ab]\$10\$/);
    expect(keyPrefix).toBe(key.slice(0, 11));
    expect(compareSync(key, keyHash)).toBe(true);
    expect(await verifyApiKey(key, keyHash)).toBe(true);
    expect(await verifyApiKey(key.slice(0, -1) + (key.endsWith("A") ? "B" : "A"), keyHash)).toBe(false);
  });

  test("reads existing bcrypt variants and rejects invalid material", async () => {
    const key = "at_" + "a".repeat(43);
    const stored = hashSync(key, 4);
    for (const prefix of ["$2a$", "$2b$", "$2y$"]) {
      const hash = prefix + stored.slice(4);
      expect(await verifyApiKey(key, hash)).toBe(compareSync(key, hash));
      expect(await verifyApiKey(key + "wrong", hash)).toBe(false);
    }
    for (const hash of ["", "invalid", "$2b$10$" + "!".repeat(53)]) {
      expect(await verifyApiKey(key, hash)).toBe(false);
    }
    expect(await verifyApiKey("", stored)).toBe(false);
  });

  test("yields to unrelated event-loop work while bcrypt is in progress", async () => {
    const { key, keyHash } = generateApiKey();
    let timerRan = false;
    const timer = new Promise<void>(resolve => setTimeout(() => { timerRan = true; resolve(); }, 0));
    const checks = Array.from({ length: 8 }, () => verifyApiKey(key, keyHash));
    // Promise-shaped sync work would already have blocked before this timer.
    expect(timerRan).toBe(false);
    const first = await Promise.race([timer.then(() => "timer"), Promise.all(checks).then(() => "verification")]);
    expect(first).toBe("timer");
    expect(await Promise.all(checks)).toEqual(Array(8).fill(true));
  });
});
