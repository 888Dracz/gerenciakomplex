/**
 * graficos.ts — Gráficos del informe, dibujados en un canvas y exportados a PNG.
 *
 * Los gráficos de pantalla (`components/Charts.tsx`) son SVG con variables CSS:
 * no se pueden meter en un Word. Aquí se vuelven a dibujar sobre un canvas con
 * una paleta fija de impresión y se sacan como PNG a 2× de resolución, que es
 * lo que Word sabe incrustar.
 *
 * Word no admite SVG en versiones antiguas y el PNG se ve igual en cualquier
 * equipo, así que el mapa de bits es la opción segura para un documento que se
 * imprime y se reenvía por correo.
 */

export type Formato = 'usd' | 'num' | 'int' | 'pct' | 'horas' | 'texto';

export interface SerieGrafico {
  label: string;
  datos: number[];
  color?: string;
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

export interface Imagen { bytes: Uint8Array; ancho: number; alto: number }

// ---------------------------------------------------------------- estilo
const ESCALA = 2;                       // 2× para que no se vea pixelado al imprimir
const ANCHO = 660;                      // ancho útil de la página en puntos aprox.
const FUENTE = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const TINTA = '#1f2430';
const TINTA2 = '#5c6270';
const REJILLA = '#dfe3ea';
const EJE = '#aeb4c0';
const FONDO = '#ffffff';

const PALETA = [
  '#2F5496', '#C9A227', '#1E7B45', '#E08A3C', '#7C4FD8',
  '#4DA3FF', '#C0504D', '#6BAF4A', '#D06A9C', '#8A8F9E',
];

const color = (s: { color?: string }, i: number): string => s.color ?? PALETA[i % PALETA.length];

// ---------------------------------------------------------------- números
const miles = (n: number, d = 0): string =>
  n.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Etiqueta compacta para el eje: 1.2k, 3.4M. */
function ejeTxt(v: number, formato: Formato): string {
  const abs = Math.abs(v);
  const signo = v < 0 ? '−' : '';
  let s: string;
  if (abs >= 1_000_000) s = miles(abs / 1_000_000, 1) + 'M';
  else if (abs >= 1000) s = miles(abs / 1000, abs >= 10_000 ? 0 : 1) + 'k';
  else s = miles(abs, abs < 10 && abs % 1 !== 0 ? 1 : 0);
  if (formato === 'usd') return `${signo}$${s}`;
  if (formato === 'pct') return `${signo}${s}%`;
  if (formato === 'horas') return `${signo}${s} h`;
  return signo + s;
}

/** Etiqueta completa, la que se escribe encima de la barra o en la leyenda. */
export function valorTxt(v: number, formato: Formato = 'num'): string {
  if (!isFinite(v)) return '—';
  const signo = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  if (formato === 'usd') {
    return abs >= 10_000 ? `${signo}$${miles(abs, 0)}` : `${signo}$${miles(abs, 2)}`;
  }
  if (formato === 'pct') return `${signo}${miles(abs, 1)}%`;
  if (formato === 'int') return signo + miles(abs, 0);
  if (formato === 'horas') return `${signo}${miles(abs, Number.isInteger(abs) ? 0 : 1)} h`;
  return signo + miles(abs, Number.isInteger(abs) ? 0 : 2);
}

/**
 * Escala "bonita" del eje: el tope se redondea a 1, 2, 2.5 o 5 por potencia de
 * diez, para que las líneas de la rejilla caigan en números legibles.
 */
function escala(min: number, max: number): { lo: number; hi: number; paso: number } {
  if (max === min) { max = min + 1; }
  const bruto = (max - min) / 4;
  const pot = 10 ** Math.floor(Math.log10(Math.abs(bruto) || 1));
  const norm = bruto / pot;
  const paso = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * pot;
  return { lo: Math.floor(min / paso) * paso, hi: Math.ceil(max / paso) * paso, paso };
}

// ---------------------------------------------------------------- canvas
interface Lienzo { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement; w: number; h: number }

function lienzo(w: number, h: number): Lienzo {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * ESCALA);
  canvas.height = Math.round(h * ESCALA);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ESCALA, ESCALA);
  ctx.fillStyle = FONDO;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  return { ctx, canvas, w, h };
}

function fuente(ctx: CanvasRenderingContext2D, px: number, peso: '400' | '600' = '400'): void {
  ctx.font = `${peso} ${px}px ${FUENTE}`;
}

/** Recorta el texto con puntos suspensivos si no cabe en `max` píxeles. */
function recortar(ctx: CanvasRenderingContext2D, txt: string, max: number): string {
  if (ctx.measureText(txt).width <= max) return txt;
  let s = txt;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

function aPng(l: Lienzo): Imagen {
  const b64 = l.canvas.toDataURL('image/png').split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ancho: l.canvas.width, alto: l.canvas.height };
}

/** Leyenda horizontal centrada; devuelve el alto que ocupó. */
function leyenda(
  ctx: CanvasRenderingContext2D, w: number, y: number,
  items: { label: string; color: string; linea?: boolean }[],
): number {
  if (items.length < 2) return 0;
  fuente(ctx, 11);
  const anchos = items.map((it) => 16 + ctx.measureText(it.label).width + 16);
  const total = anchos.reduce((s, x) => s + x, 0) - 16;
  let x = Math.max(8, (w - total) / 2);
  items.forEach((it, i) => {
    ctx.fillStyle = it.color;
    if (it.linea) {
      ctx.fillRect(x, y - 1.5, 12, 3);
      ctx.beginPath();
      ctx.arc(x + 6, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, y - 5, 10, 10);
    }
    ctx.fillStyle = TINTA2;
    ctx.fillText(it.label, x + 16, y);
    x += anchos[i];
  });
  return 22;
}

// ---------------------------------------------------------------- ejes
interface Marco {
  x0: number; x1: number; y0: number; y1: number;
  lo: number; hi: number;
  y: (v: number) => number;
}

function ejes(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  min: number, max: number, formato: Formato, topY: number, baseY: number,
): Marco {
  const { lo, hi, paso } = escala(Math.min(0, min), Math.max(0, max));
  fuente(ctx, 10.5);
  // El margen izquierdo se ajusta al ancho real de las etiquetas del eje.
  let anchoEtiq = 0;
  for (let v = lo; v <= hi + paso / 2; v += paso) {
    anchoEtiq = Math.max(anchoEtiq, ctx.measureText(ejeTxt(v, formato)).width);
  }
  const x0 = Math.ceil(anchoEtiq) + 14;
  const x1 = w - 12;
  const y0 = topY;
  const y1 = baseY;
  const y = (v: number) => y1 - (v - lo) / (hi - lo || 1) * (y1 - y0);

  ctx.strokeStyle = REJILLA;
  ctx.lineWidth = 1;
  for (let v = lo; v <= hi + paso / 2; v += paso) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
    ctx.stroke();
    ctx.fillStyle = TINTA2;
    ctx.textAlign = 'right';
    ctx.fillText(ejeTxt(v, formato), x0 - 6, y(v));
  }
  // Línea del cero más marcada cuando hay valores negativos.
  if (lo < 0) {
    ctx.strokeStyle = EJE;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y(0)) + 0.5);
    ctx.lineTo(x1, Math.round(y(0)) + 0.5);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  return { x0, x1, y0, y1, lo, hi, y };
}

/** Etiquetas del eje horizontal, giradas si no caben derechas. */
function categorias(
  ctx: CanvasRenderingContext2D, cats: string[], x0: number, ancho: number, yBase: number, h: number,
): void {
  fuente(ctx, 10.5);
  const paso = ancho / cats.length;
  const cabe = cats.every((c) => ctx.measureText(c).width <= paso - 4);
  ctx.fillStyle = TINTA2;
  cats.forEach((c, i) => {
    const cx = x0 + paso * i + paso / 2;
    if (cabe) {
      ctx.textAlign = 'center';
      ctx.fillText(c, cx, yBase + 12);
    } else {
      ctx.save();
      ctx.translate(cx, yBase + 8);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(recortar(ctx, c, h - yBase - 14), 0, 0);
      ctx.restore();
    }
  });
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------- tipos de gráfico
function barrasYLineas(g: Extract<Grafico, { clase: 'barras' | 'lineas' | 'combo' }>): Imagen {
  const cats = g.categorias;
  const formato = g.formato ?? 'num';
  const barras = g.series.filter((s) => !s.linea);
  const lineas = g.series.filter((s) => s.linea);
  const soloLineas = g.clase === 'lineas' || barras.length === 0;

  // Con muchas categorías el gráfico necesita más aire horizontal.
  const alto = 300;
  const l = lienzo(ANCHO, alto);
  const { ctx } = l;

  const items = g.series.map((s, i) => ({ label: s.label, color: color(s, i), linea: !!s.linea || soloLineas }));
  const altoLeyenda = leyenda(ctx, ANCHO, 12, items);
  const topY = 14 + altoLeyenda;

  // Espacio inferior: si las etiquetas van giradas necesitan el doble.
  fuente(ctx, 10.5);
  const anchoTotal = ANCHO - 12 - 40;
  const cabenDerechas = cats.every((c) => ctx.measureText(c).width <= anchoTotal / cats.length - 4);
  const baseY = alto - (cabenDerechas ? 26 : 62);

  const todos = g.series.flatMap((s) => s.datos.filter((v) => isFinite(v)));
  const marco = ejes(ctx, ANCHO, alto, Math.min(...todos, 0), Math.max(...todos, 0), formato, topY, baseY);
  const paso = (marco.x1 - marco.x0) / Math.max(1, cats.length);
  const y0 = marco.y(0);

  if (!soloLineas && barras.length) {
    const hueco = Math.min(10, paso * 0.18);
    const anchoGrupo = paso - hueco;
    const anchoBarra = Math.max(2, anchoGrupo / barras.length);
    barras.forEach((s, si) => {
      ctx.fillStyle = color(s, g.series.indexOf(s));
      s.datos.forEach((v, i) => {
        if (!isFinite(v)) return;
        const x = marco.x0 + paso * i + hueco / 2 + anchoBarra * si;
        const yv = marco.y(v);
        ctx.fillRect(x, Math.min(yv, y0), Math.max(1, anchoBarra - 1.5), Math.max(1, Math.abs(y0 - yv)));
      });
    });
    // Valor encima de la barra solo si hay una serie y pocas categorías: con
    // más, los números se pisan y ensucian el gráfico.
    if (barras.length === 1 && cats.length <= 14) {
      fuente(ctx, 9.5, '600');
      ctx.fillStyle = TINTA2;
      ctx.textAlign = 'center';
      barras[0].datos.forEach((v, i) => {
        if (!isFinite(v) || v === 0) return;
        const x = marco.x0 + paso * i + paso / 2;
        const yv = marco.y(v);
        ctx.fillText(valorTxt(v, formato), x, v >= 0 ? yv - 8 : yv + 9);
      });
      ctx.textAlign = 'left';
    }
  }

  const dibujarLinea = (s: SerieGrafico, idx: number) => {
    const c = color(s, idx);
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let empezada = false;
    s.datos.forEach((v, i) => {
      if (!isFinite(v)) return;
      const x = marco.x0 + paso * i + paso / 2;
      const yy = marco.y(v);
      if (empezada) ctx.lineTo(x, yy);
      else { ctx.moveTo(x, yy); empezada = true; }
    });
    ctx.stroke();
    ctx.fillStyle = c;
    s.datos.forEach((v, i) => {
      if (!isFinite(v)) return;
      ctx.beginPath();
      ctx.arc(marco.x0 + paso * i + paso / 2, marco.y(v), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  if (soloLineas) g.series.forEach((s, i) => dibujarLinea(s, i));
  else lineas.forEach((s) => dibujarLinea(s, g.series.indexOf(s)));

  categorias(ctx, cats, marco.x0, marco.x1 - marco.x0, baseY, alto);
  return aPng(l);
}

function pastel(g: Extract<Grafico, { clase: 'pastel' }>): Imagen {
  const items = g.items.filter((x) => isFinite(x.valor) && x.valor > 0);
  const formato = g.formato ?? 'num';
  const alto = Math.max(230, 40 + items.length * 20);
  const l = lienzo(ANCHO, alto);
  const { ctx } = l;

  const total = items.reduce((s, x) => s + x.valor, 0);
  if (!total) return aPng(l);

  const r = Math.min(alto / 2 - 18, 96);
  const cx = 20 + r;
  const cy = alto / 2;

  let ang = -Math.PI / 2;
  items.forEach((it, i) => {
    const barrido = it.valor / total * Math.PI * 2;
    ctx.fillStyle = PALETA[i % PALETA.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, ang, ang + barrido);
    ctx.closePath();
    ctx.fill();
    // Porcentaje dentro del sector, solo si el trozo da para leerlo.
    const pct = it.valor / total * 100;
    if (pct >= 7) {
      const m = ang + barrido / 2;
      ctx.fillStyle = '#ffffff';
      fuente(ctx, 11, '600');
      ctx.textAlign = 'center';
      ctx.fillText(`${miles(pct, 0)}%`, cx + Math.cos(m) * r * 0.64, cy + Math.sin(m) * r * 0.64);
      ctx.textAlign = 'left';
    }
    ang += barrido;
  });

  // Agujero central: un donut se lee mejor que un pastel macizo.
  ctx.fillStyle = FONDO;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TINTA;
  fuente(ctx, 12, '600');
  ctx.textAlign = 'center';
  ctx.fillText(valorTxt(total, formato), cx, cy - 6);
  fuente(ctx, 9.5);
  ctx.fillStyle = TINTA2;
  ctx.fillText('TOTAL', cx, cy + 9);
  ctx.textAlign = 'left';

  // Leyenda en columna a la derecha, con valor y porcentaje.
  const lx = cx + r + 26;
  const filas = items.length;
  const altoFila = Math.min(20, (alto - 24) / Math.max(1, filas));
  let ly = cy - (filas * altoFila) / 2 + altoFila / 2;
  items.forEach((it, i) => {
    ctx.fillStyle = PALETA[i % PALETA.length];
    ctx.fillRect(lx, ly - 5, 10, 10);
    fuente(ctx, 11);
    ctx.fillStyle = TINTA;
    const dato = `${valorTxt(it.valor, formato)}  ·  ${miles(it.valor / total * 100, 1)}%`;
    const anchoDato = ctx.measureText(dato).width;
    ctx.fillText(recortar(ctx, it.label, ANCHO - lx - anchoDato - 34), lx + 16, ly);
    ctx.fillStyle = TINTA2;
    ctx.textAlign = 'right';
    ctx.fillText(dato, ANCHO - 10, ly);
    ctx.textAlign = 'left';
    ly += altoFila;
  });
  return aPng(l);
}

function barrasH(g: Extract<Grafico, { clase: 'barrasH' }>): Imagen {
  const items = g.items.filter((x) => isFinite(x.valor));
  const formato = g.formato ?? 'num';
  if (!items.length) return aPng(lienzo(ANCHO, 40));

  const altoFila = 24;
  const alto = 16 + items.length * altoFila;
  const l = lienzo(ANCHO, alto);
  const { ctx } = l;

  fuente(ctx, 11);
  const anchoEtiq = Math.min(190, Math.max(...items.map((x) => ctx.measureText(x.label).width)) + 8);
  const x0 = anchoEtiq + 8;
  // El valor va escrito al final de la barra: hay que reservarle sitio.
  fuente(ctx, 10.5, '600');
  const anchoValor = Math.max(...items.map((x) => ctx.measureText(valorTxt(x.valor, formato)).width)) + 10;
  const x1 = ANCHO - anchoValor - 6;

  const max = Math.max(...items.map((x) => Math.abs(x.valor)), 0.000001);
  const c = g.color ?? PALETA[0];

  items.forEach((it, i) => {
    const y = 8 + i * altoFila + altoFila / 2;
    fuente(ctx, 11);
    ctx.fillStyle = TINTA;
    ctx.textAlign = 'right';
    ctx.fillText(recortar(ctx, it.label, anchoEtiq), anchoEtiq, y);
    ctx.textAlign = 'left';

    const ancho = Math.abs(it.valor) / max * (x1 - x0);
    // Fondo tenue: da referencia de cuánto falta para el máximo de la serie.
    ctx.fillStyle = '#f1f3f7';
    ctx.fillRect(x0, y - 8, x1 - x0, 16);
    ctx.fillStyle = it.valor < 0 ? '#C0504D' : c;
    ctx.fillRect(x0, y - 8, Math.max(1, ancho), 16);

    fuente(ctx, 10.5, '600');
    ctx.fillStyle = TINTA2;
    ctx.fillText(valorTxt(it.valor, formato), x0 + ancho + 6, y);
  });
  return aPng(l);
}

/** Dibuja el gráfico y devuelve el PNG listo para incrustar en el documento. */
export function dibujarGrafico(g: Grafico): Imagen | null {
  try {
    if (g.clase === 'pastel') return g.items.some((x) => x.valor > 0) ? pastel(g) : null;
    if (g.clase === 'barrasH') return g.items.length ? barrasH(g) : null;
    if (!g.categorias.length || !g.series.length) return null;
    if (!g.series.some((s) => s.datos.some((v) => isFinite(v) && v !== 0))) return null;
    return barrasYLineas(g);
  } catch {
    // Un gráfico que no se puede dibujar no debe tumbar el informe entero.
    return null;
  }
}
