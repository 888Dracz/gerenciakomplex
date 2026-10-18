/**
 * carpeta.ts — La carpeta de datos en la versión web.
 *
 * Chrome y Edge de computadora dejan que una página elija una carpeta y
 * escriba en ella (API "File System Access"). Se usa el MISMO formato que el
 * programa de escritorio (datos/, respaldos/, cierres/), así que las dos
 * versiones pueden abrir la misma carpeta.
 *
 * Otros navegadores (iPhone, Firefox…) no lo permiten: ahí la información queda
 * solo en el navegador y se cuida con respaldos descargados.
 *
 * Los tipos son estructurales para poder probarlo con una carpeta falsa en memoria.
 */

export interface Escritor {
  write(datos: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

export interface Arch {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<Escritor>;
}

export interface Dir {
  kind: 'directory';
  name: string;
  getDirectoryHandle(nombre: string, o?: { create?: boolean }): Promise<Dir>;
  getFileHandle(nombre: string, o?: { create?: boolean }): Promise<Arch>;
  removeEntry(nombre: string, o?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterable<Dir | Arch>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
}

export const NOMBRE_CARPETA = 'Komplex Gerencia';
export const SUB = { datos: 'datos', respaldos: 'respaldos', cierres: 'cierres' } as const;

interface VentanaConCarpetas {
  showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<Dir>;
}

export const soportaCarpetas = (): boolean =>
  typeof window !== 'undefined' && typeof (window as unknown as VentanaConCarpetas).showDirectoryPicker === 'function';

/** Abre el selector de carpetas. null si la persona canceló. */
export async function elegirCarpeta(): Promise<Dir | null> {
  const w = window as unknown as VentanaConCarpetas;
  if (!w.showDirectoryPicker) return null;
  try {
    return await w.showDirectoryPicker({ id: 'gerencia-komplex', mode: 'readwrite', startIn: 'documents' });
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

/** ¿Tenemos permiso para escribir? Con `pedir`, lo solicita (requiere un toque de la persona). */
export async function permiso(dir: Dir, pedir: boolean): Promise<boolean> {
  if (!dir.queryPermission) return true;
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (!pedir || !dir.requestPermission) return false;
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function subcarpeta(dir: Dir, ruta: string[], crear: boolean): Promise<Dir | null> {
  let d = dir;
  for (const parte of ruta) {
    try {
      d = await d.getDirectoryHandle(parte, { create: crear });
    } catch (e) {
      if (!crear && ((e as DOMException)?.name === 'NotFoundError' || (e as DOMException)?.name === 'TypeMismatchError')) return null;
      throw e;
    }
  }
  return d;
}

async function archivo(dir: Dir, ruta: string[], crear: boolean): Promise<Arch | null> {
  const carpeta = await subcarpeta(dir, ruta.slice(0, -1), crear);
  if (!carpeta) return null;
  try {
    return await carpeta.getFileHandle(ruta[ruta.length - 1], { create: crear });
  } catch (e) {
    if (!crear && ((e as DOMException)?.name === 'NotFoundError' || (e as DOMException)?.name === 'TypeMismatchError')) return null;
    throw e;
  }
}

export async function leerTexto(dir: Dir, ruta: string[]): Promise<string | null> {
  const a = await archivo(dir, ruta, false);
  return a ? (await a.getFile()).text() : null;
}

export async function leerJson<T>(dir: Dir, ruta: string[]): Promise<T | null> {
  const t = await leerTexto(dir, ruta);
  if (t === null) return null;
  try {
    return JSON.parse(t.replace(/^﻿/, '')) as T;
  } catch {
    throw new Error(`El archivo ${ruta.join('/')} de la carpeta está dañado. Restáuralo desde un respaldo.`);
  }
}

/** Escribe un archivo (creando las subcarpetas). El navegador lo deja completo o no lo toca. */
export async function escribirArchivo(dir: Dir, ruta: string[], contenido: string | Uint8Array): Promise<void> {
  const a = await archivo(dir, ruta, true);
  const w = await a!.createWritable();
  await w.write(typeof contenido === 'string' ? contenido : (contenido as unknown as BufferSource));
  await w.close();
}

export async function borrarArchivo(dir: Dir, ruta: string[]): Promise<void> {
  const carpeta = await subcarpeta(dir, ruta.slice(0, -1), false);
  if (!carpeta) return;
  try {
    await carpeta.removeEntry(ruta[ruta.length - 1]);
  } catch (e) {
    if ((e as DOMException)?.name !== 'NotFoundError') throw e;
  }
}

export interface ArchivoListado { nombre: string; modificado: number }

export async function listarArchivos(dir: Dir, sub: string): Promise<ArchivoListado[]> {
  const carpeta = await subcarpeta(dir, [sub], false);
  if (!carpeta) return [];
  const out: ArchivoListado[] = [];
  for await (const h of carpeta.values()) {
    if (h.kind === 'file') out.push({ nombre: h.name, modificado: (await h.getFile()).lastModified });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export const tieneDatos = async (dir: Dir): Promise<boolean> => !!(await archivo(dir, [SUB.datos, 'configuracion.json'], false));

/**
 * Decide qué carpeta usar a partir de la elegida (mismas reglas que el
 * programa de escritorio):
 *  - si ya es una carpeta de Komplex (tiene datos/configuracion.json), esa;
 *  - si dentro hay una "Komplex Gerencia" con datos, esa;
 *  - si su nombre ya dice Komplex, esa misma;
 *  - si no, se crea "Komplex Gerencia" dentro de la elegida.
 */
export async function resolverCarpeta(elegida: Dir): Promise<{ dir: Dir; tieneDatos: boolean }> {
  if (await tieneDatos(elegida)) return { dir: elegida, tieneDatos: true };
  const sub = await subcarpeta(elegida, [NOMBRE_CARPETA], false);
  if (sub && await tieneDatos(sub)) return { dir: sub, tieneDatos: true };
  if (/komplex/i.test(elegida.name)) return { dir: elegida, tieneDatos: false };
  return { dir: (await subcarpeta(elegida, [NOMBRE_CARPETA], true))!, tieneDatos: false };
}

/** Fecha de modificación más reciente de los archivos de datos (para saber si alguien más los cambió). */
export async function ultimaModificacion(dir: Dir): Promise<number> {
  const lista = await listarArchivos(dir, SUB.datos);
  return lista.filter((f) => f.nombre.endsWith('.json')).reduce((m, f) => Math.max(m, f.modificado), 0);
}
