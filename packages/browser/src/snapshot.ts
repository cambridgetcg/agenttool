import type { BoundingBox, BrowserViewport, SnapshotRef } from "./types.js";

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "gridcell",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const STRUCTURAL_CONTEXT_ROLES = new Set([
  "heading",
  "main",
  "navigation",
  "form",
  "region",
  "dialog",
  "alert",
  "status",
]);

const SENSITIVE_HINT =
  /\b(?:password|passwd|passcode|pin|secret|token|api[\s_-]*key|private[\s_-]*key|cvv|cvc)\b/i;

export interface AriaCandidate {
  nativeRef: string;
  role: string;
  name: string | null;
  line: string;
}

export interface CompactAriaSnapshotOptions {
  publicRefs: ReadonlyMap<string, string>;
  visibleRefs: ReadonlySet<string>;
  visibleStructuralRefs?: ReadonlySet<string>;
  secretRefs?: ReadonlySet<string>;
  maxChars: number;
  maxElements: number;
  maxStructuralElements?: number;
}

export interface CompactAriaSnapshotResult {
  snapshot: string;
  refs: SnapshotRef[];
  truncated: {
    snapshot: boolean;
    elements: boolean;
  };
}

export function parseAriaCandidates(snapshot: string): AriaCandidate[] {
  const candidates: AriaCandidate[] = [];
  const seen = new Set<string>();
  for (const node of parseSnapshotNodes(snapshot)) {
    if (seen.has(node.nativeRef) || !isInteractiveNode(node)) continue;
    seen.add(node.nativeRef);
    candidates.push({
      nativeRef: node.nativeRef,
      role: node.role,
      name: node.name,
      line: node.line.trim().replace(/^-\s*/, "- "),
    });
  }
  return candidates;
}

export function parseStructuralAriaCandidates(
  snapshot: string,
): Array<{ nativeRef: string; role: string }> {
  const candidates: Array<{ nativeRef: string; role: string }> = [];
  const seen = new Set<string>();
  for (const node of parseSnapshotNodes(snapshot)) {
    if (
      seen.has(node.nativeRef)
      || !STRUCTURAL_CONTEXT_ROLES.has(node.role)
    ) {
      continue;
    }
    seen.add(node.nativeRef);
    candidates.push({ nativeRef: node.nativeRef, role: node.role });
  }
  return candidates;
}

export function compactAriaSnapshot(
  rawSnapshot: string,
  options: CompactAriaSnapshotOptions,
): CompactAriaSnapshotResult {
  const secretRefs = options.secretRefs ?? new Set<string>();
  const visibleStructuralRefs =
    options.visibleStructuralRefs ?? new Set<string>();
  const maxStructuralElements = Math.max(
    0,
    Math.floor(options.maxStructuralElements ?? 0),
  );
  const nodes = parseSnapshotNodes(rawSnapshot);
  const seenInteractive = new Set<string>();
  const eligible = nodes.filter((node) => {
    if (
      seenInteractive.has(node.nativeRef)
      || !isInteractiveNode(node)
    ) {
      return false;
    }
    seenInteractive.add(node.nativeRef);
    return (
      options.visibleRefs.has(node.nativeRef)
      && options.publicRefs.has(node.nativeRef)
    );
  });
  const refs: SnapshotRef[] = [];
  const selectedLines: Array<{
    index: number;
    line: string;
    contextualLine?: string;
  }> = [];
  let usedChars = 0;
  let snapshotTruncated = false;

  for (const candidate of eligible) {
    if (refs.length >= options.maxElements) break;
    const publicRef = options.publicRefs.get(candidate.nativeRef)!;
    const secret = secretRefs.has(candidate.nativeRef);
    let contextualLine = candidate.line.replace(
      `[ref=${candidate.nativeRef}]`,
      `[ref=${publicRef}]`,
    );
    if (secret) contextualLine = redactLineValue(contextualLine, publicRef);
    const line = contextualLine.trimStart();
    const addition = (selectedLines.length === 0 ? 0 : 1) + line.length;
    if (usedChars + addition > options.maxChars) {
      snapshotTruncated = true;
      break;
    }
    selectedLines.push({ index: candidate.index, line, contextualLine });
    usedChars += addition;
    refs.push({
      ref: publicRef,
      role: candidate.role,
      name: candidate.name,
      secret,
    });
  }

  const elementsTruncated = eligible.length > refs.length;
  if (elementsTruncated && refs.length >= options.maxElements) {
    snapshotTruncated = true;
  }
  const interactiveIndentationChars = selectedLines.reduce(
    (total, item) =>
      total + ((item.contextualLine?.length ?? item.line.length) - item.line.length),
    0,
  );
  if (usedChars + interactiveIndentationChars <= options.maxChars) {
    for (const item of selectedLines) {
      if (item.contextualLine) item.line = item.contextualLine;
    }
    usedChars += interactiveIndentationChars;
  }
  const seenStructural = new Set<string>();
  const eligibleStructural = nodes.filter((node) => {
    if (
      seenStructural.has(node.nativeRef)
      || !STRUCTURAL_CONTEXT_ROLES.has(node.role)
    ) {
      return false;
    }
    seenStructural.add(node.nativeRef);
    return visibleStructuralRefs.has(node.nativeRef);
  });
  let selectedStructural = 0;
  for (const candidate of eligibleStructural) {
    if (selectedStructural >= maxStructuralElements) {
      snapshotTruncated = true;
      break;
    }
    const line = stripNativeSnapshotRefs(candidate.line);
    const addition = (selectedLines.length === 0 ? 0 : 1) + line.length;
    if (usedChars + addition > options.maxChars) {
      snapshotTruncated = true;
      break;
    }
    selectedLines.push({ index: candidate.index, line });
    selectedStructural += 1;
    usedChars += addition;
  }
  if (eligibleStructural.length > selectedStructural) {
    snapshotTruncated = true;
  }
  selectedLines.sort((left, right) => left.index - right.index);

  const empty = "(no viewport-visible interactive elements)";
  return {
    snapshot:
      selectedLines.map((item) => item.line).join("\n")
      || empty.slice(0, options.maxChars),
    refs,
    truncated: {
      snapshot: snapshotTruncated,
      elements: elementsTruncated,
    },
  };
}

/**
 * Defense-in-depth sanitizer for raw AI-mode snapshots. The compact snapshot
 * path also redacts while rewriting refs, so callers never receive a password
 * value even if Playwright includes it after the textbox node.
 */
export function redactAriaSecrets(
  snapshot: string,
  secretRefs: ReadonlySet<string>,
): string {
  return snapshot
    .split(/\r?\n/)
    .map((line) => {
      for (const ref of secretRefs) {
        if (line.includes(`[ref=${ref}]`)) return redactLineValue(line, ref);
      }
      return line;
    })
    .join("\n");
}

export function looksLikeSensitiveControl(
  attributes: Readonly<Record<string, string | null>>,
  accessibleName: string | null,
): boolean {
  if ((attributes.type ?? "").toLowerCase() === "password") return true;
  const autocomplete = (attributes.autocomplete ?? "").toLowerCase();
  if (
    autocomplete.includes("current-password")
    || autocomplete.includes("new-password")
    || autocomplete.includes("one-time-code")
  ) {
    return true;
  }
  return [
    accessibleName,
    attributes.name,
    attributes.id,
    attributes.placeholder,
    attributes["aria-label"],
  ].some((value) => value !== null && value !== undefined && SENSITIVE_HINT.test(value));
}

export function intersectsViewport(
  box: BoundingBox | null,
  viewport: BrowserViewport,
): boolean {
  if (!box || box.width <= 0 || box.height <= 0) return false;
  return (
    box.x < viewport.width
    && box.y < viewport.height
    && box.x + box.width > 0
    && box.y + box.height > 0
  );
}

export function boundText(
  value: string,
  maxChars: number,
): { value: string; truncated: boolean } {
  if (value.length <= maxChars) return { value, truncated: false };
  return { value: value.slice(0, maxChars), truncated: true };
}

/**
 * HTML extraction cannot be a general secret detector, but values on inputs
 * carrying the same recognized password/secret hints as observations are
 * removed before returning markup.
 */
export function redactSensitiveInputValues(html: string): string {
  return html.replace(/<input\b[^>]*>/gi, (tag) => {
    const attributes = {
      type: inputAttribute(tag, "type"),
      autocomplete: inputAttribute(tag, "autocomplete"),
      name: inputAttribute(tag, "name"),
      id: inputAttribute(tag, "id"),
      placeholder: inputAttribute(tag, "placeholder"),
      "aria-label": inputAttribute(tag, "aria-label"),
    };
    if (!looksLikeSensitiveControl(attributes, null)) return tag;
    return tag.replace(
      /(\s+value\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
      '$1"[redacted]"',
    );
  });
}

/** Backwards-compatible narrow name; now covers every recognized secret hint. */
export function redactPasswordValues(html: string): string {
  return redactSensitiveInputValues(html);
}

function parseAccessibleName(line: string): string | null {
  const match = line.match(/^\s*-\s+[a-z][a-z0-9_-]*\s+"((?:[^"\\]|\\.)*)"/i);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

interface SnapshotNode {
  index: number;
  nativeRef: string;
  role: string;
  name: string | null;
  line: string;
}

function parseSnapshotNodes(snapshot: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  snapshot.split(/\r?\n/).forEach((rawLine, index) => {
    const refMatch = rawLine.match(/\[ref=([A-Za-z0-9_-]+)\]/);
    const roleMatch = rawLine.match(/^\s*-\s+([a-z][a-z0-9_-]*)\b/i);
    if (!refMatch?.[1] || !roleMatch?.[1]) return;
    const normalized = rawLine
      .replace(/^(\s*)-\s*/, "$1- ")
      .trimEnd();
    nodes.push({
      index,
      nativeRef: refMatch[1],
      role: roleMatch[1].toLowerCase(),
      name: parseAccessibleName(rawLine),
      line: normalized,
    });
  });
  return nodes;
}

function isInteractiveNode(node: SnapshotNode): boolean {
  return (
    !STRUCTURAL_CONTEXT_ROLES.has(node.role)
    && (
      INTERACTIVE_ROLES.has(node.role)
      || node.line.includes("[cursor=pointer]")
    )
  );
}

function stripNativeSnapshotRefs(line: string): string {
  return line.replace(/\s*\[ref=[A-Za-z0-9_-]+\]/g, "");
}

function redactLineValue(line: string, ref: string): string {
  const refEnd = line.indexOf(`[ref=${ref}]`) + `[ref=${ref}]`.length;
  const valueSeparator = line.indexOf(":", refEnd);
  if (valueSeparator < 0) return line;
  return `${line.slice(0, valueSeparator)}: [redacted]`;
}

function inputAttribute(tag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(
      `\\s+${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}
