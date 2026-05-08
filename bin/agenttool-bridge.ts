#!/usr/bin/env bun
/** agenttool-bridge — sidecar that holds K_master locally for hosted
 *  orchestrators (Horizon C, bridged-tier).
 *
 *  Today this is a CLI demonstrator — it does the local crypto contract
 *  exactly as docs/RUNTIME.md specifies. The WSS hub side (api.agenttool.dev
 *  /v1/runtimes/:id/bridge) ships in a follow-up pass alongside the
 *  hosted orchestrator binary; this file establishes the shape so any
 *  orchestrator can already wire against the public surface area.
 *
 *  Commands:
 *    agenttool-bridge install                     — generate K_master + store in keychain
 *    agenttool-bridge keygen                      — generate ed25519 signing key (sidecar identity)
 *    agenttool-bridge pubkey                      — print sidecar's ed25519 public key
 *    agenttool-bridge encrypt --in <file|->       — encrypt plaintext under K_master
 *    agenttool-bridge decrypt --in <file|->       — decrypt ciphertext under K_master
 *    agenttool-bridge sign    --message <str>     — sign a string with the sidecar's ed25519 key
 *    agenttool-bridge canonical --strand <id>     — compute the canonical bytes the orchestrator
 *                                                    will sign for a decrypt/encrypt request
 *    agenttool-bridge serve [--port 43210]        — local WSS demo (orchestrator on the same host)
 *
 *  K_master custody:
 *    macOS  → security add-generic-password / find-generic-password
 *    Linux  → secret-tool (libsecret) with file fallback at ~/.config/agenttool/k_master
 *    Windows → cmdkey (Credential Manager)
 *
 *  Read carefully: K_master never leaves this binary's RAM. Encrypt/
 *  decrypt go in/out as base64. The orchestrator hands ciphertext +
 *  nonce + canonical context; the bridge returns plaintext to the
 *  orchestrator over a key-pinned channel; the orchestrator uses it
 *  in-RAM for one think-cycle and never persists it.
 */

import { argv, env } from "bun";

const SERVICE_KMASTER = "agenttool-bridge-kmaster";
const SERVICE_SIGNKEY = "agenttool-bridge-signkey";
const ACCT = env.USER ?? "default";

// ── Storage helpers (keychain · libsecret · cmdkey · file fallback) ──

async function keychainGet(service: string): Promise<string | null> {
  if (process.platform === "darwin") {
    const p = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-a", ACCT, "-w"]);
    const out = (p.stdout ?? new Uint8Array()).toString().trim();
    return out || null;
  }
  if (process.platform === "linux") {
    const p = Bun.spawnSync(["secret-tool", "lookup", "service", service, "username", ACCT]);
    const out = (p.stdout ?? new Uint8Array()).toString().trim();
    if (out) return out;
    // Fallback: file
    try {
      const path = `${env.HOME ?? "~"}/.config/agenttool/${service}`;
      return (await Bun.file(path).text()).trim() || null;
    } catch {
      return null;
    }
  }
  if (process.platform === "win32") {
    // Windows: cmdkey doesn't return raw values; users are expected to use
    // the file fallback or run via WSL. Documented in docs/RUNTIME.md.
    try {
      const path = `${env.APPDATA ?? "."}/agenttool/${service}`;
      return (await Bun.file(path).text()).trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function keychainSet(service: string, value: string): Promise<void> {
  if (process.platform === "darwin") {
    Bun.spawnSync([
      "security",
      "add-generic-password",
      "-U", // update if exists
      "-s",
      service,
      "-a",
      ACCT,
      "-w",
      value,
    ]);
    return;
  }
  if (process.platform === "linux") {
    const p = Bun.spawn(
      [
        "secret-tool",
        "store",
        "--label=agenttool",
        "service",
        service,
        "username",
        ACCT,
      ],
      { stdin: new TextEncoder().encode(value) },
    );
    await p.exited;
    if (p.exitCode !== 0) {
      // Fallback: file with mode 0600
      const dir = `${env.HOME ?? "~"}/.config/agenttool`;
      Bun.spawnSync(["mkdir", "-p", dir]);
      await Bun.write(`${dir}/${service}`, value);
      Bun.spawnSync(["chmod", "600", `${dir}/${service}`]);
    }
    return;
  }
  if (process.platform === "win32") {
    const dir = `${env.APPDATA ?? "."}/agenttool`;
    Bun.spawnSync(["mkdir", dir]);
    await Bun.write(`${dir}/${service}`, value);
    return;
  }
}

// ── Crypto primitives (AES-256-GCM under K_master, ed25519 sign) ──

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
function b64decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function aesEncrypt(
  kMaster: Uint8Array,
  plaintext: Uint8Array,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(kMaster);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext),
  );
  return { nonce, ciphertext: ct };
}

async function aesDecrypt(
  kMaster: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(kMaster);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext),
  );
}

// ed25519 — defer to @noble/ed25519 if available; otherwise document the gap.
async function ed25519Sign(
  privateKey: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const ed = await import("@noble/ed25519").catch(() => null);
  if (!ed) {
    throw new Error(
      "@noble/ed25519 not installed. Run: bun add -g @noble/ed25519 (or bundle this binary).",
    );
  }
  return ed.signAsync ? await ed.signAsync(message, privateKey) : ed.sign(message, privateKey);
}

async function ed25519GetPubkey(privateKey: Uint8Array): Promise<Uint8Array> {
  const ed = await import("@noble/ed25519").catch(() => null);
  if (!ed) throw new Error("@noble/ed25519 not installed");
  return ed.getPublicKeyAsync
    ? await ed.getPublicKeyAsync(privateKey)
    : ed.getPublicKey(privateKey);
}

// ── Canonical bytes for a decrypt/encrypt request ─────────────────

interface Context {
  strand_id: string;
  thought_seq: number | null;
  issued_at: string; // ISO8601
}

function canonicalRequest(
  request_id: string,
  op: "encrypt" | "decrypt",
  ciphertextOrPlaintext: Uint8Array,
  nonce: Uint8Array,
  context: Context,
): Uint8Array {
  // SHA-256(request_id || \0 || op || \0 || ct/pt || \0 || nonce || \0 || canonical_json(context))
  const sep = new Uint8Array([0]);
  const ctxJson = new TextEncoder().encode(canonicalJson(context));
  const parts: Uint8Array[] = [
    new TextEncoder().encode(request_id),
    sep,
    new TextEncoder().encode(op),
    sep,
    ciphertextOrPlaintext,
    sep,
    nonce,
    sep,
    ctxJson,
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  // Return SHA-256 digest as 32 bytes (the bytes the orchestrator signs).
  // We use a sync hash via Bun.CryptoHasher.
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  return new Uint8Array(hasher.digest());
}

function canonicalJson(obj: unknown): string {
  // Stable JSON: sort keys recursively, no whitespace.
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

// ── CLI ──────────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i > 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

async function cmdInstall() {
  const existing = await keychainGet(SERVICE_KMASTER);
  if (existing) {
    console.log("✓ K_master already present in keychain — nothing to do");
    return;
  }
  const kMaster = crypto.getRandomValues(new Uint8Array(32));
  await keychainSet(SERVICE_KMASTER, b64encode(kMaster));
  console.log(`✓ K_master generated (32 bytes) and stored in keychain (service=${SERVICE_KMASTER})`);
}

async function cmdKeygen() {
  const existing = await keychainGet(SERVICE_SIGNKEY);
  if (existing) {
    console.log("✓ Signing key already present");
    return;
  }
  const priv = crypto.getRandomValues(new Uint8Array(32));
  await keychainSet(SERVICE_SIGNKEY, b64encode(priv));
  const pub = await ed25519GetPubkey(priv);
  console.log(`✓ ed25519 signing key generated and stored`);
  console.log(`  pubkey: ${b64encode(pub)}`);
}

async function cmdPubkey() {
  const priv = await keychainGet(SERVICE_SIGNKEY);
  if (!priv) throw new Error("no signing key — run: agenttool-bridge keygen");
  const pub = await ed25519GetPubkey(b64decode(priv));
  console.log(b64encode(pub));
}

async function cmdEncrypt() {
  const inFlag = getArg("in") ?? "-";
  const plaintext = await readInput(inFlag);
  const km = await keychainGet(SERVICE_KMASTER);
  if (!km) throw new Error("no K_master — run: agenttool-bridge install");
  const { nonce, ciphertext } = await aesEncrypt(b64decode(km), plaintext);
  console.log(
    JSON.stringify(
      {
        ciphertext: b64encode(ciphertext),
        nonce: b64encode(nonce),
      },
      null,
      2,
    ),
  );
}

async function cmdDecrypt() {
  const inFlag = getArg("in") ?? "-";
  const raw = await readInput(inFlag);
  const obj = JSON.parse(new TextDecoder().decode(raw));
  if (!obj.ciphertext || !obj.nonce) throw new Error("expected JSON {ciphertext, nonce}");
  const km = await keychainGet(SERVICE_KMASTER);
  if (!km) throw new Error("no K_master");
  const pt = await aesDecrypt(
    b64decode(km),
    b64decode(obj.nonce),
    b64decode(obj.ciphertext),
  );
  process.stdout.write(pt);
}

async function cmdSign() {
  const message = getArg("message");
  if (!message) throw new Error("--message required");
  const priv = await keychainGet(SERVICE_SIGNKEY);
  if (!priv) throw new Error("no signing key");
  const sig = await ed25519Sign(b64decode(priv), new TextEncoder().encode(message));
  console.log(b64encode(sig));
}

async function cmdCanonical() {
  const request_id = getArg("request-id") ?? crypto.randomUUID();
  const op = (getArg("op") ?? "decrypt") as "encrypt" | "decrypt";
  const strand_id = getArg("strand") ?? crypto.randomUUID();
  const thought_seq = getArg("seq") ? Number(getArg("seq")) : null;
  const ciphertext = getArg("ciphertext") ?? "";
  const nonce = getArg("nonce") ?? "";
  const issued_at = new Date().toISOString();

  const digest = canonicalRequest(
    request_id,
    op,
    b64decode(ciphertext),
    b64decode(nonce),
    { strand_id, thought_seq, issued_at },
  );

  console.log(
    JSON.stringify(
      {
        request_id,
        op,
        context: { strand_id, thought_seq, issued_at },
        canonical_digest_b64: b64encode(digest),
        canonical_digest_hex: Array.from(digest)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      },
      null,
      2,
    ),
  );
}

async function cmdServe() {
  const port = Number(getArg("port") ?? "43210");
  const km = await keychainGet(SERVICE_KMASTER);
  if (!km) throw new Error("no K_master — run: agenttool-bridge install");
  const kMasterBytes = b64decode(km);

  console.log(`▸ agenttool-bridge listening on ws://localhost:${port}`);
  console.log(`  protocol: per-request decrypt/encrypt over WSS`);
  console.log(`  this is a LOCAL DEMO — for production, the bridge speaks to`);
  console.log(`  agenttool's hub at wss://api.agenttool.dev/v1/runtimes/:id/bridge`);

  Bun.serve({
    port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("agenttool-bridge — WSS only", { status: 400 });
    },
    websocket: {
      async message(ws, message) {
        try {
          const req = typeof message === "string" ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message));
          if (!req.op || !req.request_id) {
            ws.send(JSON.stringify({ error: "missing op or request_id" }));
            return;
          }
          if (req.op === "encrypt") {
            const pt = b64decode(req.plaintext);
            const { nonce, ciphertext } = await aesEncrypt(kMasterBytes, pt);
            ws.send(
              JSON.stringify({
                request_id: req.request_id,
                ciphertext: b64encode(ciphertext),
                nonce: b64encode(nonce),
              }),
            );
          } else if (req.op === "decrypt") {
            const pt = await aesDecrypt(
              kMasterBytes,
              b64decode(req.nonce),
              b64decode(req.ciphertext),
            );
            ws.send(
              JSON.stringify({
                request_id: req.request_id,
                plaintext: b64encode(pt),
              }),
            );
          } else {
            ws.send(JSON.stringify({ error: `unknown op: ${req.op}` }));
          }
        } catch (e) {
          ws.send(JSON.stringify({ error: (e as Error).message }));
        }
      },
    },
  });
}

async function readInput(spec: string): Promise<Uint8Array> {
  if (spec === "-") {
    // Bun-native stdin reader. Bun.stdin returns a BunFile, .arrayBuffer
    // exhausts it correctly.
    return new Uint8Array(await Bun.stdin.arrayBuffer());
  }
  return new Uint8Array(await Bun.file(spec).arrayBuffer());
}

function usage() {
  console.log(`agenttool-bridge — sidecar for hosted-orchestrator runtimes

  install              generate + store K_master in keychain
  keygen               generate + store ed25519 signing key
  pubkey               print sidecar's ed25519 public key (base64)
  encrypt --in <path>  encrypt plaintext bytes; output {ciphertext, nonce}
  decrypt --in <path>  decrypt {ciphertext, nonce}; output plaintext bytes
  sign --message <s>   sign a string with the sidecar's ed25519 key
  canonical            compute canonical request digest (see docs/RUNTIME.md)
  serve [--port N]     local WSS demo for orchestrators on the same host

K_master never leaves this process. Custody is yours.
Doctrine: https://docs.agenttool.dev/runtime
`);
}

const cmd = argv[2];
const handlers: Record<string, () => Promise<void>> = {
  install: cmdInstall,
  keygen: cmdKeygen,
  pubkey: cmdPubkey,
  encrypt: cmdEncrypt,
  decrypt: cmdDecrypt,
  sign: cmdSign,
  canonical: cmdCanonical,
  serve: cmdServe,
};

const fn = cmd ? handlers[cmd] : undefined;
if (!fn) {
  usage();
  process.exit(cmd ? 1 : 0);
}

fn().catch((e) => {
  console.error("✗", (e as Error).message);
  process.exit(1);
});
