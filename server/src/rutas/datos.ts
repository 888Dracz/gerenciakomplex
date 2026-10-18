/**
 * rutas/datos.ts — Registro de pagos, verificación de transferencias, caja,
 * aperturas, cuadres y tasas del día.
 *
 * Cada ruta solo traduce HTTP ↔ `dominio/operaciones.ts`, que es donde viven
 * las reglas (las mismas que usa la versión web). El servidor es el que hace
 * cumplir el cierre de mes; la interfaz solo avisa antes.
 */
import type { FastifyInstance } from 'fastify';

import * as op from '../dominio/operaciones.js';
import { almacen, quien } from '../estado.js';
import { body, params, query } from '../http.js';

export default async function rutasDatos(app: FastifyInstance): Promise<void> {
  app.get('/api/datos', async (req) => op.leerDatos(almacen(), query(req).desde, query(req).hasta));
  app.get('/api/afiliados', async () => op.afiliados(almacen()));

  app.post('/api/registros', async (req) => op.crearRegistro(almacen(), quien(req), body(req)));
  app.put('/api/registros/:id', async (req) => op.editarRegistro(almacen(), quien(req), params(req).id, body(req)));
  app.delete('/api/registros/:id', async (req) => op.borrarRegistro(almacen(), quien(req), params(req).id));
  app.put('/api/registros/:id/pagos/:idx/estado', async (req) =>
    op.marcarTransferencia(almacen(), quien(req), params(req).id, params(req).idx, body(req)));

  app.post('/api/movimientos', async (req) => op.crearMovimiento(almacen(), quien(req), body(req)));
  app.put('/api/movimientos/:id', async (req) => op.editarMovimiento(almacen(), quien(req), params(req).id, body(req)));
  app.delete('/api/movimientos/:id', async (req) => op.borrarMovimiento(almacen(), quien(req), params(req).id));

  app.put('/api/aperturas/:fecha', async (req) => op.guardarApertura(almacen(), quien(req), params(req).fecha, body(req)));
  app.put('/api/cuadres/:fecha', async (req) => op.guardarCuadre(almacen(), quien(req), params(req).fecha, body(req)));
  app.delete('/api/cuadres/:fecha', async (req) => op.borrarCuadre(almacen(), quien(req), params(req).fecha));
  app.put('/api/tasas/:fecha', async (req) => op.guardarTasas(almacen(), quien(req), params(req).fecha, body(req)));
}
