/**
 * carpeta.ts — La carpeta de datos que se crea al entrar por primera vez.
 *
 * Estructura:
 *   Komplex Gerencia/
 *     LEEME.txt
 *     datos/configuracion.json   planes, bancos, cierres de mes, bitácora
 *     datos/AAAA-MM.json         registros, caja, cuadres y tasas de cada mes
 *     respaldos/AAAA-MM-DD.json  copia completa de cada día (se guardan 60)
 *     cierres/AAAA-MM Mes/       Excel, Word y datos del mes al cerrarlo
 *
 * La dirección de la carpeta se anota en AppData\Local\GerenciaKomplex: así,
 * aunque se borre la carpeta del programa, al volver a instalarlo encuentra los
 * datos solo. Y si también se pierde esa anotación, basta con elegir la carpeta
 * otra vez: el programa reconoce que ya tiene datos y los usa.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NOMBRE_CARPETA, PUNTERO } from '../config.js';
import { leerJson, escribirJson } from './archivos.js';

export const SUB = { datos: 'datos', respaldos: 'respaldos', cierres: 'cierres' } as const;
export const ARCHIVO_CONFIG = 'configuracion.json';

export const rutaConfig = (carpeta: string) => path.join(carpeta, SUB.datos, ARCHIVO_CONFIG);
export const rutaMes = (carpeta: string, mes: string) => path.join(carpeta, SUB.datos, `${mes}.json`);

export function leerPuntero(): string | null {
  try {
    const p = leerJson<{ carpeta?: string }>(PUNTERO);
    return p?.carpeta ? p.carpeta : null;
  } catch {
    return null;
  }
}

export function guardarPuntero(carpeta: string): void {
  escribirJson(PUNTERO, { carpeta, actualizado: new Date().toISOString() });
}

export const esCarpetaKomplex = (ruta: string): boolean => fs.existsSync(rutaConfig(ruta));

export interface Revision {
  /** Ruta final que se usará (puede ser una subcarpeta "Komplex Gerencia"). */
  ruta: string;
  existe: boolean;
  tieneDatos: boolean;
  tieneClave: boolean;
  meses: string[];
  registros: number;
  /** Motivo por el que no sirve (sin permiso, es un archivo…). */
  problema: string | null;
}

/**
 * Decide qué carpeta usar a partir de lo que eligió la persona:
 *  - si ya es una carpeta de Komplex (tiene datos/configuracion.json), esa;
 *  - si dentro hay una "Komplex Gerencia" con datos, esa;
 *  - si su nombre ya dice Komplex, esa misma;
 *  - si no, una subcarpeta nueva "Komplex Gerencia" dentro de la elegida.
 */
export function resolverCarpeta(elegida: string): string {
  const r = path.resolve(elegida.trim());
  if (esCarpetaKomplex(r)) return r;
  const sub = path.join(r, NOMBRE_CARPETA);
  if (esCarpetaKomplex(sub)) return sub;
  if (/komplex/i.test(path.basename(r))) return r;
  return sub;
}

export function revisarCarpeta(elegida: string): Revision {
  if (!elegida || !elegida.trim()) {
    return { ruta: '', existe: false, tieneDatos: false, tieneClave: false, meses: [], registros: 0, problema: 'Escribe o elige una carpeta.' };
  }
  if (!path.isAbsolute(elegida.trim())) {
    return { ruta: elegida, existe: false, tieneDatos: false, tieneClave: false, meses: [], registros: 0, problema: 'Escribe la ruta completa (por ejemplo C:\\Users\\Tu nombre\\Documents\\Komplex Gerencia).' };
  }
  const ruta = resolverCarpeta(elegida);
  const out: Revision = { ruta, existe: fs.existsSync(ruta), tieneDatos: false, tieneClave: false, meses: [], registros: 0, problema: null };
  if (out.existe && !fs.statSync(ruta).isDirectory()) {
    out.problema = 'Esa ruta es un archivo, no una carpeta.';
    return out;
  }
  if (esCarpetaKomplex(ruta)) {
    out.tieneDatos = true;
    try {
      const cfg = leerJson<{ clave?: unknown }>(rutaConfig(ruta));
      out.tieneClave = !!cfg?.clave;
      out.meses = fs.readdirSync(path.join(ruta, SUB.datos))
        .filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort();
      for (const m of out.meses) {
        out.registros += leerJson<{ registros?: unknown[] }>(rutaMes(ruta, m))?.registros?.length ?? 0;
      }
    } catch (e) {
      out.problema = (e as Error).message;
    }
  }
  return out;
}

const LEEME = `GERENCIA KOMPLEX — CARPETA DE DATOS
====================================

Aquí se guarda AUTOMÁTICAMENTE toda la información del programa Gerencia
Komplex (caja, registro de pagos, transferencias, cuadres y cierres de mes).
Está separada de la carpeta del programa: si el programa se borra, se pierde o
se vuelve a descargar, la información sigue aquí.

  datos/        La información en uso. Un archivo por mes (AAAA-MM.json) y la
                configuración (planes, bancos, cierres de mes).
  respaldos/    Una copia completa por día. Se conservan las últimas 60.
  cierres/      Al cerrar un mes se guarda aquí su Excel, su informe de Word y
                una copia de sus datos.

IMPORTANTE
- No modifiques ni borres los archivos de "datos" con el programa abierto.
- Para llevar los datos a otra computadora, copia esta carpeta completa y, en
  el programa nuevo, elige esta carpeta al entrar por primera vez.
- Si un archivo de "datos" se daña, cierra el programa y reemplázalo por el del
  último respaldo (respaldos/AAAA-MM-DD.json contiene todos los meses; también
  se puede restaurar desde el programa: Configuración → Respaldos).
`;

/** Crea la estructura de la carpeta (sin tocar lo que ya exista). */
export function prepararCarpeta(ruta: string): void {
  for (const s of Object.values(SUB)) fs.mkdirSync(path.join(ruta, s), { recursive: true });
  const leeme = path.join(ruta, 'LEEME.txt');
  if (!fs.existsSync(leeme)) fs.writeFileSync(leeme, LEEME.replace(/\n/g, os.EOL), 'utf8');
}

/** Nombre de carpeta seguro para Windows. */
export const nombreSeguro = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * Abre el selector de carpetas de Windows (solo en la PC donde corre el
 * programa). Devuelve null si se canceló o si no es Windows.
 */
export function elegirCarpetaWindows(inicial: string): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const ps = (t: string) => `'${t.replace(/'/g, "''")}'`;
  const guion = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$dueno = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false}',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Elige o crea la carpeta donde se guardará la información de Komplex'",
    '$d.ShowNewFolderButton = $true',
    `if (Test-Path -LiteralPath ${ps(inicial)}) { $d.SelectedPath = ${ps(inicial)} }`,
    "if ($d.ShowDialog($dueno) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }",
  ].join('; ');
  return new Promise((resolve) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', guion], { windowsHide: true });
    let salida = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (t: string) => { salida += t; });
    p.on('error', () => resolve(null));
    p.on('close', () => resolve(salida.trim() || null));
  });
}

/** Abre la carpeta en el Explorador de archivos (o el gestor del sistema). */
export function abrirEnExplorador(ruta: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['explorer', [ruta]]
    : process.platform === 'darwin' ? ['open', [ruta]] : ['xdg-open', [ruta]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* sin explorador: no pasa nada */ }
}
