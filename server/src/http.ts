/** http.ts — Errores de la API y utilidades compartidas por las rutas. */
import type { FastifyRequest } from 'fastify';
import type { Sesion } from './sesiones.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Sesión de quien llama; la pone el hook de autenticación. */
    sesion: Sesion | null;
  }
}

export { ApiError } from './dominio/operaciones.js';
import { ApiError } from './dominio/operaciones.js';

/** Sesión obligatoria (las rutas privadas siempre la tienen). */
export function sesion(req: FastifyRequest): Sesion {
  if (!req.sesion) throw new ApiError(401, 'Inicia sesión para continuar.');
  return req.sesion;
}

/** ¿La petición viene de esta misma PC? (elegir carpeta, abrir el explorador). */
export function esLocal(req: FastifyRequest): boolean {
  const ip = req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function exigirLocal(req: FastifyRequest): void {
  if (!esLocal(req)) {
    throw new ApiError(403, 'Esto solo se puede hacer desde la computadora donde corre el programa.');
  }
}

export const params = (req: FastifyRequest) => req.params as Record<string, string>;
export const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
export const query = (req: FastifyRequest) => (req.query ?? {}) as Record<string, string | undefined>;
