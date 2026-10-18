/**
 * operaciones.ts — Lo que hace cada acción del programa (registrar, verificar
 * una transferencia, cuadrar la caja, cerrar el mes…), sin saber dónde se
 * guarda.
 *
 * La usan las dos versiones:
 *  - el programa de escritorio (servidor Node, `rutas/`), que guarda en la
 *    carpeta de datos con `fs`;
 *  - la versión web (GitHub Pages, `web/src/local/`), que guarda en el
 *    navegador y en la carpeta elegida con la API de archivos del navegador.
 * Así las reglas (cierre de mes, validación, cuadre, bitácora) son las mismas
 * en las dos, y los archivos de la carpeta tienen el mismo formato.
 *
 * Nada aquí importa Node ni el navegador.
 */
import { cajaDelDia, diferencias, lineasTransferencia, r2, resumen, resumirTransferencias } from './calculos.js';
import { esFecha, esMes, mesDe, nombreMes, ultimoDiaMes } from './fechas.js';
import { bloqueoEdicion, bloqueoEscritura, mesesPorCerrar, puedeCerrar, type Bloqueo } from './periodos.js';
import {
  esTransferencia,
  type Apertura, type Cierre, type ConfigPublica, type Configuracion, type Cuadre, type Datos, type DatosMes,
  type Movimiento, type Plan, type Registro,
} from './tipos.js';
import {
  ErrorValidacion, limpiarEfectivo, limpiarEstado, limpiarLista, limpiarMovimiento, limpiarRegistro,
} from './validar.js';

/** Error con código HTTP: el servidor lo responde tal cual; la versión web igual. */
export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = { error: message, ...extra };
  }
}

/** Lo mínimo que una operación necesita del almacén (memoria + guardado). */
export interface AlmacenDatos {
  config: Configuracion;
  mes(mes: string): DatosMes;
  datos(desde?: string, hasta?: string): Datos;
  mesesConDatos(): string[];
  guardarConfig(): void;
  /** Guarda el mes de cada fecha (el escritorio escribe al instante; la web en cola). */
  guardarFechas(...fechas: string[]): void;
  bitacora(usuario: string, accion: string, detalle: string): void;
}

/** Quién hace la acción. */
export interface Quien {
  nombre: string;
  /** Modo gerencial activo (24 h con el código): sin bloqueos de cierre. */
  gerencial: boolean;
}

type Cuerpo = Record<string, unknown>;

const ahora = () => new Date().toISOString();

/** Identificador corto y aleatorio (funciona en Node 22 y en el navegador). */
export function nuevoId(): string {
  const b = new Uint8Array(9);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fechaValida(v: unknown): string {
  if (!esFecha(v)) throw new ApiError(400, 'Fecha no válida.');
  return v;
}

export function configPublica(a: AlmacenDatos): ConfigPublica {
  const { clave: _c, bitacora: _b, ...resto } = a.config;
  return resto;
}

// ---------------------------------------------------------------- cierre de mes (regla de escritura)
function lanzar(b: Bloqueo): never {
  throw new ApiError(409, b.mensaje, {
    codigo: b.tipo === 'mes_cerrado' ? 'MES_CERRADO' : 'CIERRE_PENDIENTE',
    mes: b.mes,
    meses: b.tipo === 'cierre_pendiente' ? b.meses : [b.mes],
  });
}

const contexto = (a: AlmacenDatos, q: Quien) =>
  ({ mesesConDatos: a.mesesConDatos(), cierres: a.config.cierres, gerencial: q.gerencial });

/** Lanza 409 si la fecha está en un mes cerrado o hay meses anteriores por cerrar. */
export function exigirEscritura(a: AlmacenDatos, q: Quien, fecha: string): void {
  const b = bloqueoEscritura(contexto(a, q), fecha);
  if (b) lanzar(b);
}

export function exigirEdicion(a: AlmacenDatos, q: Quien, fechaAnterior: string, fechaNueva: string): void {
  const b = bloqueoEdicion(contexto(a, q), fechaAnterior, fechaNueva);
  if (b) lanzar(b);
}

/** Deja constancia en la bitácora cuando se toca un mes cerrado con el código gerencial. */
function notaMesCerrado(a: AlmacenDatos, q: Quien, fecha: string, detalle: string): void {
  if (a.config.cierres[mesDe(fecha)]) a.bitacora(q.nombre, 'Cambio en mes cerrado (gerencial)', detalle);
}

export function exigirGerencial(q: Quien): void {
  if (!q.gerencial) throw new ApiError(403, 'Esto requiere el código gerencial.', { codigo: 'REQUIERE_GERENCIAL' });
}

// ---------------------------------------------------------------- lectura
export function leerDatos(a: AlmacenDatos, desde?: string, hasta?: string): Datos {
  if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) throw new ApiError(400, 'Rango de fechas no válido.');
  return a.datos(desde, hasta);
}

export interface AfiliadoConocido { nombre: string; ultimoPlan: string; ultimaFecha: string; registros: number }

/** Afiliados ya registrados (para autocompletar y proponer Nuevo/Renovación). */
export function afiliados(a: AlmacenDatos): { afiliados: AfiliadoConocido[] } {
  const mapa = new Map<string, AfiliadoConocido>();
  for (const r of a.datos().registros) {
    const k = r.afiliado.trim().toLowerCase();
    const x = mapa.get(k) ?? { nombre: r.afiliado, ultimoPlan: r.plan, ultimaFecha: r.fecha, registros: 0 };
    x.registros++;
    if (r.fecha >= x.ultimaFecha) { x.ultimaFecha = r.fecha; x.ultimoPlan = r.plan; x.nombre = r.afiliado; }
    mapa.set(k, x);
  }
  return { afiliados: [...mapa.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')) };
}

export const transferenciasPendientes = (a: AlmacenDatos): number =>
  lineasTransferencia(a.datos().registros).filter((l) => l.estado === 'pendiente').length;

// ---------------------------------------------------------------- registros
function buscarRegistro(a: AlmacenDatos, id: string): { reg: Registro; lista: Registro[] } {
  for (const mes of a.mesesConDatos()) {
    const lista = a.mes(mes).registros;
    const reg = lista.find((r) => r.id === id);
    if (reg) return { reg, lista };
  }
  throw new ApiError(404, 'Ese registro ya no existe (quizá alguien lo borró).');
}

const describir = (r: Pick<Registro, 'fecha' | 'afiliado' | 'plan' | 'tipo'>) =>
  `${r.fecha} · ${r.afiliado} · ${r.plan} (${r.tipo})`;

export function crearRegistro(a: AlmacenDatos, q: Quien, cuerpo: Cuerpo): { registro: Registro } {
  const limpio = limpiarRegistro(cuerpo, a.config);
  exigirEscritura(a, q, limpio.fecha);
  const reg: Registro = { id: nuevoId(), ...limpio, creadoPor: q.nombre, creadoEn: ahora() };
  a.mes(mesDe(reg.fecha)).registros.push(reg);
  a.guardarFechas(reg.fecha);
  notaMesCerrado(a, q, reg.fecha, `Registro creado: ${describir(reg)}`);
  return { registro: reg };
}

export function editarRegistro(a: AlmacenDatos, q: Quien, id: string, cuerpo: Cuerpo): { registro: Registro } {
  const { reg, lista } = buscarRegistro(a, id);
  const limpio = limpiarRegistro(cuerpo, a.config, reg);
  exigirEdicion(a, q, reg.fecha, limpio.fecha);
  const anterior = reg.fecha;
  const nuevo: Registro = { ...reg, ...limpio, editadoPor: q.nombre, editadoEn: ahora() };
  if (mesDe(anterior) === mesDe(nuevo.fecha)) {
    lista[lista.indexOf(reg)] = nuevo;
  } else {
    lista.splice(lista.indexOf(reg), 1);
    a.mes(mesDe(nuevo.fecha)).registros.push(nuevo);
  }
  a.guardarFechas(anterior, nuevo.fecha);
  a.bitacora(q.nombre, 'Registro editado', describir(nuevo));
  notaMesCerrado(a, q, anterior, `Registro editado: ${describir(nuevo)}`);
  return { registro: nuevo };
}

export function borrarRegistro(a: AlmacenDatos, q: Quien, id: string): { ok: true } {
  const { reg, lista } = buscarRegistro(a, id);
  exigirEscritura(a, q, reg.fecha);
  lista.splice(lista.indexOf(reg), 1);
  a.guardarFechas(reg.fecha);
  a.bitacora(q.nombre, 'Registro eliminado', `${describir(reg)} · ${JSON.stringify(reg.pagos)}`);
  notaMesCerrado(a, q, reg.fecha, `Registro eliminado: ${describir(reg)}`);
  return { ok: true };
}

/** Marcar si una transferencia llegó al banco. */
export function marcarTransferencia(a: AlmacenDatos, q: Quien, id: string, idxTxt: string, cuerpo: Cuerpo): { registro: Registro } {
  const { reg } = buscarRegistro(a, id);
  const pago = reg.pagos[Number(idxTxt)];
  if (!pago || !esTransferencia(pago.moneda)) throw new ApiError(400, 'Ese pago no es una transferencia.');
  exigirEscritura(a, q, reg.fecha);
  const estado = limpiarEstado(cuerpo.estado);
  pago.estado = estado;
  if (estado === 'pendiente') {
    delete pago.verificadoPor;
    delete pago.verificadoEn;
  } else {
    pago.verificadoPor = q.nombre;
    pago.verificadoEn = ahora();
  }
  a.guardarFechas(reg.fecha);
  if (estado === 'no_llego') {
    a.bitacora(q.nombre, 'Transferencia NO llegó', `${describir(reg)} · ${pago.moneda} ${pago.monto} · ref ${pago.referencia ?? ''}`);
  }
  notaMesCerrado(a, q, reg.fecha, `Transferencia marcada ${estado}: ${describir(reg)}`);
  return { registro: reg };
}

// ---------------------------------------------------------------- movimientos de caja
function buscarMovimiento(a: AlmacenDatos, id: string): { mov: Movimiento; lista: Movimiento[] } {
  for (const mes of a.mesesConDatos()) {
    const lista = a.mes(mes).movimientos;
    const mov = lista.find((m) => m.id === id);
    if (mov) return { mov, lista };
  }
  throw new ApiError(404, 'Ese movimiento ya no existe.');
}

export function crearMovimiento(a: AlmacenDatos, q: Quien, cuerpo: Cuerpo): { movimiento: Movimiento } {
  const limpio = limpiarMovimiento(cuerpo);
  exigirEscritura(a, q, limpio.fecha);
  const mov: Movimiento = { id: nuevoId(), ...limpio, creadoPor: q.nombre, creadoEn: ahora() };
  a.mes(mesDe(mov.fecha)).movimientos.push(mov);
  a.guardarFechas(mov.fecha);
  notaMesCerrado(a, q, mov.fecha, `Movimiento creado: ${mov.fecha} ${mov.tipo} ${mov.concepto}`);
  return { movimiento: mov };
}

export function editarMovimiento(a: AlmacenDatos, q: Quien, id: string, cuerpo: Cuerpo): { movimiento: Movimiento } {
  const { mov, lista } = buscarMovimiento(a, id);
  const limpio = limpiarMovimiento(cuerpo);
  exigirEdicion(a, q, mov.fecha, limpio.fecha);
  const anterior = mov.fecha;
  const nuevo: Movimiento = { ...mov, ...limpio, editadoPor: q.nombre, editadoEn: ahora() };
  if (mesDe(anterior) === mesDe(nuevo.fecha)) lista[lista.indexOf(mov)] = nuevo;
  else {
    lista.splice(lista.indexOf(mov), 1);
    a.mes(mesDe(nuevo.fecha)).movimientos.push(nuevo);
  }
  a.guardarFechas(anterior, nuevo.fecha);
  a.bitacora(q.nombre, 'Movimiento de caja editado', `${nuevo.fecha} · ${nuevo.tipo} · ${nuevo.concepto} · ${nuevo.moneda} ${nuevo.monto}`);
  notaMesCerrado(a, q, anterior, `Movimiento editado: ${nuevo.concepto}`);
  return { movimiento: nuevo };
}

export function borrarMovimiento(a: AlmacenDatos, q: Quien, id: string): { ok: true } {
  const { mov, lista } = buscarMovimiento(a, id);
  exigirEscritura(a, q, mov.fecha);
  lista.splice(lista.indexOf(mov), 1);
  a.guardarFechas(mov.fecha);
  a.bitacora(q.nombre, 'Movimiento de caja eliminado', `${mov.fecha} · ${mov.tipo} · ${mov.concepto} · ${mov.moneda} ${mov.monto}`);
  notaMesCerrado(a, q, mov.fecha, `Movimiento eliminado: ${mov.concepto}`);
  return { ok: true };
}

// ---------------------------------------------------------------- apertura, cuadre y tasas
export function guardarApertura(a: AlmacenDatos, q: Quien, fechaTxt: string, cuerpo: Cuerpo): { apertura: Apertura } {
  const fecha = fechaValida(fechaTxt);
  exigirEscritura(a, q, fecha);
  if (a.mes(mesDe(fecha)).cuadres.some((c) => c.fecha === fecha)) {
    throw new ApiError(409, 'La caja de ese día ya está cerrada. Reábrela para cambiar el fondo.');
  }
  const fondo = limpiarEfectivo(cuerpo.fondo);
  const lista = a.mes(mesDe(fecha)).aperturas;
  const i = lista.findIndex((x) => x.fecha === fecha);
  const ap: Apertura = { fecha, fondo, responsable: q.nombre, actualizadoEn: ahora() };
  if (i >= 0) lista[i] = ap;
  else lista.push(ap);
  a.guardarFechas(fecha);
  return { apertura: ap };
}

export function guardarCuadre(a: AlmacenDatos, q: Quien, fechaTxt: string, cuerpo: Cuerpo): { cuadre: Cuadre } {
  const fecha = fechaValida(fechaTxt);
  exigirEscritura(a, q, fecha);
  const contado = limpiarEfectivo(cuerpo.contado);
  const dia = a.datos(fecha, fecha);
  const caja = cajaDelDia(dia, fecha);
  const t = resumirTransferencias(lineasTransferencia(dia.registros));
  const cuadre: Cuadre = {
    fecha,
    contado,
    esperado: caja.esperado,
    diferencia: diferencias(contado, caja.esperado),
    totalDiaUSD: r2(caja.totalUSD),
    transferencias: { total: t.total, confirmadas: t.confirmadas, pendientes: t.pendientes, noLlegaron: t.noLlegaron },
    responsable: String(cuerpo.responsable ?? '').trim().slice(0, 60) || q.nombre,
    observaciones: String(cuerpo.observaciones ?? '').trim().slice(0, 1000),
    cerradoEn: ahora(),
  };
  const lista = a.mes(mesDe(fecha)).cuadres;
  const i = lista.findIndex((x) => x.fecha === fecha);
  if (i >= 0) lista[i] = cuadre;
  else lista.push(cuadre);
  a.guardarFechas(fecha);
  a.bitacora(q.nombre, i >= 0 ? 'Cuadre de caja rehecho' : 'Caja cerrada (cuadre)',
    `${fecha} · esperado ${JSON.stringify(cuadre.esperado)} · contado ${JSON.stringify(contado)}`);
  return { cuadre };
}

export function borrarCuadre(a: AlmacenDatos, q: Quien, fechaTxt: string): { ok: true } {
  const fecha = fechaValida(fechaTxt);
  exigirEscritura(a, q, fecha);
  const lista = a.mes(mesDe(fecha)).cuadres;
  const i = lista.findIndex((x) => x.fecha === fecha);
  if (i < 0) throw new ApiError(404, 'Ese día no tiene cuadre.');
  lista.splice(i, 1);
  a.guardarFechas(fecha);
  a.bitacora(q.nombre, 'Caja reabierta', fecha);
  return { ok: true };
}

export function guardarTasas(a: AlmacenDatos, q: Quien, fechaTxt: string, cuerpo: Cuerpo): { tasas: { Bs?: number; Cop?: number } } {
  const fecha = fechaValida(fechaTxt);
  exigirEscritura(a, q, fecha);
  const t: { Bs?: number; Cop?: number } = {};
  for (const k of ['Bs', 'Cop'] as const) {
    const n = Number(cuerpo[k]);
    if (cuerpo[k] !== undefined && cuerpo[k] !== null && cuerpo[k] !== '') {
      if (!(n > 0)) throw new ErrorValidacion(`La tasa de ${k} debe ser mayor que cero.`);
      t[k] = Number(n.toFixed(6));
    }
  }
  const m = a.mes(mesDe(fecha));
  if (Object.keys(t).length) m.tasas[fecha] = t;
  else delete m.tasas[fecha];
  a.guardarFechas(fecha);
  return { tasas: t };
}

// ---------------------------------------------------------------- configuración
export function cambiarConfig(a: AlmacenDatos, q: Quien, cuerpo: Cuerpo): { config: ConfigPublica } {
  const cambios: string[] = [];
  if (cuerpo.negocio !== undefined) {
    const n = String(cuerpo.negocio ?? '').trim().slice(0, 60);
    if (!n) throw new ErrorValidacion('Escribe el nombre del negocio.');
    a.config.negocio = n;
    cambios.push('nombre');
  }
  if (cuerpo.planes !== undefined) {
    if (!Array.isArray(cuerpo.planes)) throw new ErrorValidacion('Lista de planes no válida.');
    const vistos = new Set<string>();
    const planes: Plan[] = [];
    for (const x of cuerpo.planes as Record<string, unknown>[]) {
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
  if (cuerpo.bancos !== undefined) { a.config.bancos = limpiarLista(cuerpo.bancos); cambios.push('bancos'); }
  if (cuerpo.categoriasGasto !== undefined) {
    a.config.categoriasGasto = limpiarLista(cuerpo.categoriasGasto);
    if (!a.config.categoriasGasto.length) a.config.categoriasGasto = ['Otros'];
    cambios.push('categorías de gasto');
  }
  a.guardarConfig();
  if (cambios.length) a.bitacora(q.nombre, 'Configuración cambiada', cambios.join(', '));
  return { config: configPublica(a) };
}

// ---------------------------------------------------------------- cierre de mes
/** Nombre de la carpeta del cierre dentro de `cierres/`: "2026-09 Septiembre". */
export const carpetaDelCierre = (mes: string): string => `${mes} ${nombreMes(mes).split(' ')[0]}`;

/**
 * Cierra un mes. Devuelve el cierre y la copia de los datos del mes, que cada
 * versión deja en `cierres/AAAA-MM Mes/datos del mes.json`.
 */
export function cerrarMes(a: AlmacenDatos, q: Quien, mes: string, hoy: string): { cierre: Cierre; datosMes: DatosMes } {
  if (!esMes(mes)) throw new ApiError(400, 'Mes no válido.');
  const estado = { mesesConDatos: a.mesesConDatos(), cierres: a.config.cierres };
  const motivo = puedeCerrar(estado, mes, hoy);
  // Con el código gerencial se puede cerrar también el mes en curso, pero
  // nunca saltándose un mes anterior abierto.
  if (motivo && !(q.gerencial && !a.config.cierres[mes] && !mesesPorCerrar(estado, mes).length)) {
    throw new ApiError(409, motivo);
  }
  const r = resumen(a.datos(), `${mes}-01`, ultimoDiaMes(mes));
  const cierre: Cierre = {
    mes,
    cerradoEn: ahora(),
    cerradoPor: q.nombre,
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
  a.bitacora(q.nombre, 'Mes cerrado', `${nombreMes(mes)} · ingreso $${r.ingresoUSD} · ${r.afiliados} afiliados`);
  return { cierre, datosMes: a.mes(mes) };
}

export function reabrirMes(a: AlmacenDatos, q: Quien, mes: string): { ok: true } {
  exigirGerencial(q);
  if (!a.config.cierres[mes]) throw new ApiError(404, 'Ese mes no está cerrado.');
  const posteriores = Object.keys(a.config.cierres).filter((m) => m > mes);
  if (posteriores.length) {
    throw new ApiError(409, `Primero reabre ${posteriores.sort().reverse().map(nombreMes).join(', ')}.`);
  }
  delete a.config.cierres[mes];
  a.guardarConfig();
  a.bitacora(q.nombre, 'Mes reabierto (gerencial)', nombreMes(mes));
  return { ok: true };
}

/** Nombre de archivo seguro para Windows. */
export const nombreSeguro = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Valida el nombre de un archivo de cierre (solo .xlsx o .docx). */
export function nombreArchivoCierre(a: AlmacenDatos, mes: string, nombre: string): string {
  if (!esMes(mes) || !a.config.cierres[mes]) throw new ApiError(400, 'Ese mes no está cerrado.');
  const limpio = nombreSeguro(decodeURIComponent(nombre));
  if (!/\.(xlsx|docx)$/i.test(limpio)) throw new ApiError(400, 'Solo se guardan archivos .xlsx o .docx.');
  return limpio;
}

/** Bitácora (lo más nuevo primero). */
export const leerBitacora = (a: AlmacenDatos) => ({ entradas: [...a.config.bitacora].reverse().slice(0, 500) });

/** Clave de acceso nueva: reglas mínimas. */
export function validarClaveNueva(clave: string): void {
  if (clave.length < 4) throw new ApiError(400, 'La clave de acceso debe tener al menos 4 caracteres.');
  if (clave.length > 100) throw new ApiError(400, 'La clave de acceso es demasiado larga.');
}

// ---------------------------------------------------------------- respaldos
/** Copia completa (lo que va a respaldos/ y lo que se descarga como respaldo). */
export interface Respaldo {
  app: 'gerencia-komplex';
  version: 1;
  creado: string;
  config: Configuracion;
  meses: DatosMes[];
}

export function esRespaldo(v: unknown): v is Respaldo {
  const r = v as Respaldo;
  return !!r && r.app === 'gerencia-komplex' && !!r.config && Array.isArray(r.meses);
}

/** Completa un mes leído de disco (versiones viejas o archivos editados a mano). */
export function normalizarMes(mes: string, m: Partial<DatosMes> | null | undefined): DatosMes {
  return {
    mes,
    registros: (m?.registros ?? []).map((r) => ({ ...r, vueltos: r.vueltos ?? [], notas: r.notas ?? '' })),
    movimientos: m?.movimientos ?? [],
    aperturas: m?.aperturas ?? [],
    cuadres: m?.cuadres ?? [],
    tasas: m?.tasas ?? {},
  };
}

export const mesVacio = (mes: string): DatosMes => normalizarMes(mes, null);

/** ¿El mes se quedó sin nada? (entonces no deja archivo). */
export const mesEstaVacio = (m: DatosMes): boolean =>
  !m.registros.length && !m.movimientos.length && !m.aperturas.length && !m.cuadres.length && !Object.keys(m.tasas).length;

export const BITACORA_MAX = 3000;

export const LEEME = `GERENCIA KOMPLEX — CARPETA DE DATOS
====================================

Aquí se guarda AUTOMÁTICAMENTE toda la información de Gerencia Komplex (caja,
registro de pagos, transferencias, cuadres y cierres de mes). Está separada del
programa: si el programa se borra, se pierde o se vuelve a descargar, la
información sigue aquí.

La usan igual el programa de escritorio (Iniciar Gerencia Komplex.bat) y la
versión web (el enlace de GitHub): cualquiera de los dos puede abrir esta
carpeta. No los uses a la vez sobre la misma carpeta.

  datos/        La información en uso. Un archivo por mes (AAAA-MM.json) y la
                configuración (planes, bancos, cierres de mes).
  respaldos/    Una copia completa por día. Se conservan las últimas 60.
  cierres/      Al cerrar un mes se guarda aquí su Excel, su informe de Word y
                una copia de sus datos.

IMPORTANTE
- No modifiques ni borres los archivos de "datos" con el programa abierto.
- Para llevar los datos a otra computadora, copia esta carpeta completa y elige
  esta carpeta al entrar por primera vez.
- Si un archivo de "datos" se daña, se puede restaurar el último respaldo desde
  el programa: Configuración → Carpeta y respaldos.
`;

export type { Bloqueo };
