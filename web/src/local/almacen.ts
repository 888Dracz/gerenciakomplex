/**
 * almacen.ts — Los datos de la versión web: en memoria mientras se usa, en el
 * navegador (IndexedDB) como copia de trabajo y, si se eligió, en la carpeta
 * de datos con el mismo formato que el programa de escritorio.
 *
 * Sincronización con la carpeta (cuando no está conectada, por ejemplo porque
 * el navegador pide volver a dar permiso, los cambios se guardan igual en el
 * navegador y se pasan a la carpeta al reconectarla):
 *  - si solo cambió el navegador  → se escribe todo en la carpeta;
 *  - si solo cambió la carpeta (la usó el programa de escritorio u otro
 *    navegador) → se cargan los datos de la carpeta;
 *  - si cambiaron los dos → se pregunta con cuáles quedarse.
 */
import { mesesConDatos } from '@dominio/calculos';
import { esMes, hoyISO, mesDe, mesesEnRango } from '@dominio/fechas';
import {
  BITACORA_MAX, LEEME, carpetaDelCierre, esRespaldo, mesEstaVacio, mesVacio, normalizarMes,
  type AlmacenDatos, type Respaldo,
} from '@dominio/operaciones';
import { configInicial, datosVacios, type Configuracion, type Datos, type DatosMes } from '@dominio/tipos';
import {
  SUB, borrarArchivo, escribirArchivo, leerJson, leerTexto, listarArchivos, permiso, soportaCarpetas, tieneDatos,
  ultimaModificacion, type Dir,
} from './carpeta';
import type { Persistencia } from './persistencia';

export type EstadoCarpeta = 'sin-soporte' | 'sin-carpeta' | 'conectada' | 'sin-permiso' | 'error';
export type ResultadoSincronizar = 'igual' | 'subido' | 'bajado' | 'conflicto';

interface Meta {
  /** Última vez que esta pestaña escribió en la carpeta (ms). */
  ultimaEscrituraCarpeta: number;
  /** Hay cambios guardados solo en el navegador (pendientes de pasar a la carpeta). */
  cambiosSinCarpeta: boolean;
  ultimoRespaldoCarpeta?: string;
  ultimoRespaldoNavegador?: string;
  nombreCarpeta?: string;
  ultimoGuardado?: string;
}

const META_INICIAL: Meta = { ultimaEscrituraCarpeta: 0, cambiosSinCarpeta: false };
const RESPALDOS_CARPETA = 60;
const RESPALDOS_NAVEGADOR = 14;
const MARGEN_MS = 2000;

export interface ResumenDatos { registros: number; meses: number; ultimaFecha: string | null }

const json = (v: unknown) => JSON.stringify(v, null, 1);

export class AlmacenWeb implements AlmacenDatos {
  config: Configuracion;
  private meses = new Map<string, DatosMes>();
  private sucios = new Set<string>();
  private meta: Meta;
  carpeta: Dir | null;
  estadoCarpeta: EstadoCarpeta;
  errorCarpeta: string | null = null;

  private constructor(private p: Persistencia, config: Configuracion, meses: DatosMes[], meta: Meta, carpeta: Dir | null) {
    this.config = config;
    for (const m of meses) this.meses.set(m.mes, m);
    this.meta = meta;
    this.carpeta = carpeta;
    this.estadoCarpeta = carpeta ? 'sin-permiso' : soportaCarpetas() ? 'sin-carpeta' : 'sin-soporte';
  }

  /** Lo guardado en este navegador, o null si todavía no se configuró. */
  static async cargar(p: Persistencia): Promise<AlmacenWeb | null> {
    const config = await p.leer<Configuracion>('config');
    if (!config) return null;
    const meses: DatosMes[] = [];
    for (const k of await p.claves('mes:')) {
      const mes = k.slice(4);
      if (esMes(mes)) meses.push(normalizarMes(mes, await p.leer<DatosMes>(k)));
    }
    const meta = { ...META_INICIAL, ...(await p.leer<Meta>('meta')) };
    const carpeta = (await p.leer<Dir>('carpeta')) ?? null;
    const a = new AlmacenWeb(p, { ...configInicial(new Date().toISOString()), ...config }, meses, meta, carpeta);
    if (carpeta) {
      // Sin un toque de la persona solo se puede consultar el permiso, no pedirlo.
      try {
        if (await permiso(carpeta, false)) a.estadoCarpeta = 'conectada';
      } catch { a.estadoCarpeta = 'sin-permiso'; }
    }
    return a;
  }

  /** Crea los datos de este navegador (vacíos o a partir de una carpeta/respaldo). */
  static async crear(p: Persistencia, config: Configuracion, meses: DatosMes[] = []): Promise<AlmacenWeb> {
    const a = new AlmacenWeb(p, config, meses.map((m) => normalizarMes(m.mes, m)), { ...META_INICIAL }, null);
    a.sucios.add('config');
    for (const m of meses) a.sucios.add(m.mes);
    await a.persistir();
    return a;
  }

  // ---------------------------------------------------------------- lectura (igual que el escritorio)
  mes(mes: string): DatosMes {
    let m = this.meses.get(mes);
    if (!m) {
      m = mesVacio(mes);
      this.meses.set(mes, m);
    }
    return m;
  }

  datos(desde?: string, hasta?: string): Datos {
    const out = datosVacios();
    const meses = desde && hasta ? mesesEnRango(desde, hasta) : [...this.meses.keys()].sort();
    const dentro = (f: string) => (!desde || f >= desde) && (!hasta || f <= hasta);
    for (const k of meses) {
      const m = this.meses.get(k);
      if (!m) continue;
      out.registros.push(...m.registros.filter((r) => dentro(r.fecha)));
      out.movimientos.push(...m.movimientos.filter((x) => dentro(x.fecha)));
      out.aperturas.push(...m.aperturas.filter((x) => dentro(x.fecha)));
      out.cuadres.push(...m.cuadres.filter((x) => dentro(x.fecha)));
      for (const [f, t] of Object.entries(m.tasas)) if (dentro(f)) out.tasas[f] = t;
    }
    return out;
  }

  mesesConDatos(): string[] {
    return mesesConDatos(this.datos());
  }

  get nombreCarpeta(): string | null {
    return this.carpeta?.name ?? this.meta.nombreCarpeta ?? null;
  }

  get ultimoGuardado(): string | null {
    return this.meta.ultimoGuardado ?? null;
  }

  get ultimoRespaldo(): string | null {
    return this.meta.ultimoRespaldoCarpeta ?? this.meta.ultimoRespaldoNavegador ?? null;
  }

  resumen(): ResumenDatos {
    const regs = this.datos().registros;
    return {
      registros: regs.length,
      meses: this.mesesConDatos().length,
      ultimaFecha: regs.reduce<string | null>((m, r) => (!m || r.fecha > m ? r.fecha : m), null),
    };
  }

  // ---------------------------------------------------------------- escritura (marca y guarda al final)
  guardarConfig(): void { this.sucios.add('config'); }

  guardarFechas(...fechas: string[]): void {
    for (const f of fechas) this.sucios.add(mesDe(f));
  }

  bitacora(usuario: string, accion: string, detalle: string): void {
    this.config.bitacora.push({ fecha: new Date().toISOString(), usuario, accion, detalle });
    if (this.config.bitacora.length > BITACORA_MAX) this.config.bitacora.splice(0, this.config.bitacora.length - BITACORA_MAX);
    this.sucios.add('config');
  }

  /** Guarda lo marcado: primero en el navegador y después en la carpeta. */
  async persistir(): Promise<void> {
    if (!this.sucios.size) return;
    const claves = [...this.sucios];
    this.sucios.clear();
    for (const k of claves) {
      if (k === 'config') await this.p.escribir('config', this.config);
      else {
        const m = this.meses.get(k);
        if (!m || mesEstaVacio(m)) {
          this.meses.delete(k);
          await this.p.borrar(`mes:${k}`);
        } else await this.p.escribir(`mes:${k}`, m);
      }
    }
    this.meta.ultimoGuardado = new Date().toISOString();
    await this.respaldoNavegador();
    if (this.estadoCarpeta === 'conectada' && this.carpeta) {
      try {
        await this.escribirEnCarpeta(claves);
      } catch (e) {
        this.marcarErrorCarpeta(e);
      }
    } else if (this.carpeta) {
      this.meta.cambiosSinCarpeta = true;
    }
    await this.p.escribir('meta', this.meta);
  }

  private marcarErrorCarpeta(e: unknown): void {
    this.meta.cambiosSinCarpeta = true;
    const nombre = (e as DOMException)?.name;
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
      this.estadoCarpeta = 'sin-permiso';
      this.errorCarpeta = null;
    } else {
      this.estadoCarpeta = 'error';
      this.errorCarpeta = nombre === 'NotFoundError'
        ? 'No se encontró la carpeta (¿se movió o se borró?). Elige la carpeta otra vez.'
        : `No se pudo escribir en la carpeta: ${(e as Error)?.message ?? e}`;
    }
  }

  private async escribirEnCarpeta(claves: string[]): Promise<void> {
    const dir = this.carpeta!;
    for (const k of claves) {
      if (k === 'config') await escribirArchivo(dir, [SUB.datos, 'configuracion.json'], json(this.config));
      else {
        const m = this.meses.get(k);
        if (m && !mesEstaVacio(m)) await escribirArchivo(dir, [SUB.datos, `${k}.json`], json(m));
        else await borrarArchivo(dir, [SUB.datos, `${k}.json`]);
      }
    }
    await this.respaldoCarpeta(false);
    this.meta.ultimaEscrituraCarpeta = Date.now();
    this.meta.cambiosSinCarpeta = false;
  }

  // ---------------------------------------------------------------- respaldos
  respaldo(): Respaldo {
    return {
      app: 'gerencia-komplex',
      version: 1,
      creado: new Date().toISOString(),
      config: this.config,
      meses: [...this.meses.keys()].sort().map((k) => this.meses.get(k)!).filter((m) => !mesEstaVacio(m)),
    };
  }

  /** Una copia por día también dentro del navegador (se guardan 14). */
  private async respaldoNavegador(): Promise<void> {
    const hoy = hoyISO();
    if (this.meta.ultimoRespaldoNavegador?.startsWith(hoy)) return;
    await this.p.escribir(`respaldo:${hoy}`, this.respaldo());
    this.meta.ultimoRespaldoNavegador = new Date().toISOString();
    const viejos = (await this.p.claves('respaldo:')).sort();
    for (const k of viejos.slice(0, Math.max(0, viejos.length - RESPALDOS_NAVEGADOR))) await this.p.borrar(k);
  }

  /** Copia del día en respaldos/AAAA-MM-DD.json de la carpeta (se guardan 60). */
  async respaldoCarpeta(forzar: boolean): Promise<void> {
    if (!this.carpeta || this.estadoCarpeta !== 'conectada') return;
    const hoy = hoyISO();
    if (!forzar && this.meta.ultimoRespaldoCarpeta?.startsWith(hoy)) return;
    await escribirArchivo(this.carpeta, [SUB.respaldos, `${hoy}.json`], json(this.respaldo()));
    this.meta.ultimoRespaldoCarpeta = new Date().toISOString();
    const lista = (await listarArchivos(this.carpeta, SUB.respaldos)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.nombre));
    for (const f of lista.slice(0, Math.max(0, lista.length - RESPALDOS_CARPETA))) {
      await borrarArchivo(this.carpeta, [SUB.respaldos, f.nombre]);
    }
  }

  async listarRespaldos(): Promise<{ carpeta: string; archivos: string[] }> {
    if (this.carpeta && this.estadoCarpeta === 'conectada') {
      const lista = await listarArchivos(this.carpeta, SUB.respaldos);
      return { carpeta: `${this.carpeta.name}/${SUB.respaldos}`, archivos: lista.map((f) => f.nombre).reverse().slice(0, 100) };
    }
    const claves = (await this.p.claves('respaldo:')).sort().reverse();
    return { carpeta: 'este navegador', archivos: claves.map((k) => `${k.slice(9)}.json`) };
  }

  /** Reemplaza todos los datos por los de un respaldo (antes guarda una copia de lo actual). */
  async restaurar(r: Respaldo): Promise<void> {
    if (!esRespaldo(r)) throw new Error('Ese archivo no es un respaldo de Gerencia Komplex.');
    const antes = this.respaldo();
    await this.p.escribir(`respaldo:antes-de-restaurar`, antes);
    if (this.carpeta && this.estadoCarpeta === 'conectada') {
      await escribirArchivo(this.carpeta, [SUB.respaldos, `antes-de-restaurar-${new Date().toISOString().replace(/[:.]/g, '-')}.json`], json(antes));
    }
    const clave = this.config.clave;
    for (const k of this.meses.keys()) this.sucios.add(k);
    this.config = { ...configInicial(new Date().toISOString()), ...r.config, clave: r.config.clave ?? clave };
    this.meses.clear();
    for (const m of r.meses) {
      if (!esMes(m.mes)) continue;
      this.meses.set(m.mes, normalizarMes(m.mes, m));
      this.sucios.add(m.mes);
    }
    this.sucios.add('config');
    await this.persistir();
  }

  // ---------------------------------------------------------------- carpeta
  /**
   * Usa esta carpeta. Si la persona ya la eligió con un toque, el permiso ya
   * está; si no, se pide (por eso solo se llama desde un botón).
   */
  async conectar(dir: Dir, recienLeida = false): Promise<ResultadoSincronizar> {
    if (!(await permiso(dir, true))) {
      this.carpeta = dir;
      this.estadoCarpeta = 'sin-permiso';
      await this.p.escribir('carpeta', dir);
      throw new Error('Sin permiso para escribir en esa carpeta.');
    }
    const otra = !this.carpeta || this.carpeta.name !== dir.name || this.meta.nombreCarpeta !== dir.name;
    this.carpeta = dir;
    this.estadoCarpeta = 'conectada';
    this.errorCarpeta = null;
    if (otra) this.meta.ultimaEscrituraCarpeta = 0;
    this.meta.nombreCarpeta = dir.name;
    if (recienLeida) {
      // Los datos de este navegador se acaban de cargar desde esa carpeta: ya están iguales.
      this.meta.ultimaEscrituraCarpeta = Math.max(Date.now(), await ultimaModificacion(dir));
      this.meta.cambiosSinCarpeta = false;
    }
    await this.p.escribir('carpeta', dir);
    await this.p.escribir('meta', this.meta);
    return recienLeida ? 'bajado' : this.sincronizar();
  }

  /** Vuelve a pedir el permiso de la carpeta ya elegida (botón "Conectar carpeta"). */
  async reconectar(): Promise<ResultadoSincronizar> {
    if (!this.carpeta) throw new Error('No hay carpeta elegida.');
    return this.conectar(this.carpeta);
  }

  async desconectar(): Promise<void> {
    this.carpeta = null;
    this.meta.nombreCarpeta = undefined;
    this.meta.ultimaEscrituraCarpeta = 0;
    this.estadoCarpeta = soportaCarpetas() ? 'sin-carpeta' : 'sin-soporte';
    await this.p.borrar('carpeta');
    await this.p.escribir('meta', this.meta);
  }

  async sincronizar(): Promise<ResultadoSincronizar> {
    const dir = this.carpeta;
    if (!dir || this.estadoCarpeta !== 'conectada') return 'igual';
    try {
      if (!(await tieneDatos(dir))) {
        await this.subirTodo();
        return 'subido';
      }
      const ultima = await ultimaModificacion(dir);
      const carpetaCambio = ultima > this.meta.ultimaEscrituraCarpeta + MARGEN_MS;
      const navegadorCambio = this.meta.cambiosSinCarpeta || (this.meta.ultimaEscrituraCarpeta === 0 && this.resumen().registros > 0);
      if (carpetaCambio && navegadorCambio) return 'conflicto';
      if (carpetaCambio) { await this.bajarTodo(); return 'bajado'; }
      if (navegadorCambio) { await this.subirTodo(); return 'subido'; }
      return 'igual';
    } catch (e) {
      this.marcarErrorCarpeta(e);
      await this.p.escribir('meta', this.meta);
      throw e;
    }
  }

  /** Resolver un conflicto: quedarse con lo de la carpeta o con lo del navegador. */
  async resolver(usar: 'carpeta' | 'navegador'): Promise<void> {
    if (usar === 'carpeta') await this.bajarTodo();
    else await this.subirTodo();
  }

  /** Escribe todo lo del navegador en la carpeta (y quita meses que ya no existen). */
  async subirTodo(): Promise<void> {
    const dir = this.carpeta!;
    const presentes = new Set([...this.meses.values()].filter((m) => !mesEstaVacio(m)).map((m) => `${m.mes}.json`));
    for (const f of await listarArchivos(dir, SUB.datos)) {
      if (/^\d{4}-\d{2}\.json$/.test(f.nombre) && !presentes.has(f.nombre)) await borrarArchivo(dir, [SUB.datos, f.nombre]);
    }
    if ((await leerTexto(dir, ['LEEME.txt'])) === null) await escribirArchivo(dir, ['LEEME.txt'], LEEME.replace(/\n/g, '\r\n'));
    await this.escribirEnCarpeta(['config', ...this.meses.keys()]);
    await this.respaldoCarpeta(true);
    await this.p.escribir('meta', this.meta);
  }

  /** Carga en el navegador los datos de la carpeta (reemplaza los de aquí). */
  async bajarTodo(): Promise<void> {
    const dir = this.carpeta!;
    const leidos = await leerCarpeta(dir);
    if (!leidos) throw new Error('La carpeta no tiene datos de Gerencia Komplex.');
    // Copia de seguridad de lo que había en el navegador antes de reemplazarlo.
    await this.p.escribir('respaldo:antes-de-cargar-carpeta', this.respaldo());
    for (const k of await this.p.claves('mes:')) await this.p.borrar(k);
    this.config = leidos.config;
    this.meses.clear();
    for (const m of leidos.meses) this.meses.set(m.mes, m);
    await this.p.escribir('config', this.config);
    for (const m of leidos.meses) await this.p.escribir(`mes:${m.mes}`, m);
    this.meta.ultimaEscrituraCarpeta = Math.max(Date.now(), await ultimaModificacion(dir));
    this.meta.cambiosSinCarpeta = false;
    await this.p.escribir('meta', this.meta);
  }

  /** Al cerrar un mes: copia de sus datos en cierres/AAAA-MM Mes/. */
  async escribirCierre(mes: string, nombre: string, contenido: string | Uint8Array): Promise<boolean> {
    if (!this.carpeta || this.estadoCarpeta !== 'conectada') return false;
    try {
      await escribirArchivo(this.carpeta, [SUB.cierres, carpetaDelCierre(mes), nombre], contenido);
      return true;
    } catch (e) {
      this.marcarErrorCarpeta(e);
      return false;
    }
  }

  /** Vuelve a leer lo guardado (otra pestaña cambió algo). */
  async recargar(): Promise<void> {
    const otro = await AlmacenWeb.cargar(this.p);
    if (!otro) return;
    this.config = otro.config;
    this.meses = otro.meses;
    this.meta = otro.meta;
  }
}

/** Lee la configuración y los meses de una carpeta (null si no es de Komplex). */
export async function leerCarpeta(dir: Dir): Promise<{ config: Configuracion; meses: DatosMes[] } | null> {
  const config = await leerJson<Configuracion>(dir, [SUB.datos, 'configuracion.json']);
  if (!config) return null;
  const meses: DatosMes[] = [];
  for (const f of await listarArchivos(dir, SUB.datos)) {
    const m = f.nombre.match(/^(\d{4}-\d{2})\.json$/);
    if (m && esMes(m[1])) meses.push(normalizarMes(m[1], await leerJson<DatosMes>(dir, [SUB.datos, f.nombre])));
  }
  return { config: { ...configInicial(new Date().toISOString()), ...config }, meses };
}
