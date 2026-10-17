/**
 * xlsx.ts — Exportación a Excel (.xlsx) sin dependencias.
 *
 * Un .xlsx es un ZIP de archivos XML (OOXML). El contenedor ZIP está en
 * `zip.ts` (lo comparte con el exportador de Word); aquí queda el mínimo de
 * partes XML que Excel, LibreOffice y Google Sheets abren sin avisos. Dos
 * formas de usarlo:
 *
 *   exportExcel(archivo, hojas)  — datos estructurados (números nativos).
 *     hojas = [{ nombre, headers:[str], filas:[[celda,...]], titulo, subtitulo }]
 *     celda: number  -> celda numérica (se puede sumar en Excel)
 *            string  -> texto
 *            null/'' -> celda vacía
 *
 *   exportarVista(archivo, cont) — recorre las tablas <table class="t"> ya
 *     dibujadas en pantalla y arma una hoja por tabla, convirtiendo las celdas
 *     numéricas (clase "num") a número.
 */

import { descargarBinario, enc, xmlEsc, zipStore } from './zip';

export type Celda = string | number | null | undefined;

export interface Hoja {
  nombre: string;
  headers?: string[];
  filas?: Celda[][];
  titulo?: string;
  subtitulo?: string;
}

function colLetra(i: number): string {
  let s = '';
  for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}

const esNumero = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const esEntero = (v: unknown) => esNumero(v) && Number.isInteger(v);

/** Índices de estilo definidos en STYLES (cellXfs). */
const ST = {
  HEADER: 1, TEXT: 2, INT: 3, NUM: 4, SECTION: 5,
  TEXT_ALT: 6, INT_ALT: 7, NUM_ALT: 8, TITULO: 9, SUBTITULO: 10,
};

function celdaXml(ref: string, valor: Celda, estilo?: number): string {
  const s = estilo ? ` s="${estilo}"` : '';
  if (valor === null || valor === undefined || valor === '') return `<c r="${ref}"${s}/>`;
  if (esNumero(valor)) return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(valor)}</t></is></c>`;
}

/** Estilo de una celda de datos según su tipo, con franjas alternas por fila. */
function estiloCelda(v: Celda, alterna: boolean): number {
  if (esEntero(v)) return alterna ? ST.INT_ALT : ST.INT;
  if (esNumero(v)) return alterna ? ST.NUM_ALT : ST.NUM;
  return alterna ? ST.TEXT_ALT : ST.TEXT;
}

/** ¿Es una fila de sección? (solo la primera celda tiene texto). */
function esSeccion(fila: Celda[]): boolean {
  if (fila.length < 2) return false;
  if (fila[0] === null || fila[0] === undefined || fila[0] === '' || esNumero(fila[0])) return false;
  for (let i = 1; i < fila.length; i++) {
    if (fila[i] !== null && fila[i] !== undefined && fila[i] !== '') return false;
  }
  return true;
}

/** Ancho de columna aproximado (en "caracteres" de Excel). */
function anchoTexto(v: Celda): number {
  if (v === null || v === undefined || v === '') return 0;
  if (esNumero(v)) return Math.round(Math.abs(v)).toString().length + (esEntero(v) ? 3 : 6);
  return String(v).length;
}

function colsXml(headers: string[] | undefined, filas: Celda[][]): string {
  const nCols = Math.max(headers ? headers.length : 0, ...filas.map((f) => f.length), 0);
  if (!nCols) return '';
  const anchos = new Array(nCols).fill(0);
  for (let c = 0; c < nCols; c++) {
    let m = headers && headers[c] != null ? String(headers[c]).length : 0;
    for (const f of filas) m = Math.max(m, anchoTexto(f[c]));
    anchos[c] = Math.min(Math.max(m + 2, 8), 60);
  }
  const cols = anchos.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<cols>${cols}</cols>`;
}

/** Fila de título/subtítulo: el texto en A y el resto vacío con el mismo estilo. */
function filaTitulo(texto: string, r: number, nCols: number, estilo: number): string {
  const cells = [celdaXml('A' + r, texto, estilo)];
  for (let c = 1; c < nCols; c++) cells.push(celdaXml(colLetra(c) + r, '', estilo));
  return `<row r="${r}" ht="${estilo === ST.TITULO ? 24 : 16}" customHeight="1">${cells.join('')}</row>`;
}

function hojaXml(headers: string[] | undefined, filas: Celda[][], titulo?: string, subtitulo?: string): string {
  const tieneHeader = !!(headers && headers.length);
  const nCols = Math.max(headers ? headers.length : 0, ...filas.map((f) => f.length), 1);
  const rows: string[] = [];
  const merges: string[] = [];
  let r = 1;
  // Portada de la hoja: título y, debajo, a qué corresponde (p. ej. el día).
  for (const [txt, estilo] of [[titulo, ST.TITULO], [subtitulo, ST.SUBTITULO]] as [string | undefined, number][]) {
    if (!txt) continue;
    rows.push(filaTitulo(String(txt), r, nCols, estilo));
    if (nCols > 1) merges.push(`<mergeCell ref="A${r}:${colLetra(nCols - 1)}${r}"/>`);
    r++;
  }
  if (r > 1) r++;   // línea en blanco entre la portada y la tabla
  const filaHeader = r;
  if (tieneHeader) {
    const cells = headers!.map((hd, c) => celdaXml(colLetra(c) + r, String(hd ?? ''), ST.HEADER)).join('');
    rows.push(`<row r="${r}" ht="18" customHeight="1">${cells}</row>`);
    r++;
  }
  let dataRow = 0;
  for (const fila of filas) {
    const seccion = esSeccion(fila);
    const alterna = !seccion && (dataRow % 2 === 1);
    const cells = fila.map((v, c) =>
      celdaXml(colLetra(c) + r, v, seccion ? ST.SECTION : estiloCelda(v, alterna))).join('');
    rows.push(`<row r="${r}">${cells}</row>`);
    r++;
    if (!seccion) dataRow++;
  }
  // Panel congelado: fija la fila de encabezado (y la portada) al desplazar.
  const panes = tieneHeader
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${filaHeader}" topLeftCell="A${filaHeader + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + panes + colsXml(headers, filas)
    + `<sheetData>${rows.join('')}</sheetData>`
    + (merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '')
    + '</worksheet>';
}

/** Nombre de hoja válido para Excel: sin []:*?/\, máx 31, único. */
function sanitizarNombre(nombre: string, usados: Set<string>): string {
  let s = String(nombre || 'Hoja').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hoja';
  const base = s;
  let i = 2;
  while (usados.has(s.toLowerCase())) {
    const suf = ` (${i++})`;
    s = base.slice(0, 31 - suf.length) + suf;
  }
  usados.add(s.toLowerCase());
  return s;
}

/**
 * Hoja de estilos: fuentes, rellenos, bordes y formatos numéricos.
 * Índices usados por las celdas (ver constante ST):
 *   s=1 encabezado · s=2 texto · s=3 entero · s=4 decimal · s=5 sección
 */
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2">'
  + '<numFmt numFmtId="164" formatCode="#,##0"/>'
  + '<numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>'
  + '<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="16"/><color rgb="FFB0201A"/><name val="Calibri"/></font>'
  + '<font><sz val="11"/><color rgb="FF595959"/><name val="Calibri"/></font></fonts>'
  + '<fills count="5"><fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF1A1A1A"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF6DCDA"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F8"/></patternFill></fill></fills>'
  + '<borders count="2"><border/>'
  + '<border>'
  + '<left style="thin"><color rgb="FFBFBFBF"/></left>'
  + '<right style="thin"><color rgb="FFBFBFBF"/></right>'
  + '<top style="thin"><color rgb="FFBFBFBF"/></top>'
  + '<bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="11">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
  + '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">'
  + '<alignment horizontal="left" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">'
  + '<alignment horizontal="left" vertical="center"/></xf>'
  + '</cellXfs>'
  + '</styleSheet>';

/** Arma el paquete .xlsx a partir de las hojas. */
export function construirXlsx(hojasIn: Hoja[]): Uint8Array {
  const usados = new Set<string>();
  const hojas = hojasIn.map((hj) => ({
    nombre: sanitizarNombre(hj.nombre, usados),
    headers: hj.headers,
    filas: hj.filas ?? [],
    titulo: hj.titulo,
    subtitulo: hj.subtitulo,
  }));

  const files: { name: string; data: Uint8Array }[] = [];
  const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
  hojas.forEach((_, i) => ct.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`));
  ct.push('</Types>');

  const sheetsXml = hojas.map((hj, i) => `<sheet name="${xmlEsc(hj.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${sheetsXml}</sheets></workbook>`;

  const rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'];
  hojas.forEach((_, i) => rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`));
  rels.push(`<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  rels.push('</Relationships>');

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';

  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) });
  add('[Content_Types].xml', ct.join(''));
  add('_rels/.rels', rootRels);
  add('xl/workbook.xml', workbook);
  add('xl/_rels/workbook.xml.rels', rels.join(''));
  add('xl/styles.xml', STYLES);
  hojas.forEach((hj, i) => add(`xl/worksheets/sheet${i + 1}.xml`, hojaXml(hj.headers, hj.filas, hj.titulo, hj.subtitulo)));
  return zipStore(files);
}

function descargar(archivo: string, bytes: Uint8Array): void {
  descargarBinario(
    /\.xlsx$/i.test(archivo) ? archivo : archivo + '.xlsx',
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

/**
 * Convierte un texto formateado en es-VE ("$ 1.234,56", "12,5%", "45 h") a
 * número. Devuelve null si no hay dígitos (p. ej. "—").
 */
function parseNumES(txt: unknown): number | null {
  let s = String(txt ?? '').replace(/ /g, ' ').trim();
  if (!/\d/.test(s)) return null;
  const neg = /^[−-]/.test(s.replace(/[^\d,.\s−-]/g, '').trim()) || /^[−-]/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  s = s.replace(/\./g, '').replace(',', '.');   // es-VE: '.' miles, ',' decimal
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** Datos estructurados: hojas = [{nombre, headers, filas}]. */
export function exportExcel(archivo: string, hojas: Hoja[]): void {
  if (!hojas?.length) return;
  descargar(archivo, construirXlsx(hojas));
}

/**
 * Recorre las <table class="t"> dibujadas dentro de `cont` (por defecto
 * #content) y las exporta, una hoja por tabla. Convierte las celdas con clase
 * "num" a número. Ignora columnas y botones marcados "noprint".
 */
export function exportarVista(archivo: string, cont?: HTMLElement | null): boolean {
  const raiz = cont || document.getElementById('content');
  if (!raiz) return false;
  const tablas = [...raiz.querySelectorAll('table.t')] as HTMLTableElement[];
  if (!tablas.length) return false;

  const usados = new Set<string>();
  const hojas: Hoja[] = [];
  for (const tabla of tablas) {
    // Nombre de la hoja: el título (h2/h3) de la tarjeta que la contiene.
    const card = tabla.closest('.card') || raiz;
    const tit = card.querySelector('h2, h3');
    const nombre = tit ? (tit.textContent ?? '').trim() : 'Hoja';

    const visibles = (celdas: ArrayLike<Element>) =>
      [...(celdas as unknown as Element[])].filter((c) => !c.classList.contains('noprint'));
    const headers = visibles(tabla.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
    const nCols = headers.length;

    const filas: Celda[][] = [];
    const filasTr = [...tabla.querySelectorAll('tbody tr'), ...tabla.querySelectorAll('tfoot tr')];
    for (const tr of filasTr) {
      if (tr.querySelector('td.empty')) continue;   // fila "Sin registros"
      const tds = visibles(tr.children) as HTMLTableCellElement[];
      // Fila de sección (una celda con colspan): rótulo a todo lo ancho.
      if (tds.length === 1 && (tds[0].colSpan > 1 || nCols > 1)) {
        const fila: Celda[] = new Array(nCols).fill('');
        fila[0] = (tds[0].textContent ?? '').trim();
        filas.push(fila);
        continue;
      }
      filas.push(tds.map((td) => {
        const txt = (td.textContent ?? '').trim();
        if (td.classList.contains('num')) {
          const n = parseNumES(txt);
          if (n !== null) return n;
        }
        return txt === '—' ? '' : txt;
      }));
    }
    if (!headers.length && !filas.length) continue;
    hojas.push({ nombre: sanitizarNombre(nombre, usados), headers, filas });
  }
  if (!hojas.length) return false;
  descargar(archivo, construirXlsx(hojas));
  return true;
}
