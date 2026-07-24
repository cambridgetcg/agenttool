export const LOVE_MANIFEST_HEADER_PATTERN =
  "/packages/v1/@agenttool/:package/:version/manifest.json";
export const LOVE_ARTIFACT_HEADER_PATTERN =
  "/packages/v1/@agenttool/:package/:version/*.tgz";

export function cloudflareHeaderRulePaths(headers: string): string[] {
  return headers
    .split("\n")
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !/^\s/u.test(line),
    );
}

export function matchesCloudflarePathPattern(
  pattern: string,
  path: string,
): boolean {
  let source = "^";
  for (let index = 0; index < pattern.length;) {
    const character = pattern[index]!;
    if (character === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (character === ":") {
      const placeholder = /^:[A-Za-z][A-Za-z0-9_]*/u.exec(pattern.slice(index));
      if (!placeholder) throw new Error(`invalid placeholder in ${pattern}`);
      source += "[^/]+";
      index += placeholder[0].length;
      continue;
    }
    source += /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
    index += 1;
  }
  return new RegExp(`${source}$`, "u").test(path);
}
