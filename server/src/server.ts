/**
 * server.ts — Aplicación Fastify: API REST + estáticos de la interfaz.
 */
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

import { PUBLIC_DIR } from './config.js';
import { ErrorArchivo } from './almacen/archivos.js';
import { ErrorValidacion } from './dominio/validar.js';
import { ApiError } from './http.js';
import { obtenerSesion } from './sesiones.js';
import rutasInicio from './rutas/inicio.js';
import rutasDatos from './rutas/datos.js';
import rutasAdmin from './rutas/admin.js';

/** Rutas que se pueden llamar sin haber entrado. */
const RUTAS_PUBLICAS = new Set([
  '/api/salud', '/api/inicio', '/api/login', '/api/logout',
  '/api/carpeta/elegir', '/api/carpeta/revisar', '/api/carpeta/configurar',
]);

/** Archivos que nunca se cachean: así una actualización se ve al instante. */
const SIN_CACHE = /\.(html|webmanifest)$/i;
/** Archivos con hash en el nombre (index-CQXFjFfj.js): se cachean un año. */
const CON_HASH = /[/\\]assets[/\\][^/\\]+-[A-Za-z0-9_-]{8,}\.[a-z]+$/;

export async function crearApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  // Excel y Word del cierre de mes llegan como binario.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' },
    (_req, cuerpo, done) => done(null, cuerpo));

  app.decorateRequest('sesion', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api')) return;
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
  });

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api')) return;
    const h = req.headers.authorization ?? '';
    req.sesion = obtenerSesion(h.startsWith('Bearer ') ? h.slice(7) : null);
    if (!RUTAS_PUBLICAS.has(url) && !req.sesion) {
      return reply.code(401).send({ error: 'Inicia sesión para continuar.', codigo: 'SIN_SESION' });
    }
  });

  const MENSAJES: Record<number, string> = {
    400: 'Petición inválida', 401: 'Inicia sesión para continuar.', 403: 'Acceso denegado',
    404: 'No encontrado', 413: 'El archivo es demasiado grande',
  };

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send(error.payload);
    if (error instanceof ErrorValidacion) return reply.code(400).send({ error: error.message });
    if (error instanceof ErrorArchivo) return reply.code(500).send({ error: error.message });
    const estado = (error as { statusCode?: number }).statusCode ?? 0;
    if (estado >= 400 && estado < 500) {
      return reply.code(estado).send({ error: MENSAJES[estado] ?? 'Petición inválida' });
    }
    console.error(`[error] ${req.method} ${req.url}:`, error);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'ENOSPC') {
      return reply.code(500).send({ error: `No se pudo guardar en la carpeta de datos (${code}). Revisa que exista y que haya espacio.` });
    }
    return reply.code(500).send({ error: 'Error interno del servidor' });
  });

  await app.register(rutasInicio);
  await app.register(rutasDatos);
  await app.register(rutasAdmin);

  if (fs.existsSync(PUBLIC_DIR)) {
    await app.register(fastifyStatic, {
      root: PUBLIC_DIR,
      index: ['index.html'],
      setHeaders(reply, ruta) {
        if (SIN_CACHE.test(ruta)) {
          reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        } else if (CON_HASH.test(ruta)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          reply.header('Cache-Control', 'max-age=86400');
        }
      },
    });
  }

  // SPA: cualquier ruta que no sea /api devuelve index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && fs.existsSync(PUBLIC_DIR)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'No encontrado' });
  });

  return app;
}
