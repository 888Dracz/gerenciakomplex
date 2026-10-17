/**
 * index.ts — Punto de entrada de Gerencia Komplex.
 *
 *   npm start          (puerto 3004 por defecto; PORT lo cambia)
 *
 * Arranca el servidor, abre el programa en su propia ventana (Edge o Chrome en
 * modo aplicación, sin barra del navegador), deja programado el respaldo
 * diario e imprime las direcciones para entrar desde el celular.
 */
import { spawn, exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ABRIR_NAVEGADOR, APP_ID, HOST, PORT, VENTANA_APP } from './config.js';
import { almacenActual, iniciarAlmacen } from './estado.js';
import { crearApp } from './server.js';

function ipsLocales(): string[] {
  const out: string[] = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal && !out.includes(i.address)) out.push(i.address);
    }
  }
  return out;
}

/** Edge o Chrome instalados (para abrir en ventana de aplicación). */
function navegadorApp(): string | null {
  if (process.platform !== 'win32') return null;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidatos = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ].filter(Boolean);
  return candidatos.find((c) => fs.existsSync(c)) ?? null;
}

function abrirPrograma(url: string): void {
  const exe = VENTANA_APP ? navegadorApp() : null;
  if (exe) {
    try {
      spawn(exe, [`--app=${url}`, '--window-size=1366,860'], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch { /* si falla, se abre en el navegador normal */ }
  }
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => { /* si no hay navegador, no pasa nada */ });
}

/** ¿Ya hay un Gerencia Komplex corriendo en este puerto? */
async function yaAbierto(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/salud`, { signal: AbortSignal.timeout(800) });
    const j = await r.json() as { app?: string };
    return j.app === APP_ID;
  } catch {
    return false;
  }
}

function respaldoDiario(): void {
  try {
    const destino = almacenActual()?.respaldar();
    if (destino) console.log(`[respaldo] Copia del día: ${destino}`);
  } catch (e) {
    console.error('[respaldo] No se pudo crear:', (e as Error).message);
  }
}

async function main(): Promise<void> {
  const url = `http://localhost:${PORT}`;
  if (await yaAbierto()) {
    console.log('Gerencia Komplex ya estaba abierto: se abre otra ventana.');
    if (ABRIR_NAVEGADOR) abrirPrograma(url);
    return;
  }

  iniciarAlmacen();
  respaldoDiario();
  setInterval(respaldoDiario, 60 * 60 * 1000).unref();

  const app = await crearApp();
  await app.listen({ port: PORT, host: HOST });

  console.log('');
  console.log('  GERENCIA KOMPLEX está abierto.');
  console.log(`  En esta PC:          ${url}`);
  const ips = ipsLocales();
  if (ips.length) {
    console.log('  Desde el celular (misma red WiFi):');
    for (const ip of ips) console.log(`                       http://${ip}:${PORT}`);
  }
  const a = almacenActual();
  console.log(a ? `  Carpeta de datos:    ${a.carpeta}` : '  Falta elegir la carpeta de datos (se pide al abrir el programa).');
  console.log('');
  console.log('  Para cerrar el programa, cierra ESTA ventana.');
  console.log('');

  if (ABRIR_NAVEGADOR) setTimeout(() => abrirPrograma(url), 700);

  const cerrar = async () => {
    console.log('\nGerencia Komplex se está cerrando…');
    try { await app.close(); } catch { /* ya estaba cerrado */ }
    process.exit(0);
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}

main().catch((e) => {
  console.error('No se pudo arrancar Gerencia Komplex:', e);
  process.exit(1);
});
