export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type MetadataShape =
  | { type: "null" }
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "array"; items: MetadataShape[] }
  | { type: "object"; fields: { [key: string]: MetadataShape } };

export interface InspectionLimits {
  maxDepth: number;
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxSkills: number;
  maxFrontmatterBytes: number;
}

export interface InspectionOptions {
  limits?: Partial<InspectionLimits>;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface InspectionIssue {
  severity: IssueSeverity;
  code: string;
  path: string;
  message: string;
}

export type FileCategory = "skill" | "script" | "reference" | "asset" | "resource";

export interface InventoryFile {
  path: string;
  bytes: number;
  category: FileCategory;
}

export interface CredentialRequirement {
  name: string;
  source: string;
  literalDeclared: boolean;
}

export interface SymbolicRequirements {
  tools: Array<{ name: string; source: string; trusted: false }>;
  mcpServers: Array<{ name: string; source: string }>;
  runtimes: Array<{ name: string; constraint?: string; source: string }>;
  credentials: CredentialRequirement[];
}

export interface SkillInspection {
  path: string;
  skillFile: string;
  name: string | null;
  metadataShape: { [key: string]: MetadataShape };
  digest: string | null;
  digestSemantics: "sha256 of sorted relative paths and regular-file bytes; unavailable for incomplete coverage or symlinks; not publisher authentication";
  files: InventoryFile[];
  scripts: string[];
  resources: string[];
  requirements: SymbolicRequirements;
  allowedToolsSemantics: "untrusted requested capabilities; host support and approval are implementation-dependent";
}

export interface ManifestMcpServer {
  name: string;
  credentialBindings: CredentialRequirement[];
}

export interface PluginManifestInspection {
  kind: "codex" | "claude";
  path: string;
  name: string | null;
  version: string | null;
  declaredSkillPaths: string[];
  mcpServers: ManifestMcpServer[];
}

export interface PackageInspection {
  path: "package.json";
  name: string | null;
  version: string | null;
  runtimes: Array<{ name: string; constraint?: string; source: string }>;
}

export interface InspectionReport {
  $schema: string;
  schemaVersion: string;
  kind: "agenttool.skills.inspection";
  generatedBy: { name: string; version: string };
  mode: "read-only";
  valid: boolean;
  scope: {
    root: ".";
    inputKind: "skill" | "plugin" | "package" | "directory" | "invalid";
    limits: InspectionLimits;
  };
  executionPolicy: {
    network: false;
    subprocesses: false;
    scriptExecution: false;
    mcpStartup: false;
    configMutation: false;
    credentialLookup: false;
    hostedApiCalls: false;
  };
  filesystemPolicy: {
    observedSymlinks: "reject";
    finalFileSymlinkFollowing: false;
    concurrentAncestorReplacement: "not-guaranteed";
    immutableSnapshotRecommended: true;
  };
  package: PackageInspection | null;
  manifests: PluginManifestInspection[];
  skills: SkillInspection[];
  summary: {
    skills: number;
    files: number;
    scripts: number;
    resources: number;
    errors: number;
    warnings: number;
    redactions: number;
  };
  issues: InspectionIssue[];
}
