/** Loopback static fixture server. Models committed headers and redirects;
 * production Worker/Pages readback remains a separate release check. */
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handlePagesRequest } from '../../infra/pages/sensitive-path-worker.js';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [app, portText] = process.argv.slice(2);
const ports = { dashboard: 5173, web: 5174, docs: 5175 };
if (!Object.hasOwn(ports, app) || Number(portText) !== ports[app]) throw new Error('Unknown fixture target');
const root = resolve(repo, 'apps', app);
// Ask the actual checked-in Worker for its absent-header policy using an
// in-memory asset binding. This performs no network request and avoids a
// second hard-coded CSP, particularly for docs' hashed legacy inline code.
const origins = { dashboard: 'https://app.agenttool.dev', web: 'https://agenttool.dev', docs: 'https://docs.agenttool.dev' };
const policyResponse = await handlePagesRequest(new Request(origins[app] + '/', { headers: { Accept: 'text/html' } }), {
  ASSETS: { fetch: async () => new Response('', { headers: { 'Content-Type': 'text/html' } }) },
});
const workerCsp = policyResponse.headers.get('Content-Security-Policy');
if (!workerCsp || !workerCsp.includes("script-src-elem 'self'") || !workerCsp.includes('frame-ancestors')) {
  throw new Error('The Pages Worker did not provide its static CSP; refusing an unprotected fixture');
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
function pattern(value) {
  return new RegExp('^' + value.split(/(\*|:[A-Za-z][A-Za-z0-9_]*)/).map(part => part === '*' ? '(.*)' : part.startsWith(':') ? '([^/]+)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
}
async function rules(name) {
  try { return (await readFile(resolve(root, name), 'utf8')).split('\n'); } catch { return []; }
}
const redirects = (await rules('_redirects')).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => line.trim().split(/\s+/));
const headerRules = [];
let current;
for (const line of await rules('_headers')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (line.startsWith('/')) {
    current = { match: pattern(line.trim()), headers: {} };
    headerRules.push(current);
  } else if (current && /^\s+[^:]+:/.test(line)) {
    const separator = line.indexOf(':');
    current.headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
}
function inside(parent, child) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== '..' && !path.startsWith('../');
}
createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path.includes('\0') || path.split('/').some(part => part.startsWith('.') && part !== '.well-known')) { response.writeHead(404).end(); return; }
    for (const [source, destination, code] of redirects) {
      const match = pattern(source).exec(path);
      if (match && /^30[1278]$/.test(code)) { response.writeHead(Number(code), { Location: destination.replace(':splat', match[1] ?? '') }).end(); return; }
    }
    let candidate = resolve(root, '.' + path);
    if (!inside(root, candidate)) { response.writeHead(404).end(); return; }
    const candidates = path.endsWith('/') ? [resolve(candidate, 'index.html')] : [candidate, candidate + '.html'];
    let file;
    for (candidate of candidates) {
      try {
        const actual = await realpath(candidate);
        if (inside(repo, actual) && (await stat(actual)).isFile()) { file = actual; break; }
      } catch { /* Try the extensionless HTML projection. */ }
    }
    const status = file ? 200 : 404;
    file ??= resolve(root, '404.html');
    const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
    for (const rule of headerRules) if (rule.match.test(path)) Object.assign(headers, rule.headers);
    if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-security-policy')) headers['Content-Security-Policy'] = workerCsp;
    response.writeHead(status, headers);
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
  } catch { if (!response.headersSent) response.writeHead(500); response.end('Fixture server failed'); }
}).listen(ports[app], '127.0.0.1', () => process.stdout.write(`Fixture ${app} ready on ${ports[app]}\n`));
