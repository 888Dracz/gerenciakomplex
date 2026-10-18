/**
 * web-final.mjs — Último paso de la versión web (después de `vite build --mode web`).
 *
 *   node scripts/web-final.mjs dist-web
 *
 * 1. sw.js — service worker: guarda la página para abrirla sin internet y
 *    permite instalarla como app. El nombre de la caché cambia con cada
 *    versión, así que al publicar una nueva se actualiza sola.
 * 2. komplex-gerencia.html — el programa entero en UN solo archivo (código,
 *    estilos, fuentes e iconos incluidos) para guardarlo en la computadora y
 *    abrirlo con doble clic, incluso sin internet.
 *
 * Sin dependencias: solo Node.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'dist-web');
if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error(`No está ${dir}/index.html: primero vite build --mode web`);
  process.exit(1);
}

const EXCLUIR = new Set(['sw.js', 'komplex-gerencia.html']);

function listar(d, base = '') {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listar(path.join(d, e.name), rel));
    else if (!EXCLUIR.has(rel)) out.push(rel);
  }
  return out.sort();
}

// ---------------------------------------------------------------- 1. service worker
const archivos = listar(dir);
const huella = crypto.createHash('sha256');
for (const f of archivos) huella.update(f).update(fs.readFileSync(path.join(dir, f)));
const version = huella.digest('hex').slice(0, 12);

const sw = `/* Service worker de Gerencia Komplex (generado por scripts/web-final.mjs). */
const CACHE = 'gerencia-komplex-${version}';
const ARCHIVOS = ${JSON.stringify(['./', ...archivos.map((f) => `./${f}`)], null, 1)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('gerencia-komplex-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // La página: primero la versión publicada; sin internet, la guardada.
    e.respondWith(fetch(req).then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put('./', copia)).catch(() => {});
      return r;
    }).catch(() => caches.match('./').then((r) => r || caches.match('./index.html'))));
    return;
  }
  // Código, estilos, fuentes e iconos: de la caché (llevan versión en el nombre).
  e.respondWith(caches.match(req).then((r) => r || fetch(req).then((resp) => {
    if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {}); }
    return resp;
  })));
});
`;
fs.writeFileSync(path.join(dir, 'sw.js'), sw);

// ---------------------------------------------------------------- 2. página en un solo archivo
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const base = (html.match(/<script[^>]+src="([^"]*?)assets\//) ?? [])[1] ?? '/';
const local = (url) => path.join(dir, url.startsWith(base) ? url.slice(base.length) : url.replace(/^\.?\//, ''));
const tipo = (f) => ({ '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }[path.extname(f)] ?? 'application/octet-stream');
const dataUri = (f) => `data:${tipo(f)};base64,${fs.readFileSync(f).toString('base64')}`;
const sinCierre = (txt) => txt.replace(/<\/(script|style)/gi, '<\\/$1');

// Fuentes: el CSS con cada .woff2 incrustado.
html = html.replace(/<link rel="stylesheet" href="([^"]*fonts\/fonts\.css)"\s*\/?>/, (_m, href) => {
  const archivo = local(href);
  const css = fs.readFileSync(archivo, 'utf8')
    .replace(/url\(([^)]+\.woff2)\)/g, (_u, f) => `url(${dataUri(path.join(path.dirname(archivo), f.replace(/^['"]|['"]$/g, '')))})`);
  return `<style>${sinCierre(css)}</style>`;
});
// Estilos de la app.
html = html.replace(/<link rel="stylesheet"(?: crossorigin)? href="([^"]+\.css)"\s*\/?>/g, (_m, href) =>
  `<style>${sinCierre(fs.readFileSync(local(href), 'utf8'))}</style>`);
// Código de la app.
html = html.replace(/<script type="module" crossorigin src="([^"]+\.js)"><\/script>/g, (_m, src) =>
  `<script type="module">${sinCierre(fs.readFileSync(local(src), 'utf8'))}</script>`);
// Iconos incrustados; sin manifiesto (no aplica a un archivo local).
html = html.replace(/<link rel="(icon|apple-touch-icon)" href="([^"]+)"([^>]*)>/g, (_m, rel, href, resto) =>
  `<link rel="${rel}" href="${dataUri(local(href))}"${resto}>`);
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');

if (/<script[^>]+src=|<link rel="stylesheet" href=/.test(html)) {
  console.error('La página única todavía apunta a archivos externos:', html.match(/<(script|link)[^>]+(src|href)="[^"]+"/g));
  process.exit(1);
}
fs.writeFileSync(path.join(dir, 'komplex-gerencia.html'), html);

const kb = (f) => Math.round(fs.statSync(path.join(dir, f)).size / 1024);
console.log(`sw.js (caché ${version}, ${archivos.length} archivos) y komplex-gerencia.html (${kb('komplex-gerencia.html')} KB) listos en ${dir}`);
