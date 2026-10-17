/** router.ts — Router mínimo sobre el hash (#/caja, #/registro…). */
import { useSyncExternalStore } from 'react';

export const SECCIONES = ['caja', 'registro', 'transferencias', 'cuadre', 'resumen', 'cierres', 'configuracion'] as const;
export type Seccion = (typeof SECCIONES)[number];

function leer(): Seccion {
  const m = location.hash.match(/^#\/([\w-]+)/);
  const s = m?.[1] as Seccion | undefined;
  return s && (SECCIONES as readonly string[]).includes(s) ? s : 'caja';
}

let cache = leer();
let clave = location.hash;

function snapshot(): Seccion {
  if (location.hash !== clave) {
    clave = location.hash;
    cache = leer();
  }
  return cache;
}

function suscribir(fn: () => void): () => void {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

export const useSeccion = (): Seccion => useSyncExternalStore(suscribir, snapshot);

export function ir(s: Seccion): void {
  if (location.hash !== `#/${s}`) location.hash = `#/${s}`;
}
