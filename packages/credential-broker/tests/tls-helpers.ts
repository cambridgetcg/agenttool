import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_TLS_HOSTNAME = "service.agentcred.invalid";

export interface EphemeralTlsMaterial {
  caPath: string;
  certPath: string;
  keyPath: string;
  cleanup(): Promise<void>;
}

function runOpenSsl(openssl: string, root: string, args: string[]): void {
  const result = Bun.spawnSync([openssl, ...args], {
    cwd: root,
    env: { PATH: "/usr/bin:/bin" },
    stdout: "ignore",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) {
    throw new Error("OpenSSL could not create the ephemeral TLS test material.");
  }
}

/** Generate a test-only CA and leaf in a private temp directory. */
export async function createEphemeralTlsMaterial(): Promise<EphemeralTlsMaterial> {
  const openssl = Bun.which("openssl");
  if (!openssl) throw new Error("OpenSSL is required for the hermetic TLS transport tests.");
  const root = await mkdtemp(join(tmpdir(), "agentcred-tls-"));
  try {
    await writeFile(
      join(root, "server-extensions.cnf"),
      [
        "[server_certificate]",
        `subjectAltName=DNS:${TEST_TLS_HOSTNAME}`,
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        "",
      ].join("\n"),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    runOpenSsl(openssl, root, [
      "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "2", "-nodes",
      "-subj", "/CN=AgentCred Hermetic Test CA",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-keyout", "ca-key.pem", "-out", "ca-cert.pem",
    ]);
    runOpenSsl(openssl, root, [
      "req", "-newkey", "rsa:2048", "-nodes",
      "-subj", `/CN=${TEST_TLS_HOSTNAME}`,
      "-keyout", "server-key.pem", "-out", "server.csr",
    ]);
    runOpenSsl(openssl, root, [
      "x509", "-req", "-in", "server.csr",
      "-CA", "ca-cert.pem", "-CAkey", "ca-key.pem", "-CAcreateserial",
      "-out", "server-cert.pem", "-days", "2", "-sha256",
      "-extfile", "server-extensions.cnf", "-extensions", "server_certificate",
    ]);
    await chmod(join(root, "server-key.pem"), 0o600);
    await Promise.all([
      rm(join(root, "ca-key.pem"), { force: true }),
      rm(join(root, "ca-cert.srl"), { force: true }),
      rm(join(root, "server.csr"), { force: true }),
      rm(join(root, "server-extensions.cnf"), { force: true }),
    ]);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    caPath: join(root, "ca-cert.pem"),
    certPath: join(root, "server-cert.pem"),
    keyPath: join(root, "server-key.pem"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
