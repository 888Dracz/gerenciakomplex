/**
 * rutas/admin.ts — Estado general, configuración, cierre de mes, código
 * gerencial, clave de acceso, bitácora y respaldos.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

import { esRespaldo } from '../almacen/almacen.js';
import { escribirBinario, escribirJson } from '../almacen/archivos.js';
import { SUB, nombreSeguro } from '../almacen/carpeta.js';
import { ARCHIVO_MAX, VERSION } from '../config.js';
import { r2, resumen } from '../dominio/calculos.js';
import { esMes, hoyISO, nombreMes, ultimoDiaMes } from '../dominio/fechas.js';
import { mesesPorCerrar, puedeCerrar } from '../dominio/periodos.js';
import type { Cierre, ConfigPublica, Plan } from '../dominio/tipos.js';
import { ErrorValidacion, limpiarLista } from '../dominio/validar.js';
import { almacen } from '../estado.js';
import { ApiError, body, esLocal, params, sesion } from '../http.js';
import {
  activarGerencial, bloqueadoPorIntentos, cerrarOtras, cifrarClave, claveCorrecta, codigoGerencialCorrecto,
  gerencialActivo, limpiarFallos, registrarFallo, terminarGerencial,
} from '../sesiones.js';
import { validarClaveNueva } from './inicio.js';

function configPublica(): ConfigPublica {
  const { clave: _c, bitacora: _b, ...resto } = almacen().config;
  return resto;
}

const carpetaCierre = (carpeta: string, mes: string) =>
  path.join(carpeta, SUB.cierres, nombreSeguro(`${mes} ${nombreMes(mes).split(' ')[0]}`));

function exigirGerencial(req: Parameters<typeof sesion>[0]): void {
  if (!gerencialActivo(sesion(req))) {
    throw new ApiError(403, 'Esto requiere el código gerencial.', { codigo: 'REQUIERE_GERENCIAL' });
  }
}

export default async function rutasAdmin(app: FastifyInstance): Promise<void> {
  /** Lo que la interfaz necesita para pintar: configuración, cierres y sesión. */
  app.get('/api/estado', async (req) => {
    const a = almacen();
    const s = sesion(req);
    return {
      version: VERSION,
      config: configPublica(),
      mesesConDatos: a.mesesConDatos(),
      carpeta: a.carpeta,
      local: esLocal(req),
      usuario: s.nombre,
      gerencialHasta: gerencialActivo(s) ? new Date(s.gerencialHasta).toISOString() : null,
      hoy: hoyISO(),
      ultimoGuardado: a.ultimoGuardado,
      ultimoRespaldo: a.ultimoRespaldo,
    };
  });

  // ---------------------------------------------------------------- configuración
  app.put('/api/config', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const b = body(req);
    const cambios: string[] = [];
    if (b.negocio !== undefined) {
      const n = String(b.negocio ?? '').trim().slice(0, 60);
      if (!n) throw new ErrorValidacion('Escribe el nombre del negocio.');
      a.config.negocio = n;
      cambios.push('nombre');
    }
    if (b.planes !== undefined) {
      if (!Array.isArray(b.planes)) throw new ErrorValidacion('Lista de planes no válida.');
      const vistos = new Set<string>();
      const planes: Plan[] = [];
      for (const x of b.planes as Record<string, unknown>[]) {
        const nombre = String(x?.nombre ?? '').trim().slice(0, 60);
        if (!nombre) continue;
        if (vistos.has(nombre.toLowerCase())) throw new ErrorValidacion(`El plan "${nombre}" está repetido.`);
        vistos.add(nombre.toLowerCase());
        const precio = Number(x?.precio);
        if (!(precio >= 0)) throw new ErrorValidacion(`El precio del plan "${nombre}" no es válido.`);
        planes.push({ nombre, precio: r2(precio), activo: x?.activo !== false });
      }
      if (!planes.length) throw new ErrorValidacion('Debe haber al menos un plan.');
      a.config.planes = planes;
      cambios.push('planes');
    }
    if (b.bancos !== undefined) { a.config.bancos = limpiarLista(b.bancos); cambios.push('bancos'); }
    if (b.categoriasGasto !== undefined) {
      a.config.categoriasGasto = limpiarLista(b.categoriasGasto);
      if (!a.config.categoriasGasto.length) a.config.categoriasGasto = ['Otros'];
      cambios.push('categorías de gasto');
    }
    a.guardarConfig();
    if (cambios.length) a.bitacora(s.nombre, 'Configuración cambiada', cambios.join(', '));
    return { config: configPublica() };
  });

  // ---------------------------------------------------------------- cierre de mes
  app.post('/api/cierres/:mes', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const mes = params(req).mes;
    if (!esMes(mes)) throw new ApiError(400, 'Mes no válido.');
    const ger = gerencialActivo(s);
    const estado = { mesesConDatos: a.mesesConDatos(), cierres: a.config.cierres };
    const motivo = puedeCerrar(estado, mes, hoyISO());
    // Con el código gerencial se puede cerrar también el mes en curso, pero
    // nunca saltándose un mes anterior abierto.
    if (motivo && !(ger && !a.config.cierres[mes] && !mesesPorCerrar(estado, mes).length)) {
      throw new ApiError(409, motivo);
    }
    const r = resumen(a.datos(), `${mes}-01`, ultimoDiaMes(mes));
    const cierre: Cierre = {
      mes,
      cerradoEn: new Date().toISOString(),
      cerradoPor: s.nombre,
      resumen: {
        registros: r.registros,
        afiliados: r.afiliados,
        ingresoUSD: r.ingresoUSD,
        gastosUSD: r.gastosUSD,
        transferenciasPendientes: r.transferencias.pendientes,
      },
    };
    a.config.cierres[mes] = cierre;
    a.guardarConfig();
    a.bitacora(s.nombre, 'Mes cerrado', `${nombreMes(mes)} · ingreso $${r.ingresoUSD} · ${r.afiliados} afiliados`);
    // Copia de los datos del mes tal como quedaron al cerrarlo.
    const dir = carpetaCierre(a.carpeta, mes);
    escribirJson(path.join(dir, 'datos del mes.json'), { cierre, datos: a.mes(mes) });
    a.respaldar(true);
    return { cierre, carpeta: dir };
  });

  /** La interfaz sube el Excel y el Word del mes recién cerrado para dejarlos en la carpeta. */
  app.put('/api/cierres/:mes/archivos/:nombre', { bodyLimit: ARCHIVO_MAX }, async (req) => {
    const a = almacen();
    sesion(req);
    const { mes, nombre } = params(req);
    if (!esMes(mes) || !a.config.cierres[mes]) throw new ApiError(400, 'Ese mes no está cerrado.');
    const limpio = nombreSeguro(decodeURIComponent(nombre));
    if (!/\.(xlsx|docx)$/i.test(limpio)) throw new ApiError(400, 'Solo se guardan archivos .xlsx o .docx.');
    if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'Archivo vacío.');
    escribirBinario(path.join(carpetaCierre(a.carpeta, mes), limpio), req.body);
    return { ok: true };
  });

  app.delete('/api/cierres/:mes', async (req) => {
    const a = almacen();
    const s = sesion(req);
    exigirGerencial(req);
    const mes = params(req).mes;
    if (!a.config.cierres[mes]) throw new ApiError(404, 'Ese mes no está cerrado.');
    const posteriores = Object.keys(a.config.cierres).filter((m) => m > mes);
    if (posteriores.length) {
      throw new ApiError(409, `Primero reabre ${posteriores.sort().reverse().map(nombreMes).join(', ')}.`);
    }
    delete a.config.cierres[mes];
    a.guardarConfig();
    a.bitacora(s.nombre, 'Mes reabierto (gerencial)', nombreMes(mes));
    return { ok: true };
  });

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
    validarClaveNueva(nueva);
    a.config.clave = cifrarClave(nueva);
    a.guardarConfig();
    cerrarOtras(s.token);
    a.bitacora(s.nombre, 'Clave de acceso cambiada', 'Se cerraron las demás sesiones');
    return { ok: true };
  });

  // ---------------------------------------------------------------- bitácora y respaldos
  app.get('/api/bitacora', async (req) => {
    sesion(req);
    return { entradas: [...almacen().config.bitacora].reverse().slice(0, 500) };
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
    exigirGerencial(req);
    const r = req.body;
    if (!esRespaldo(r)) throw new ApiError(400, 'Ese archivo no es un respaldo de Gerencia Komplex.');
    const a = almacen();
    a.restaurar(r);
    a.bitacora(s.nombre, 'Respaldo restaurado (gerencial)', `creado ${r.creado} · ${r.meses.length} meses`);
    return { ok: true, meses: r.meses.length };
  });
}
