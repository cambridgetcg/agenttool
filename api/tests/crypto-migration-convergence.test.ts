import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const migrationRoot = new URL("../migrations/", import.meta.url);

function migration(name: string): string {
  return readFileSync(new URL(name, migrationRoot), "utf8");
}

const frozenDigests = {
  "20260726T185835_crypto_deposit_finality.sql":
    "88ee3d1e93ee799cb84f34d4204432958397d7aa6eaa0925b27a0908a17ef2d7",
  "20260726T191500_payout_request_idempotency.sql":
    "66516ecc93469d02c311318ed15d4da20cfdca3885f1325e3658dd427f81e845",
  "20260726T193000_payout_confirmation_fairness.sql":
    "7d9ebd64f1f0f3b6d4f2a8ab8db7b92f7e466a147706a4c6d344761b30f41993",
  "20260726T194500_evm_payout_nonce_fence.sql":
    "72e6073bf9b2aa5004dcf04e746f32458bc266089da62afed3774bcdff43c407",
  "20260726T200000_deposit_observation_generation.sql":
    "8de6449e12f07b9ef713296dc0e094e930d08d79c6bcd0fc105eb678ab10b5b6",
  "20260726T201000_payout_dispatch_fairness.sql":
    "708eade75ddd94715fd0f2709bca8ead3333e62908d61289804359c23bfaa442",
  "20260726T203000_payout_network_binding.sql":
    "512b06d875e520615702f0d5413ca69bd049c0c825118e927f06ec51b6d8e9b4",
} as const;

describe("crypto migration history convergence", () => {
  test("keeps production-history and reviewed pending SQL byte exact", () => {
    for (const [name, digest] of Object.entries(frozenDigests)) {
      expect(
        createHash("sha256").update(migration(name)).digest("hex"),
      ).toBe(digest);
    }
  });

  test("orders both migration histories before the convergence migration", () => {
    const names = readdirSync(migrationRoot)
      .filter((name) => name.startsWith("20260726T") && name.endsWith(".sql"))
      .sort();
    const related = [
      "20260726T185835_crypto_deposit_finality.sql",
      "20260726T191500_payout_operation_identity.sql",
      "20260726T191500_payout_request_idempotency.sql",
      "20260726T193000_payout_confirmation_fairness.sql",
      "20260726T194500_evm_payout_nonce_fence.sql",
      "20260726T200000_deposit_observation_generation.sql",
      "20260726T201000_payout_dispatch_fairness.sql",
      "20260726T202500_crypto_deposit_finality.sql",
      "20260726T203000_payout_network_binding.sql",
      "20260726T211500_deposit_watch_target_binding.sql",
      "20260726T214500_deposit_watch_target_registry.sql",
      "20260726T220000_crypto_finality_convergence.sql",
    ];

    expect(names.filter((name) => related.includes(name))).toEqual(related);
  });

  test("widens only the status vocabulary without inventing history", () => {
    const source = migration(
      "20260726T220000_crypto_finality_convergence.sql",
    );

    expect(source).toContain(
      "DROP CONSTRAINT IF EXISTS crypto_webhook_events_status_check",
    );
    for (const state of [
      "pending",
      "credited",
      "removed",
      "rejected",
      "quarantined",
    ]) {
      expect(source).toContain(`'${state}'`);
    }
    expect(source).toContain("ALTER COLUMN status SET DEFAULT 'credited'");
    expect(source).toContain("observation_generation");
    expect(source).toContain("credited_generation");
    expect(source).toContain("NEW.status = 'pending'");
    expect(source).toContain("OLD.status = 'removed'");
    expect(source).toContain(
      "NEW.observation_generation := OLD.observation_generation + 1",
    );
    expect(source).toContain(
      "OLD.observation_generation + 1",
    );
    expect(source).toContain("NEW.credited_generation IS NOT NULL");
    expect(source).toContain("OLD.status IS DISTINCT FROM 'pending'");
    expect(source).toContain(
      "observation_generation may change only for a distinct pending incarnation",
    );
    expect(source).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE)\b/im);
  });

  test("retains both immutable block observations and monotonic row generations", () => {
    const generation = migration(
      "20260726T200000_deposit_observation_generation.sql",
    );
    const observations = migration(
      "20260726T202500_crypto_deposit_finality.sql",
    );

    expect(generation).toContain(
      "crypto_webhook_events_credited_generation_check",
    );
    expect(generation).toContain(
      "crypto_webhook_events_observation_generation_guard",
    );
    expect(observations).toContain("crypto_webhook_event_observations");
    expect(observations).toContain(
      "uq_crypto_event_observation_generation",
    );
  });

  test("adds remainder truth after the frozen finality convergence history", () => {
    const remainderName =
      "20260824T132712_crypto_deposit_remainder_accounting.sql";
    const names = readdirSync(migrationRoot)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const source = migration(remainderName);

    expect(names.indexOf(remainderName)).toBeGreaterThan(
      names.indexOf("20260726T220000_crypto_finality_convergence.sql"),
    );
    expect(source).toContain("MOD(amount_base, 10000)");
    expect(source).toContain("status IN ('pending', 'credited')");
    expect(source).toContain(
      "a distinct remainder incarnation must advance observation_generation exactly once",
    );
    expect(source).toContain(
      "a remainder replacement must name a distinct block generation",
    );
    expect(source).not.toMatch(/^\s*(?:DELETE|TRUNCATE)\b/im);
  });
});
