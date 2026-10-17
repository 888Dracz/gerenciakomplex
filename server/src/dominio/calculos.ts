/**
 * calculos.ts — Las cuentas del gimnasio: total en dólares de cada pago, caja
 * esperada del día, cuadre y resumen de un período.
 *
 * Reglas (las mismas del Excel de registro de pagos):
 *  - Total USD = monto / tasa. Dólares y Zelle llevan tasa 1.
 *  - Afiliados = registros Nuevo + Renovación. "Pago mixto" suma dinero pero no
 *    cuenta como otro afiliado.
 *  - Una transferencia marcada "No llegó" NO cuenta como ingreso: el dinero no
 *    está. Las pendientes sí cuentan, pero se señalan aparte.
 *  - Los vueltos (cambio devuelto) restan del efectivo y del ingreso.
 */
import { diasEnRango, mesDe } from './fechas.js';
import {
  INFO_MONEDA, MONEDAS, MONEDAS_EFECTIVO, MONEDAS_TRANSFERENCIA,
  efectivoCero, esEfectivo, esTransferencia,
  type Apertura, type Cuadre, type Datos, type Efectivo, type EstadoTransferencia, type Moneda,
  type MonedaTransferencia, type Pago, type Plan, type Registro, type Tasas,
} from './tipos.js';

/** Redondeo a 2 decimales, mitad hacia arriba (igual que Dorado Club). */
export function r2(v: unknown): number {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  const m = Math.floor(Math.abs(x) * 100 + 0.5 + 1e-9) / 100;
  return x < 0 ? -m : m;
}

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Equivalente en dólares de un monto en cualquier moneda. */
export function enUSD(p: { moneda: Moneda; monto: number; tasa: number }): number {
  if (!INFO_MONEDA[p.moneda].tasa) return num(p.monto);
  return p.tasa > 0 ? num(p.monto) / p.tasa : 0;
}

/** ¿Este pago cuenta como dinero recibido? (una transferencia que no llegó, no). */
export const pagoCuenta = (p: Pago): boolean => p.estado !== 'no_llego';

/** Estado de una línea: las transferencias sin marcar están pendientes. */
export const estadoDe = (p: Pago): EstadoTransferencia | null =>
  (esTransferencia(p.moneda) ? (p.estado ?? 'pendiente') : null);

/** Lo cobrado en el registro, en dólares (sin transferencias que no llegaron, menos vueltos). */
export function totalUSD(r: Pick<Registro, 'pagos' | 'vueltos'>): number {
  let t = 0;
  for (const p of r.pagos) if (pagoCuenta(p)) t += enUSD(p);
  for (const v of r.vueltos ?? []) t -= enUSD(v);
  return r2(t);
}

/** Total en dólares tal como se registró (incluye transferencias que no llegaron). */
export function totalRegistradoUSD(r: Pick<Registro, 'pagos' | 'vueltos'>): number {
  let t = 0;
  for (const p of r.pagos) t += enUSD(p);
  for (const v of r.vueltos ?? []) t -= enUSD(v);
  return r2(t);
}

export const cuentaComoAfiliado = (r: Pick<Registro, 'tipo'>): boolean => r.tipo !== 'Pago mixto';

/** Precio del plan con el convenio aplicado (50%). */
export function precioConConvenio(planes: Plan[], plan: string, convenio: boolean): number {
  const p = planes.find((x) => x.nombre === plan);
  return p ? r2(p.precio * (convenio ? 0.5 : 1)) : 0;
}

/** Diferencia entre lo pagado y el precio del plan (positivo = sobra). */
export function diferenciaPlan(r: Registro): number | null {
  if (r.tipo === 'Pago mixto' || !(r.precioPlan > 0)) return null;
  return r2(totalRegistradoUSD(r) - r.precioPlan);
}

/** Tasa propuesta para una moneda en un día (la tasa del día guardada). */
export function tasaSugerida(tasas: Record<string, Tasas>, fecha: string, moneda: Moneda): number | null {
  const de = INFO_MONEDA[moneda].tasaDe;
  if (!de) return 1;
  const exacta = tasas[fecha]?.[de];
  if (exacta && exacta > 0) return exacta;
  // Si ese día no tiene tasa, la del último día anterior que sí la tenga.
  const dias = Object.keys(tasas).filter((d) => d < fecha && (tasas[d]?.[de] ?? 0) > 0).sort();
  const ult = dias[dias.length - 1];
  return ult ? tasas[ult][de] ?? null : null;
}

// ---------------------------------------------------------------- transferencias
export interface LineaTransferencia {
  registroId: string;
  idx: number;
  fecha: string;
  afiliado: string;
  plan: string;
  moneda: MonedaTransferencia;
  monto: number;
  tasa: number;
  usd: number;
  bancoEmisor: string;
  bancoReceptor: string;
  referencia: string;
  estado: EstadoTransferencia;
  verificadoPor?: string;
  verificadoEn?: string;
}

/** Todas las líneas que son transferencia, en el orden en que se registraron. */
export function lineasTransferencia(registros: Registro[]): LineaTransferencia[] {
  const out: LineaTransferencia[] = [];
  for (const r of registros) {
    r.pagos.forEach((p, idx) => {
      if (!esTransferencia(p.moneda)) return;
      out.push({
        registroId: r.id, idx, fecha: r.fecha, afiliado: r.afiliado, plan: r.plan,
        moneda: p.moneda, monto: p.monto, tasa: p.tasa, usd: r2(enUSD(p)),
        bancoEmisor: p.bancoEmisor ?? '', bancoReceptor: p.bancoReceptor ?? '', referencia: p.referencia ?? '',
        estado: p.estado ?? 'pendiente', verificadoPor: p.verificadoPor, verificadoEn: p.verificadoEn,
      });
    });
  }
  return out;
}

export interface ResumenTransferencias {
  total: number;
  confirmadas: number;
  pendientes: number;
  noLlegaron: number;
  usdPendiente: number;
  usdNoLlego: number;
  porMoneda: Record<MonedaTransferencia, { n: number; monto: number; confirmado: number }>;
}

export function resumirTransferencias(lineas: LineaTransferencia[]): ResumenTransferencias {
  const porMoneda = Object.fromEntries(
    MONEDAS_TRANSFERENCIA.map((m) => [m, { n: 0, monto: 0, confirmado: 0 }]),
  ) as ResumenTransferencias['porMoneda'];
  const out: ResumenTransferencias = {
    total: 0, confirmadas: 0, pendientes: 0, noLlegaron: 0, usdPendiente: 0, usdNoLlego: 0, porMoneda,
  };
  for (const l of lineas) {
    out.total++;
    const pm = porMoneda[l.moneda];
    pm.n++;
    pm.monto = r2(pm.monto + l.monto);
    if (l.estado === 'confirmada') { out.confirmadas++; pm.confirmado = r2(pm.confirmado + l.monto); }
    else if (l.estado === 'no_llego') { out.noLlegaron++; out.usdNoLlego = r2(out.usdNoLlego + l.usd); }
    else { out.pendientes++; out.usdPendiente = r2(out.usdPendiente + l.usd); }
  }
  return out;
}

// ---------------------------------------------------------------- caja del día
export interface CajaDia {
  fecha: string;
  fondo: Efectivo;
  /** Efectivo cobrado en afiliaciones. */
  cobros: Efectivo;
  vueltos: Efectivo;
  ingresos: Efectivo;
  gastos: Efectivo;
  retiros: Efectivo;
  /** Lo que debería haber en la caja: fondo + cobros − vueltos + ingresos − gastos − retiros. */
  esperado: Efectivo;
  /** Cobrado ese día por moneda (todas las monedas, en su moneda). */
  porMoneda: Record<Moneda, number>;
  totalUSD: number;
  afiliaciones: number;
  transferencias: ResumenTransferencias;
  apertura: Apertura | null;
  cuadre: Cuadre | null;
}

const porMonedaCero = (): Record<Moneda, number> =>
  Object.fromEntries(MONEDAS.map((m) => [m, 0])) as Record<Moneda, number>;

export function cajaDelDia(datos: Datos, fecha: string): CajaDia {
  const apertura = datos.aperturas.find((a) => a.fecha === fecha) ?? null;
  const cuadre = datos.cuadres.find((c) => c.fecha === fecha) ?? null;
  const fondo = { ...efectivoCero(), ...(apertura?.fondo ?? {}) };
  const cobros = efectivoCero();
  const vueltos = efectivoCero();
  const ingresos = efectivoCero();
  const gastos = efectivoCero();
  const retiros = efectivoCero();
  const porMoneda = porMonedaCero();
  let usdDia = 0;
  let afiliaciones = 0;

  const registros = datos.registros.filter((r) => r.fecha === fecha);
  for (const r of registros) {
    if (cuentaComoAfiliado(r)) afiliaciones++;
    usdDia += totalUSD(r);
    for (const p of r.pagos) {
      if (!pagoCuenta(p)) continue;
      porMoneda[p.moneda] = r2(porMoneda[p.moneda] + p.monto);
      if (esEfectivo(p.moneda)) cobros[p.moneda] = r2(cobros[p.moneda] + p.monto);
    }
    for (const v of r.vueltos ?? []) {
      vueltos[v.moneda] = r2(vueltos[v.moneda] + v.monto);
      porMoneda[v.moneda] = r2(porMoneda[v.moneda] - v.monto);
    }
  }
  for (const m of datos.movimientos) {
    if (m.fecha !== fecha || !esEfectivo(m.moneda)) continue;
    const dst = m.tipo === 'gasto' ? gastos : m.tipo === 'retiro' ? retiros : ingresos;
    dst[m.moneda] = r2(dst[m.moneda] + m.monto);
  }
  const esperado = efectivoCero();
  for (const m of MONEDAS_EFECTIVO) {
    esperado[m] = r2(fondo[m] + cobros[m] - vueltos[m] + ingresos[m] - gastos[m] - retiros[m]);
  }
  return {
    fecha, fondo, cobros, vueltos, ingresos, gastos, retiros, esperado, porMoneda,
    totalUSD: r2(usdDia), afiliaciones,
    transferencias: resumirTransferencias(lineasTransferencia(registros)),
    apertura, cuadre,
  };
}

/** Diferencia contado − esperado por moneda. */
export function diferencias(contado: Efectivo, esperado: Efectivo): Efectivo {
  const d = efectivoCero();
  for (const m of MONEDAS_EFECTIVO) d[m] = r2((contado[m] ?? 0) - (esperado[m] ?? 0));
  return d;
}

/** Tolerancia de redondeo para decir que la caja cuadró. */
export const TOLERANCIA: Efectivo = { Dólares: 0.01, Cop: 1 };

export type EstadoCuadre = 'cuadrada' | 'sobrante' | 'faltante';

export function estadoCuadre(dif: Efectivo): EstadoCuadre {
  let falta = false;
  let sobra = false;
  for (const m of MONEDAS_EFECTIVO) {
    if (dif[m] < -TOLERANCIA[m]) falta = true;
    else if (dif[m] > TOLERANCIA[m]) sobra = true;
  }
  return falta ? 'faltante' : sobra ? 'sobrante' : 'cuadrada';
}

/** ¿Cambió lo esperado después de cerrar la caja? (alguien registró o editó). */
export function cuadreDesactualizado(c: Cuadre, esperadoActual: Efectivo): boolean {
  return MONEDAS_EFECTIVO.some((m) => Math.abs((c.esperado[m] ?? 0) - esperadoActual[m]) > TOLERANCIA[m]);
}

/** Fondo sugerido para abrir el día: lo contado en el último cuadre anterior. */
export function fondoSugerido(datos: Datos, fecha: string): Efectivo | null {
  const previos = datos.cuadres.filter((c) => c.fecha < fecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ult = previos[previos.length - 1];
  return ult ? { ...ult.contado } : null;
}

// ---------------------------------------------------------------- resumen de un período
export interface FilaPlan {
  plan: string;
  pagados: number;
  nuevos: number;
  renovaciones: number;
  convenios: number;
  usd: number;
}

export interface FilaMoneda {
  moneda: Moneda;
  pagos: number;
  monto: number;
  usd: number;
  pct: number;
}

export interface FilaDia {
  fecha: string;
  afiliados: number;
  usd: number;
  otrosIngresosUSD: number;
  gastosUSD: number;
}

export interface ResumenPeriodo {
  desde: string;
  hasta: string;
  registros: number;
  ingresoUSD: number;
  afiliados: number;
  nuevos: number;
  renovaciones: number;
  pagosMixtos: number;
  promedioPorAfiliado: number;
  porMoneda: FilaMoneda[];
  planes: FilaPlan[];
  transferencias: ResumenTransferencias;
  otrosIngresosUSD: number;
  gastosUSD: number;
  retirosUSD: number;
  netoUSD: number;
  gastosPorCategoria: { categoria: string; n: number; usd: number }[];
  porDia: FilaDia[];
  /** Días con movimiento y cuántos tienen la caja cuadrada. */
  cuadres: {
    diasConMovimiento: number;
    diasCuadrados: number;
    sinCuadre: string[];
    conDiferencia: { fecha: string; diferencia: Efectivo; estado: EstadoCuadre }[];
  };
  convenios: number;
  /** Registros cuyo pago no cubre el precio del plan. */
  incompletos: { fecha: string; afiliado: string; plan: string; falta: number }[];
}

export const enRango = (fecha: string, desde: string, hasta: string): boolean => fecha >= desde && fecha <= hasta;

export function filtrarDatos(d: Datos, desde: string, hasta: string): Datos {
  const tasas: Record<string, Tasas> = {};
  for (const [f, t] of Object.entries(d.tasas)) if (enRango(f, desde, hasta)) tasas[f] = t;
  return {
    registros: d.registros.filter((r) => enRango(r.fecha, desde, hasta)),
    movimientos: d.movimientos.filter((m) => enRango(m.fecha, desde, hasta)),
    aperturas: d.aperturas.filter((a) => enRango(a.fecha, desde, hasta)),
    cuadres: d.cuadres.filter((c) => enRango(c.fecha, desde, hasta)),
    tasas,
  };
}

export function resumen(todo: Datos, desde: string, hasta: string): ResumenPeriodo {
  const d = filtrarDatos(todo, desde, hasta);
  const porMonedaMap = new Map<Moneda, FilaMoneda>(MONEDAS.map((m) => [m, { moneda: m, pagos: 0, monto: 0, usd: 0, pct: 0 }]));
  const planes = new Map<string, FilaPlan>();
  const porDia = new Map<string, FilaDia>();
  const dia = (f: string) => {
    let x = porDia.get(f);
    if (!x) { x = { fecha: f, afiliados: 0, usd: 0, otrosIngresosUSD: 0, gastosUSD: 0 }; porDia.set(f, x); }
    return x;
  };

  let ingreso = 0;
  let nuevos = 0;
  let renovaciones = 0;
  let mixtos = 0;
  let convenios = 0;
  const incompletos: ResumenPeriodo['incompletos'] = [];

  for (const r of d.registros) {
    const usd = totalUSD(r);
    ingreso += usd;
    if (r.tipo === 'Nuevo') nuevos++;
    else if (r.tipo === 'Renovación') renovaciones++;
    else mixtos++;
    if (r.convenio && cuentaComoAfiliado(r)) convenios++;

    const fp = planes.get(r.plan) ?? { plan: r.plan, pagados: 0, nuevos: 0, renovaciones: 0, convenios: 0, usd: 0 };
    if (r.tipo === 'Nuevo') fp.nuevos++;
    if (r.tipo === 'Renovación') fp.renovaciones++;
    if (cuentaComoAfiliado(r)) fp.pagados++;
    if (r.convenio && cuentaComoAfiliado(r)) fp.convenios++;
    fp.usd = r2(fp.usd + usd);
    planes.set(r.plan, fp);

    const fd = dia(r.fecha);
    if (cuentaComoAfiliado(r)) fd.afiliados++;
    fd.usd = r2(fd.usd + usd);

    for (const p of r.pagos) {
      if (!pagoCuenta(p)) continue;
      const fm = porMonedaMap.get(p.moneda)!;
      fm.pagos++;
      fm.monto = r2(fm.monto + p.monto);
      fm.usd = r2(fm.usd + enUSD(p));
    }
    for (const v of r.vueltos ?? []) {
      const fm = porMonedaMap.get(v.moneda)!;
      fm.monto = r2(fm.monto - v.monto);
      fm.usd = r2(fm.usd - enUSD(v));
    }
    const dif = diferenciaPlan(r);
    if (dif !== null && dif < -0.01) incompletos.push({ fecha: r.fecha, afiliado: r.afiliado, plan: r.plan, falta: r2(-dif) });
  }

  let otros = 0;
  let gastos = 0;
  let retiros = 0;
  const cats = new Map<string, { categoria: string; n: number; usd: number }>();
  for (const m of d.movimientos) {
    const usd = enUSD(m);
    if (m.tipo === 'ingreso') { otros += usd; dia(m.fecha).otrosIngresosUSD = r2(dia(m.fecha).otrosIngresosUSD + usd); }
    else if (m.tipo === 'gasto') {
      gastos += usd;
      dia(m.fecha).gastosUSD = r2(dia(m.fecha).gastosUSD + usd);
      const c = cats.get(m.categoria || 'Sin categoría') ?? { categoria: m.categoria || 'Sin categoría', n: 0, usd: 0 };
      c.n++;
      c.usd = r2(c.usd + usd);
      cats.set(c.categoria, c);
    } else retiros += usd;
  }

  const ingresoUSD = r2(ingreso);
  const porMoneda = [...porMonedaMap.values()].map((f) => ({ ...f, pct: ingresoUSD > 0 ? r2((f.usd / ingresoUSD) * 100) : 0 }));
  const afiliados = nuevos + renovaciones;

  // Cuadres: días con cualquier movimiento frente a días con la caja cerrada.
  const diasMov = new Set<string>([...d.registros.map((r) => r.fecha), ...d.movimientos.map((m) => m.fecha)]);
  const cuadrados = new Set(d.cuadres.map((c) => c.fecha));
  const sinCuadre = [...diasMov].filter((f) => !cuadrados.has(f)).sort();
  const conDiferencia = d.cuadres
    .map((c) => ({ fecha: c.fecha, diferencia: c.diferencia, estado: estadoCuadre(c.diferencia) }))
    .filter((c) => c.estado !== 'cuadrada')
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    desde, hasta,
    registros: d.registros.length,
    ingresoUSD,
    afiliados, nuevos, renovaciones, pagosMixtos: mixtos,
    promedioPorAfiliado: afiliados ? r2(ingresoUSD / afiliados) : 0,
    porMoneda,
    planes: [...planes.values()].sort((a, b) => b.usd - a.usd),
    transferencias: resumirTransferencias(lineasTransferencia(d.registros)),
    otrosIngresosUSD: r2(otros),
    gastosUSD: r2(gastos),
    retirosUSD: r2(retiros),
    netoUSD: r2(ingresoUSD + otros - gastos),
    gastosPorCategoria: [...cats.values()].sort((a, b) => b.usd - a.usd),
    porDia: diasEnRango(desde, hasta).filter((f) => porDia.has(f)).map((f) => porDia.get(f)!),
    cuadres: {
      diasConMovimiento: diasMov.size,
      diasCuadrados: [...diasMov].filter((f) => cuadrados.has(f)).length,
      sinCuadre,
      conDiferencia,
    },
    convenios,
    incompletos,
  };
}

/** Resumen por mes (para la hoja "Resumen por mes" del Excel y el informe). */
export function resumenPorMes(todo: Datos, meses: string[]): (ResumenPeriodo & { mes: string })[] {
  return meses.map((mes) => ({ mes, ...resumen(todo, `${mes}-01`, `${mes}-31`) }));
}

/** Meses que tienen cualquier dato (registros, caja, cuadres). */
export function mesesConDatos(d: Datos): string[] {
  const s = new Set<string>();
  for (const r of d.registros) s.add(mesDe(r.fecha));
  for (const m of d.movimientos) s.add(mesDe(m.fecha));
  for (const a of d.aperturas) s.add(mesDe(a.fecha));
  for (const c of d.cuadres) s.add(mesDe(c.fecha));
  return [...s].sort();
}

