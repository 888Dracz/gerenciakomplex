/**
 * persistencia.ts — Dónde guarda la versión web su copia de trabajo: en el
 * navegador (IndexedDB). Es una tabla clave → valor muy simple:
 *   'config'          configuración (planes, bancos, cierres, bitácora, clave)
 *   'mes:AAAA-MM'     datos de cada mes
 *   'sesiones'        sesiones abiertas en este navegador
 *   'carpeta'         la carpeta elegida (permiso del navegador)
 *   'meta'            marcas de sincronización con la carpeta
 *
 * Hay una versión en memoria para las pruebas.
 */

export interface Persistencia {
  leer<T = unknown>(clave: string): Promise<T | undefined>;
  escribir(clave: string, valor: unknown): Promise<void>;
  borrar(clave: string): Promise<void>;
  claves(prefijo?: string): Promise<string[]>;
}

const BD = 'gerencia-komplex';
const TABLA = 'datos';

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(TABLA)) r.result.createObjectStore(TABLA);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('No se pudo abrir el almacenamiento del navegador.'));
    r.onblocked = () => reject(new Error('Cierra las otras pestañas de Gerencia Komplex y vuelve a intentar.'));
  });
}

function pedir<T>(db: IDBDatabase, modo: IDBTransactionMode, fn: (t: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLA, modo);
    const req = fn(tx.objectStore(TABLA));
    let valor: T;
    req.onsuccess = () => { valor = req.result as T; };
    tx.oncomplete = () => resolve(valor);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Error del almacenamiento del navegador.'));
    tx.onabort = () => reject(tx.error ?? new Error('El navegador canceló el guardado (¿falta espacio?).'));
  });
}

export function persistenciaNavegador(): Persistencia {
  let db: Promise<IDBDatabase> | null = null;
  const conDb = () => (db ??= abrir());
  return {
    async leer<T>(clave: string) {
      return pedir<T | undefined>(await conDb(), 'readonly', (t) => t.get(clave));
    },
    async escribir(clave, valor) {
      await pedir(await conDb(), 'readwrite', (t) => t.put(valor, clave));
    },
    async borrar(clave) {
      await pedir(await conDb(), 'readwrite', (t) => t.delete(clave));
    },
    async claves(prefijo = '') {
      const todas = await pedir<IDBValidKey[]>(await conDb(), 'readonly', (t) => t.getAllKeys());
      return todas.map(String).filter((k) => k.startsWith(prefijo));
    },
  };
}

/** Para las pruebas (y por si el navegador no deja usar IndexedDB). */
export function persistenciaMemoria(): Persistencia {
  const m = new Map<string, unknown>();
  return {
    // La carpeta (un objeto del navegador) se guarda tal cual; lo demás, copiado.
    async leer<T>(clave: string) { return (clave === 'carpeta' ? m.get(clave) : structuredClone(m.get(clave))) as T | undefined; },
    async escribir(clave, valor) { m.set(clave, clave === 'carpeta' ? valor : structuredClone(valor)); },
    async borrar(clave) { m.delete(clave); },
    async claves(prefijo = '') { return [...m.keys()].filter((k) => k.startsWith(prefijo)); },
  };
}
