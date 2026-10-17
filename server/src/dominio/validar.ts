/**
 * validar.ts — Limpia y valida lo que llega de un formulario.
 *
 * Devuelve el objeto listo para guardar o lanza `ErrorValidacion` con un
 * mensaje que se puede mostrar tal cual a quien está registrando.
 */
import { r2, num } from './calculos.js';
import { esFecha } from './fechas.js';
import {
  INFO_MONEDA, MONEDAS_EFECTIVO, TIPOS_MOVIMIENTO, TIPOS_REGISTRO, esMoneda, esTransferencia, efectivoCero,
  type Configuracion, type Efectivo, type EstadoTransferencia, type Moneda, type Movimiento, type Pago,
  type Registro, type TipoMovimiento, type TipoRegistro, type Vuelto,
} from './tipos.js';

export class ErrorValidacion extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorValidacion';
  }
}

const txt = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max);

function fecha(v: unknown): string {
  if (!esFecha(v)) throw new ErrorValidacion('La fecha no es válida.');
  return v;
}

function monto(v: unknown, que: string): number {
  const n = num(v);
  if (!(n > 0)) throw new ErrorValidacion(`El monto ${que} debe ser mayor que cero.`);
  if (n > 1e12) throw new ErrorValidacion(`El monto ${que} es demasiado grande.`);
  return r2(n);
}

function tasa(moneda: Moneda, v: unknown, que: string): number {
  if (!INFO_MONEDA[moneda].tasa) return 1;
  const n = num(v);
  if (!(n > 0)) throw new ErrorValidacion(`Falta la tasa ${que}.`);
  return Number(n.toFixed(6));
}

/** Datos de un pago tal como llegan del formulario. */
export interface PagoEntrada {
  moneda?: unknown;
  monto?: unknown;
  tasa?: unknown;
  bancoEmisor?: unknown;
  bancoReceptor?: unknown;
  referencia?: unknown;
}

export function limpiarPago(p: PagoEntrada, i: number, anterior?: Pago): Pago {
  const que = `del pago ${i + 1}`;
  if (!esMoneda(p.moneda)) throw new ErrorValidacion(`Elige la moneda ${que}.`);
  const moneda = p.moneda;
  const info = INFO_MONEDA[moneda];
  const out: Pago = { moneda, monto: monto(p.monto, que), tasa: tasa(moneda, p.tasa, `${que} (${moneda})`) };
  if (info.ref === 'banco') {
    out.bancoEmisor = txt(p.bancoEmisor, 80);
    out.bancoReceptor = txt(p.bancoReceptor, 80);
    out.referencia = txt(p.referencia, 60);
    if (!out.bancoEmisor) throw new ErrorValidacion(`Falta el banco emisor ${que}.`);
    if (!out.bancoReceptor) throw new ErrorValidacion(`Falta el banco receptor ${que}.`);
    if (!out.referencia) throw new ErrorValidacion(`Falta el n° de referencia ${que}.`);
  } else if (info.ref === 'confirmacion') {
    out.referencia = txt(p.referencia, 60);
    if (!out.referencia) throw new ErrorValidacion(`Falta el n° de confirmación ${que}.`);
  }
  if (esTransferencia(moneda)) {
    // La verificación se conserva si la línea sigue siendo la misma transferencia.
    const misma = anterior && anterior.moneda === moneda && anterior.referencia === out.referencia
      && Math.abs(anterior.monto - out.monto) < 0.005;
    out.estado = misma ? (anterior.estado ?? 'pendiente') : 'pendiente';
    if (misma && anterior.verificadoPor) {
      out.verificadoPor = anterior.verificadoPor;
      out.verificadoEn = anterior.verificadoEn;
    }
  }
  return out;
}

function limpiarVuelto(v: { moneda?: unknown; monto?: unknown; tasa?: unknown }, i: number): Vuelto {
  const que = `del vuelto ${i + 1}`;
  if (!(MONEDAS_EFECTIVO as readonly unknown[]).includes(v.moneda)) {
    throw new ErrorValidacion(`El vuelto ${i + 1} solo puede ser en Dólares o Cop (efectivo).`);
  }
  const moneda = v.moneda as Vuelto['moneda'];
  return { moneda, monto: monto(v.monto, que), tasa: tasa(moneda, v.tasa, que) };
}

export interface RegistroEntrada {
  fecha?: unknown;
  afiliado?: unknown;
  plan?: unknown;
  tipo?: unknown;
  convenio?: unknown;
  pagos?: unknown;
  vueltos?: unknown;
  notas?: unknown;
}

/** Campos editables de un registro (sin id ni auditoría). */
export type RegistroLimpio = Pick<Registro, 'fecha' | 'afiliado' | 'plan' | 'tipo' | 'convenio' | 'precioPlan' | 'pagos' | 'vueltos' | 'notas'>;

export function limpiarRegistro(e: RegistroEntrada, cfg: Configuracion, anterior?: Registro): RegistroLimpio {
  const f = fecha(e.fecha);
  const afiliado = txt(e.afiliado, 120);
  if (!afiliado) throw new ErrorValidacion('Escribe el nombre del afiliado.');
  if (!(TIPOS_REGISTRO as readonly unknown[]).includes(e.tipo)) throw new ErrorValidacion('Elige el tipo (Nuevo, Renovación o Pago mixto).');
  const tipo = e.tipo as TipoRegistro;
  const plan = txt(e.plan, 80);
  if (!plan) throw new ErrorValidacion('Elige el plan.');
  const p = cfg.planes.find((x) => x.nombre === plan);
  // Un plan que ya no existe se acepta solo si el registro ya lo tenía.
  if (!p && anterior?.plan !== plan) throw new ErrorValidacion(`El plan "${plan}" no existe en Configuración.`);
  const convenio = e.convenio === true || e.convenio === 'Sí' || e.convenio === 1;

  let precioPlan = 0;
  if (tipo !== 'Pago mixto') {
    // El precio se fija al registrar: si luego cambia la lista de precios, el
    // historial no se mueve. Al editar se recalcula solo si cambió el plan o el convenio.
    const mismo = anterior && anterior.plan === plan && anterior.convenio === convenio && anterior.tipo !== 'Pago mixto';
    precioPlan = mismo ? anterior.precioPlan : r2((p?.precio ?? 0) * (convenio ? 0.5 : 1));
  }

  const entradaPagos = Array.isArray(e.pagos) ? e.pagos as PagoEntrada[] : [];
  if (!entradaPagos.length) throw new ErrorValidacion('Indica cómo pagó (moneda y monto).');
  if (entradaPagos.length > 6) throw new ErrorValidacion('Máximo 6 pagos en un mismo registro.');
  const pagos = entradaPagos.map((x, i) => limpiarPago(x, i, anterior?.pagos[i]));
  const entradaVueltos = Array.isArray(e.vueltos) ? e.vueltos as { moneda?: unknown; monto?: unknown; tasa?: unknown }[] : [];
  const vueltos = entradaVueltos.slice(0, 4).map(limpiarVuelto);

  return { fecha: f, afiliado, plan, tipo, convenio, precioPlan, pagos, vueltos, notas: txt(e.notas, 500) };
}

export interface MovimientoEntrada {
  fecha?: unknown;
  tipo?: unknown;
  concepto?: unknown;
  categoria?: unknown;
  moneda?: unknown;
  monto?: unknown;
  tasa?: unknown;
  referencia?: unknown;
  notas?: unknown;
}

export type MovimientoLimpio = Pick<Movimiento, 'fecha' | 'tipo' | 'concepto' | 'categoria' | 'moneda' | 'monto' | 'tasa' | 'referencia' | 'notas'>;

export function limpiarMovimiento(e: MovimientoEntrada): MovimientoLimpio {
  const f = fecha(e.fecha);
  if (!(TIPOS_MOVIMIENTO as readonly unknown[]).includes(e.tipo)) throw new ErrorValidacion('Elige el tipo de movimiento.');
  const tipo = e.tipo as TipoMovimiento;
  const concepto = txt(e.concepto, 160);
  if (!concepto) throw new ErrorValidacion('Escribe el concepto.');
  if (!esMoneda(e.moneda)) throw new ErrorValidacion('Elige la moneda.');
  const moneda = e.moneda;
  return {
    fecha: f, tipo, concepto,
    categoria: tipo === 'gasto' ? txt(e.categoria, 60) || 'Otros' : txt(e.categoria, 60),
    moneda,
    monto: monto(e.monto, ''),
    tasa: tasa(moneda, e.tasa, `(${moneda})`),
    referencia: esTransferencia(moneda) ? txt(e.referencia, 60) : undefined,
    notas: txt(e.notas, 500),
  };
}

export function limpiarEfectivo(v: unknown): Efectivo {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = efectivoCero();
  for (const m of MONEDAS_EFECTIVO) {
    const n = num(src[m]);
    if (n < 0) throw new ErrorValidacion(`El monto en ${m} no puede ser negativo.`);
    out[m] = r2(n);
  }
  return out;
}

export function limpiarEstado(v: unknown): EstadoTransferencia {
  if (v === 'pendiente' || v === 'confirmada' || v === 'no_llego') return v;
  throw new ErrorValidacion('Estado de transferencia no válido.');
}

/** Listas de configuración: sin vacíos ni repetidos. */
export function limpiarLista(v: unknown, max = 100): string[] {
  if (!Array.isArray(v)) throw new ErrorValidacion('Lista no válida.');
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const s = txt(x, 80);
    const k = s.toLowerCase();
    if (!s || vistos.has(k)) continue;
    vistos.add(k);
    out.push(s);
  }
  return out.slice(0, max);
}
