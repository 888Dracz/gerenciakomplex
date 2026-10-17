/** format.ts — Números, montos y fechas en formato venezolano (es-VE). */
import { INFO_MONEDA, type Moneda } from '@dominio/tipos';

export { fmtFecha, hoyISO, nombreMes } from '@dominio/fechas';

export function fmtNum(n: unknown, d?: number): string {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  const dec = d != null ? d : (Number.isInteger(x) ? 0 : 2);
  return x.toLocaleString('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: d != null ? d : 2 });
}

export function fmtUSD(n: unknown): string {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  return (x < 0 ? '− $ ' : '$ ') + fmtNum(Math.abs(x), 2);
}

/** Monto en su moneda: "Bs 39.500", "$ 40,00", "COP 60.000". */
export function fmtMonto(moneda: Moneda, n: number): string {
  const u = INFO_MONEDA[moneda].unidad;
  if (u === 'USD') return fmtUSD(n);
  return `${u} ${fmtNum(n, u === 'COP' ? 0 : 2)}`;
}

/** Fecha y hora local corta a partir de un ISO. */
export function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
}

export const sinTildes = (s: unknown): string =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');

/** Lee un número escrito a mano: acepta "39.500,50", "39500.5" o "39500". */
export function leerNumero(txt: string): number {
  let s = String(txt ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return Number(s);
}
