import { build } from 'vite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const result = await build({ configFile: false, resolve: { alias: { 'bwip-js/node': path.resolve('src/standalone/barcode.ts') } }, plugins: [{ name: 'portable', enforce: 'pre', transform(code, id) {
 if (id.endsWith('/domain/store.ts')) return code.replace('import { createHash, randomUUID } from "node:crypto";', 'import { makeIdempotencyKey as randomUUID } from "../ui/keys.ts";').replace('createHash("sha256").update(bytes).digest("hex")', 'Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), b => b.toString(16).padStart(2, "0")).join("")');
 if (id.endsWith('/ui/main.ts')) return code.replace('const res = await fetch(path, {', 'const res = await localFetch(path, {').replace('import type { Batch,', 'import { localFetch, pdfUrl, readProject, saveProject } from "../standalone/local.ts";\nimport type { Batch,').replace('const match = document.cookie.match', 'return readProject();\n  const match = document.cookie.match').replace('document.cookie = `${PROJECT_COOKIE}', 'saveProject(project);\n  document.cookie = `${PROJECT_COOKIE}').replace('href="/api/batches/${encodeURIComponent(batch.id)}/pdf"', 'href="${pdfUrl(batch.id)}"').replace('return `/api/batches/${encodeURIComponent(id)}/pdf`;', 'return pdfUrl(id);');
 } }], build: { write: false, minify: true, lib: { entry: 'src/ui/main.ts', name: 'Tickets', formats: ['iife'] } } });
const js = (Array.isArray(result) ? result[0] : result).output.find(x => x.type === 'chunk').code;
let html = await readFile('src/ui/index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="/styles.css" />', `<style>${await readFile('src/ui/styles.css', 'utf8')}</style>`).replace('<script type="module" src="/main.ts"></script>', () => `<script>${js.replaceAll('</script', '<\\/script')}</script>`);
await mkdir('dist/standalone', { recursive: true });
await writeFile('dist/standalone/tickets.html', html);
console.log('Built dist/standalone/tickets.html');
