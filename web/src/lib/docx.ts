/**
 * docx.ts — Exportación del informe gerencial a Word (.docx), sin dependencias.
 * (Tomado de Dorado Club; aquí con la marca de Komplex Gym.)
 *
 * Un .docx es un ZIP de XML igual que el .xlsx (el contenedor está en `zip.ts`).
 * Aquí se arma el documento: portada, índice, encabezados con nivel de esquema
 * —para que el panel de navegación de Word muestre la estructura—, tablas con
 * estilo, gráficos como imagen y pie con número de página.
 *
 * Los gráficos llegan como PNG desde `graficos.ts`: Word no incrusta SVG de
 * forma fiable y el mapa de bits se ve igual en cualquier equipo.
 */
import { dibujarGrafico, valorTxt, type Formato, type Grafico, type Imagen } from './graficos';
import { descargarBinario, enc, xmlEsc, zipStore } from './zip';

// ---------------------------------------------------------------- modelo
// Espejo del que arma el servidor en `domain/reports/informe/tipos.ts`.

export type Celda = string | number | null;

export interface KpiItem {
  label: string;
  valor: Celda;
  formato?: Formato;
  detalle?: string;
  tono?: 'pos' | 'neg' | 'warn';
}

export interface FilaTabla { celdas: Celda[]; total?: boolean; seccion?: boolean }

export type Bloque =
  | { tipo: 'kpis'; items: KpiItem[] }
  | {
    tipo: 'tabla'; titulo?: string; nota?: string; headers: string[];
    formatos?: Formato[]; filas: FilaTabla[]; vacio?: string;
  }
  | { tipo: 'grafico'; titulo?: string; nota?: string; grafico: Grafico }
  | { tipo: 'texto'; titulo?: string; parrafos: string[] }
  | { tipo: 'lista'; titulo?: string; items: { texto: string; nivel?: 'ok' | 'aviso' | 'alerta' }[] };

export interface Seccion { id: string; titulo: string; intro?: string; bloques: Bloque[] }

export interface PeriodoInforme { from: string; to: string; label: string; meses: string[] }

export interface Informe {
  area: string;
  titulo: string;
  subtitulo: string;
  periodo: PeriodoInforme;
  comparados: { anterior?: PeriodoInforme; anioPasado?: PeriodoInforme };
  generado: string;
  secciones: Seccion[];
}

// ---------------------------------------------------------------- medidas
/** Carta: 12240 × 15840 twips. Márgenes de 2 cm (1134 twips). */
const PAGINA = { ancho: 12240, alto: 15840, margen: 1134 };
const ANCHO_UTIL = PAGINA.ancho - PAGINA.margen * 2;   // 9972 twips
const EMU_POR_TWIP = 635;

const AZUL = '1F3864';
const AZUL2 = '2F5496';
const ORO = 'B0201A';
const TINTA = '1F2430';
const TINTA2 = '5C6270';
const VERDE = '1E7B45';
const ROJO = 'B02A20';
const AMBAR = 'A15C07';
const LINEA = 'D5D8DF';
const FRANJA = 'F4F6F9';
const CABECERA = AZUL2;

const TONO: Record<string, string> = { pos: VERDE, neg: ROJO, warn: AMBAR };

// ---------------------------------------------------------------- piezas XML
interface OpcRun { b?: boolean; i?: boolean; sz?: number; color?: string; caps?: boolean }

/** Un fragmento de texto con formato. `sz` va en puntos (no en medios puntos). */
function run(txt: string, o: OpcRun = {}): string {
  const rPr = [
    o.b ? '<w:b/>' : '',
    o.i ? '<w:i/>' : '',
    o.caps ? '<w:caps/>' : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '',
    o.sz ? `<w:sz w:val="${Math.round(o.sz * 2)}"/><w:szCs w:val="${Math.round(o.sz * 2)}"/>` : '',
  ].join('');
  // xml:space evita que Word coma los espacios de los extremos.
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(txt)}</w:t></w:r>`;
}

interface OpcParrafo {
  estilo?: string;
  jc?: 'left' | 'center' | 'right' | 'both';
  antes?: number;      // espacio antes, en puntos
  despues?: number;
  sangria?: number;    // sangría izquierda en twips
  colgante?: number;   // sangría francesa (viñetas)
  borde?: 'inferior';
  saltoAntes?: boolean;
  interlineado?: number;   // en % (240 = doble); por defecto el del estilo
}

function parrafo(contenido: string, o: OpcParrafo = {}): string {
  const esp = (o.antes !== undefined || o.despues !== undefined || o.interlineado !== undefined)
    ? `<w:spacing${o.antes !== undefined ? ` w:before="${Math.round(o.antes * 20)}"` : ''}`
      + `${o.despues !== undefined ? ` w:after="${Math.round(o.despues * 20)}"` : ''}`
      + `${o.interlineado !== undefined ? ` w:line="${o.interlineado}" w:lineRule="auto"` : ''}/>`
    : '';
  const ind = (o.sangria || o.colgante)
    ? `<w:ind${o.sangria ? ` w:left="${o.sangria}"` : ''}${o.colgante ? ` w:hanging="${o.colgante}"` : ''}/>`
    : '';
  // El orden importa: el esquema de OOXML define w:pPr como una secuencia
  // (pStyle → pageBreakBefore → pBdr → spacing → ind → jc) y Word rechaza el
  // documento si los elementos vienen desordenados.
  const pPr = [
    o.estilo ? `<w:pStyle w:val="${o.estilo}"/>` : '',
    o.saltoAntes ? '<w:pageBreakBefore/>' : '',
    o.borde === 'inferior' ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:color="${LINEA}"/></w:pBdr>` : '',
    esp,
    ind,
    o.jc ? `<w:jc w:val="${o.jc}"/>` : '',
  ].join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${contenido}</w:p>`;
}

const vacio = (pts = 6): string => parrafo('', { despues: pts, antes: 0 });

/** Celda de tabla. `ancho` en twips. */
function celda(contenido: string, ancho: number, relleno?: string): string {
  return '<w:tc><w:tcPr>'
    + `<w:tcW w:w="${ancho}" w:type="dxa"/>`
    + (relleno ? `<w:shd w:val="clear" w:color="auto" w:fill="${relleno}"/>` : '')
    + '<w:vAlign w:val="center"/>'
    + '</w:tcPr>'
    + (contenido || parrafo(''))
    + '</w:tc>';
}

const fila = (celdas: string, cabecera = false): string =>
  `<w:tr>${cabecera ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${celdas}</w:tr>`;

function tablaXml(anchos: number[], filas: string, conBordes = true): string {
  const bordes = conBordes
    ? '<w:tblBorders>'
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="${LINEA}"/>`).join('')
      + '</w:tblBorders>'
    : '';
  // Mismo criterio que en w:pPr: la secuencia del esquema es
  // tblW → tblBorders → tblLayout → tblCellMar.
  return '<w:tbl><w:tblPr>'
    + `<w:tblW w:w="${anchos.reduce((s, a) => s + a, 0)}" w:type="dxa"/>`
    + bordes
    + '<w:tblLayout w:type="fixed"/>'
    + '<w:tblCellMar>'
    + '<w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
    + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>'
    + '</w:tblCellMar>'
    + '</w:tblPr>'
    + `<w:tblGrid>${anchos.map((a) => `<w:gridCol w:w="${a}"/>`).join('')}</w:tblGrid>`
    + filas
    + '</w:tbl>';
}

// ---------------------------------------------------------------- formato de celdas
const esNumerico = (f?: Formato): boolean => !!f && f !== 'texto';

function textoCelda(v: Celda, f?: Formato): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return valorTxt(v, f ?? 'num');
  return String(v);
}

/** Reparte el ancho de la tabla entre las columnas según lo que llevan dentro. */
function anchosColumnas(headers: string[], filas: FilaTabla[], formatos: Formato[]): number[] {
  const n = headers.length;
  const peso = headers.map((h, i) => {
    let m = h.length * 0.85 + 2;
    for (const f of filas) {
      const v = f.celdas[i];
      const largo = typeof v === 'number' ? Math.min(12, textoCelda(v, formatos[i]).length) : String(v ?? '').length;
      m = Math.max(m, Math.min(largo, 34));
    }
    // Las columnas numéricas no necesitan crecer tanto: su contenido es corto.
    return esNumerico(formatos[i]) ? Math.min(m, 14) : m;
  });
  const suma = peso.reduce((s, x) => s + x, 0) || 1;
  const minimo = Math.min(560, Math.floor(ANCHO_UTIL / n));
  const anchos = peso.map((x) => Math.max(minimo, Math.round(ANCHO_UTIL * x / suma)));
  // La suma tiene que cuadrar exactamente con el ancho de la página: el sobrante
  // (o el faltante que dejaron los mínimos) se reparte entre las columnas que
  // pueden ceder, nunca dejando ninguna por debajo del mínimo.
  let dif = ANCHO_UTIL - anchos.reduce((s, x) => s + x, 0);
  for (let vuelta = 0; vuelta < 3 && dif !== 0; vuelta++) {
    const ceden = anchos.map((a, i) => (dif > 0 || a > minimo ? i : -1)).filter((i) => i >= 0);
    if (!ceden.length) break;
    const trozo = Math.trunc(dif / ceden.length);
    for (const i of ceden) {
      const nuevo = Math.max(minimo, anchos[i] + (i === ceden[ceden.length - 1] ? dif - trozo * (ceden.length - 1) : trozo));
      dif -= nuevo - anchos[i];
      anchos[i] = nuevo;
    }
  }
  return anchos;
}

// ---------------------------------------------------------------- bloques
function bloqueTabla(b: Extract<Bloque, { tipo: 'tabla' }>): string {
  const formatos = b.formatos ?? b.headers.map(() => 'texto' as Formato);
  const salida: string[] = [];
  if (b.titulo) salida.push(parrafo(run(b.titulo, { b: true, sz: 10.5, color: AZUL2 }), { antes: 10, despues: 3 }));

  if (!b.filas.length) {
    salida.push(parrafo(run(b.vacio ?? 'Sin datos en el período.', { i: true, sz: 9.5, color: TINTA2 }), { despues: 8 }));
    return salida.join('');
  }

  const anchos = anchosColumnas(b.headers, b.filas, formatos);
  const filas: string[] = [];

  filas.push(fila(b.headers.map((h, i) => celda(
    parrafo(run(h, { b: true, sz: 8.5, color: 'FFFFFF' }),
      { jc: esNumerico(formatos[i]) ? 'right' : 'left', antes: 2, despues: 2 }),
    anchos[i], CABECERA,
  )).join(''), true));

  let alterna = 0;
  for (const f of b.filas) {
    if (f.seccion) {
      filas.push(fila(celda(
        parrafo(run(String(f.celdas[0] ?? ''), { b: true, sz: 9, color: AZUL }), { antes: 2, despues: 2 }),
        ANCHO_UTIL, 'E8ECF4',
      )));
      continue;
    }
    const relleno = f.total ? 'DCE6F1' : (alterna % 2 === 1 ? FRANJA : undefined);
    if (!f.total) alterna++;
    filas.push(fila(b.headers.map((_, i) => {
      const v = f.celdas[i] ?? null;
      const num = esNumerico(formatos[i]);
      // Los negativos en rojo: en un informe de gestión hay que verlos de lejos.
      const rojo = typeof v === 'number' && v < 0 && (formatos[i] === 'usd' || formatos[i] === 'pct');
      return celda(
        parrafo(run(textoCelda(v, formatos[i]), {
          b: f.total, sz: 8.5, color: rojo ? ROJO : (f.total ? AZUL : TINTA),
        }), { jc: num ? 'right' : 'left', antes: 2, despues: 2 }),
        anchos[i], relleno,
      );
    }).join('')));
  }

  salida.push(tablaXml(anchos, filas.join('')));
  if (b.nota) {
    salida.push(parrafo(run(b.nota, { i: true, sz: 8, color: TINTA2 }), { antes: 3, despues: 8 }));
  } else {
    salida.push(vacio(8));
  }
  return salida.join('');
}

function bloqueKpis(b: Extract<Bloque, { tipo: 'kpis' }>): string {
  const items = b.items.filter((k) => k.valor !== null && k.valor !== undefined && k.valor !== '');
  if (!items.length) return '';
  const cols = items.length <= 2 ? items.length : 3;
  const ancho = Math.floor(ANCHO_UTIL / cols);
  const filas: string[] = [];

  for (let i = 0; i < items.length; i += cols) {
    const grupo = items.slice(i, i + cols);
    const celdas = grupo.map((k) => {
      const dentro = [
        parrafo(run(k.label.toUpperCase(), { sz: 7.5, color: TINTA2, caps: true }), { antes: 4, despues: 1 }),
        parrafo(run(textoCelda(k.valor, k.formato), { b: true, sz: 15, color: k.tono ? TONO[k.tono] : AZUL }),
          { despues: k.detalle ? 1 : 4 }),
        k.detalle ? parrafo(run(k.detalle, { sz: 7.5, color: TINTA2 }), { despues: 4 }) : '',
      ].join('');
      return celda(dentro, ancho, 'F7F9FC');
    });
    // Rellena la última fila para que la rejilla no quede coja.
    while (celdas.length < cols) celdas.push(celda(parrafo(''), ancho));
    filas.push(fila(celdas.join('')));
  }
  return tablaXml(new Array(cols).fill(ancho), filas.join('')) + vacio(8);
}

function bloqueTexto(b: Extract<Bloque, { tipo: 'texto' }>): string {
  if (!b.parrafos.length) return '';
  const salida: string[] = [];
  if (b.titulo) salida.push(parrafo(run(b.titulo, { b: true, sz: 10.5, color: AZUL2 }), { antes: 10, despues: 3 }));
  for (const t of b.parrafos) {
    salida.push(parrafo(run(t, { sz: 10 }), { jc: 'both', despues: 5, interlineado: 264 }));
  }
  return salida.join('') + vacio(4);
}

const VIÑETA: Record<string, { simbolo: string; color: string }> = {
  alerta: { simbolo: '■', color: ROJO },
  aviso: { simbolo: '▲', color: AMBAR },
  ok: { simbolo: '●', color: VERDE },
};

function bloqueLista(b: Extract<Bloque, { tipo: 'lista' }>): string {
  if (!b.items.length) return '';
  const salida: string[] = [];
  if (b.titulo) salida.push(parrafo(run(b.titulo, { b: true, sz: 10.5, color: AZUL2 }), { antes: 10, despues: 3 }));
  for (const it of b.items) {
    const v = VIÑETA[it.nivel ?? 'aviso'] ?? VIÑETA.aviso;
    salida.push(parrafo(
      run(v.simbolo + '  ', { color: v.color, sz: 10, b: true }) + run(it.texto, { sz: 10 }),
      { sangria: 340, colgante: 340, despues: 5, jc: 'both' },
    ));
  }
  return salida.join('') + vacio(4);
}

interface Medios { nombre: string; bytes: Uint8Array }

function bloqueGrafico(
  b: Extract<Bloque, { tipo: 'grafico' }>, medios: Medios[],
): string {
  const img = dibujarGrafico(b.grafico);
  if (!img) return '';
  const salida: string[] = [];
  if (b.titulo) salida.push(parrafo(run(b.titulo, { b: true, sz: 10.5, color: AZUL2 }), { antes: 10, despues: 3 }));
  salida.push(parrafo(imagenXml(img, medios), { jc: 'center', despues: b.nota ? 2 : 8 }));
  if (b.nota) salida.push(parrafo(run(b.nota, { i: true, sz: 8, color: TINTA2 }), { jc: 'center', despues: 9 }));
  return salida.join('');
}

/** Dibujo incrustado: la imagen se estira al ancho útil conservando su proporción. */
function imagenXml(img: Imagen, medios: Medios[]): string {
  const idx = medios.length + 1;
  const nombre = `imagen${idx}.png`;
  medios.push({ nombre, bytes: img.bytes });
  const rid = `rIdImg${idx}`;
  const cx = ANCHO_UTIL * EMU_POR_TWIP;
  const cy = Math.round(cx * (img.alto / img.ancho));
  return '<w:r><w:drawing>'
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${idx}" name="${nombre}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${idx}" name="${nombre}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline>'
    + '</w:drawing></w:r>';
}

// ---------------------------------------------------------------- documento
const fmtFecha = (s: string): string => {
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : s;
};

function portada(inf: Informe): string {
  const cmp: string[] = [];
  if (inf.comparados.anterior) cmp.push(`período anterior (${inf.comparados.anterior.label})`);
  if (inf.comparados.anioPasado) cmp.push(`mismo período del año pasado (${inf.comparados.anioPasado.label})`);

  return [
    vacio(90),
    parrafo(run('KOMPLEX GYM', { sz: 11, color: ORO, b: true, caps: true }), { jc: 'center', despues: 4 }),
    parrafo(run(inf.titulo, { sz: 26, b: true, color: AZUL }), { jc: 'center', despues: 6 }),
    parrafo('', { jc: 'center', despues: 10, borde: 'inferior' }),
    parrafo(run(inf.periodo.label, { sz: 14, color: TINTA }), { jc: 'center', despues: 3 }),
    parrafo(run(`${fmtFecha(inf.periodo.from)} — ${fmtFecha(inf.periodo.to)}`, { sz: 10, color: TINTA2 }),
      { jc: 'center', despues: 24 }),
    cmp.length
      ? parrafo(run('Comparado con: ' + cmp.join(' y ') + '.', { sz: 9.5, i: true, color: TINTA2 }),
        { jc: 'center', despues: 6 })
      : '',
    vacio(120),
    parrafo(run('Documento para Gerencia General', { sz: 10, b: true, color: TINTA2 }), { jc: 'center', despues: 3 }),
    parrafo(run(`Generado el ${inf.generado}`, { sz: 9, color: TINTA2 }), { jc: 'center', despues: 3 }),
    parrafo(run('Cifras expresadas en dólares estadounidenses (USD).', { sz: 9, color: TINTA2 }),
      { jc: 'center' }),
  ].join('');
}

function indice(inf: Informe): string {
  const salida = [
    parrafo(run('Contenido', { sz: 16, b: true, color: AZUL }), { saltoAntes: true, despues: 8 }),
  ];
  inf.secciones.forEach((s, i) => {
    salida.push(parrafo(
      run(`${i + 1}.  `, { b: true, color: ORO, sz: 10.5 }) + run(s.titulo, { sz: 10.5 }),
      { sangria: 280, colgante: 280, despues: 4 },
    ));
  });
  salida.push(vacio(10));
  salida.push(parrafo(
    run('Nota metodológica: ', { b: true, sz: 8.5, color: TINTA2 })
    + run('el ingreso es lo cobrado en afiliaciones convertido a dólares con la tasa registrada en cada '
      + 'pago, menos los vueltos. Las transferencias marcadas como "no llegó" no cuentan como ingreso; las '
      + 'pendientes de verificar sí, y se señalan aparte. "Pago mixto" suma dinero pero no cuenta como otro '
      + 'afiliado. El resultado neto resta los gastos de caja; los retiros (dinero entregado a la gerencia o '
      + 'al banco) no son gasto.',
    { sz: 8.5, color: TINTA2 }),
    { jc: 'both' },
  ));
  return salida.join('');
}

function seccionXml(s: Seccion, medios: Medios[], primera: boolean, numero: number): string {
  const salida = [
    parrafo(
      run(`${numero}.  `, { b: true, color: ORO, sz: 15 }) + run(s.titulo, { b: true, color: AZUL, sz: 15 }),
      { estilo: 'Titulo1', saltoAntes: !primera, antes: primera ? 0 : 6, despues: 4, borde: 'inferior' },
    ),
  ];
  if (s.intro) {
    salida.push(parrafo(run(s.intro, { i: true, sz: 9.5, color: TINTA2 }), { despues: 8, jc: 'both' }));
  }
  for (const b of s.bloques) {
    if (b.tipo === 'kpis') salida.push(bloqueKpis(b));
    else if (b.tipo === 'tabla') salida.push(bloqueTabla(b));
    else if (b.tipo === 'grafico') salida.push(bloqueGrafico(b, medios));
    else if (b.tipo === 'texto') salida.push(bloqueTexto(b));
    else if (b.tipo === 'lista') salida.push(bloqueLista(b));
  }
  return salida.join('');
}

// ---------------------------------------------------------------- partes fijas
const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr>'
  + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
  + `<w:color w:val="${TINTA}"/><w:sz w:val="20"/><w:szCs w:val="20"/>`
  + '<w:lang w:val="es-VE"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
  + '</w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  // El nivel de esquema es lo que hace que el panel de navegación de Word
  // muestre las secciones y que se pueda generar un índice automático.
  + '<w:style w:type="paragraph" w:styleId="Titulo1">'
  + '<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>'
  + '<w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>'
  + `<w:rPr><w:b/><w:color w:val="${AZUL}"/><w:sz w:val="30"/></w:rPr></w:style>`
  + '<w:style w:type="table" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>'
  + '</w:styles>';

const PIE = (titulo: string): string => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:p><w:pPr>'
  + `<w:pBdr><w:top w:val="single" w:sz="4" w:color="${LINEA}"/></w:pBdr>`
  + `<w:tabs><w:tab w:val="right" w:pos="${ANCHO_UTIL}"/></w:tabs>`
  + '<w:spacing w:before="60"/></w:pPr>'
  + `<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="${TINTA2}"/></w:rPr>`
  + `<w:t xml:space="preserve">Komplex Gym · ${xmlEsc(titulo)}</w:t></w:r>`
  + '<w:r><w:tab/></w:r>'
  + `<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="${TINTA2}"/></w:rPr><w:t xml:space="preserve">Página </w:t></w:r>`
  + `<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="${TINTA2}"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>`
  + '</w:p></w:ftr>';

const SETTINGS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:defaultTabStop w:val="708"/><w:evenAndOddHeaders w:val="false"/>'
  + '</w:settings>';

function core(inf: Informe): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
    + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${xmlEsc(inf.titulo)} — ${xmlEsc(inf.periodo.label)}</dc:title>`
    + '<dc:creator>Gerencia Komplex</dc:creator>'
    + '<cp:lastModifiedBy>Gerencia Komplex</cp:lastModifiedBy>'
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>`
    + '</cp:coreProperties>';
}

// ---------------------------------------------------------------- armado
export function construirDocx(inf: Informe): Uint8Array {
  const medios: Medios[] = [];
  const cuerpo = [
    portada(inf),
    indice(inf),
    ...inf.secciones.map((s, i) => seccionXml(s, medios, false, i + 1)),
  ].join('');

  const sectPr = '<w:sectPr>'
    + '<w:footerReference w:type="default" r:id="rIdPie"/>'
    + `<w:pgSz w:w="${PAGINA.ancho}" w:h="${PAGINA.alto}"/>`
    + `<w:pgMar w:top="${PAGINA.margen}" w:right="${PAGINA.margen}" w:bottom="${PAGINA.margen}" `
    + `w:left="${PAGINA.margen}" w:header="708" w:footer="567" w:gutter="0"/>`
    + '</w:sectPr>';

  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    + `<w:body>${cuerpo}${sectPr}</w:body></w:document>`;

  const rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    '<Relationship Id="rIdPie" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'];
  medios.forEach((m, i) => rels.push(
    `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.nombre}"/>`));
  rels.push('</Relationships>');

  const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '</Types>'].join('');

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '</Relationships>';

  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, txt: string) => files.push({ name, data: enc.encode(txt) });
  add('[Content_Types].xml', ct);
  add('_rels/.rels', rootRels);
  add('docProps/core.xml', core(inf));
  add('word/document.xml', document);
  add('word/_rels/document.xml.rels', rels.join(''));
  add('word/styles.xml', ESTILOS);
  add('word/settings.xml', SETTINGS);
  add('word/footer1.xml', PIE(inf.titulo));
  for (const m of medios) files.push({ name: `word/media/${m.nombre}`, data: m.bytes });
  return zipStore(files);
}

/** Nombre de archivo sin caracteres que Windows rechace. */
export function nombreArchivo(inf: Informe): string {
  const limpio = `${inf.titulo} - ${inf.periodo.label}`
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${limpio}.docx`;
}

/** Genera el .docx y lanza la descarga. */
export function exportarInformeWord(inf: Informe): void {
  descargarBinario(
    nombreArchivo(inf),
    construirDocx(inf),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
}
