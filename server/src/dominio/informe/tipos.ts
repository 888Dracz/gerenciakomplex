/**
 * informe/tipos.ts — Modelo del documento que se entrega a Gerencia.
 *
 * El servidor no arma el Word: arma un DOCUMENTO ABSTRACTO (secciones → bloques)
 * y el navegador lo convierte en .docx (`web/src/lib/docx.ts`) dibujando los
 * gráficos con canvas. Así el mismo informe podría exportarse mañana a otro
 * formato sin volver a calcular nada.
 *
 * Un bloque es una de estas cinco cosas: fila de KPIs, tabla, gráfico, párrafos
 * o lista de puntos (alertas). Nada más: si algo no entra en eso, se compone
 * con varios bloques.
 */

/** Cómo se escribe un número en el documento. */
export type Formato = 'usd' | 'num' | 'int' | 'pct' | 'horas' | 'texto';

export type Celda = string | number | null;

export interface KpiItem {
  label: string;
  valor: Celda;
  formato?: Formato;
  detalle?: string;
  /** Colorea el número: verde, rojo o ámbar. */
  tono?: 'pos' | 'neg' | 'warn';
}

export interface SerieGrafico {
  label: string;
  datos: number[];
  color?: string;
  /** En un gráfico 'combo': la serie se dibuja como línea en vez de barra. */
  linea?: boolean;
}

export type Grafico =
  | {
    clase: 'barras' | 'lineas' | 'combo';
    categorias: string[];
    series: SerieGrafico[];
    formato?: Formato;
    apilado?: boolean;
  }
  | { clase: 'pastel'; items: { label: string; valor: number }[]; formato?: Formato }
  | { clase: 'barrasH'; items: { label: string; valor: number }[]; formato?: Formato; color?: string };

export interface FilaTabla {
  celdas: Celda[];
  /** Fila de totales: se pinta en negrita con línea superior. */
  total?: boolean;
  /** Rótulo a todo lo ancho (subtítulo dentro de la tabla). */
  seccion?: boolean;
}

export type Bloque =
  | { tipo: 'kpis'; items: KpiItem[] }
  | {
    tipo: 'tabla';
    titulo?: string;
    nota?: string;
    headers: string[];
    formatos?: Formato[];
    filas: FilaTabla[];
    vacio?: string;
  }
  | { tipo: 'grafico'; titulo?: string; nota?: string; grafico: Grafico }
  | { tipo: 'texto'; titulo?: string; parrafos: string[] }
  | { tipo: 'lista'; titulo?: string; items: { texto: string; nivel?: 'ok' | 'aviso' | 'alerta' }[] };

export interface Seccion {
  id: string;
  titulo: string;
  /** Frase que explica de qué va la sección; va bajo el título. */
  intro?: string;
  bloques: Bloque[];
}

export interface Periodo {
  from: string;
  to: string;
  label: string;
  /** Meses 'YYYY-MM' que toca el período (para las series). */
  meses: string[];
}

export interface Informe {
  area: string;
  titulo: string;
  subtitulo: string;
  periodo: Periodo;
  /** Rangos con los que se compara (los que pidió el usuario). */
  comparados: { anterior?: Periodo; anioPasado?: Periodo };
  generado: string;
  secciones: Seccion[];
}

/**
 * Lo que recibe la función de cada área: el período, con qué se compara y qué
 * secciones marcó el usuario en el diálogo.
 */
export interface Ctx {
  p: Periodo;
  cmp: { anterior?: Periodo; anioPasado?: Periodo };
  quiere: (id: string) => boolean;
}

/** Ficha de una sección en el catálogo que ve el usuario al elegir qué incluir. */
export interface OpcionSeccion {
  id: string;
  titulo: string;
  desc: string;
  /** Marcada por defecto al abrir el diálogo. */
  base?: boolean;
}

// ---------------------------------------------------------------- constructores
// Azúcar para que las funciones de cada área se lean como el documento final.

export const kpis = (items: (KpiItem | null | false | undefined)[]): Bloque =>
  ({ tipo: 'kpis', items: items.filter(Boolean) as KpiItem[] });

export function tabla(
  titulo: string | undefined,
  headers: string[],
  formatos: Formato[],
  filas: (Celda[] | FilaTabla)[],
  extra: { nota?: string; vacio?: string } = {},
): Bloque {
  return {
    tipo: 'tabla',
    titulo,
    headers,
    formatos,
    filas: filas.map((f) => (Array.isArray(f) ? { celdas: f } : f)),
    ...extra,
  };
}

export const total = (celdas: Celda[]): FilaTabla => ({ celdas, total: true });

export const grafico = (titulo: string | undefined, g: Grafico, nota?: string): Bloque =>
  ({ tipo: 'grafico', titulo, grafico: g, nota });

export const texto = (parrafos: (string | null | false | undefined)[], titulo?: string): Bloque =>
  ({ tipo: 'texto', titulo, parrafos: parrafos.filter(Boolean) as string[] });

export const lista = (
  titulo: string | undefined,
  items: ({ texto: string; nivel?: 'ok' | 'aviso' | 'alerta' } | null | false | undefined)[],
): Bloque => ({
  tipo: 'lista',
  titulo,
  items: items.filter(Boolean) as { texto: string; nivel?: 'ok' | 'aviso' | 'alerta' }[],
});

/** Quita del documento las secciones que se quedaron sin nada que decir. */
export function limpiar(secciones: (Seccion | null)[]): Seccion[] {
  return secciones.filter((s): s is Seccion => !!s && s.bloques.length > 0);
}

// ---------------------------------------------------------------- paleta
/**
 * Colores del documento impreso. No se heredan del tema de pantalla: un informe
 * que va a Gerencia se imprime, y el tema oscuro sale ilegible en papel.
 */
export const COLOR = {
  ingresos: '#2F5496',
  egresos: '#C0504D',
  neto: '#1E7B45',
  oro: '#C9A227',
  morado: '#7C4FD8',
  naranja: '#E08A3C',
  celeste: '#4DA3FF',
  gris: '#8A8F9E',
  rosa: '#D06A9C',
  verdeClaro: '#6BAF4A',
} as const;

/** Colores en orden, para series y sectores sin color propio. */
export const PALETA = [
  COLOR.ingresos, COLOR.oro, COLOR.neto, COLOR.naranja, COLOR.morado,
  COLOR.celeste, COLOR.egresos, COLOR.verdeClaro, COLOR.rosa, COLOR.gris,
];

