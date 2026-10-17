/**
 * config.ts — Puerto, rutas y variables de entorno de Gerencia Komplex.
 *
 * Los DATOS no viven aquí ni en la carpeta del programa: viven en la carpeta
 * que la persona crea al entrar por primera vez (ver almacen/carpeta.ts). Así,
 * si se borra o se pierde la carpeta del programa (o el repositorio), la
 * información sigue en el equipo.
 *
 * En la carpeta de la aplicación (AppData\Local\GerenciaKomplex) solo queda la
 * dirección de esa carpeta de datos y las sesiones abiertas.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export const VERSION = '1.0.0';
export const APP_ID = 'gerencia-komplex';

/** Raíz del paquete `server` (funciona igual en src/ y en dist/). */
export const SERVER_DIR = path.resolve(AQUI, '..');
/** Raíz del proyecto. */
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');
/** Interfaz ya compilada (la genera `vite build`). */
export const PUBLIC_DIR = path.join(SERVER_DIR, 'public');

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');

/** Puerto 3004: Dorado Club usa el 3003 y las dos pueden correr a la vez. */
export const PORT = Number(process.env.PORT || 3004);
export const HOST = process.env.HOST || '0.0.0.0';

/** Carpeta propia de la aplicación (puntero a la carpeta de datos y sesiones). */
export const APP_DIR = process.env.KOMPLEX_APP_DIR || path.join(LOCALAPPDATA, 'GerenciaKomplex');
export const PUNTERO = path.join(APP_DIR, 'carpeta-datos.json');
export const SESIONES = path.join(APP_DIR, 'sesiones.json');

/** Fuerza una carpeta de datos (sin preguntar). */
export const DATA_DIR_ENV = process.env.KOMPLEX_DATA_DIR || '';

export const ABRIR_NAVEGADOR = !process.env.KOMPLEX_NO_BROWSER;
/** Abrir en ventana propia (Edge/Chrome en modo aplicación) en vez de una pestaña. */
export const VENTANA_APP = process.env.KOMPLEX_VENTANA !== '0';

export const NOMBRE_CARPETA = 'Komplex Gerencia';
/** Copias diarias que se conservan en la carpeta de respaldos. */
export const RESPALDOS_A_CONSERVAR = 60;
/** Duración de la sesión: con "recordar" 30 días; sin él, 12 horas. */
export const SESION_RECORDAR_MS = 30 * 24 * 60 * 60 * 1000;
export const SESION_CORTA_MS = 12 * 60 * 60 * 1000;
/** Tamaño máximo de un archivo de cierre (Excel/Word) que sube la interfaz. */
export const ARCHIVO_MAX = 25 * 1024 * 1024;

/** Carpeta que se propone la primera vez: Documentos\Komplex Gerencia. */
export function carpetaSugerida(): string {
  const home = os.homedir();
  const candidatas = [
    path.join(home, 'Documents'),
    process.env.OneDrive ? path.join(process.env.OneDrive, 'Documents') : '',
    process.env.OneDrive ? path.join(process.env.OneDrive, 'Documentos') : '',
    path.join(home, 'Documentos'),
  ].filter(Boolean);
  const base = candidatas.find((c) => fs.existsSync(c)) ?? home;
  return path.join(base, NOMBRE_CARPETA);
}
