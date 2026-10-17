/** fechas.ts — Fechas 'AAAA-MM-DD' y meses 'AAAA-MM', sin zonas horarias. */

export const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const RE_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const hoyISO = (): string => iso(new Date());

/** ¿Es una fecha real? (rechaza 2026-02-30). */
export function esFecha(v: unknown): v is string {
  if (typeof v !== 'string' || !RE_FECHA.test(v)) return false;
  const [a, m, d] = v.split('-').map(Number);
  const f = new Date(a, m - 1, d);
  return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d;
}

export const esMes = (v: unknown): v is string => typeof v === 'string' && RE_MES.test(v);

export const mesDe = (fecha: string): string => fecha.slice(0, 7);

/** 'Septiembre 2026' a partir de '2026-09'. */
export function nombreMes(mes: string): string {
  const i = Number(mes.slice(5, 7)) - 1;
  return `${MESES_LARGO[i] ?? mes} ${mes.slice(0, 4)}`;
}

/** 'septiembre' (para frases). */
export const nombreMesMinuscula = (mes: string): string =>
  (MESES_LARGO[Number(mes.slice(5, 7)) - 1] ?? mes).toLowerCase();

/** 'Sep 26' a partir de '2026-09'. */
export function mesCorto(mes: string): string {
  const i = Number(mes.slice(5, 7)) - 1;
  return `${MESES_CORTO[i] ?? mes} ${mes.slice(2, 4)}`;
}

/** '17/10/2026' */
export function fmtFecha(f: string | null | undefined): string {
  if (!f) return '—';
  const [a, m, d] = f.slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : `${m}/${a}`;
}

export const ultimoDiaMes = (mes: string): string => {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
};

export const primerDiaMes = (mes: string): string => `${mes}-01`;

/** Mes siguiente / anterior de 'AAAA-MM'. */
export function sumarMeses(mes: string, n: number): string {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return iso(new Date(a, m - 1, d + n));
}

/** Meses 'AAAA-MM' que toca el rango (inclusive). */
export function mesesEnRango(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let m = mesDe(desde);
  const fin = mesDe(hasta);
  while (m <= fin && out.length < 600) {
    out.push(m);
    m = sumarMeses(m, 1);
  }
  return out;
}

/** Días 'AAAA-MM-DD' del rango (inclusive). */
export function diasEnRango(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let d = desde;
  while (d <= hasta && out.length < 4000) {
    out.push(d);
    d = sumarDias(d, 1);
  }
  return out;
}

export const diaSemana = (fecha: string): string => {
  const [a, m, d] = fecha.split('-').map(Number);
  return DIAS_SEMANA[new Date(a, m - 1, d).getDay()];
};

const ultimo = (a: number, m: number) => new Date(a, m, 0).getDate();

/** Nombre humano del rango: mes completo, año completo, un día o "del X al Y". */
export function etiquetaPeriodo(desde: string, hasta: string): string {
  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  if (desde === hasta) return `${d1} de ${MESES_LARGO[m1 - 1].toLowerCase()} de ${a1}`;
  if (a1 === a2 && m1 === 1 && d1 === 1 && m2 === 12 && d2 === 31) return `Año ${a1}`;
  if (a1 === a2 && m1 === m2 && d1 === 1 && d2 === ultimo(a2, m2)) return `${MESES_LARGO[m1 - 1]} ${a1}`;
  const dia = (d: number, m: number) => `${d} de ${MESES_LARGO[m - 1].toLowerCase()}`;
  return a1 === a2
    ? `Del ${dia(d1, m1)} al ${dia(d2, m2)} de ${a1}`
    : `Del ${dia(d1, m1)} de ${a1} al ${dia(d2, m2)} de ${a2}`;
}

/** El rango de la misma duración que termina justo antes de `desde`. */
export function rangoAnterior(desde: string, hasta: string): [string, string] {
  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  // Si son meses completos se compara mes contra mes, no "los 31 días previos".
  if (d1 === 1 && d2 === ultimo(a2, m2)) {
    const n = (a2 - a1) * 12 + (m2 - m1) + 1;
    return [iso(new Date(a1, m1 - 1 - n, 1)), iso(new Date(a1, m1 - 1, 0))];
  }
  const dias = diasEnRango(desde, hasta).length;
  const fin = sumarDias(desde, -1);
  return [sumarDias(fin, -(dias - 1)), fin];
}
