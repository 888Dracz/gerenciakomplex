/**
 * rutas/datos.ts — Registro de pagos, verificación de transferencias, caja,
 * aperturas, cuadres y tasas del día.
 *
 * Toda escritura pasa por `exigirEscritura`/`exigirEdicion`: el servidor es el
 * que hace cumplir el cierre de mes, la interfaz solo avisa antes.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { cajaDelDia, diferencias, lineasTransferencia, r2, resumirTransferencias } from '../dominio/calculos.js';
import { esFecha, mesDe } from '../dominio/fechas.js';
import { esTransferencia, type Movimiento, type Registro } from '../dominio/tipos.js';
import {
  ErrorValidacion, limpiarEfectivo, limpiarEstado, limpiarMovimiento, limpiarRegistro,
} from '../dominio/validar.js';
import { almacen, exigirEdicion, exigirEscritura, notaMesCerrado } from '../estado.js';
import { ApiError, body, params, query, sesion } from '../http.js';

const nuevoId = () => crypto.randomBytes(9).toString('base64url');
const ahora = () => new Date().toISOString();

function fechaParam(v: unknown): string {
  if (!esFecha(v)) throw new ApiError(400, 'Fecha no válida.');
  return v;
}

/** Ubica un registro por id en cualquier mes. */
function buscarRegistro(id: string): { reg: Registro; lista: Registro[] } {
  const a = almacen();
  for (const mes of a.mesesConDatos()) {
    const lista = a.mes(mes).registros;
    const reg = lista.find((r) => r.id === id);
    if (reg) return { reg, lista };
  }
  throw new ApiError(404, 'Ese registro ya no existe (quizá alguien lo borró).');
}

function buscarMovimiento(id: string): { mov: Movimiento; lista: Movimiento[] } {
  const a = almacen();
  for (const mes of a.mesesConDatos()) {
    const lista = a.mes(mes).movimientos;
    const mov = lista.find((m) => m.id === id);
    if (mov) return { mov, lista };
  }
  throw new ApiError(404, 'Ese movimiento ya no existe.');
}

const describir = (r: Pick<Registro, 'fecha' | 'afiliado' | 'plan' | 'tipo'>) =>
  `${r.fecha} · ${r.afiliado} · ${r.plan} (${r.tipo})`;

export default async function rutasDatos(app: FastifyInstance): Promise<void> {
  /** Datos de un rango; sin rango, todo. */
  app.get('/api/datos', async (req) => {
    const { desde, hasta } = query(req);
    if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) throw new ApiError(400, 'Rango de fechas no válido.');
    return almacen().datos(desde, hasta);
  });

  // ---------------------------------------------------------------- registros
  app.post('/api/registros', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const limpio = limpiarRegistro(body(req), a.config);
    exigirEscritura(req, limpio.fecha);
    const reg: Registro = { id: nuevoId(), ...limpio, creadoPor: s.nombre, creadoEn: ahora() };
    a.mes(mesDe(reg.fecha)).registros.push(reg);
    a.guardarFechas(reg.fecha);
    notaMesCerrado(req, reg.fecha, `Registro creado: ${describir(reg)}`);
    return { registro: reg };
  });

  app.put('/api/registros/:id', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const { reg, lista } = buscarRegistro(params(req).id);
    const limpio = limpiarRegistro(body(req), a.config, reg);
    exigirEdicion(req, reg.fecha, limpio.fecha);
    const anterior = reg.fecha;
    const nuevo: Registro = { ...reg, ...limpio, editadoPor: s.nombre, editadoEn: ahora() };
    if (mesDe(anterior) === mesDe(nuevo.fecha)) {
      lista[lista.indexOf(reg)] = nuevo;
    } else {
      lista.splice(lista.indexOf(reg), 1);
      a.mes(mesDe(nuevo.fecha)).registros.push(nuevo);
    }
    a.guardarFechas(anterior, nuevo.fecha);
    a.bitacora(s.nombre, 'Registro editado', describir(nuevo));
    notaMesCerrado(req, anterior, `Registro editado: ${describir(nuevo)}`);
    return { registro: nuevo };
  });

  app.delete('/api/registros/:id', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const { reg, lista } = buscarRegistro(params(req).id);
    exigirEscritura(req, reg.fecha);
    lista.splice(lista.indexOf(reg), 1);
    a.guardarFechas(reg.fecha);
    a.bitacora(s.nombre, 'Registro eliminado', `${describir(reg)} · ${JSON.stringify(reg.pagos)}`);
    notaMesCerrado(req, reg.fecha, `Registro eliminado: ${describir(reg)}`);
    return { ok: true };
  });

  /** Marcar si una transferencia llegó al banco. */
  app.put('/api/registros/:id/pagos/:idx/estado', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const { reg } = buscarRegistro(params(req).id);
    const idx = Number(params(req).idx);
    const pago = reg.pagos[idx];
    if (!pago || !esTransferencia(pago.moneda)) throw new ApiError(400, 'Ese pago no es una transferencia.');
    exigirEscritura(req, reg.fecha);
    const estado = limpiarEstado(body(req).estado);
    pago.estado = estado;
    if (estado === 'pendiente') {
      delete pago.verificadoPor;
      delete pago.verificadoEn;
    } else {
      pago.verificadoPor = s.nombre;
      pago.verificadoEn = ahora();
    }
    a.guardarFechas(reg.fecha);
    if (estado === 'no_llego') a.bitacora(s.nombre, 'Transferencia NO llegó', `${describir(reg)} · ${pago.moneda} ${pago.monto} · ref ${pago.referencia ?? ''}`);
    notaMesCerrado(req, reg.fecha, `Transferencia marcada ${estado}: ${describir(reg)}`);
    return { registro: reg };
  });

  // ---------------------------------------------------------------- movimientos de caja
  app.post('/api/movimientos', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const limpio = limpiarMovimiento(body(req));
    exigirEscritura(req, limpio.fecha);
    const mov: Movimiento = { id: nuevoId(), ...limpio, creadoPor: s.nombre, creadoEn: ahora() };
    a.mes(mesDe(mov.fecha)).movimientos.push(mov);
    a.guardarFechas(mov.fecha);
    notaMesCerrado(req, mov.fecha, `Movimiento creado: ${mov.fecha} ${mov.tipo} ${mov.concepto}`);
    return { movimiento: mov };
  });

  app.put('/api/movimientos/:id', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const { mov, lista } = buscarMovimiento(params(req).id);
    const limpio = limpiarMovimiento(body(req));
    exigirEdicion(req, mov.fecha, limpio.fecha);
    const anterior = mov.fecha;
    const nuevo: Movimiento = { ...mov, ...limpio, editadoPor: s.nombre, editadoEn: ahora() };
    if (mesDe(anterior) === mesDe(nuevo.fecha)) lista[lista.indexOf(mov)] = nuevo;
    else {
      lista.splice(lista.indexOf(mov), 1);
      a.mes(mesDe(nuevo.fecha)).movimientos.push(nuevo);
    }
    a.guardarFechas(anterior, nuevo.fecha);
    a.bitacora(s.nombre, 'Movimiento de caja editado', `${nuevo.fecha} · ${nuevo.tipo} · ${nuevo.concepto} · ${nuevo.moneda} ${nuevo.monto}`);
    notaMesCerrado(req, anterior, `Movimiento editado: ${nuevo.concepto}`);
    return { movimiento: nuevo };
  });

  app.delete('/api/movimientos/:id', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const { mov, lista } = buscarMovimiento(params(req).id);
    exigirEscritura(req, mov.fecha);
    lista.splice(lista.indexOf(mov), 1);
    a.guardarFechas(mov.fecha);
    a.bitacora(s.nombre, 'Movimiento de caja eliminado', `${mov.fecha} · ${mov.tipo} · ${mov.concepto} · ${mov.moneda} ${mov.monto}`);
    notaMesCerrado(req, mov.fecha, `Movimiento eliminado: ${mov.concepto}`);
    return { ok: true };
  });

  // ---------------------------------------------------------------- apertura, cuadre y tasas
  app.put('/api/aperturas/:fecha', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const fecha = fechaParam(params(req).fecha);
    exigirEscritura(req, fecha);
    if (a.mes(mesDe(fecha)).cuadres.some((c) => c.fecha === fecha)) {
      throw new ApiError(409, 'La caja de ese día ya está cerrada. Reábrela para cambiar el fondo.');
    }
    const fondo = limpiarEfectivo(body(req).fondo);
    const lista = a.mes(mesDe(fecha)).aperturas;
    const i = lista.findIndex((x) => x.fecha === fecha);
    const ap = { fecha, fondo, responsable: s.nombre, actualizadoEn: ahora() };
    if (i >= 0) lista[i] = ap;
    else lista.push(ap);
    a.guardarFechas(fecha);
    return { apertura: ap };
  });

  app.put('/api/cuadres/:fecha', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const fecha = fechaParam(params(req).fecha);
    exigirEscritura(req, fecha);
    const b = body(req);
    const contado = limpiarEfectivo(b.contado);
    const caja = cajaDelDia(a.datos(fecha, fecha), fecha);
    const t = resumirTransferencias(lineasTransferencia(a.datos(fecha, fecha).registros));
    const cuadre = {
      fecha,
      contado,
      esperado: caja.esperado,
      diferencia: diferencias(contado, caja.esperado),
      totalDiaUSD: r2(caja.totalUSD),
      transferencias: { total: t.total, confirmadas: t.confirmadas, pendientes: t.pendientes, noLlegaron: t.noLlegaron },
      responsable: String(b.responsable ?? '').trim().slice(0, 60) || s.nombre,
      observaciones: String(b.observaciones ?? '').trim().slice(0, 1000),
      cerradoEn: ahora(),
    };
    const lista = a.mes(mesDe(fecha)).cuadres;
    const i = lista.findIndex((x) => x.fecha === fecha);
    if (i >= 0) lista[i] = cuadre;
    else lista.push(cuadre);
    a.guardarFechas(fecha);
    a.bitacora(s.nombre, i >= 0 ? 'Cuadre de caja rehecho' : 'Caja cerrada (cuadre)',
      `${fecha} · esperado ${JSON.stringify(cuadre.esperado)} · contado ${JSON.stringify(contado)}`);
    return { cuadre };
  });

  app.delete('/api/cuadres/:fecha', async (req) => {
    const a = almacen();
    const s = sesion(req);
    const fecha = fechaParam(params(req).fecha);
    exigirEscritura(req, fecha);
    const lista = a.mes(mesDe(fecha)).cuadres;
    const i = lista.findIndex((x) => x.fecha === fecha);
    if (i < 0) throw new ApiError(404, 'Ese día no tiene cuadre.');
    lista.splice(i, 1);
    a.guardarFechas(fecha);
    a.bitacora(s.nombre, 'Caja reabierta', fecha);
    return { ok: true };
  });

  app.put('/api/tasas/:fecha', async (req) => {
    const a = almacen();
    const fecha = fechaParam(params(req).fecha);
    exigirEscritura(req, fecha);
    const b = body(req);
    const t: { Bs?: number; Cop?: number } = {};
    for (const k of ['Bs', 'Cop'] as const) {
      const n = Number(b[k]);
      if (b[k] !== undefined && b[k] !== null && b[k] !== '') {
        if (!(n > 0)) throw new ErrorValidacion(`La tasa de ${k} debe ser mayor que cero.`);
        t[k] = Number(n.toFixed(6));
      }
    }
    const m = a.mes(mesDe(fecha));
    if (Object.keys(t).length) m.tasas[fecha] = t;
    else delete m.tasas[fecha];
    a.guardarFechas(fecha);
    return { tasas: t };
  });
}
