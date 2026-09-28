#!/usr/bin/env bun
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const dist = join(root, 'dist');
const mcp = resolve(root, '../local-starter-mcp');
const manifest = await Bun.file(join(root, 'package.json')).json();
if (Bun.version !== manifest.bundlerBunVersion) throw new Error('Use the pinned bundlerBunVersion.');
const mcpManifest = await Bun.file(join(mcp, 'package.json')).json();
if (manifest.version !== mcpManifest.version) throw new Error('Local starter and MCP versions must agree.');
await mkdir(dist, { recursive: true });
// This directory contains generated release files only; do not copy arbitrary source trees.
for (const name of await readdir(dist)) await rm(join(dist, name), { recursive: true, force: true });
for (const name of ['cli', 'core', 'files', 'adapters', 'delivery', 'connect']) {
  await copyFile(join(root, 'src', `${name}.mjs`), join(dist, `${name}.mjs`));
  await chmod(join(dist, `${name}.mjs`), name === 'cli' || name === 'connect' ? 0o755 : 0o644);
}
const result = await Bun.build({
  entrypoints: [join(mcp, 'src/cli.mjs')], outdir: dist,
  root: resolve(root, '../..'),
  target: 'node', format: 'esm', sourcemap: 'none', splitting: false,
  naming: { entry: 'agenttool-local-starter-mcp.js' },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('Standalone Local Starter MCP build failed.');
}
await chmod(join(dist, 'agenttool-local-starter-mcp.js'), 0o755);
const notices = ['Bundled third-party software', '', 'Generated from the exact installed dependency licenses.'];
for (const name of ['@modelcontextprotocol/core', '@modelcontextprotocol/server', 'zod']) {
  const dependency = join(mcp, 'node_modules', ...name.split('/'));
  const metadata = await Bun.file(join(dependency, 'package.json')).json();
  const license = await readFile(join(dependency, 'LICENSE'), 'utf8');
  notices.push('', `===== ${name} ${metadata.version} =====`, '', license.trimEnd());
  const notice = Bun.file(join(dependency, 'NOTICE'));
  if (await notice.exists()) notices.push('', (await notice.text()).trimEnd());
}
await writeFile(join(dist, 'THIRD_PARTY_LICENSES'), `${notices.join('\n')}\n`, { mode: 0o644 });
console.log('Built dependency-free CLI modules and standalone optional MCP bundle.');
