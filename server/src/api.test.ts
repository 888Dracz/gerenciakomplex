/**
 * Prueba de punta a punta de la API: carpeta de datos, registro, cierre de mes
 * obligatorio, código gerencial, transferencias y cuadre. Usa carpetas
 * temporales: no toca la configuración real del equipo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hoyISO, mesDe, sumarMeses } from './dominio/fechas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'komplex-'));
process.env.KOMPLEX_APP_DIR = path.join(tmp, 'app');
const elegida = path.join(tmp, 'Documentos');

let app: FastifyInstance;
let token = '';

const mesActual = mesDe(hoyISO());
const mesA = sumarMeses(mesActual, -2);
const mesB = sumarMeses(mesActual, -1);

async function api(method: string, url: string, payload?: unknown, tk = token) {
  const r = await app.inject({
    method: method as 'GET', url, payload: payload as object,
    headers: tk ? { authorization: `Bearer ${tk}` } : {},
  });
  return { status: r.statusCode, json: r.json() as Record<string, any> };
}

const registro = (fecha: string, extra: Record<string, unknown> = {}) => ({
  fecha, afiliado: 'María Pérez', plan: 'Ilimitado', tipo: 'Renovación',
  pagos: [{ moneda: 'Bs', monto: 39500, tasa: 790, bancoEmisor: 'Banesco', bancoReceptor: 'Mercantil', referencia: '00451236' }],
  ...extra,
});

beforeAll(async () => {
  const { crearApp } = await import('./server.js');
  app = await crearApp();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('API', () => {
  it('pide crear la carpeta de datos al entrar por primera vez', async () => {
    const r = await api('GET', '/api/inicio');
    expect(r.json).toMatchObject({ configurado: false, local: true });
    expect((await api('POST', '/api/login', { nombre: 'Ana', clave: 'x' })).status).toBe(409);
  });

  it('crea la carpeta "Komplex Gerencia" dentro de la elegida y deja la sesión abierta', async () => {
    const rev = await api('POST', '/api/carpeta/revisar', { ruta: elegida });
    expect(rev.json.ruta).toBe(path.join(elegida, 'Komplex Gerencia'));
    const r = await api('POST', '/api/carpeta/configurar', { ruta: elegida, clave: 'komplex1', nombre: 'Ana' });
    expect(r.status).toBe(200);
    token = r.json.token;
    expect(token).toBeTruthy();
    const carpeta = r.json.carpeta;
    for (const sub of ['datos', 'respaldos', 'cierres', 'LEEME.txt']) expect(fs.existsSync(path.join(carpeta, sub))).toBe(true);
    // El puntero vive fuera de la carpeta del programa.
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'carpeta-datos.json'), 'utf8')).carpeta).toBe(carpeta);
  });

  it('entra solo con la clave correcta', async () => {
    expect((await api('POST', '/api/login', { nombre: 'Luis', clave: 'mala' }, '')).status).toBe(401);
    const r = await api('POST', '/api/login', { nombre: 'Luis', clave: 'komplex1' }, '');
    expect(r.status).toBe(200);
    expect((await api('GET', '/api/estado', undefined, '')).status).toBe(401);
  });

  let idA = '';
  it('registra un pago y lo guarda en el archivo del mes', async () => {
    const r = await api('POST', '/api/registros', registro(`${mesA}-15`));
    expect(r.status).toBe(200);
    idA = r.json.registro.id;
    expect(r.json.registro).toMatchObject({ precioPlan: 50, creadoPor: 'Ana' });
    expect(r.json.registro.pagos[0].estado).toBe('pendiente');
    const archivo = path.join(elegida, 'Komplex Gerencia', 'datos', `${mesA}.json`);
    expect(JSON.parse(fs.readFileSync(archivo, 'utf8')).registros).toHaveLength(1);
  });

  it('rechaza datos incompletos de una transferencia', async () => {
    const r = await api('POST', '/api/registros', registro(`${mesA}-16`, { pagos: [{ moneda: 'Zelle', monto: 50 }] }));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/confirmación/);
  });

  it('no deja registrar en el mes siguiente hasta cerrar el anterior', async () => {
    const r = await api('POST', '/api/registros', registro(`${mesB}-01`));
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ codigo: 'CIERRE_PENDIENTE', meses: [mesA] });
  });

  it('verifica una transferencia', async () => {
    const r = await api('PUT', `/api/registros/${idA}/pagos/0/estado`, { estado: 'confirmada' });
    expect(r.status).toBe(200);
    expect(r.json.registro.pagos[0]).toMatchObject({ estado: 'confirmada', verificadoPor: 'Ana' });
  });

  it('cierra el mes y después ya no se puede modificar', async () => {
    const c = await api('POST', `/api/cierres/${mesA}`);
    expect(c.status).toBe(200);
    expect(c.json.cierre.resumen).toMatchObject({ registros: 1, afiliados: 1, ingresoUSD: 50 });
    expect(fs.existsSync(path.join(c.json.carpeta, 'datos del mes.json'))).toBe(true);

    expect((await api('POST', '/api/registros', registro(`${mesB}-01`))).status).toBe(200);
    const ed = await api('PUT', `/api/registros/${idA}`, registro(`${mesA}-15`, { afiliado: 'Otra' }));
    expect(ed.status).toBe(409);
    expect(ed.json.codigo).toBe('MES_CERRADO');
    expect((await api('DELETE', `/api/registros/${idA}`)).status).toBe(409);
  });

  it('el código gerencial abre 24 h para modificar un mes cerrado', async () => {
    expect((await api('POST', '/api/gerencial', { codigo: 'otro' })).status).toBe(401);
    const g = await api('POST', '/api/gerencial', { codigo: 'amoaadriano' });
    expect(g.status).toBe(200);
    const horas = (Date.parse(g.json.gerencialHasta) - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(23.9);
    const ed = await api('PUT', `/api/registros/${idA}`, registro(`${mesA}-15`, { afiliado: 'María P.' }));
    expect(ed.status).toBe(200);
    // La verificación se conserva al editar sin cambiar la transferencia.
    expect(ed.json.registro.pagos[0].estado).toBe('confirmada');
    const bit = await api('GET', '/api/bitacora');
    expect(bit.json.entradas.some((e: { accion: string }) => e.accion === 'Cambio en mes cerrado (gerencial)')).toBe(true);
    await api('DELETE', '/api/gerencial');
    expect((await api('PUT', `/api/registros/${idA}`, registro(`${mesA}-15`))).status).toBe(409);
  });

  it('cuadra la caja con fondo, cobros en efectivo y gastos', async () => {
    const dia = `${mesB}-02`;
    await api('PUT', `/api/aperturas/${dia}`, { fondo: { Dólares: 20, Cop: 0 } });
    await api('POST', '/api/registros', registro(dia, {
      afiliado: 'José', plan: 'Tarde', tipo: 'Nuevo', pagos: [{ moneda: 'Dólares', monto: 50 }],
      vueltos: [{ moneda: 'Dólares', monto: 10 }],
    }));
    await api('POST', '/api/movimientos', { fecha: dia, tipo: 'gasto', concepto: 'Cloro', categoria: 'Limpieza', moneda: 'Dólares', monto: 12 });
    const c = await api('PUT', `/api/cuadres/${dia}`, { contado: { Dólares: 45, Cop: 0 }, observaciones: 'Faltan 3' });
    expect(c.status).toBe(200);
    expect(c.json.cuadre.esperado).toEqual({ Dólares: 48, Cop: 0 });
    expect(c.json.cuadre.diferencia).toEqual({ Dólares: -3, Cop: 0 });
  });

  it('vuelve a leer todo desde la carpeta (como si se reinstalara el programa)', async () => {
    const { Almacen } = await import('./almacen/almacen.js');
    const a = new Almacen(path.join(elegida, 'Komplex Gerencia'));
    const d = a.datos();
    expect(d.registros).toHaveLength(3);
    expect(d.cuadres).toHaveLength(1);
    expect(a.config.cierres[mesA]).toBeTruthy();
    expect(fs.readdirSync(path.join(elegida, 'Komplex Gerencia', 'respaldos')).length).toBeGreaterThan(0);
  });
});
