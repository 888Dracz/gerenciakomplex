/**
 * rutas/admin.ts — Estado general, configuración, cierre de mes, código
 * gerencial, clave de acceso, bitácora y respaldos.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

import { escribirBinario, escribirJson } from '../almacen/archivos.js';
import { SUB } from '../almacen/carpeta.js';
import { ARCHIVO_MAX, VERSION } from '../config.js';
import { hoyISO } from '../dominio/fechas.js';
import * as op from '../dominio/operaciones.js';
import { almacen, quien } from '../estado.js';
import { direccionesRed } from '../red.js';
import { ApiError, body, esLocal, params, sesion } from '../http.js';
import {
  activarGerencial, bloqueadoPorIntentos, cerrarOtras, cifrarClave, claveCorrecta, codigoGerencialCorrecto,
  gerencialActivo, limpiarFallos, registrarFallo, terminarGerencial,
} from '../sesiones.js';

const carpetaCierre = (carpeta: string, mes: string) => path.join(carpeta, SUB.cierres, op.carpetaDelCierre(mes));

export default async function rutasAdmin(app: FastifyInstance): Promise<void> {
  /** Lo que la interfaz necesita para pintar: configuración, cierres y sesión. */
  app.get('/api/estado', async (req) => {
    const a = almacen();
    const s = sesion(req);
    return {
      version: VERSION,
      config: op.configPublica(a),
      mesesConDatos: a.mesesConDatos(),
      carpeta: a.carpeta,
      local: esLocal(req),
      usuario: s.nombre,
      gerencialHasta: gerencialActivo(s) ? new Date(s.gerencialHasta).toISOString() : null,
      hoy: hoyISO(),
      ultimoGuardado: a.ultimoGuardado,
      ultimoRespaldo: a.ultimoRespaldo,
      direcciones: direccionesRed(),
      transferenciasPendientes: op.transferenciasPendientes(a),
    };
  });

  // ---------------------------------------------------------------- configuración
  app.put('/api/config', async (req) => op.cambiarConfig(almacen(), quien(req), body(req)));

  // ---------------------------------------------------------------- cierre de mes
  app.post('/api/cierres/:mes', async (req) => {
    const a = almacen();
    const mes = params(req).mes;
    const { cierre, datosMes } = op.cerrarMes(a, quien(req), mes, hoyISO());
    // Copia de los datos del mes tal como quedaron al cerrarlo.
    const dir = carpetaCierre(a.carpeta, mes);
    escribirJson(path.join(dir, 'datos del mes.json'), { cierre, datos: datosMes });
    a.respaldar(true);
    return { cierre, carpeta: dir };
  });

  /** La interfaz sube el Excel y el Word del mes recién cerrado para dejarlos en la carpeta. */
  app.put('/api/cierres/:mes/archivos/:nombre', { bodyLimit: ARCHIVO_MAX }, async (req) => {
    const a = almacen();
    sesion(req);
    const { mes, nombre } = params(req);
    const limpio = op.nombreArchivoCierre(a, mes, nombre);
    if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'Archivo vacío.');
    escribirBinario(path.join(carpetaCierre(a.carpeta, mes), limpio), req.body);
    return { ok: true };
  });

  app.delete('/api/cierres/:mes', async (req) => op.reabrirMes(almacen(), quien(req), params(req).mes));

  // ---------------------------------------------------------------- código gerencial
  app.post('/api/gerencial', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const ip = req.socket.remoteAddress ?? '?';
    const espera = bloqueadoPorIntentos(ip);
    if (espera) throw new ApiError(429, `Demasiados intentos. Espera ${espera} segundos.`);
    if (!codigoGerencialCorrecto(String(body(req).codigo ?? ''))) {
      registrarFallo(ip);
      a.bitacora(s.nombre, 'Código gerencial incorrecto', ip);
      throw new ApiError(401, 'El código gerencial no es correcto.');
    }
    limpiarFallos(ip);
    const hasta = activarGerencial(s);
    a.bitacora(s.nombre, 'Modo gerencial activado (24 h)', `hasta ${new Date(hasta).toLocaleString('es-VE')}`);
    return { gerencialHasta: new Date(hasta).toISOString() };
  });

  app.delete('/api/gerencial', async (req) => {
    const s = sesion(req);
    if (gerencialActivo(s)) almacen().bitacora(s.nombre, 'Modo gerencial terminado', '');
    terminarGerencial(s);
    return { ok: true };
  });

  // ---------------------------------------------------------------- clave de acceso
  app.put('/api/clave', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const b = body(req);
    if (!claveCorrecta(String(b.actual ?? ''), a.config.clave) && !gerencialActivo(s)) {
      throw new ApiError(401, 'La clave actual no es correcta.');
    }
    const nueva = String(b.nueva ?? '');
    op.validarClaveNueva(nueva);
    a.config.clave = cifrarClave(nueva);
    a.guardarConfig();
    cerrarOtras(s.token);
    a.bitacora(s.nombre, 'Clave de acceso cambiada', 'Se cerraron las demás sesiones');
    return { ok: true };
  });

  // ---------------------------------------------------------------- bitácora y respaldos
  app.get('/api/bitacora', async (req) => {
    sesion(req);
    return op.leerBitacora(almacen());
  });

  app.get('/api/respaldo', async (req, reply) => {
    const s = sesion(req);
    const a = almacen();
    a.bitacora(s.nombre, 'Respaldo descargado', '');
    const r = a.respaldo();
    reply.header('Content-Disposition', `attachment; filename="Respaldo Komplex ${hoyISO()}.json"`);
    return r;
  });

  app.get('/api/respaldos', async (req) => {
    sesion(req);
    const dir = path.join(almacen().carpeta, SUB.respaldos);
    const lista = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse() : [];
    return { carpeta: dir, archivos: lista.slice(0, 100) };
  });

  app.post('/api/respaldo/restaurar', { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const s = sesion(req);
    op.exigirGerencial(quien(req));
    const r = req.body;
    if (!op.esRespaldo(r)) throw new ApiError(400, 'Ese archivo no es un respaldo de Gerencia Komplex.');
    const a = almacen();
    a.restaurar(r);
    a.bitacora(s.nombre, 'Respaldo restaurado (gerencial)', `creado ${r.creado} · ${r.meses.length} meses`);
    return { ok: true, meses: r.meses.length };
  });
}
