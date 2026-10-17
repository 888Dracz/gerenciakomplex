/**
 * exportar.ts — Excel con todos los datos e informe de Word.
 *
 * La hoja "Registro" sigue las columnas del Excel "Komplex Gym - Registro de
 * pagos": una fila por pago. Si alguien pagó con dos monedas, la segunda fila
 * lleva Tipo «Pago mixto» (así no cuenta dos veces como afiliado), igual que
 * se hacía a mano en el Excel.
 */
import {
  cajaDelDia, enUSD, estadoCuadre, lineasTransferencia, r2, resumen, resumenPorMes,
} from '@dominio/calculos';
import {
  etiquetaPeriodo, fmtFecha, hoyISO, mesesEnRango, nombreMes, rangoAnterior, ultimoDiaMes,
} from '@dominio/fechas';
import { construirInforme, SECCIONES_INFORME } from '@dominio/informe/komplex';
import {
  ETIQUETA_ESTADO, ETIQUETA_MOVIMIENTO, INFO_MONEDA, MONEDAS, esTransferencia,
  type ConfigPublica, type Datos,
} from '@dominio/tipos';
import { apiGet, apiPutBinario } from './api';
import { construirDocx, nombreArchivo } from './docx';
import { construirXlsx, type Celda, type Hoja } from './xlsx';
import { descargarBinario } from './zip';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const vacioSi = (n: number | null | undefined): Celda => (n === null || n === undefined ? '' : n);

export interface OpcionesExcel {
  /** Sin rango: todos los datos. */
  desde?: string;
  hasta?: string;
}

function rangoDe(d: Datos, o: OpcionesExcel): [string, string] {
  if (o.desde && o.hasta) return [o.desde, o.hasta];
  const fechas = [...d.registros.map((r) => r.fecha), ...d.movimientos.map((m) => m.fecha), ...d.cuadres.map((c) => c.fecha)].sort();
  return [fechas[0] ?? hoyISO(), fechas[fechas.length - 1] ?? hoyISO()];
}

export function hojasExcel(todo: Datos, cfg: ConfigPublica, o: OpcionesExcel = {}): Hoja[] {
  const [desde, hasta] = rangoDe(todo, o);
  const dentro = (f: string) => f >= desde && f <= hasta;
  const registros = todo.registros.filter((r) => dentro(r.fecha))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creadoEn.localeCompare(b.creadoEn));
  const movimientos = todo.movimientos.filter((m) => dentro(m.fecha)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const negocio = (cfg.negocio || 'Komplex Gym').toUpperCase();
  const sub = `${o.desde ? etiquetaPeriodo(desde, hasta) : 'Todos los datos'} · ${fmtFecha(desde)} al ${fmtFecha(hasta)} · generado el ${fmtFecha(hoyISO())}`;

  // ---- Registro (formato del Excel original)
  const filasRegistro: Celda[][] = [];
  for (const r of registros) {
    r.pagos.forEach((p, i) => {
      filasRegistro.push([
        fmtFecha(r.fecha), r.afiliado, r.plan,
        i === 0 ? r.tipo : 'Pago mixto',
        i === 0 ? (r.convenio ? 'Sí' : 'No') : '',
        i === 0 && r.tipo !== 'Pago mixto' ? r.precioPlan : '',
        p.moneda, p.monto, INFO_MONEDA[p.moneda].tasa ? p.tasa : '',
        r2(enUSD(p)),
        p.bancoEmisor ?? '', p.bancoReceptor ?? '', p.referencia ?? '',
        esTransferencia(p.moneda) ? (p.estado === 'confirmada' ? 'Sí' : p.estado === 'no_llego' ? 'No' : 'Pendiente') : '',
        i === 0 ? r.notas : '',
        r.creadoPor,
      ]);
    });
    for (const v of r.vueltos) {
      filasRegistro.push([
        fmtFecha(r.fecha), r.afiliado, r.plan, 'Pago mixto', '', '', v.moneda, -v.monto, v.moneda === 'Cop' ? v.tasa : '',
        -r2(enUSD(v)), '', '', '', '', 'Vuelto (cambio devuelto)', r.creadoPor,
      ]);
    }
  }

  // ---- Transferencias
  const lineas = lineasTransferencia(registros);
  const filasTransf: Celda[][] = lineas.map((l) => [
    fmtFecha(l.fecha), l.afiliado, l.plan, l.moneda, l.monto, INFO_MONEDA[l.moneda].tasa ? l.tasa : '', l.usd,
    l.bancoEmisor, l.bancoReceptor, l.referencia, ETIQUETA_ESTADO[l.estado],
    l.verificadoPor ?? '', l.verificadoEn ? fmtFecha(l.verificadoEn.slice(0, 10)) : '',
  ]);

  // ---- Caja (movimientos)
  const filasCaja: Celda[][] = movimientos.map((m) => [
    fmtFecha(m.fecha), ETIQUETA_MOVIMIENTO[m.tipo], m.concepto, m.categoria, m.moneda, m.monto,
    INFO_MONEDA[m.moneda].tasa ? m.tasa : '', r2(enUSD(m)), m.referencia ?? '', m.notas, m.creadoPor,
  ]);

  // ---- Cuadres: todos los días con movimiento, cuadrados o no
  const dias = new Set<string>([...registros.map((r) => r.fecha), ...movimientos.map((m) => m.fecha),
    ...todo.cuadres.filter((c) => dentro(c.fecha)).map((c) => c.fecha), ...todo.aperturas.filter((a) => dentro(a.fecha)).map((a) => a.fecha)]);
  const filasCuadre: Celda[][] = [...dias].sort().map((f) => {
    const c = cajaDelDia(todo, f);
    const q = c.cuadre;
    return [
      fmtFecha(f),
      c.fondo.Dólares, c.cobros.Dólares, c.vueltos.Dólares, c.ingresos.Dólares, c.gastos.Dólares, c.retiros.Dólares,
      c.esperado.Dólares, q ? q.contado.Dólares : '', q ? q.diferencia.Dólares : '',
      c.fondo.Cop, c.cobros.Cop, c.esperado.Cop, q ? q.contado.Cop : '', q ? q.diferencia.Cop : '',
      c.transferencias.total, c.transferencias.confirmadas, c.transferencias.pendientes, c.transferencias.noLlegaron,
      c.totalUSD,
      q ? { cuadrada: 'Cuadrada', sobrante: 'Sobrante', faltante: 'Faltante' }[estadoCuadre(q.diferencia)] : 'Sin cuadre',
      q?.responsable ?? '', q?.observaciones ?? '',
    ];
  });

  // ---- Resumen del período (como la hoja "Resumen" del Excel)
  const R = resumen(todo, desde, hasta);
  const filasResumen: Celda[][] = [
    ['INDICADORES', '', '', '', ''],
    ['Ingreso total (USD)', '', '', R.ingresoUSD, ''],
    ['Total afiliados', R.afiliados, '', '', ''],
    ['Nuevos contratos', R.nuevos, '', '', ''],
    ['Renovaciones', R.renovaciones, '', '', ''],
    ['Pagos mixtos', R.pagosMixtos, '', '', ''],
    ['Promedio por afiliado', '', '', R.promedioPorAfiliado, ''],
    ['Otros ingresos de caja', '', '', R.otrosIngresosUSD, ''],
    ['Gastos de caja', '', '', R.gastosUSD, ''],
    ['Resultado neto', '', '', R.netoUSD, ''],
    ['Retiros / entregas (no es gasto)', '', '', R.retirosUSD, ''],
    ['INGRESOS POR MONEDA', '', '', '', ''],
    ...R.porMoneda.map((m) => [m.moneda, m.pagos, m.monto, m.usd, m.pct] as Celda[]),
    ['Total', R.porMoneda.reduce((s, m) => s + m.pagos, 0), '', R.ingresoUSD, R.ingresoUSD ? 100 : 0],
    ['TRANSFERENCIAS', '', '', '', ''],
    ['Llegaron', R.transferencias.confirmadas, '', '', ''],
    ['Pendientes de verificar', R.transferencias.pendientes, '', R.transferencias.usdPendiente, ''],
    ['No llegaron (no cuentan como ingreso)', R.transferencias.noLlegaron, '', R.transferencias.usdNoLlego, ''],
  ];

  const planes: Celda[][] = R.planes.map((p) => [p.plan, p.pagados, p.nuevos, p.renovaciones, p.convenios, p.usd]);
  planes.push(['TOTAL', R.afiliados, R.nuevos, R.renovaciones, R.convenios, R.ingresoUSD]);

  // ---- Resumen por mes
  const meses = mesesEnRango(desde, hasta);
  const porMes = resumenPorMes(todo, meses).map((m): Celda[] => [
    nombreMes(m.mes), cfg.cierres[m.mes] ? 'Cerrado' : 'Abierto', m.afiliados, m.nuevos, m.renovaciones, m.pagosMixtos,
    m.ingresoUSD, ...MONEDAS.map((mo) => m.porMoneda.find((x) => x.moneda === mo)?.usd ?? 0),
    m.otrosIngresosUSD, m.gastosUSD, m.netoUSD, m.transferencias.pendientes, m.transferencias.noLlegaron,
  ]);

  // ---- Configuración
  const n = Math.max(cfg.planes.length, cfg.bancos.length, cfg.categoriasGasto.length);
  const filasConfig: Celda[][] = Array.from({ length: n }, (_, i) => [
    cfg.planes[i]?.nombre ?? '', vacioSi(cfg.planes[i]?.precio), cfg.planes[i] ? (cfg.planes[i].activo ? 'Sí' : 'No') : '',
    '', cfg.bancos[i] ?? '', '', cfg.categoriasGasto[i] ?? '',
  ]);

  return [
    {
      nombre: 'Registro', titulo: `${negocio} — Registro de pagos`, subtitulo: sub,
      headers: ['Fecha', 'Afiliado', 'Plan', 'Tipo', 'Convenio 50%', 'Precio del plan (USD)', 'Moneda', 'Monto', 'Tasa',
        'Total USD', 'Banco emisor', 'Banco receptor', 'N° referencia / confirmación', '¿Llegó al banco?', 'Notas', 'Registrado por'],
      filas: filasRegistro,
    },
    {
      nombre: 'Transferencias', titulo: `${negocio} — Transferencias`, subtitulo: sub,
      headers: ['Fecha', 'Afiliado', 'Plan', 'Moneda', 'Monto', 'Tasa', 'Total USD', 'Banco emisor', 'Banco receptor',
        'Referencia / confirmación', 'Estado', 'Verificado por', 'Verificado el'],
      filas: filasTransf,
    },
    {
      nombre: 'Caja', titulo: `${negocio} — Movimientos de caja`, subtitulo: sub,
      headers: ['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Moneda', 'Monto', 'Tasa', 'Total USD', 'Referencia', 'Notas', 'Registrado por'],
      filas: filasCaja,
    },
    {
      nombre: 'Cuadres', titulo: `${negocio} — Cuadre de caja por día`, subtitulo: sub,
      headers: ['Fecha', 'Fondo USD', 'Cobros efectivo USD', 'Vueltos USD', 'Otros ingresos USD', 'Gastos USD', 'Retiros USD',
        'Esperado USD', 'Contado USD', 'Diferencia USD', 'Fondo COP', 'Cobros COP', 'Esperado COP', 'Contado COP', 'Diferencia COP',
        'Transferencias', 'Llegaron', 'Pendientes', 'No llegaron', 'Total del día USD', 'Estado', 'Responsable', 'Observaciones'],
      filas: filasCuadre,
    },
    {
      nombre: 'Resumen', titulo: `${negocio} — Resumen de ingresos`, subtitulo: sub,
      headers: ['Concepto', 'Pagos / cantidad', 'Recibido (en su moneda)', 'Equivalente USD', '% del total'],
      filas: filasResumen,
    },
    {
      nombre: 'Planes', titulo: `${negocio} — Planes pagados`, subtitulo: sub,
      headers: ['Plan', 'Pagados', 'Nuevos', 'Renovaciones', 'Convenios', 'Ingreso USD'],
      filas: planes,
    },
    {
      nombre: 'Resumen por mes', titulo: `${negocio} — Resumen por mes`, subtitulo: sub,
      headers: ['Mes', 'Estado', 'Afiliados', 'Nuevos', 'Renovaciones', 'Pagos mixtos', 'Ingreso USD',
        ...MONEDAS.map((m) => `${m} (USD)`), 'Otros ingresos', 'Gastos', 'Neto', 'Transf. pendientes', 'No llegaron'],
      filas: porMes,
    },
    {
      nombre: 'Configuración', titulo: `${negocio} — Configuración`, subtitulo: 'Planes con su precio, bancos y categorías de gasto',
      headers: ['Plan', 'Precio USD', 'Activo', '', 'Banco', '', 'Categoría de gasto'],
      filas: filasConfig,
    },
  ];
}

export function nombreExcel(cfg: ConfigPublica, o: OpcionesExcel = {}): string {
  const base = `${cfg.negocio || 'Komplex Gym'} - Registro de pagos`;
  const cual = o.desde && o.hasta ? etiquetaPeriodo(o.desde, o.hasta) : `completo ${hoyISO()}`;
  return `${base} - ${cual}`.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() + '.xlsx';
}

export function bytesExcel(todo: Datos, cfg: ConfigPublica, o: OpcionesExcel = {}): Uint8Array {
  return construirXlsx(hojasExcel(todo, cfg, o));
}

export function descargarExcel(todo: Datos, cfg: ConfigPublica, o: OpcionesExcel = {}): void {
  descargarBinario(nombreExcel(cfg, o), bytesExcel(todo, cfg, o), MIME_XLSX);
}

// ---------------------------------------------------------------- Word
export interface OpcionesWord {
  desde: string;
  hasta: string;
  secciones?: string[];
  comparar?: boolean;
}

export function informe(todo: Datos, cfg: ConfigPublica, o: OpcionesWord) {
  return construirInforme(todo, cfg, {
    desde: o.desde,
    hasta: o.hasta,
    secciones: o.secciones ?? SECCIONES_INFORME.filter((s) => s.base).map((s) => s.id),
    comparar: o.comparar ?? true,
    generado: new Date().toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' }),
    cerrados: Object.keys(cfg.cierres),
  });
}

export function descargarWord(todo: Datos, cfg: ConfigPublica, o: OpcionesWord): boolean {
  const inf = informe(todo, cfg, o);
  if (!inf.secciones.length) return false;
  descargarBinario(nombreArchivo(inf), construirDocx(inf), MIME_DOCX);
  return true;
}

/** Datos de un rango y del período anterior (para comparar en el informe). */
export async function datosParaInforme(desde: string, hasta: string): Promise<Datos> {
  const [antD] = rangoAnterior(desde, hasta);
  return apiGet<Datos>(`/api/datos?desde=${antD}&hasta=${hasta}`);
}

/**
 * Al cerrar un mes: arma su Excel y su informe de Word y los deja en la
 * carpeta de datos (cierres/AAAA-MM Mes/).
 */
export async function guardarArchivosCierre(mes: string, cfg: ConfigPublica): Promise<void> {
  const desde = `${mes}-01`;
  const hasta = ultimoDiaMes(mes);
  const todo = await datosParaInforme(desde, hasta);
  const nombreMesTxt = nombreMes(mes);
  await apiPutBinario(`/api/cierres/${mes}/archivos/${encodeURIComponent(`Registro de pagos - ${nombreMesTxt}.xlsx`)}`,
    bytesExcel(todo, cfg, { desde, hasta }));
  const inf = informe(todo, cfg, { desde, hasta, secciones: SECCIONES_INFORME.map((s) => s.id), comparar: true });
  await apiPutBinario(`/api/cierres/${mes}/archivos/${encodeURIComponent(`Informe - ${nombreMesTxt}.docx`)}`, construirDocx(inf));
}

