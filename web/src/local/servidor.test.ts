/**
 * Pruebas de la versión web sin navegador: el "servidor local" con la
 * persistencia en memoria y una carpeta REAL del disco envuelta con la misma
 * forma que la API de archivos del navegador.
 *
 * Lo más importante: una carpeta creada por el programa de escritorio se abre
 * en la versión web (misma clave, mismos datos) y al revés.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hoyISO, mesDe, sumarMeses } from '@dominio/fechas';
import type { Arch, Dir, Escritor } from './carpeta';
import { persistenciaMemoria, type Persistencia } from './persistencia';
import { reiniciarServidorLocal, servidorLocal } from './servidor';

// ---------------------------------------------------------------- carpeta del disco con forma de navegador
class DirNode implements Dir {
  kind = 'directory' as const;
  permisoConcedido = true;
  constructor(public ruta: string) {}
  get name() { return path.basename(this.ruta); }
  async getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<Dir> {
    const r = path.join(this.ruta, n);
    if (!fs.existsSync(r)) {
      if (!o?.create) throw new DOMException('no', 'NotFoundError');
      fs.mkdirSync(r);
    }
    if (!fs.statSync(r).isDirectory()) throw new DOMException('no', 'TypeMismatchError');
    const d = new DirNode(r);
    d.permisoConcedido = this.permisoConcedido;
    return d;
  }
  async getFileHandle(n: string, o?: { create?: boolean }): Promise<Arch> {
    const r = path.join(this.ruta, n);
    if (!fs.existsSync(r)) {
      if (!o?.create) throw new DOMException('no', 'NotFoundError');
      fs.writeFileSync(r, '');
    }
    return archivoNode(r);
  }
  async removeEntry(n: string) {
    const r = path.join(this.ruta, n);
    if (!fs.existsSync(r)) throw new DOMException('no', 'NotFoundError');
    fs.rmSync(r, { recursive: true });
  }
  async *values(): AsyncIterable<Dir | Arch> {
    for (const e of fs.readdirSync(this.ruta, { withFileTypes: true })) {
      yield e.isDirectory() ? new DirNode(path.join(this.ruta, e.name)) : archivoNode(path.join(this.ruta, e.name));
    }
  }
  async queryPermission() { return this.permisoConcedido ? 'granted' as const : 'prompt' as const; }
  async requestPermission() { this.permisoConcedido = true; return 'granted' as const; }
}

function archivoNode(r: string): Arch {
  return {
    kind: 'file',
    name: path.basename(r),
    async getFile() {
      const st = fs.statSync(r);
      return new File([fs.readFileSync(r)], path.basename(r), { lastModified: st.mtimeMs });
    },
    async createWritable(): Promise<Escritor> {
      const partes: Buffer[] = [];
      return {
        async write(d) { partes.push(typeof d === 'string' ? Buffer.from(d) : Buffer.from(d as Uint8Array)); },
        async close() { fs.writeFileSync(r, Buffer.concat(partes)); },
      };
    },
  };
}

// ---------------------------------------------------------------- utilidades
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'komplex-web-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let elegida: Dir | null = null;
(globalThis as unknown as { window: unknown }).window = { showDirectoryPicker: async () => elegida };

let token: string | null = null;
async function api(metodo: string, url: string, cuerpo?: unknown, binario?: Uint8Array) {
  try {
    return { status: 200, json: await servidorLocal(metodo, url, cuerpo ?? {}, binario, token) as Record<string, any> };
  } catch (e) {
    const err = e as { status: number; payload: Record<string, any> };
    return { status: err.status, json: err.payload };
  }
}

const mesActual = mesDe(hoyISO());
const mesA = sumarMeses(mesActual, -2);
const mesB = sumarMeses(mesActual, -1);
const pagoBs = { moneda: 'Bs', monto: 39500, tasa: 790, bancoEmisor: 'Banesco', bancoReceptor: 'Mercantil', referencia: '00451236' };
const registro = (fecha: string, extra: Record<string, unknown> = {}) =>
  ({ fecha, afiliado: 'María Pérez', plan: 'Ilimitado', tipo: 'Renovación', pagos: [pagoBs], ...extra });

let persistencia: Persistencia;
beforeEach(() => { token = null; });

// ---------------------------------------------------------------- pruebas
describe('versión web con carpeta', () => {
  const docs = path.join(tmp, 'Documentos');
  fs.mkdirSync(docs);

  it('arranca sin configurar y pide la carpeta', async () => {
    persistencia = persistenciaMemoria();
    reiniciarServidorLocal(persistencia);
    const r = await api('GET', '/api/inicio');
    expect(r.json).toMatchObject({ configurado: false, web: true, soportaCarpeta: true });
  });

  it('crea "Komplex Gerencia" dentro de la carpeta elegida y escribe ahí', async () => {
    elegida = new DirNode(docs);
    const rev = await api('POST', '/api/carpeta/elegir');
    expect(rev.json).toMatchObject({ ruta: 'Komplex Gerencia', tieneDatos: false });
    const c = await api('POST', '/api/carpeta/configurar', { clave: 'komplex1', nombre: 'Ana' });
    expect(c.status).toBe(200);
    token = c.json.token;
    const k = path.join(docs, 'Komplex Gerencia');
    expect(fs.existsSync(path.join(k, 'datos', 'configuracion.json'))).toBe(true);
    expect(fs.existsSync(path.join(k, 'LEEME.txt'))).toBe(true);
    expect(fs.readdirSync(path.join(k, 'respaldos')).length).toBeGreaterThan(0);
  });

  it('registra, guarda el mes en la carpeta y aplica el cierre de mes', async () => {
    token = (await api('POST', '/api/login', { nombre: 'Ana', clave: 'komplex1' })).json.token;
    const r = await api('POST', '/api/registros', registro(`${mesA}-10`));
    expect(r.status).toBe(200);
    const archivo = path.join(docs, 'Komplex Gerencia', 'datos', `${mesA}.json`);
    expect(JSON.parse(fs.readFileSync(archivo, 'utf8')).registros).toHaveLength(1);

    const bloqueado = await api('POST', '/api/registros', registro(`${mesB}-01`));
    expect(bloqueado.status).toBe(409);
    expect(bloqueado.json).toMatchObject({ codigo: 'CIERRE_PENDIENTE', meses: [mesA] });

    const cierre = await api('POST', `/api/cierres/${mesA}`);
    expect(cierre.status).toBe(200);
    expect(cierre.json.cierre.resumen).toMatchObject({ registros: 1, ingresoUSD: 50 });
    const xlsx = await api('PUT', `/api/cierres/${mesA}/archivos/${encodeURIComponent('Registro de pagos.xlsx')}`, undefined, new Uint8Array([80, 75, 3, 4]));
    expect(xlsx.json).toMatchObject({ ok: true, guardado: true });
    const dirCierre = fs.readdirSync(path.join(docs, 'Komplex Gerencia', 'cierres'))[0];
    expect(fs.readdirSync(path.join(docs, 'Komplex Gerencia', 'cierres', dirCierre)).sort())
      .toEqual(['Registro de pagos.xlsx', 'datos del mes.json']);

    expect((await api('POST', '/api/registros', registro(`${mesB}-01`))).status).toBe(200);
    expect((await api('PUT', `/api/registros/${r.json.registro.id}`, registro(`${mesA}-10`))).json.codigo).toBe('MES_CERRADO');
  });

  it('el código gerencial abre 24 h y el incorrecto no', async () => {
    token = (await api('POST', '/api/login', { nombre: 'Ana', clave: 'komplex1' })).json.token;
    expect((await api('POST', '/api/gerencial', { codigo: 'nop' })).status).toBe(401);
    const g = await api('POST', '/api/gerencial', { codigo: 'amoaadriano' });
    expect(Date.parse(g.json.gerencialHasta) - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    expect((await api('GET', '/api/estado')).json.gerencialHasta).toBeTruthy();
  });

  it('no deja entrar con una clave equivocada ni sin sesión', async () => {
    expect((await api('POST', '/api/login', { nombre: 'X', clave: 'mala' })).status).toBe(401);
    expect((await api('GET', '/api/datos')).json.codigo).toBe('SIN_SESION');
  });

  it('el programa de escritorio lee lo que escribió la versión web', async () => {
    const { Almacen } = await import('../../../server/src/almacen/almacen.js');
    const a = new Almacen(path.join(docs, 'Komplex Gerencia'));
    expect(a.datos().registros).toHaveLength(2);
    expect(a.config.cierres[mesA]).toBeTruthy();
  });
});

describe('carpeta compartida con el programa de escritorio', () => {
  it('abre en la web una carpeta creada por el escritorio, con la misma clave', async () => {
    // El escritorio crea la carpeta y registra un pago.
    const { Almacen } = await import('../../../server/src/almacen/almacen.js');
    const { cifrarClave } = await import('../../../server/src/sesiones.js');
    const { crearRegistro } = await import('../../../server/src/dominio/operaciones.js');
    const carpeta = path.join(tmp, 'Escritorio', 'Komplex Gerencia');
    const a = new Almacen(carpeta);
    a.config.clave = cifrarClave('desde-escritorio');
    a.guardarConfig();
    crearRegistro(a, { nombre: 'Luis', gerencial: false }, registro(`${mesActual}-01`, { afiliado: 'Carlos Díaz' }));

    // Un navegador nuevo elige esa carpeta.
    reiniciarServidorLocal(persistenciaMemoria());
    elegida = new DirNode(path.dirname(carpeta));
    const rev = await api('POST', '/api/carpeta/elegir');
    expect(rev.json).toMatchObject({ ruta: 'Komplex Gerencia', tieneDatos: true, tieneClave: true, registros: 1 });
    const c = await api('POST', '/api/carpeta/configurar', { nombre: 'Ana' });
    expect(c.json.token).toBeNull();   // hay que entrar con la clave de la carpeta
    const l = await api('POST', '/api/login', { nombre: 'Ana', clave: 'desde-escritorio' });
    expect(l.status).toBe(200);
    token = l.json.token;
    const d = await api('GET', '/api/datos');
    expect(d.json.registros.map((r: { afiliado: string }) => r.afiliado)).toEqual(['Carlos Díaz']);
    const est = await api('GET', '/api/estado');
    expect(est.json).toMatchObject({ web: true, carpeta: 'Komplex Gerencia', carpetaEstado: 'conectada' });
  });
});

describe('sin carpeta y reconexión', () => {
  it('funciona solo en el navegador (iPhone, Firefox…)', async () => {
    reiniciarServidorLocal(persistenciaMemoria());
    const c = await api('POST', '/api/carpeta/configurar', { sinCarpeta: true, clave: '1234', nombre: 'Ana' });
    token = c.json.token;
    expect((await api('POST', '/api/registros', registro(`${mesActual}-02`))).status).toBe(200);
    const est = await api('GET', '/api/estado');
    expect(est.json).toMatchObject({ carpeta: '', carpetaEstado: 'sin-carpeta' });
    const resp = await api('GET', '/api/respaldos');
    expect(resp.json.carpeta).toBe('este navegador');
    expect(resp.json.archivos.length).toBeGreaterThan(0);
  });

  it('las sesiones y los datos sobreviven a cerrar y abrir el navegador', async () => {
    const p = persistenciaMemoria();
    reiniciarServidorLocal(p);
    token = (await api('POST', '/api/carpeta/configurar', { sinCarpeta: true, clave: '1234', nombre: 'Ana' })).json.token;
    await api('POST', '/api/registros', registro(`${mesActual}-03`));
    const guardado = token;
    reiniciarServidorLocal(p);   // "se cerró y se abrió el navegador"
    token = guardado;
    expect((await api('GET', '/api/datos')).json.registros).toHaveLength(1);
  });

  it('si la carpeta y el navegador cambiaron a la vez, pregunta; si no, sincroniza solo', async () => {
    const p = persistenciaMemoria();
    reiniciarServidorLocal(p);
    const base = path.join(tmp, 'Sync');
    fs.mkdirSync(base);
    elegida = new DirNode(base);
    await api('POST', '/api/carpeta/elegir');
    token = (await api('POST', '/api/carpeta/configurar', { clave: '1234', nombre: 'Ana' })).json.token;
    await api('POST', '/api/registros', registro(`${mesActual}-04`));

    // Se cierra el navegador; al volver, el permiso de la carpeta hay que darlo de nuevo.
    const guardado = token;
    const carpetaGuardada = await p.leer<DirNode>('carpeta');
    carpetaGuardada!.permisoConcedido = false;
    reiniciarServidorLocal(p);
    token = guardado;
    expect((await api('GET', '/api/estado')).json.carpetaEstado).toBe('sin-permiso');

    // Mientras tanto: un pago en el navegador…
    await api('POST', '/api/registros', registro(`${mesActual}-05`, { afiliado: 'Solo navegador' }));
    // …y la carpeta modificada por el programa de escritorio.
    const { Almacen } = await import('../../../server/src/almacen/almacen.js');
    const { crearRegistro } = await import('../../../server/src/dominio/operaciones.js');
    const esc = new Almacen(path.join(base, 'Komplex Gerencia'));
    await new Promise((r) => setTimeout(r, 2200));
    crearRegistro(esc, { nombre: 'Luis', gerencial: false }, registro(`${mesActual}-06`, { afiliado: 'Solo escritorio' }));

    const c = await api('POST', '/api/carpeta/conectar');
    expect(c.json.resultado).toBe('conflicto');
    expect(c.json.navegador.registros).toBe(2);
    expect(c.json.carpetaDatos.registros).toBe(2);
    await api('POST', '/api/carpeta/resolver', { usar: 'carpeta' });
    const nombres = (await api('GET', '/api/datos')).json.registros.map((r: { afiliado: string }) => r.afiliado).sort();
    expect(nombres).toEqual(['María Pérez', 'Solo escritorio']);
    expect((await api('GET', '/api/estado')).json.carpetaEstado).toBe('conectada');
  });
});
