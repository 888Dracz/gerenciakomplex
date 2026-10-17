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
import { bloqueoEdicion, bloqueoEscritura, type Bloqueo } from './dominio/periodos.js';
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

function lanzar(b: Bloqueo): never {
  throw new ApiError(409, b.mensaje, {
    codigo: b.tipo === 'mes_cerrado' ? 'MES_CERRADO' : 'CIERRE_PENDIENTE',
    mes: b.mes,
    meses: b.tipo === 'cierre_pendiente' ? b.meses : [b.mes],
  });
}

function contexto(req: FastifyRequest) {
  const a = almacen();
  return { mesesConDatos: a.mesesConDatos(), cierres: a.config.cierres, gerencial: gerencialActivo(sesion(req)) };
}

/** Lanza 409 si la fecha está en un mes cerrado o hay meses anteriores por cerrar. */
export function exigirEscritura(req: FastifyRequest, fecha: string): void {
  const b = bloqueoEscritura(contexto(req), fecha);
  if (b) lanzar(b);
}

export function exigirEdicion(req: FastifyRequest, fechaAnterior: string, fechaNueva: string): void {
  const b = bloqueoEdicion(contexto(req), fechaAnterior, fechaNueva);
  if (b) lanzar(b);
}

/** Deja constancia en la bitácora cuando se toca un mes cerrado con el código gerencial. */
export function notaMesCerrado(req: FastifyRequest, fecha: string, detalle: string): void {
  const a = almacen();
  if (a.config.cierres[fecha.slice(0, 7)]) a.bitacora(sesion(req).nombre, 'Cambio en mes cerrado (gerencial)', detalle);
}
