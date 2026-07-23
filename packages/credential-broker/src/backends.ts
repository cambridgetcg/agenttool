import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { AgentCredError } from "./errors.js";
import { validateCredentialAuth } from "./http.js";
import type {
  CredentialAuth,
  CredentialMaterial,
  CredentialSource,
} from "./types.js";

export interface MacOSKeychainReference {
  backend: "macos-keychain";
  service: string;
  account?: string;
  auth: CredentialAuth;
}

export type CredentialReference = MacOSKeychainReference;

const MAX_SECRET_BYTES = 16 * 1024;

function validateReferencePart(value: string, name: string): string {
  if (!value || value.length > 512 || /[\0\r\n]/.test(value)) {
    throw new AgentCredError("invalid_request", `Invalid ${name} in broker-owned credential mapping.`);
  }
  return value;
}

async function readBoundedCommand(
  executable: string,
  args: string[],
  signal?: AbortSignal,
): Promise<Buffer> {
  if (signal?.aborted) {
    throw new AgentCredError("request_failed", "Credential lookup was cancelled.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        HOME: process.env.HOME ?? homedir(),
        USER: process.env.USER ?? userInfo().username,
        LOGNAME: process.env.LOGNAME ?? userInfo().username,
        LANG: process.env.LANG ?? "C.UTF-8",
        PATH: "/usr/bin:/bin",
      },
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const stop = (): void => {
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, 15_000);
    timeout.unref?.();
    const onAbort = (): void => {
      aborted = true;
      stop();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_SECRET_BYTES) {
        tooLarge = true;
        child.kill();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      for (const chunk of chunks) chunk.fill(0);
      reject(new AgentCredError("backend_unavailable", "Credential backend could not start."));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted || timedOut || tooLarge || code !== 0) {
        for (const chunk of chunks) chunk.fill(0);
        reject(
          new AgentCredError(
            aborted ? "request_failed" : tooLarge || timedOut ? "backend_unavailable" : "credential_not_found",
            aborted
              ? "Credential lookup was cancelled."
              : tooLarge || timedOut
                ? "Credential backend returned an invalid value."
                : "Credential is unavailable.",
          ),
        );
        return;
      }
      const output = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      const hasTrailingNewline = output.at(-1) === 0x0a;
      const end = hasTrailingNewline ? output.length - 1 : output.length;
      const value = Buffer.from(output.subarray(0, end));
      output.fill(0);
      if (value.length === 0) {
        reject(new AgentCredError("credential_not_found", "Credential is unavailable."));
        return;
      }
      resolve(value);
    });
  });
}

/**
 * Broker-only mapping from public aliases to macOS Keychain item metadata.
 * The source exposes no enumeration or raw-read method to protocol clients.
 *
 * The current adapter invokes the fixed system `security` binary. This keeps
 * values out of the agent process, but it is not equivalent to a native
 * Security.framework ACL bound to a code-signed broker.
 */
export class MacOSKeychainSource implements CredentialSource {
  readonly #references: ReadonlyMap<string, MacOSKeychainReference>;

  constructor(references: Record<string, MacOSKeychainReference>) {
    this.#references = new Map(
      Object.entries(references).map(([alias, reference]) => {
        validateCredentialAuth(reference.auth);
        return [
          validateReferencePart(alias, "credential alias"),
          {
            ...reference,
            service: validateReferencePart(reference.service, "Keychain service"),
            account: validateReferencePart(
              reference.account ?? process.env.USER ?? userInfo().username,
              "Keychain account",
            ),
          },
        ];
      }),
    );
  }

  async withCredential<T>(
    alias: string,
    use: (material: CredentialMaterial) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const reference = this.#references.get(alias);
    if (!reference) {
      throw new AgentCredError("credential_not_found", "Credential is unavailable.");
    }
    if (process.platform !== "darwin") {
      throw new AgentCredError("backend_unavailable", "macOS Keychain backend is unavailable.");
    }
    const value = await readBoundedCommand("/usr/bin/security", [
      "find-generic-password",
      "-s",
      reference.service,
      "-a",
      reference.account!,
      "-w",
    ], signal);
    try {
      return await use({ value, auth: { ...reference.auth } });
    } finally {
      value.fill(0);
    }
  }
}
