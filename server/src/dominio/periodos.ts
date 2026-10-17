/**
 * periodos.ts — Cierre de mes.
 *
 * Reglas:
 *  1. Un mes cerrado no se modifica: no se crean, editan ni borran registros,
 *     movimientos, aperturas, cuadres ni verificaciones con fecha de ese mes.
 *  2. Para escribir en un mes, todos los meses ANTERIORES que tengan datos
 *     deben estar cerrados. Así, al registrar el día 1 (o cualquier día) de un
 *     mes nuevo, el programa pregunta obligatoriamente "¿Quieres cerrar el
 *     registro del mes X?". Si la respuesta es no, no se puede registrar en el
 *     mes nuevo.
 *  3. Con el código gerencial (24 h) no hay bloqueos ni avisos: se puede
 *     modificar cualquier mes.
 *
 * El servidor aplica estas reglas en cada escritura; la interfaz usa las mismas
 * funciones para preguntar ANTES de que la persona empiece a escribir.
 */
import { mesDe, nombreMes } from './fechas.js';
import type { Cierre } from './tipos.js';

export type Bloqueo =
  | { tipo: 'mes_cerrado'; mes: string; mensaje: string }
  | { tipo: 'cierre_pendiente'; meses: string[]; mes: string; mensaje: string };

export interface EstadoPeriodos {
  /** Meses 'AAAA-MM' que tienen algún dato. */
  mesesConDatos: string[];
  cierres: Record<string, Cierre | undefined>;
  /** Modo gerencial activo para quien escribe. */
  gerencial: boolean;
}

export const mesCerrado = (e: Pick<EstadoPeriodos, 'cierres'>, mes: string): boolean => !!e.cierres[mes];

/** Meses anteriores a `mes` con datos que siguen abiertos (del más viejo al más nuevo). */
export function mesesPorCerrar(e: Pick<EstadoPeriodos, 'mesesConDatos' | 'cierres'>, mes: string): string[] {
  return e.mesesConDatos.filter((m) => m < mes && !e.cierres[m]).sort();
}

/** ¿Se puede escribir algo con esta fecha? null = sí. */
export function bloqueoEscritura(e: EstadoPeriodos, fecha: string): Bloqueo | null {
  if (e.gerencial) return null;
  const mes = mesDe(fecha);
  if (mesCerrado(e, mes)) {
    return {
      tipo: 'mes_cerrado',
      mes,
      mensaje: `${nombreMes(mes)} está cerrado: no se puede crear, modificar ni borrar nada de ese mes. `
        + 'Para corregirlo hace falta el código gerencial.',
    };
  }
  const pendientes = mesesPorCerrar(e, mes);
  if (pendientes.length) {
    const lista = pendientes.map(nombreMes).join(', ');
    return {
      tipo: 'cierre_pendiente',
      meses: pendientes,
      mes,
      mensaje: `Antes de registrar en ${nombreMes(mes)} hay que cerrar ${lista}.`,
    };
  }
  return null;
}

/**
 * Bloqueo para una edición: se revisa la fecha que tenía y la nueva (no se
 * puede sacar un registro de un mes cerrado ni meterlo en uno).
 */
export function bloqueoEdicion(e: EstadoPeriodos, fechaAnterior: string, fechaNueva: string): Bloqueo | null {
  return bloqueoEscritura(e, fechaAnterior) ?? (fechaNueva !== fechaAnterior ? bloqueoEscritura(e, fechaNueva) : null);
}

/** ¿Se puede cerrar este mes? Solo meses que ya terminaron y en orden. */
export function puedeCerrar(e: Pick<EstadoPeriodos, 'mesesConDatos' | 'cierres'>, mes: string, hoy: string): string | null {
  if (e.cierres[mes]) return `${nombreMes(mes)} ya está cerrado.`;
  if (mes >= mesDe(hoy)) return `${nombreMes(mes)} todavía no ha terminado.`;
  const antes = mesesPorCerrar(e, mes);
  if (antes.length) return `Primero hay que cerrar ${antes.map(nombreMes).join(', ')}.`;
  return null;
}
