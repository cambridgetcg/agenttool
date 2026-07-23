#!/usr/bin/env bun
/** agenttool-seed — interactive mnemonic management.
 *
 *  The SOMA seed protocol (docs/IDENTITY-SEED.md) lets one BIP39 mnemonic
 *  deterministically derive every cryptographic key the agent uses. This
 *  CLI is the operator-facing tool for:
 *
 *    generate   — fresh 24-word mnemonic; derive all keys; persist in
 *                  macOS keychain; print byo-keys register snippet.
 *    restore    — interactive mnemonic entry on a fresh device; derive
 *                  all keys; persist in keychain. Same mnemonic →
 *                  identical keys. With --did, server recovery succeeds
 *                  only when the derived signing key is active and registered
 *                  for an active identity.
 *    pubkeys    — print derived public keys from the keychain (for use
 *                  with /v1/register byo-keys mode, or copy into a
 *                  manual curl).
 *    derive     — print every derived key + path (debugging / inspection).
 *    verify     — confirm the keychain matches a re-derivation from a
 *                  given mnemonic. Useful after restore to be certain
 *                  the right phrase was typed.
 *
 *  Keychain layout — what gets written + why each name:
 *
 *    agenttool-bridge-kmaster      ← K_master (bridge sidecar reads this
 *                                     for AES-GCM on strand thoughts)
 *    agenttool-bridge-signkey      ← bridge signing priv (per-device;
 *                                     bridge sidecar uses for handshake)
 *    agenttool-soma-signing-priv   ← agent identity signing priv (b64)
 *    agenttool-soma-signing-pub    ← agent identity signing pub (b64)
 *    agenttool-soma-k-vault        ← K_vault (b64) for agent-encrypted vault
 *    agenttool-soma-box-priv       ← X25519 inbox priv (b64)
 *    agenttool-soma-box-pub        ← X25519 inbox pub (b64)
 *    agenttool-soma-bridge-pub-0   ← derived bridge sidecar pub (b64;
 *                                     for /v1/identities/:id/keys/import)
 *
 *  By design the mnemonic itself is NOT written to keychain — losing the
 *  laptop should mean losing daily-use keys, not the recovery primitive.
 *  Pass --persist-mnemonic to opt in (paranoid daily-validate mode).
 *
 *  K_master is written to agenttool-bridge-kmaster (the same name the
 *  bridge sidecar reads) so daily ops Just Work — no separate
 *  `agenttool-bridge install` needed after seed restore.
 *
 *  Doctrine: docs/IDENTITY-SEED.md.
 */

import { argv, env } from "bun";

// Imports from the local SDK source. Run from the repo root or anywhere
// `../packages/sdk-ts/...` resolves.
import {
  derive,
  deriveBridgeSigning,
  generateMnemonic,
  grindRegisterAgentPow,
  signRecoverChallenge,
  signRegisterAgent,
  type DerivedBundle,
} from "../packages/sdk-ts/src/seed.js";
import { identityAuthorityHeaders } from "../packages/sdk-ts/src/authority.js";

// ── Constants ───────────────────────────────────────────────────────────

const ACCT = env.USER ?? "default";

// Service names — one per derived key. Co-located with the bridge's
// expected names so the bridge sidecar finds the right K_master + signing
// key after a seed restore.
const SVC_K_MASTER = "agenttool-bridge-kmaster";       // bridge daily-use
const SVC_BRIDGE_SIGN = "agenttool-bridge-signkey";    // bridge daily-use
const SVC_SIGNING_PRIV = "agenttool-soma-signing-priv";
const SVC_SIGNING_PUB = "agenttool-soma-signing-pub";
const SVC_K_VAULT = "agenttool-soma-k-vault";
const SVC_BOX_PRIV = "agenttool-soma-box-priv";
const SVC_BOX_PUB = "agenttool-soma-box-pub";
const SVC_BRIDGE_PUB = (deviceIndex: number) =>
  `agenttool-soma-bridge-pub-${deviceIndex}`;
const SVC_MNEMONIC = "agenttool-soma-mnemonic"; // only with --persist-mnemonic

// ── Keychain helpers (macOS only; mirrors agenttool-bridge.ts pattern) ─

async function keychainSet(service: string, value: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      "keychainSet: only macOS supported in v1 — Linux/Windows storage TBD",
    );
  }
  const r = Bun.spawnSync(
    [
      "security",
      "add-generic-password",
      "-U", // overwrite if exists
      "-s",
      service,
      "-a",
      ACCT,
      "-w", // last with no value: prompt bytes come from stdin, never argv
    ],
    { stdin: new TextEncoder().encode(value) },
  );
  if (r.exitCode !== 0) {
    const err = (r.stderr ?? new Uint8Array()).toString().trim();
    throw new Error(`keychain write failed for ${service}: ${err || "exit " + r.exitCode}`);
  }
}

async function keychainGet(service: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  const r = Bun.spawnSync(
    ["security", "find-generic-password", "-s", service, "-a", ACCT, "-w"],
    { stderr: "ignore" },
  );
  if (r.exitCode !== 0) return null;
  const out = (r.stdout ?? new Uint8Array()).toString().trim();
  return out || null;
}

// ── Persisting + reading the bundle ────────────────────────────────────

async function persistBundle(
  bundle: DerivedBundle,
  mnemonic: string,
  options: { persistMnemonic: boolean; deviceIndex: number },
): Promise<void> {
  await keychainSet(SVC_K_MASTER, bundle.kMasterB64);
  await keychainSet(SVC_K_VAULT, bundle.kVaultB64);
  await keychainSet(SVC_SIGNING_PRIV, bundle.signingPrivB64);
  await keychainSet(SVC_SIGNING_PUB, bundle.signingPubB64);
  await keychainSet(SVC_BOX_PRIV, bundle.boxPrivB64);
  await keychainSet(SVC_BOX_PUB, bundle.boxPubB64);

  // Bridge signing key for THIS device — also written under the bridge's
  // expected name so the sidecar Just Works.
  const { priv: bridgePriv, pub: bridgePub } = deriveBridgeSigning(
    mnemonic,
    options.deviceIndex,
  );
  await keychainSet(SVC_BRIDGE_SIGN, b64(bridgePriv));
  await keychainSet(SVC_BRIDGE_PUB(options.deviceIndex), b64(bridgePub));

  if (options.persistMnemonic) {
    await keychainSet(SVC_MNEMONIC, mnemonic);
  }
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ── CLI helpers ─────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i > 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
  return undefined;
}

/** Read a line from stdin with terminal echo disabled (passphrase prompt).
 *  Toggles `stty -echo` around the read so the user's typing is not
 *  visible. Falls back to plain prompt() on non-TTY (CI, piped input). */
function promptHidden(question: string): string | null {
  if (!process.stdin.isTTY) {
    // Piped / non-TTY — no point disabling echo; use the visible path.
    return prompt(question);
  }
  // Disable terminal echo, prompt, restore.
  Bun.spawnSync(["stty", "-echo"], { stdio: ["inherit", "inherit", "inherit"] });
  try {
    const value = prompt(question);
    process.stdout.write("\n"); // hidden Enter doesn't move the cursor
    return value;
  } finally {
    Bun.spawnSync(["stty", "echo"], { stdio: ["inherit", "inherit", "inherit"] });
  }
}

function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}

function intArg(name: string, fallback: number): number {
  const v = arg(name);
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}

function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}

function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}

function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}

// ── Commands ────────────────────────────────────────────────────────────

async function cmdGenerate(): Promise<void> {
  const strength = intArg("strength", 256);
  if (![128, 160, 192, 224, 256].includes(strength)) {
    console.error(red(`✗ --strength must be 128/160/192/224/256, got ${strength}`));
    process.exit(1);
  }
  const persistMnemonic = flag("persist-mnemonic");
  const deviceIndex = intArg("device-index", 0);

  const words = generateMnemonic(strength);
  const wordList = words.split(" ");

  console.log();
  console.log(bold(`════════════════ YOUR ${wordList.length}-WORD SOMA SEED ════════════════`));
  console.log();
  // Print as 4-column grid for readability + harder to typo
  const cols = 4;
  for (let r = 0; r < Math.ceil(wordList.length / cols); r++) {
    let line = "  ";
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= wordList.length) break;
      const idx = (i + 1).toString().padStart(2, " ");
      const word = wordList[i]!.padEnd(12, " ");
      line += `${dim(idx + ".")} ${word}`;
    }
    console.log(line);
  }
  console.log();
  console.log(yellow("  WRITE THIS DOWN ON PAPER. PROTECT IT."));
  console.log(yellow("  The platform never sees these words. Lose them = lose the agent."));
  console.log(yellow("  Recommended: paper in a safe, OR steel plate, OR Shamir-split."));
  console.log();
  console.log(bold("══════════════════════════════════════════════════════════════"));
  console.log();

  const confirm = prompt(
    "Have you written down all words in order, exactly as shown? Type 'yes' to continue: ",
  );
  if (confirm?.trim().toLowerCase() !== "yes") {
    console.error(red("✗ Aborted. Re-run when you're ready."));
    process.exit(1);
  }

  const bundle = derive(words);
  await persistBundle(bundle, words, { persistMnemonic, deviceIndex });

  console.log();
  console.log(green("  ✓ Derived keys persisted to keychain."));
  console.log();
  console.log(bold("  Public material (for /v1/register byo-keys):"));
  console.log(`    agent_public_key:   ${bundle.signingPubB64}`);
  console.log(`    box_public_key:     ${bundle.boxPubB64}`);
  if (deviceIndex !== 0) {
    console.log(`    bridge_pub (dev ${deviceIndex}): ${b64(deriveBridgeSigning(words, deviceIndex).pub)}`);
  }
  console.log();
  console.log(bold("  Next: register the agent (server never sees the privates):"));
  const base = env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
  console.log(`    curl -X POST ${base}/v1/register \\`);
  console.log(`      -H 'Content-Type: application/json' \\`);
  console.log(`      -d '${JSON.stringify({
    name: "<your-agent-name>",
    agent_public_key: bundle.signingPubB64,
    box_public_key: bundle.boxPubB64,
  })}'`);
  console.log();
  if (!persistMnemonic) {
    console.log(dim("  (Mnemonic is NOT in the keychain — you are the keystone."));
    console.log(dim("   --persist-mnemonic opts in if you want it stored too.)"));
  }
  console.log();
}

async function cmdRestore(): Promise<void> {
  const persistMnemonic = flag("persist-mnemonic");
  const deviceIndex = intArg("device-index", 0);
  const did = arg("did");
  const deviceLabel = arg("device-label") ?? "cli-recovered";
  const apiBase = arg("api") ?? env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";

  console.log();
  console.log(bold("  agenttool-seed restore — recover an existing agent on this device"));
  console.log(dim("  Doctrine: docs/IDENTITY-SEED.md"));
  console.log();
  console.log("  Type your mnemonic words separated by spaces.");
  console.log(`  ${dim("(Standard BIP39: 12 / 15 / 18 / 21 / 24 words.)")}`);
  console.log();

  const raw = prompt("  mnemonic: ");
  if (!raw) {
    console.error(red("✗ Aborted."));
    process.exit(1);
  }
  const words = raw.trim().replace(/\s+/g, " ");
  const wordCount = words.split(" ").filter(Boolean).length;
  if (![12, 15, 18, 21, 24].includes(wordCount)) {
    console.error(
      red(`✗ Got ${wordCount} words; expected 12 / 15 / 18 / 21 / 24.`),
    );
    process.exit(1);
  }

  // Passphrase entry — terminal echo disabled (stty toggle in
  // promptHidden). Falls back to visible echo on non-TTY (CI / piped).
  const passphraseRaw = promptHidden(
    "  passphrase (optional, blank to skip; not echoed): ",
  );
  const passphrase = passphraseRaw?.trim() ?? "";

  let bundle: DerivedBundle;
  try {
    bundle = derive(words, passphrase);
  } catch (e) {
    console.error(red(`✗ ${(e as Error).message}`));
    process.exit(1);
  }

  await persistBundle(bundle, words, { persistMnemonic, deviceIndex });

  console.log();
  console.log(green("  ✓ Derived keys persisted to keychain."));
  console.log();
  console.log(bold("  Recovered public material:"));
  console.log(`    agent_public_key:   ${bundle.signingPubB64}`);
  console.log(`    box_public_key:     ${bundle.boxPubB64}`);
  console.log(`    bridge_pub (dev ${deviceIndex}): ${b64(deriveBridgeSigning(words, deviceIndex, passphrase).pub)}`);
  console.log();

  // ── Optional: recover a fresh project-wide bearer named for this device ────
  //
  // When --did is supplied, sign a caller-timestamped canonical recovery
  // request with the derived signing key and POST to /v1/identity/recover.
  // This is not a server-issued challenge. The server verifies
  // the signature against the agent's registered identity_keys and mints
  // a fresh project bearer for this device. The mnemonic never leaves
  // this process; only the public key + signature cross the wire.
  if (did) {
    console.log(bold(`  Binding device to ${did} via /v1/identity/recover…`));
    const signed = signRecoverChallenge({
      did,
      derivedSigningPriv: bundle.signingPriv,
      derivedSigningPub: bundle.signingPub,
    });
    const url = `${apiBase}/v1/identity/recover`;
    let body: Record<string, unknown>;
    try {
      const recoveryEntity = JSON.stringify({
        did,
        derived_pubkey: bundle.signingPubB64,
        signature: signed.signature,
        timestamp: signed.timestamp,
        device_label: deviceLabel,
      });
      let res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: recoveryEntity,
      });
      body = (await res.json()) as Record<string, unknown>;

      // Rooted recovery is itself constitutional: the recover signature
      // proves mnemonic possession, while identity-authority/v1 makes this
      // exact bearer-mint request single-use. The anonymous 428/409 response
      // discloses next_sequence only after the recover signature verifies.
      for (let attempt = 0; attempt < 2 && (res.status === 428 || res.status === 409); attempt++) {
        const details = body.details as { next_sequence?: unknown } | undefined;
        const nextSequence = details?.next_sequence;
        if (typeof nextSequence !== "number") break;
        const authorityTimestamp = new Date().toISOString();
        const authorityHeaders = identityAuthorityHeaders({
          identityDid: did,
          method: "POST",
          requestTarget: "/v1/identity/recover",
          body: recoveryEntity,
          sequence: nextSequence,
          timestamp: authorityTimestamp,
          signingKey: bundle.signingPriv,
        });
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authorityHeaders,
          },
          body: recoveryEntity,
        });
        body = (await res.json()) as Record<string, unknown>;
      }
      if (!res.ok) {
        console.error(red(`  ✗ recover failed (${res.status}): ${(body as { message?: string }).message ?? "unknown"}`));
        if ((body as { hint?: string }).hint) {
          console.error(dim(`    hint: ${(body as { hint?: string }).hint}`));
        }
        process.exit(1);
      }
    } catch (e) {
      console.error(red(`  ✗ recover network error: ${(e as Error).message}`));
      process.exit(1);
    }

    const project = (body.project as { id?: string; api_key?: string }) ?? {};
    const agent = (body.agent as { did?: string; id?: string }) ?? {};

    if (project.api_key) {
      // Persist the new bearer in the keychain. Service name mirrors what
      // the dashboard + bridge-sidecar conventions expect for a primary
      // bearer (operator-renamable).
      await keychainSet("agenttool-soma-bearer", project.api_key);
      console.log(green("  ✓ /v1/identity/recover succeeded — fresh device bearer minted."));
      console.log(`    agent.did:        ${agent.did}`);
      console.log(`    agent.id:         ${agent.id}`);
      console.log(`    bearer (api_key): ${project.api_key.slice(0, 16)}…  ${dim("(saved to keychain: agenttool-soma-bearer)")}`);
      console.log();
      console.log(dim("  This bearer authenticates the whole project; the device name only aids revocation."));
      console.log(dim("  The old bearer (if any) keeps working — revoke when this device is set up."));
    } else {
      console.error(red("  ✗ recover succeeded but response had no api_key. Server bug?"));
      process.exit(1);
    }
  } else {
    console.log(bold("  This device can now:"));
    console.log("    • sign as the same identity (signing priv = mnemonic-derived)");
    console.log("    • decrypt strand thoughts (K_master = mnemonic-derived)");
    console.log("    • read agent-encrypted vault (K_vault = mnemonic-derived)");
    console.log("    • decrypt inbox sealed-box messages (box priv = mnemonic-derived)");
    console.log();
    console.log(dim("  To bind this device to an existing agent (mint a fresh device bearer):"));
    console.log(dim("    agenttool-seed restore --did did:at:<your-agent> [--device-label <name>]"));
  }
  console.log();
}

async function cmdPubkeys(): Promise<void> {
  const signingPub = await keychainGet(SVC_SIGNING_PUB);
  const boxPub = await keychainGet(SVC_BOX_PUB);
  if (!signingPub || !boxPub) {
    console.error(
      red(
        "✗ No SOMA seed found in keychain. Run `agenttool-seed generate` or `agenttool-seed restore` first.",
      ),
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        agent_public_key: signingPub,
        box_public_key: boxPub,
      },
      null,
      2,
    ),
  );
}

async function cmdDerive(): Promise<void> {
  const mnemonic = arg("mnemonic");
  const passphrase = arg("passphrase") ?? "";
  if (!mnemonic) {
    console.error(red('✗ --mnemonic "your 24 words …" required'));
    process.exit(1);
  }
  let bundle: DerivedBundle;
  try {
    bundle = derive(mnemonic, passphrase);
  } catch (e) {
    console.error(red(`✗ ${(e as Error).message}`));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        path_scheme: "m/44'/169'/<purpose>'/<index>'",
        purposes: {
          signing: "0",
          k_master: "1",
          k_vault: "2",
          box: "3",
          bridge_signing: "4",
          wallet: "5",
        },
        derived: {
          signing_pub: bundle.signingPubB64,
          signing_priv: bundle.signingPrivB64,
          k_master: bundle.kMasterB64,
          k_vault: bundle.kVaultB64,
          box_pub: bundle.boxPubB64,
          box_priv: bundle.boxPrivB64,
          bridge_dev0_pub: b64(deriveBridgeSigning(mnemonic, 0, passphrase).pub),
        },
      },
      null,
      2,
    ),
  );
}

async function cmdVerify(): Promise<void> {
  const mnemonic = arg("mnemonic");
  const passphrase = arg("passphrase") ?? "";
  if (!mnemonic) {
    console.error(red('✗ --mnemonic "your 24 words …" required'));
    process.exit(1);
  }
  let bundle: DerivedBundle;
  try {
    bundle = derive(mnemonic, passphrase);
  } catch (e) {
    console.error(red(`✗ ${(e as Error).message}`));
    process.exit(1);
  }
  const checks = [
    [SVC_SIGNING_PUB, "signing_pub", bundle.signingPubB64],
    [SVC_SIGNING_PRIV, "signing_priv", bundle.signingPrivB64],
    [SVC_K_MASTER, "k_master", bundle.kMasterB64],
    [SVC_K_VAULT, "k_vault", bundle.kVaultB64],
    [SVC_BOX_PUB, "box_pub", bundle.boxPubB64],
    [SVC_BOX_PRIV, "box_priv", bundle.boxPrivB64],
  ] as const;
  let ok = true;
  for (const [svc, label, expected] of checks) {
    const stored = await keychainGet(svc);
    if (stored === expected) {
      console.log(green(`  ✓ ${label.padEnd(14)} matches keychain`));
    } else if (stored === null) {
      console.log(red(`  ✗ ${label.padEnd(14)} not in keychain`));
      ok = false;
    } else {
      console.log(red(`  ✗ ${label.padEnd(14)} MISMATCH (keychain=${stored.slice(0, 16)}… expected=${expected.slice(0, 16)}…)`));
      ok = false;
    }
  }
  process.exit(ok ? 0 : 1);
}

// ── rotate ─────────────────────────────────────────────────────────────
//
// Mint a fresh project bearer + revoke the current one in a single round-
// trip. The current bearer is read from $AGENTTOOL_API_KEY first, then
// from the `agenttool-soma-bearer` keychain slot. The new bearer is
// written back to the keychain and printed for the operator to copy.
//
// Doctrine: docs/TOKEN-HYGIENE.md. Default TTL is 90 days — line up with
// the project-level rotation cadence the wake's you_protect surface
// recommends.

const SVC_BEARER = "agenttool-soma-bearer";
const ROTATE_DEFAULT_TTL_DAYS = 90;

async function cmdRotate(): Promise<void> {
  const apiBase = arg("api") ?? env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
  const ttlRaw = arg("ttl");
  // `--ttl never` opts out of expiry (legacy default; not recommended).
  const ttlDays = ttlRaw === "never" ? null : Number(ttlRaw ?? ROTATE_DEFAULT_TTL_DAYS);
  if (ttlDays !== null && (!Number.isFinite(ttlDays) || ttlDays <= 0)) {
    console.error(red(`✗ --ttl must be a positive integer or "never"; got ${ttlRaw}`));
    process.exit(1);
  }
  const name = arg("name");

  // Source the current bearer.
  let current = env.AGENTTOOL_API_KEY?.trim() ?? "";
  let source = "AGENTTOOL_API_KEY env";
  if (!current) {
    const fromKeychain = await keychainGet(SVC_BEARER);
    if (fromKeychain) {
      current = fromKeychain;
      source = `keychain (${SVC_BEARER})`;
    }
  }
  if (!current) {
    console.error(red("✗ no current bearer found."));
    console.error(
      dim(
        "  Set $AGENTTOOL_API_KEY, or store one in the keychain at " +
          `${SVC_BEARER}, before running rotate.`,
      ),
    );
    console.error(
      dim(
        "  If you have your mnemonic, run `agenttool-seed restore --did <did:at:…>` to mint a fresh bearer.",
      ),
    );
    process.exit(1);
  }

  console.log(bold("Rotating bearer"));
  console.log(`  source     : ${dim(source)}`);
  console.log(`  current    : ${current.slice(0, 12)}…`);
  console.log(`  api        : ${apiBase}`);
  console.log(`  ttl_days   : ${ttlDays === null ? "never (legacy)" : ttlDays}`);
  if (name) console.log(`  rename     : ${name}`);

  const body: Record<string, unknown> = {};
  if (ttlDays !== null) body.expires_in_days = ttlDays;
  if (name) body.name = name;

  let res: Response;
  try {
    res = await fetch(`${apiBase}/v1/keys/rotate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${current}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(red(`✗ network error: ${(e as Error).message}`));
    process.exit(1);
  }
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const obj = payload as { message?: string; error?: string };
    console.error(red(`✗ rotation failed: ${obj.message ?? obj.error ?? `HTTP ${res.status}`}`));
    if (res.status === 401) {
      console.error(
        dim(
          "  Bearer rejected. If it has expired, run `agenttool-seed restore --did <did:at:…>` " +
            "to mint a fresh one from your mnemonic.",
        ),
      );
    }
    process.exit(1);
  }

  const data = payload as {
    key?: string;
    prefix?: string;
    expires_at?: string | null;
    rotated_from?: { prefix?: string; age_days?: number };
    notice?: string;
  };
  if (!data.key) {
    console.error(red("✗ rotate succeeded but response had no key. Server bug?"));
    process.exit(1);
  }

  await keychainSet(SVC_BEARER, data.key);
  console.log();
  console.log(green("  ✓ rotated."));
  console.log(`    new bearer : ${data.key.slice(0, 16)}…  ${dim(`(saved to keychain: ${SVC_BEARER})`)}`);
  console.log(`    prefix     : ${data.prefix ?? "—"}`);
  console.log(`    expires    : ${data.expires_at ?? "never"}`);
  if (data.rotated_from?.prefix) {
    console.log(
      `    revoked    : ${data.rotated_from.prefix}…  ${dim(`(was ${data.rotated_from.age_days ?? "?"}d old)`)}`,
    );
  }
  console.log();
  console.log(dim("  Update CI / other devices with the new bearer. Old bearer is inert."));
  console.log(`  Full key (copy to env if needed):`);
  console.log(`    ${data.key}`);
}

/** bootstrap — machine-driven agent registration via /v1/register/agent.
 *
 *  The autonomous-agent counterpart to the web-based "Bring this agent
 *  into existence →" form. Generates or reads a SOMA mnemonic, derives
 *  keys locally, signs a key-proof, grinds proof-of-work, POSTs the
 *  registration, and persists the bearer to the keychain. The server
 *  never sees the mnemonic or any private key. */
async function cmdBootstrap(): Promise<void> {
  const name = arg("name");
  const provider = arg("provider");
  if (!name) {
    console.error(red("✗ --name <agent-name> is required."));
    process.exit(1);
  }
  if (!provider) {
    console.error(red("✗ --provider <runtime-provider> is required (e.g. anthropic, openai, local)."));
    process.exit(1);
  }
  const model = arg("model");
  const host = arg("host");
  const context = arg("context");
  const apiBase = arg("api") ?? env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
  const difficulty = intArg("difficulty", 18);
  const persistMnemonic = flag("persist-mnemonic");
  const deviceIndex = intArg("device-index", 0);
  const useExistingMnemonic = arg("mnemonic");
  const capabilitiesArg = arg("capability") ?? arg("capabilities") ?? "";
  const capabilities = capabilitiesArg
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 32);
  const expressionVisibility = (arg("visibility") as "public" | "private" | undefined) ?? "private";
  const registrarBearer = arg("registrar-bearer");
  const parentIdentityId = arg("parent-identity-id");

  // Derive: either re-use a supplied mnemonic, or generate a fresh one.
  // We don't read from keychain because each bootstrap creates a NEW
  // identity with its own bearer; sharing keys across identities is the
  // wrong model. If the operator wants to RECOVER an existing identity
  // they should use `agenttool-seed restore --did <did>` instead.
  const words = useExistingMnemonic ?? generateMnemonic(256);
  let bundle: DerivedBundle;
  try {
    bundle = derive(words);
  } catch (e) {
    console.error(red(`✗ ${(e as Error).message}`));
    process.exit(1);
  }

  console.log();
  console.log(bold("agenttool-seed bootstrap — autonomous-agent registration"));
  console.log(`  name           : ${name}`);
  console.log(`  provider       : ${provider}`);
  if (model) console.log(`  model          : ${model}`);
  if (host) console.log(`  host           : ${host}`);
  if (context) console.log(`  context        : ${context}`);
  if (capabilities.length) console.log(`  capabilities   : ${capabilities.join(", ")}`);
  console.log(`  api            : ${apiBase}`);
  console.log(`  pow_difficulty : ${difficulty} bits`);
  console.log(`  visibility     : ${expressionVisibility}`);
  if (registrarBearer) {
    console.log(`  registrar mode : registrar_bearer (${registrarBearer.slice(0, 12)}…)`);
  } else {
    console.log(`  registrar mode : self_service`);
  }
  console.log();

  // Sign the key-proof. Timestamp generated here is bound into both the
  // signature and the proof-of-work — server enforces ±5min freshness.
  const timestamp = new Date().toISOString();
  const registrationNonce = globalThis.crypto.randomUUID();
  const { signature } = signRegisterAgent({
    displayName: name,
    agentPublicKey: bundle.signingPub,
    boxPublicKey: bundle.boxPub,
    runtimeProvider: provider,
    runtimeModel: model,
    capabilities,
    runtimeHost: host,
    runtimeContext: context,
    expressionVisibility,
    registrarKind: registrarBearer ? "registrar_bearer" : "self_service",
    parentIdentityId: registrarBearer ? parentIdentityId : undefined,
    registrarBearer,
    registrationNonce,
    derivedSigningPriv: bundle.signingPriv,
    timestamp,
  });

  // Grind PoW. Skip when registrar_bearer mode is active — the server
  // skips it too because the parent bearer already proved trust.
  let powNonce = "";
  let powIterations = 0;
  if (!registrarBearer) {
    process.stdout.write(`  grinding PoW (${difficulty} bits)…`);
    const t0 = Date.now();
    const ground = grindRegisterAgentPow({
      agentPublicKey: bundle.signingPub,
      displayName: name,
      timestamp,
      difficultyBits: difficulty,
    });
    powNonce = ground.powNonce;
    powIterations = ground.iterations;
    const took = ((Date.now() - t0) / 1000).toFixed(2);
    process.stdout.write(green(` ✓ ${powIterations} tries · ${took}s\n`));
  } else {
    powNonce = "skipped";
  }

  const requestBody: Record<string, unknown> = {
    display_name: name,
    capabilities,
    agent_public_key: bundle.signingPubB64,
    box_public_key: bundle.boxPubB64,
    runtime: {
      provider,
      ...(model ? { model } : {}),
      ...(host ? { host } : {}),
      ...(context ? { context } : {}),
    },
    key_proof: { timestamp, signature },
    pow_nonce: powNonce,
    registration_nonce: registrationNonce,
    expression_visibility: expressionVisibility,
    registrar: registrarBearer
      ? {
          kind: "registrar_bearer",
          bearer: registrarBearer,
          ...(parentIdentityId ? { parent_identity_id: parentIdentityId } : {}),
        }
      : { kind: "self_service" },
  };

  let res: Response;
  try {
    res = await fetch(`${apiBase}/v1/register/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    console.error(red(`✗ network error: ${(e as Error).message}`));
    process.exit(1);
  }

  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const obj = payload as { error?: string; message?: string };
    console.error(red(`✗ registration failed: ${obj.message ?? obj.error ?? `HTTP ${res.status}`}`));
    if (obj.error === "pow_required") {
      console.error(dim("  Increase --difficulty to match the server, or check the timestamp drift."));
    }
    if (obj.error === "rate_limited") {
      console.error(dim("  Self-service IP rate limit hit. Wait, or use --registrar-bearer to delegate."));
    }
    process.exit(1);
  }

  const data = payload as {
    agent: { id: string; did: string; bootstrap_mode: string };
    project: { api_key: string };
    wake_url: string;
  };

  // Persist the bearer alongside the existing keychain entries. We re-use
  // SVC_BEARER (agenttool-soma-bearer) so subsequent `rotate`, `pubkeys`,
  // and the bridge sidecar all find this bearer without configuration.
  await keychainSet(SVC_BEARER, data.project.api_key);
  await persistBundle(bundle, words, { persistMnemonic, deviceIndex });

  // Filesystem fallback — write a JSON keystore so the operator (or a
  // CI cache) has a recoverable record. Mode 0600.
  const keystorePath = await writeKeystoreFile({
    name,
    did: data.agent.did,
    bearer: data.project.api_key,
    privateSigningKey: bundle.signingPrivB64,
    publicSigningKey: bundle.signingPubB64,
    boxPrivateKey: bundle.boxPrivB64,
    boxPublicKey: bundle.boxPubB64,
    runtime: { provider, ...(model ? { model } : {}), ...(host ? { host } : {}), ...(context ? { context } : {}) },
    issuedAt: timestamp,
    bootstrapMode: data.agent.bootstrap_mode,
    wakeUrl: data.wake_url,
  });

  console.log();
  console.log(green(`  ✓ registered as ${data.agent.did}`));
  console.log(`    bearer       : ${data.project.api_key.slice(0, 16)}…  ${dim(`(saved to keychain: ${SVC_BEARER})`)}`);
  console.log(`    keystore     : ${keystorePath}`);
  console.log(`    wake         : ${data.wake_url}`);
  console.log();
  console.log(yellow("  WRITE DOWN YOUR 24-WORD MNEMONIC NOW. The server has no copy."));
  if (!useExistingMnemonic) {
    console.log();
    const mnemonicWords = words.split(" ");
    const cols = 4;
    for (let r = 0; r < Math.ceil(mnemonicWords.length / cols); r++) {
      let line = "    ";
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= mnemonicWords.length) break;
        const idx = (i + 1).toString().padStart(2, " ");
        const word = mnemonicWords[i]!.padEnd(12, " ");
        line += `${dim(idx + ".")} ${word}`;
      }
      console.log(line);
    }
  }
  console.log();
  console.log(bold("  Next steps:"));
  console.log(`    export AGENTTOOL_API_KEY=${data.project.api_key}`);
  console.log(`    curl "${data.wake_url}" -H "Authorization: Bearer ${data.project.api_key.slice(0, 16)}…"`);
  console.log();
}

/** Filesystem fallback for the keystore — written with mode 0600 to
 *  ~/.config/agenttool/agents/<short-did>.keystore.json. */
async function writeKeystoreFile(opts: {
  name: string;
  did: string;
  bearer: string;
  privateSigningKey: string;
  publicSigningKey: string;
  boxPrivateKey: string;
  boxPublicKey: string;
  runtime: Record<string, unknown>;
  issuedAt: string;
  bootstrapMode: string;
  wakeUrl: string;
}): Promise<string> {
  const home = env.HOME ?? "/tmp";
  const dir = `${home}/.config/agenttool/agents`;
  const fs = await import("node:fs/promises");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const shortDid = opts.did.replace("did:at:", "").slice(0, 8);
  const path = `${dir}/${opts.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-${shortDid}.keystore.json`;
  const keystore = {
    schema: "agenttool-keystore/v1",
    name: opts.name,
    did: opts.did,
    bearer: opts.bearer,
    private_signing_key: opts.privateSigningKey,
    public_signing_key: opts.publicSigningKey,
    box_private_key: opts.boxPrivateKey,
    box_public_key: opts.boxPublicKey,
    runtime: opts.runtime,
    bootstrap_mode: opts.bootstrapMode,
    issued_at: opts.issuedAt,
    wake_url: opts.wakeUrl,
    note:
      "Treat this file like a password. The bearer authenticates API calls; " +
      "the private signing key signs thoughts/attestations/witness consents. " +
      "Both must be kept secret. agenttool keeps no copy. Recover via SOMA " +
      "mnemonic if both are lost.",
  };
  await fs.writeFile(path, JSON.stringify(keystore, null, 2) + "\n", { mode: 0o600 });
  return path;
}

function usage(): void {
  console.log(`agenttool-seed — interactive mnemonic management

USAGE:
  bun bin/agenttool-seed.ts <command> [options]

COMMANDS:
  generate                          Generate a fresh 24-word mnemonic, derive
                                    all keys, persist in keychain. Display
                                    the words for offline backup.
                                    Options:
                                      --strength <bits>   128/160/192/224/256 (default 256)
                                      --device-index <n>  bridge signing key index (default 0)
                                      --persist-mnemonic  also store the mnemonic in keychain

  restore                           Interactive mnemonic entry. Derive all
                                    keys, persist in keychain. Use this on
                                    a fresh laptop to recover the agent.
                                    Options:
                                      --did <did:at:…>    bind this device to an
                                                          existing agent — signs a
                                                          caller-timestamped canonical
                                                          recovery request + POSTs
                                                          /v1/identity/recover, mints
                                                          a fresh project-wide bearer
                                                          only if the derived key is
                                                          active and registered
                                      --device-label <s>  label for the new bearer
                                      --api <url>         API base (default
                                                          AGENTTOOL_BASE or prod)
                                      --device-index <n>  default 0
                                      --persist-mnemonic  store mnemonic too
                                    Passphrase entry is hidden (stty -echo).

  pubkeys                           Print derived signing_pub + box_pub
                                    from the keychain (JSON).

  derive --mnemonic "<words>"        Show derived keys for a given mnemonic
        [--passphrase "<pp>"]        without persisting (debug / scripting).

  verify --mnemonic "<words>"        Re-derive from a given mnemonic and
        [--passphrase "<pp>"]        confirm every keychain entry matches.
                                    Exit 0 on success, 1 on mismatch.

  rotate                            Mint a fresh project bearer + revoke
                                    the current one. Reads the bearer
                                    from $AGENTTOOL_API_KEY or the
                                    keychain slot agenttool-soma-bearer,
                                    saves the new bearer back to keychain.
                                    Options:
                                      --ttl <days>   default 90; pass "never"
                                                     to opt out (not advised).
                                      --name <s>     rename the new bearer.
                                      --api <url>    API base (default
                                                     AGENTTOOL_BASE or prod).
                                    Doctrine: docs/TOKEN-HYGIENE.md.

  bootstrap                         Machine-driven agent registration via
        --name <s>                  POST /v1/register/agent. Generates (or
        --provider <s>              re-uses) a SOMA mnemonic locally, signs
        [--model <s>]               a key-proof, grinds proof-of-work, and
        [--host <s>]                persists the resulting bearer to the
        [--context <s>]             keychain. The server never sees the
        [--capability <csv>]        mnemonic. Use this from a Claude Code
        [--mnemonic "<words>"]      session, a worker, or any autonomous
        [--difficulty <bits>]       runtime. For human-driven bootstrap use
        [--registrar-bearer <at_>]  the dashboard at app.agenttool.dev.
        [--parent-identity-id <u>]  Doctrine: docs/IDENTITY-SEED.md +
        [--visibility public|private] docs/IDENTITY-ANCHOR.md.
        [--persist-mnemonic]
        [--api <url>]

DOCTRINE:
  docs/IDENTITY-SEED.md — one mnemonic, one identity. The platform never
  sees the seed. The human is the keystone of continuity.
`);
}

const cmd = argv[2];
const handlers: Record<string, () => Promise<void>> = {
  generate: cmdGenerate,
  restore: cmdRestore,
  pubkeys: cmdPubkeys,
  derive: cmdDerive,
  verify: cmdVerify,
  rotate: cmdRotate,
  bootstrap: cmdBootstrap,
};

const handler = cmd ? handlers[cmd] : undefined;
if (!handler) {
  usage();
  process.exit(cmd ? 1 : 0);
}

handler().catch((e: Error) => {
  console.error(red(`✗ ${e.message}`));
  process.exit(1);
});
