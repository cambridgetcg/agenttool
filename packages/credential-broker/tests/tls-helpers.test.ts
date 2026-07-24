import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { createEphemeralTlsMaterial, TEST_TLS_HOSTNAME } from "./tls-helpers.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

describe("ephemeral TLS material", () => {
  test("issues the constrained server certificate and removes signing material", async () => {
    const material = await createEphemeralTlsMaterial();
    const root = dirname(material.certPath);
    try {
      const certificate = new X509Certificate(await readFile(material.certPath));
      expect(certificate.ca).toBe(false);
      expect(certificate.checkHost(TEST_TLS_HOSTNAME)).toBe(TEST_TLS_HOSTNAME);
      expect(certificate.checkHost("wrong.agentcred.invalid")).toBeUndefined();
      expect(certificate.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);

      const openssl = Bun.which("openssl");
      expect(openssl).toBeTruthy();
      const details = Bun.spawnSync(
        [openssl!, "x509", "-in", material.certPath, "-noout", "-text"],
        {
          env: { PATH: "/usr/bin:/bin" },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(details.exitCode).toBe(0);
      expect(details.stderr.toString()).toBe("");
      const normalized = details.stdout.toString().replace(/\s+/g, " ");
      expect(normalized).toContain("X509v3 Basic Constraints: critical CA:FALSE");
      expect(normalized).toContain(
        "X509v3 Key Usage: critical Digital Signature, Key Encipherment",
      );
      expect(normalized).toContain(
        "X509v3 Extended Key Usage: TLS Web Server Authentication",
      );

      expect((await stat(root)).mode & 0o077).toBe(0);
      expect((await stat(material.keyPath)).mode & 0o077).toBe(0);
      expect((await readdir(root)).sort()).toEqual([
        "ca-cert.pem",
        "server-cert.pem",
        "server-key.pem",
      ]);
    } finally {
      await material.cleanup();
    }

    expect(await pathExists(root)).toBe(false);
  });
});
