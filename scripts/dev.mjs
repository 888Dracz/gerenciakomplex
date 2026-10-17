/**
 * dev.mjs — Arranca a la vez el servidor (tsx watch, puerto 3004) y Vite
 * (puerto 5175, que pasa /api al servidor). Ctrl+C cierra los dos.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const hijos = [];

function lanzar(nombre, args, color, env = {}) {
  const p = spawn(npm, args, { cwd: raiz, shell: process.platform === 'win32', env: { ...process.env, ...env } });
  const prefijo = `\x1b[${color}m[${nombre}]\x1b[0m `;
  const pipe = (stream, destino) => {
    stream.setEncoding('utf8');
    let resto = '';
    stream.on('data', (txt) => {
      const lineas = (resto + txt).split('\n');
      resto = lineas.pop() ?? '';
      for (const l of lineas) destino.write(prefijo + l + '\n');
    });
  };
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    process.stdout.write(`${prefijo}terminó (código ${code})\n`);
    cerrar(code ?? 0);
  });
  hijos.push(p);
}

let cerrando = false;
function cerrar(code) {
  if (cerrando) return;
  cerrando = true;
  for (const p of hijos) { try { p.kill(); } catch { /* ya murió */ } }
  process.exit(code);
}

process.on('SIGINT', () => cerrar(0));
process.on('SIGTERM', () => cerrar(0));

lanzar('api', ['run', 'dev', '--workspace', 'server'], '33', { KOMPLEX_NO_BROWSER: '1' });
lanzar('web', ['run', 'dev', '--workspace', 'web'], '36');
