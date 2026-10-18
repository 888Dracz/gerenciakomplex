/**
 * almacen.ts — Los datos en memoria y su guardado automático en la carpeta.
 *
 * Al arrancar se leen todos los meses (son pocos y pequeños). Cada cambio se
 * escribe en el acto en el archivo de su mes: no hay botón "Guardar" ni nada
 * que se pierda si se cierra la ventana.
 *
 * Node atiende una petición entera antes de pasar a la siguiente y todas las
 * escrituras son síncronas, así que dos personas guardando a la vez nunca se
 * pisan.
 */
import fs from 'node:fs';
import path from 'node:path';

import { RESPALDOS_A_CONSERVAR } from '../config.js';
import { mesesConDatos } from '../dominio/calculos.js';
import { esMes, hoyISO, mesDe, mesesEnRango } from '../dominio/fechas.js';
import {
  configInicial, datosVacios,
  type Configuracion, type Datos, type DatosMes, type EntradaBitacora,
} from '../dominio/tipos.js';
import {
  BITACORA_MAX, esRespaldo, mesEstaVacio, mesVacio, normalizarMes, type AlmacenDatos, type Respaldo,
} from '../dominio/operaciones.js';
import { escribirJson, leerJson } from './archivos.js';
import { SUB, prepararCarpeta, rutaConfig, rutaMes } from './carpeta.js';

export { mesVacio };

export class Almacen implements AlmacenDatos {
  readonly carpeta: string;
  config: Configuracion;
  private meses = new Map<string, DatosMes>();
  ultimoGuardado: string | null = null;
  ultimoRespaldo: string | null = null;

  constructor(carpeta: string) {
    this.carpeta = carpeta;
    prepararCarpeta(carpeta);
    const cfg = leerJson<Configuracion>(rutaConfig(carpeta));
    this.config = cfg ? { ...configInicial(new Date().toISOString()), ...cfg } : configInicial(new Date().toISOString());
    if (!cfg) this.guardarConfig();
    for (const f of fs.readdirSync(path.join(carpeta, SUB.datos))) {
      const m = f.match(/^(\d{4}-\d{2})\.json$/);
      if (!m || !esMes(m[1])) continue;
      this.meses.set(m[1], normalizarMes(m[1], leerJson<DatosMes>(path.join(carpeta, SUB.datos, f))));
    }
  }

  // ---------------------------------------------------------------- lectura
  /** Datos de un mes (lo crea vacío en memoria si no existe). */
  mes(mes: string): DatosMes {
    let m = this.meses.get(mes);
    if (!m) {
      m = mesVacio(mes);
      this.meses.set(mes, m);
    }
    return m;
  }

  /** Todo, o solo el rango pedido (filtrado por fecha). */
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

  // ---------------------------------------------------------------- escritura
  guardarConfig(): void {
    escribirJson(rutaConfig(this.carpeta), this.config);
    this.ultimoGuardado = new Date().toISOString();
  }

  guardarMes(mes: string): void {
    const m = this.mes(mes);
    const ruta = rutaMes(this.carpeta, mes);
    if (mesEstaVacio(m)) {
      // Un mes que se quedó sin nada no deja archivo: si no, contaría como mes con datos.
      try { fs.unlinkSync(ruta); } catch { /* no existía */ }
      this.meses.delete(mes);
    } else {
      escribirJson(ruta, m);
    }
    this.ultimoGuardado = new Date().toISOString();
  }

  /** Guarda el mes de una fecha (y el de otra, si un registro cambió de mes). */
  guardarFechas(...fechas: string[]): void {
    for (const mes of new Set(fechas.map(mesDe))) this.guardarMes(mes);
  }

  bitacora(usuario: string, accion: string, detalle: string): void {
    const e: EntradaBitacora = { fecha: new Date().toISOString(), usuario, accion, detalle };
    this.config.bitacora.push(e);
    if (this.config.bitacora.length > BITACORA_MAX) {
      this.config.bitacora.splice(0, this.config.bitacora.length - BITACORA_MAX);
    }
    this.guardarConfig();
  }

  // ---------------------------------------------------------------- respaldos
  respaldo(): Respaldo {
    return {
      app: 'gerencia-komplex',
      version: 1,
      creado: new Date().toISOString(),
      config: this.config,
      meses: [...this.meses.keys()].sort().map((k) => this.meses.get(k)!),
    };
  }

  /**
   * Copia diaria en respaldos/AAAA-MM-DD.json. Idempotente: si la del día ya
   * existe no hace nada (salvo `forzar`). Conserva las últimas 60.
   */
  respaldar(forzar = false): string | null {
    const dir = path.join(this.carpeta, SUB.respaldos);
    const destino = path.join(dir, `${hoyISO()}.json`);
    if (!forzar && fs.existsSync(destino)) return null;
    escribirJson(destino, this.respaldo());
    this.ultimoRespaldo = new Date().toISOString();
    const viejos = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of viejos.slice(0, Math.max(0, viejos.length - RESPALDOS_A_CONSERVAR))) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* lo intentará mañana */ }
    }
    return destino;
  }

  /** Reemplaza todos los datos por los de un respaldo (antes guarda una copia de lo actual). */
  restaurar(r: Respaldo): void {
    const dir = path.join(this.carpeta, SUB.respaldos);
    escribirJson(path.join(dir, `antes-de-restaurar-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), this.respaldo());
    const clave = this.config.clave;
    this.config = { ...configInicial(new Date().toISOString()), ...r.config, clave: r.config.clave ?? clave };
    this.guardarConfig();
    for (const k of [...this.meses.keys()]) {
      try { fs.unlinkSync(rutaMes(this.carpeta, k)); } catch { /* no estaba */ }
    }
    this.meses.clear();
    for (const m of r.meses) {
      if (!esMes(m.mes)) continue;
      this.meses.set(m.mes, normalizarMes(m.mes, m));
      this.guardarMes(m.mes);
    }
  }
}

export { esRespaldo, type Respaldo };
