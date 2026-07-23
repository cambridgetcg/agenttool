import type {
  CredentialRequirement,
  JsonObject,
  JsonValue,
  SymbolicRequirements,
} from "./types.js";
import { compareStrings } from "./stable-json.js";

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function symbolicNames(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (isObject(item) && typeof item.name === "string") return [item.name];
      return [];
    });
  }
  if (isObject(value)) return Object.keys(value);
  return [];
}

const SAFE_SYMBOL = /^[A-Za-z][A-Za-z0-9_.:/-]{0,127}$/;

function safeSymbols(values: string[]): string[] {
  return values.filter((value) => SAFE_SYMBOL.test(value));
}

function requestedTools(value: JsonValue | undefined): string[] {
  if (typeof value !== "string") return safeSymbols(symbolicNames(value));
  const tools: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of value) {
    if (/\s/.test(character) && depth === 0) {
      if (current) tools.push(current);
      current = "";
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")" && depth > 0) depth -= 1;
    current += character;
  }
  if (current) tools.push(current);
  return safeSymbols(tools.map((tool) => tool.replace(/\(.*/, "")));
}

function isSymbolicEnvironmentBinding(value: JsonValue): boolean {
  return typeof value === "string" && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);
}

function credentialRequirements(value: JsonValue | undefined, source: string): CredentialRequirement[] {
  if (typeof value === "string") {
    return SAFE_SYMBOL.test(value) ? [{ name: value, source, literalDeclared: false }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") {
        return SAFE_SYMBOL.test(item) ? [{ name: item, source, literalDeclared: false }] : [];
      }
      if (!isObject(item) || typeof item.name !== "string" || !SAFE_SYMBOL.test(item.name)) return [];
      const bindings = Object.entries(item).filter(([key]) =>
        key !== "name" && key !== "literalDeclared");
      return [{
        name: item.name,
        source,
        literalDeclared:
          item.literalDeclared === true ||
          bindings.some(([, binding]) => !isSymbolicEnvironmentBinding(binding)),
      }];
    });
  }
  if (!isObject(value)) return [];
  return Object.entries(value).filter(([name]) => SAFE_SYMBOL.test(name)).map(([name, binding]) => ({
    name,
    source,
    literalDeclared: !isSymbolicEnvironmentBinding(binding),
  }));
}

function containers(metadata: JsonObject): JsonObject[] {
  const found: JsonObject[] = [];
  if (isObject(metadata.requirements)) found.push(metadata.requirements);
  if (isObject(metadata.metadata)) {
    if (isObject(metadata.metadata.requirements)) found.push(metadata.metadata.requirements);
    if (isObject(metadata.metadata.agenttool) && isObject(metadata.metadata.agenttool.requirements)) {
      found.push(metadata.metadata.agenttool.requirements);
    }
  }
  return found;
}

export function emptyRequirements(): SymbolicRequirements {
  return { tools: [], mcpServers: [], runtimes: [], credentials: [] };
}

export function requirementsFromMetadata(metadata: JsonObject, source: string): SymbolicRequirements {
  const output = emptyRequirements();
  if (metadata["allowed-tools"] !== undefined) {
    for (const name of requestedTools(metadata["allowed-tools"])) {
      output.tools.push({ name, source: `${source}#allowed-tools`, trusted: false });
    }
  }
  for (const container of containers(metadata)) {
    for (const name of safeSymbols(symbolicNames(container.tools ?? container.tool))) {
      output.tools.push({ name, source, trusted: false });
    }
    for (const name of safeSymbols(symbolicNames(container.mcpServers ?? container["mcp-servers"] ?? container.mcp))) {
      output.mcpServers.push({ name, source });
    }
    for (const name of safeSymbols(symbolicNames(container.runtimes ?? container.runtime))) {
      output.runtimes.push({ name, source });
    }
    output.credentials.push(
      ...credentialRequirements(container.credentials ?? container.credential ?? container.env, source),
    );
  }
  return normalizeRequirements(output);
}

export function normalizeRequirements(requirements: SymbolicRequirements): SymbolicRequirements {
  const unique = <T>(items: T[], key: (item: T) => string): T[] => {
    const map = new Map<string, T>();
    for (const item of items) map.set(key(item), item);
    return [...map.values()].sort((a, b) => compareStrings(key(a), key(b)));
  };
  return {
    tools: unique(requirements.tools, (item) => `${item.name}\0${item.source}`),
    mcpServers: unique(requirements.mcpServers, (item) => `${item.name}\0${item.source}`),
    runtimes: unique(requirements.runtimes, (item) => `${item.name}\0${item.constraint ?? ""}\0${item.source}`),
    credentials: unique(
      requirements.credentials,
      (item) => `${item.name}\0${item.source}\0${String(item.literalDeclared)}`,
    ),
  };
}
