/**
 * archivos.ts — Lectura y escritura segura de JSON.
 *
 * Cada guardado escribe primero un archivo temporal y luego lo renombra sobre
 * el original: si se va la luz a mitad de camino, queda el archivo viejo
 * entero, nunca uno a medias. El renombrado se reintenta unas veces porque en
 * Windows un antivirus u OneDrive pueden tener el archivo abierto un instante.
 */
import fs from 'node:fs';
import path from 'node:path';

export class ErrorArchivo extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorArchivo';
  }
}

export function leerJson<T>(ruta: string): T | null {
  let txt: string;
  try {
    txt = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(txt.replace(/^﻿/, '')) as T;
  } catch {
    throw new ErrorArchivo(`El archivo ${ruta} está dañado (no es JSON válido). Restáuralo desde la carpeta "respaldos".`);
  }
}

function dormir(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function escribirJson(ruta: string, datos: unknown): void {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(datos, null, 1), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let intento = 0; ; intento++) {
    try {
      fs.renameSync(tmp, ruta);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (intento >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) {
        try { fs.unlinkSync(tmp); } catch { /* ya no estaba */ }
        throw e;
      }
      dormir(60 * (intento + 1));
    }
  }
}

export function escribirBinario(ruta: string, datos: Uint8Array): void {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, datos);
  fs.renameSync(tmp, ruta);
}
