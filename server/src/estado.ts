/**
 * estado.ts — El almacén activo y la regla de escritura (cierre de mes).
 *
 * Mientras no se haya elegido la carpeta de datos no hay almacén: las rutas de
 * datos responden 409 y la interfaz muestra la pantalla de bienvenida.
 */
import type { FastifyRequest } from 'fastify';

import { Almacen } from './almacen/almacen.js';
import { leerPuntero } from './almacen/carpeta.js';
import { DATA_DIR_ENV } from './config.js';
import type { Quien } from './dominio/operaciones.js';
import { ApiError, sesion } from './http.js';
import { gerencialActivo } from './sesiones.js';

let actual: Almacen | null = null;
/** Carpeta anotada que ya no se encuentra (se borró, se movió, era un USB…). */
let perdida: string | null = null;

export function iniciarAlmacen(): void {
  const ruta = DATA_DIR_ENV || leerPuntero();
  if (!ruta) return;
  try {
    actual = new Almacen(ruta);
    perdida = null;
    console.log(`Carpeta de datos: ${ruta}`);
  } catch (e) {
    perdida = ruta;
    console.error(`No se pudo abrir la carpeta de datos ${ruta}: ${(e as Error).message}`);
  }
}

export function usarAlmacen(a: Almacen): void {
  actual = a;
  perdida = null;
}

export const almacenActual = (): Almacen | null => actual;
export const carpetaPerdida = (): string | null => perdida;

export function almacen(): Almacen {
  if (!actual) throw new ApiError(409, 'Todavía no se eligió la carpeta de datos.', { codigo: 'SIN_CARPETA' });
  return actual;
}

/** Quién hace la acción (nombre y si tiene el modo gerencial activo). */
export function quien(req: FastifyRequest): Quien {
  const s = sesion(req);
  return { nombre: s.nombre, gerencial: gerencialActivo(s) };
}
