/** Passphrase prompts — TTY raw mode for non-echoing input.
 *
 *  Precedence (when a passphrase is needed):
 *    1. --passphrase <value>   flag (insecure but useful for automation)
 *    2. AGENTTOOL_THINK_PASSPHRASE env var
 *    3. interactive prompt (no echo)
 *
 *  The passphrase NEVER touches the agenttool server. It stays in this
 *  process for the duration of the operation, used to derive the AES
 *  key, then released. */

import { argv, env, stdin, stdout } from "node:process";

function flagFromArgv(name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

async function readSecretFromTty(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(
        new Error(
          "stdin is not a TTY; pass --passphrase or set AGENTTOOL_THINK_PASSPHRASE",
        ),
      );
      return;
    }
    stdout.write(prompt);

    const setRaw = stdin.setRawMode?.bind(stdin);
    if (setRaw) setRaw(true);
    let buf = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.pause();
      if (setRaw) setRaw(false);
    };

    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf-8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\x7f" || ch === "\b") {
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        if (ch === "\x03") {
          // Ctrl-C
          cleanup();
          stdout.write("\n");
          process.exit(130);
        }
        buf += ch;
      }
    };

    stdin.on("data", onData);
    stdin.resume();
  });
}

export interface PassphraseOptions {
  prompt?: string;
  confirm?: boolean;       // ask twice; verify match
  minLength?: number;
}

export async function readPassphrase(opts: PassphraseOptions = {}): Promise<string> {
  const prompt = opts.prompt ?? "Passphrase: ";
  const minLength = opts.minLength ?? 8;

  // 1. CLI flag
  const fromFlag = flagFromArgv("--passphrase");
  if (fromFlag !== undefined) {
    if (fromFlag.length < minLength) {
      throw new Error(`passphrase must be at least ${minLength} characters`);
    }
    return fromFlag;
  }

  // 2. Env var
  const fromEnv = env.AGENTTOOL_THINK_PASSPHRASE;
  if (fromEnv !== undefined && fromEnv !== "") {
    if (fromEnv.length < minLength) {
      throw new Error(`AGENTTOOL_THINK_PASSPHRASE must be at least ${minLength} characters`);
    }
    return fromEnv;
  }

  // 3. Interactive
  const first = await readSecretFromTty(prompt);
  if (first.length < minLength) {
    throw new Error(`passphrase must be at least ${minLength} characters`);
  }
  if (opts.confirm) {
    const second = await readSecretFromTty("Confirm:    ");
    if (first !== second) {
      throw new Error("passphrases do not match");
    }
  }
  return first;
}
