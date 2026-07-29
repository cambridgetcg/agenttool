import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";

const packageRoot = join(import.meta.dir, "..");

describe("packed package boundary", () => {
  test("ships resolvable JavaScript source maps and no declaration maps", async () => {
    const packDirectory = await mkdtemp(join(tmpdir(), "agenttool-adds-pack-"));
    const extractDirectory = join(packDirectory, "extracted");
    try {
      await mkdir(extractDirectory);
      const pack = Bun.spawn(
        [
          "npm",
          "pack",
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          packDirectory,
        ],
        {
          cwd: packageRoot,
          env: {
            ...process.env,
            npm_config_userconfig: "/dev/null",
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [packExit, packOutput, packError] = await Promise.all([
        pack.exited,
        new Response(pack.stdout).text(),
        new Response(pack.stderr).text(),
      ]);
      expect(packExit, packError).toBe(0);

      const result = JSON.parse(packOutput) as Array<{
        filename: string;
        files: Array<{ path: string }>;
      }>;
      const packed = result[0]!;
      const files = new Set(packed.files.map(({ path }) => normalize(path)));
      expect(packed.filename).toBe("agenttool-adds-0.2.3.tgz");
      expect([...files].some((path) => path.startsWith("src/"))).toBe(false);
      expect([...files].some((path) => path.endsWith(".d.ts.map"))).toBe(false);

      const mapFiles = [...files].filter((path) => path.endsWith(".js.map"));
      expect(mapFiles.length).toBeGreaterThan(0);

      const extract = Bun.spawn(
        [
          "tar",
          "-xzf",
          join(packDirectory, packed.filename),
          "-C",
          extractDirectory,
        ],
        {
          cwd: packageRoot,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [extractExit, extractError] = await Promise.all([
        extract.exited,
        new Response(extract.stderr).text(),
      ]);
      expect(extractExit, extractError).toBe(0);

      for (const mapFile of mapFiles) {
        const sourceMap = JSON.parse(
          await readFile(join(extractDirectory, "package", mapFile), "utf8"),
        ) as {
          sources?: string[];
          sourcesContent?: Array<string | null>;
        };
        expect(Array.isArray(sourceMap.sources), mapFile).toBe(true);

        for (const [index, source] of sourceMap.sources!.entries()) {
          const embedded = sourceMap.sourcesContent?.[index];
          const resolved = normalize(join(dirname(mapFile), source));
          expect(
            typeof embedded === "string" || files.has(resolved),
            `${mapFile} source ${source} must be embedded or shipped`,
          ).toBe(true);
        }
      }
    } finally {
      await rm(packDirectory, { recursive: true, force: true });
    }
  });
});
