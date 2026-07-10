import { createHash } from "node:crypto";

/** Stable, non-secret namespace for one project's local credential and config. */
export function projectCredentialNamespace(projectId: string): string {
  return createHash("sha256").update(projectId, "utf8").digest("hex").slice(0, 16);
}

export function projectCredentialService(projectId: string): string {
  return `agenttool:${projectCredentialNamespace(projectId)}`;
}
