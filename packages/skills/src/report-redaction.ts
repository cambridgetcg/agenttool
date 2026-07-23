import type { InspectionReport, MetadataShape } from "./types.js";

const KNOWN_CREDENTIAL = /(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|glpat-[A-Za-z0-9_-]{12,}|npm_[A-Za-z0-9_-]{12,}|hf_[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{12,}|(?:AKIA|ASIA)[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{20,})/g;
const OPAQUE_CANDIDATE = /[A-Za-z0-9+_=-]{32,}/g;

function looksOpaque(value: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[+_=-]/].filter((pattern) => pattern.test(value)).length;
  return classes >= 2 && new Set(value).size >= 10;
}

class OutputRedactor {
  readonly #aliases = new Map<string, string>();

  get count(): number {
    return this.#aliases.size;
  }

  redact(value: string): string {
    const knownRedacted = value.replace(KNOWN_CREDENTIAL, (token) => this.#alias(token));
    return knownRedacted.replace(OPAQUE_CANDIDATE, (token) =>
      looksOpaque(token) ? this.#alias(token) : token);
  }

  #alias(value: string): string {
    const existing = this.#aliases.get(value);
    if (existing !== undefined) return existing;
    const alias = `<redacted-${this.#aliases.size + 1}>`;
    this.#aliases.set(value, alias);
    return alias;
  }
}

function redactShape(shape: MetadataShape, redactor: OutputRedactor): void {
  if (shape.type === "array") {
    for (const item of shape.items) redactShape(item, redactor);
    return;
  }
  if (shape.type !== "object") return;
  const fields: Record<string, MetadataShape> = Object.create(null) as Record<string, MetadataShape>;
  for (const [key, child] of Object.entries(shape.fields)) {
    fields[redactor.redact(key)] = child;
    redactShape(child, redactor);
  }
  shape.fields = fields;
}

export function redactInspectionReport(report: InspectionReport): number {
  const redactor = new OutputRedactor();
  if (report.package !== null) {
    if (report.package.name !== null) report.package.name = redactor.redact(report.package.name);
    if (report.package.version !== null) report.package.version = redactor.redact(report.package.version);
    for (const runtime of report.package.runtimes) {
      runtime.name = redactor.redact(runtime.name);
      runtime.source = redactor.redact(runtime.source);
      if (runtime.constraint !== undefined) runtime.constraint = redactor.redact(runtime.constraint);
    }
  }
  for (const manifest of report.manifests) {
    manifest.path = redactor.redact(manifest.path);
    if (manifest.name !== null) manifest.name = redactor.redact(manifest.name);
    if (manifest.version !== null) manifest.version = redactor.redact(manifest.version);
    manifest.declaredSkillPaths = manifest.declaredSkillPaths.map((path) => redactor.redact(path));
    for (const server of manifest.mcpServers) {
      server.name = redactor.redact(server.name);
      for (const credential of server.credentialBindings) {
        credential.name = redactor.redact(credential.name);
        credential.source = redactor.redact(credential.source);
      }
    }
  }
  for (const skill of report.skills) {
    skill.path = redactor.redact(skill.path);
    skill.skillFile = redactor.redact(skill.skillFile);
    if (skill.name !== null) skill.name = redactor.redact(skill.name);
    const metadataShape: typeof skill.metadataShape = Object.create(null) as typeof skill.metadataShape;
    for (const [key, shape] of Object.entries(skill.metadataShape)) {
      metadataShape[redactor.redact(key)] = shape;
      redactShape(shape, redactor);
    }
    skill.metadataShape = metadataShape;
    for (const file of skill.files) file.path = redactor.redact(file.path);
    skill.scripts = skill.scripts.map((path) => redactor.redact(path));
    skill.resources = skill.resources.map((path) => redactor.redact(path));
    for (const tool of skill.requirements.tools) {
      tool.name = redactor.redact(tool.name);
      tool.source = redactor.redact(tool.source);
    }
    for (const server of skill.requirements.mcpServers) {
      server.name = redactor.redact(server.name);
      server.source = redactor.redact(server.source);
    }
    for (const runtime of skill.requirements.runtimes) {
      runtime.name = redactor.redact(runtime.name);
      runtime.source = redactor.redact(runtime.source);
      if (runtime.constraint !== undefined) runtime.constraint = redactor.redact(runtime.constraint);
    }
    for (const credential of skill.requirements.credentials) {
      credential.name = redactor.redact(credential.name);
      credential.source = redactor.redact(credential.source);
    }
  }
  for (const issue of report.issues) issue.path = redactor.redact(issue.path);
  return redactor.count;
}
