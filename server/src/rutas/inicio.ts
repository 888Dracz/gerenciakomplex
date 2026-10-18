/**
 * rutas/inicio.ts — Primer arranque (carpeta de datos), entrada y salida.
 *
 * La carpeta solo se elige desde la propia PC del programa: desde un celular
 * de la red no se puede tocar dónde se guardan los datos.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

import { Almacen } from '../almacen/almacen.js';
import { abrirEnExplorador, elegirCarpetaWindows, guardarPuntero, revisarCarpeta } from '../almacen/carpeta.js';
import { APP_ID, VERSION, carpetaSugerida } from '../config.js';
import { almacenActual, carpetaPerdida, usarAlmacen } from '../estado.js';
import { validarClaveNueva } from '../dominio/operaciones.js';
import { ApiError, body, esLocal, exigirLocal, sesion } from '../http.js';
import {
  bloqueadoPorIntentos, cerrarSesion, cifrarClave, claveCorrecta, crearSesion, limpiarFallos, registrarFallo,
} from '../sesiones.js';

const txt = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

export default async function rutasInicio(app: FastifyInstance): Promise<void> {
  app.get('/api/salud', async () => ({ ok: true, app: APP_ID, version: VERSION }));

  /** Lo que la interfaz necesita saber antes de entrar. */
  app.get('/api/inicio', async (req) => {
    const a = almacenActual();
    return {
      app: APP_ID,
      version: VERSION,
      configurado: !!a,
      negocio: a?.config.negocio ?? 'Komplex Gym',
      local: esLocal(req),
      windows: process.platform === 'win32',
      sugerida: carpetaSugerida(),
      carpetaPerdida: carpetaPerdida(),
      sesion: req.sesion ? { nombre: req.sesion.nombre } : null,
    };
  });

  app.post('/api/carpeta/elegir', async (req) => {
    exigirLocal(req);
    if (almacenActual() && !req.sesion) throw new ApiError(401, 'Inicia sesión para continuar.');
    const ruta = await elegirCarpetaWindows(txt(body(req).inicial, 500) || carpetaSugerida());
    return { ruta };
  });

  app.post('/api/carpeta/revisar', async (req) => {
    exigirLocal(req);
    if (almacenActual() && !req.sesion) throw new ApiError(401, 'Inicia sesión para continuar.');
    return revisarCarpeta(txt(body(req).ruta, 500));
  });

  /**
   * Crea (o adopta) la carpeta de datos. La primera vez cualquiera desde la PC
   * puede hacerlo; para cambiarla después hay que haber entrado.
   */
  app.post('/api/carpeta/configurar', async (req) => {
    exigirLocal(req);
    const previo = almacenActual();
    if (previo && !req.sesion) throw new ApiError(401, 'Inicia sesión para continuar.');
    const b = body(req);
    const rev = revisarCarpeta(txt(b.ruta, 500));
    if (rev.problema) throw new ApiError(400, rev.problema);
    const nombre = txt(b.nombre, 60) || req.sesion?.nombre || 'Administración';

    // Llevar los datos actuales a una carpeta nueva y vacía.
    if (previo && b.mover === true && !rev.tieneDatos) {
      const dentro = path.resolve(rev.ruta).toLowerCase().startsWith(path.resolve(previo.carpeta).toLowerCase() + path.sep);
      if (dentro) throw new ApiError(400, 'La carpeta nueva no puede estar dentro de la actual.');
      fs.mkdirSync(rev.ruta, { recursive: true });
      fs.cpSync(previo.carpeta, rev.ruta, { recursive: true, errorOnExist: false, force: false });
    }

    let a: Almacen;
    try {
      a = new Almacen(rev.ruta);
    } catch (e) {
      throw new ApiError(400, `No se pudo usar esa carpeta: ${(e as Error).message}`);
    }
    if (!a.config.clave) {
      const clave = String(b.clave ?? '');
      validarClaveNueva(clave);
      a.config.clave = cifrarClave(clave);
      a.guardarConfig();
    }
    guardarPuntero(rev.ruta);
    usarAlmacen(a);
    a.bitacora(nombre, previo ? 'Carpeta de datos cambiada' : 'Carpeta de datos creada', rev.ruta);
    a.respaldar();
    // Quien crea la carpeta queda dentro sin volver a escribir la clave.
    const s = req.sesion ?? (rev.tieneDatos ? null : crearSesion(nombre, true));
    return { ok: true, carpeta: rev.ruta, recuperada: rev.tieneDatos, token: s && !req.sesion ? s.token : null, nombre: s?.nombre ?? null };
  });

  app.post('/api/carpeta/abrir', async (req) => {
    exigirLocal(req);
    sesion(req);
    const a = almacenActual();
    if (a) abrirEnExplorador(a.carpeta);
    return { ok: true };
  });

  app.post('/api/login', async (req) => {
    const a = almacenActual();
    if (!a) throw new ApiError(409, 'Todavía no se eligió la carpeta de datos.', { codigo: 'SIN_CARPETA' });
    const ip = req.socket.remoteAddress ?? '?';
    const espera = bloqueadoPorIntentos(ip);
    if (espera) throw new ApiError(429, `Demasiados intentos. Espera ${espera} segundos.`);
    const b = body(req);
    const nombre = txt(b.nombre, 60);
    if (!nombre) throw new ApiError(400, 'Escribe tu nombre (queda anotado en lo que registres).');
    if (!claveCorrecta(String(b.clave ?? ''), a.config.clave)) {
      registrarFallo(ip);
      throw new ApiError(401, 'La clave de acceso no es correcta.');
    }
    limpiarFallos(ip);
    const s = crearSesion(nombre, b.recordar !== false);
    return { token: s.token, nombre: s.nombre };
  });

  app.post('/api/logout', async (req) => {
    if (req.sesion) cerrarSesion(req.sesion.token);
    return { ok: true };
  });
}

