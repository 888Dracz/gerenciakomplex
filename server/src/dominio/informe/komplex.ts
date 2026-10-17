/**
 * informe/komplex.ts — Informe de gestión del Komplex Gym para Gerencia.
 *
 * Arma un DOCUMENTO ABSTRACTO (secciones → bloques, ver `tipos.ts`) con las
 * cifras de un período; la interfaz lo convierte en Word dibujando los gráficos
 * (igual que en Dorado Club). Es una función pura: recibe los datos ya leídos.
 */
import { lineasTransferencia, r2, resumen, type ResumenPeriodo } from '../calculos.js';
import {
  diaSemana, etiquetaPeriodo, fmtFecha, mesCorto, mesesEnRango, nombreMes, rangoAnterior,
} from '../fechas.js';
import { ETIQUETA_ESTADO, MONEDAS_EFECTIVO, type ConfigPublica, type Datos } from '../tipos.js';
import {
  COLOR, grafico, kpis, limpiar, lista, tabla, texto, total,
  type Bloque, type Informe, type OpcionSeccion, type Periodo, type Seccion,
} from './tipos.js';

export const SECCIONES_INFORME: OpcionSeccion[] = [
  { id: 'resumen', titulo: 'Resumen ejecutivo', desc: 'Ingreso, afiliados, gastos y resultado, con la comparación.', base: true },
  { id: 'monedas', titulo: 'Ingresos por moneda', desc: 'Cuánto entró en Dólares, Zelle, Bs, Cop y Bancolombia.', base: true },
  { id: 'planes', titulo: 'Planes pagados', desc: 'Qué planes se venden: nuevos, renovaciones y convenios.', base: true },
  { id: 'transferencias', titulo: 'Transferencias', desc: 'Verificadas, pendientes y las que no llegaron.', base: true },
  { id: 'caja', titulo: 'Caja y cuadres', desc: 'Cuadre de cada día: esperado, contado y diferencias.', base: true },
  { id: 'gastos', titulo: 'Gastos y movimientos de caja', desc: 'Gastos por categoría, otros ingresos y retiros.', base: true },
  { id: 'dias', titulo: 'Detalle por día', desc: 'Afiliados, ingreso y gastos de cada día del período.' },
  { id: 'alertas', titulo: 'Alertas y observaciones', desc: 'Lo que Gerencia debe revisar, redactado a partir de los datos.', base: true },
];

// ---------------------------------------------------------------- números y frases
const nf = (n: number, d = 2): string =>
  Number(n ?? 0).toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number): string => '$ ' + nf(n, 2);
const ent = (n: number): string => nf(n, 0);
const plural = (n: number, uno: string, varios: string): string => `${ent(n)} ${n === 1 ? uno : varios}`;

/** Variación porcentual de a frente a b (null si b es 0). */
function variacion(a: number, b: number): number | null {
  if (!b) return null;
  return r2(((a - b) / Math.abs(b)) * 100);
}

function frase(a: number, b: number): string {
  const v = variacion(a, b);
  if (v === null) return 'sin base de comparación';
  if (Math.abs(v) < 0.5) return 'prácticamente igual que el período anterior';
  return `${v > 0 ? 'un aumento' : 'una caída'} de ${nf(Math.abs(v), 1)}% frente al período anterior`;
}

export function periodoDe(desde: string, hasta: string): Periodo {
  return { from: desde, to: hasta, label: etiquetaPeriodo(desde, hasta), meses: mesesEnRango(desde, hasta) };
}

export interface OpcionesInforme {
  desde: string;
  hasta: string;
  secciones: string[];
  comparar: boolean;
  /** Texto de "Generado el …" (fecha y hora local). */
  generado: string;
  /** Meses cerrados, para decirlo en el informe. */
  cerrados?: string[];
}

export function construirInforme(datos: Datos, cfg: ConfigPublica, o: OpcionesInforme): Informe {
  const quiere = (id: string) => o.secciones.includes(id);
  const p = periodoDe(o.desde, o.hasta);
  const [antD, antH] = rangoAnterior(o.desde, o.hasta);
  const anterior = o.comparar ? periodoDe(antD, antH) : undefined;
  const A = resumen(datos, o.desde, o.hasta);
  const B = anterior ? resumen(datos, antD, antH) : null;

  const secciones: (Seccion | null)[] = [
    quiere('resumen') ? seccionResumen(A, B, p, datos) : null,
    quiere('monedas') ? seccionMonedas(A) : null,
    quiere('planes') ? seccionPlanes(A, B, cfg) : null,
    quiere('transferencias') ? seccionTransferencias(A, datos) : null,
    quiere('caja') ? seccionCaja(A, datos) : null,
    quiere('gastos') ? seccionGastos(A) : null,
    quiere('dias') ? seccionDias(A) : null,
    quiere('alertas') ? seccionAlertas(A, B, p, o.cerrados ?? []) : null,
  ];

  return {
    area: 'komplex',
    titulo: `Informe de gestión — ${cfg.negocio || 'Komplex Gym'}`,
    subtitulo: p.label,
    periodo: p,
    comparados: anterior ? { anterior } : {},
    generado: o.generado,
    secciones: limpiar(secciones),
  };
}

// ---------------------------------------------------------------- secciones
function seccionResumen(A: ResumenPeriodo, B: ResumenPeriodo | null, p: Periodo, datos: Datos): Seccion {
  const bloques: Bloque[] = [
    kpis([
      {
        label: 'Ingreso total', valor: A.ingresoUSD, formato: 'usd',
        detalle: `${plural(A.registros, 'registro', 'registros')} · promedio ${usd(A.promedioPorAfiliado)} por afiliado`,
      },
      {
        label: 'Afiliados', valor: A.afiliados, formato: 'int',
        detalle: `${ent(A.nuevos)} nuevos · ${ent(A.renovaciones)} renovaciones`,
      },
      {
        label: 'Gastos de caja', valor: A.gastosUSD, formato: 'usd',
        detalle: A.otrosIngresosUSD ? `Otros ingresos ${usd(A.otrosIngresosUSD)}` : undefined,
      },
      { label: 'Resultado neto', valor: A.netoUSD, formato: 'usd', tono: A.netoUSD >= 0 ? 'pos' : 'neg' },
    ]),
  ];

  const parrafos: string[] = [
    `En el período (${p.label}) el gimnasio cobró ${usd(A.ingresoUSD)} `
    + `en ${plural(A.afiliados, 'afiliación', 'afiliaciones')} (${ent(A.nuevos)} nuevas y ${ent(A.renovaciones)} renovaciones)`
    + (A.pagosMixtos ? ` y ${plural(A.pagosMixtos, 'pago mixto', 'pagos mixtos')}` : '') + '.',
  ];
  if (B) {
    parrafos.push(`El ingreso muestra ${frase(A.ingresoUSD, B.ingresoUSD)} (${usd(B.ingresoUSD)}); `
      + `los afiliados, ${frase(A.afiliados, B.afiliados)} (${ent(B.afiliados)}).`);
  }
  if (A.gastosUSD || A.otrosIngresosUSD) {
    parrafos.push(`Se registraron gastos por ${usd(A.gastosUSD)}`
      + (A.otrosIngresosUSD ? ` y otros ingresos por ${usd(A.otrosIngresosUSD)}` : '')
      + `, con lo que el resultado neto es ${usd(A.netoUSD)}.`);
  }
  if (A.transferencias.pendientes) {
    parrafos.push(`Quedan ${plural(A.transferencias.pendientes, 'transferencia', 'transferencias')} por verificar `
      + `(${usd(A.transferencias.usdPendiente)}), que ya están contadas en el ingreso.`);
  }
  bloques.push(texto(parrafos));

  if (B) {
    bloques.push(tabla('Comparación con el período anterior', ['Indicador', 'Este período', 'Anterior', 'Variación'],
      ['texto', 'usd', 'usd', 'pct'], [
        ['Ingreso total', A.ingresoUSD, B.ingresoUSD, variacion(A.ingresoUSD, B.ingresoUSD)],
        ['Gastos de caja', A.gastosUSD, B.gastosUSD, variacion(A.gastosUSD, B.gastosUSD)],
        ['Resultado neto', A.netoUSD, B.netoUSD, variacion(A.netoUSD, B.netoUSD)],
        ['Promedio por afiliado', A.promedioPorAfiliado, B.promedioPorAfiliado, variacion(A.promedioPorAfiliado, B.promedioPorAfiliado)],
      ]));
    bloques.push(tabla(undefined, ['Movimiento de afiliados', 'Este período', 'Anterior', 'Variación'],
      ['texto', 'int', 'int', 'pct'], [
        ['Afiliados', A.afiliados, B.afiliados, variacion(A.afiliados, B.afiliados)],
        ['Nuevos', A.nuevos, B.nuevos, variacion(A.nuevos, B.nuevos)],
        ['Renovaciones', A.renovaciones, B.renovaciones, variacion(A.renovaciones, B.renovaciones)],
      ]));
  }

  // Serie: por mes si el período es largo, por día si es un mes o menos.
  if (p.meses.length > 1) {
    const filas = p.meses.map((m) => {
      const r = resumen(datos, `${m}-01`, `${m}-31`);
      return { m, ing: r.ingresoUSD, gas: r.gastosUSD };
    });
    bloques.push(grafico('Ingresos y gastos por mes', {
      clase: 'barras', categorias: filas.map((f) => mesCorto(f.m)), formato: 'usd',
      series: [
        { label: 'Ingresos', datos: filas.map((f) => f.ing), color: COLOR.ingresos },
        { label: 'Gastos', datos: filas.map((f) => f.gas), color: COLOR.egresos },
      ],
    }));
  } else if (A.porDia.length > 1) {
    bloques.push(grafico('Ingreso por día', {
      clase: 'barras', categorias: A.porDia.map((d) => d.fecha.slice(8, 10)), formato: 'usd',
      series: [{ label: 'Ingreso', datos: A.porDia.map((d) => d.usd), color: COLOR.ingresos }],
    }, 'Días del mes con cobros registrados.'));
  }
  return { id: 'resumen', titulo: 'Resumen ejecutivo', bloques };
}

function seccionMonedas(A: ResumenPeriodo): Seccion {
  const filas = A.porMoneda.filter((m) => m.pagos || m.monto);
  return {
    id: 'monedas',
    titulo: 'Ingresos por moneda',
    intro: 'Lo recibido en cada moneda y su equivalente en dólares con la tasa de cada pago. '
      + 'Dólares y Cop son efectivo; Zelle, Bs y Bancolombia son transferencias.',
    bloques: [
      tabla(undefined, ['Moneda', 'Pagos', 'Recibido (en su moneda)', 'Equivalente USD', '% del total'],
        ['texto', 'int', 'num', 'usd', 'pct'], [
          ...filas.map((m) => [m.moneda, m.pagos, m.monto, m.usd, m.pct]),
          total(['TOTAL', filas.reduce((s, m) => s + m.pagos, 0), null, A.ingresoUSD, filas.length ? 100 : 0]),
        ], { vacio: 'Sin cobros en el período.' }),
      ...(filas.length > 1 ? [grafico('Composición del ingreso', {
        clase: 'pastel', formato: 'usd', items: filas.map((m) => ({ label: m.moneda, valor: m.usd })),
      })] : []),
    ],
  };
}

function seccionPlanes(A: ResumenPeriodo, B: ResumenPeriodo | null, cfg: ConfigPublica): Seccion {
  const anterior = new Map((B?.planes ?? []).map((x) => [x.plan, x]));
  const precio = new Map(cfg.planes.map((x) => [x.nombre, x.precio]));
  const bloques: Bloque[] = [
    tabla(undefined, ['Plan', 'Precio', 'Pagados', 'Nuevos', 'Renovaciones', 'Convenios', 'Ingreso USD'],
      ['texto', 'usd', 'int', 'int', 'int', 'int', 'usd'], [
        ...A.planes.map((f) => [f.plan, precio.get(f.plan) ?? null, f.pagados, f.nuevos, f.renovaciones, f.convenios, f.usd]),
        total(['TOTAL', null, A.afiliados, A.nuevos, A.renovaciones, A.convenios, A.ingresoUSD]),
      ], {
        vacio: 'Sin planes pagados en el período.',
        nota: 'Ingreso USD incluye los pagos mixtos del plan. Convenio = 50% de descuento.',
      }),
  ];
  if (A.planes.length > 1) {
    bloques.push(grafico('Ingreso por plan', {
      clase: 'barrasH', formato: 'usd', color: COLOR.ingresos,
      items: A.planes.map((f) => ({ label: f.plan, valor: f.usd })),
    }));
  }
  if (B && A.planes.length) {
    bloques.push(tabla('Planes frente al período anterior', ['Plan', 'Pagados', 'Antes', 'Ingreso USD', 'Antes'],
      ['texto', 'int', 'int', 'usd', 'usd'],
      A.planes.map((f) => [f.plan, f.pagados, anterior.get(f.plan)?.pagados ?? 0, f.usd, anterior.get(f.plan)?.usd ?? 0])));
  }
  return { id: 'planes', titulo: 'Planes pagados', bloques };
}

function seccionTransferencias(A: ResumenPeriodo, datos: Datos): Seccion {
  const t = A.transferencias;
  const lineas = lineasTransferencia(datos.registros.filter((r) => r.fecha >= A.desde && r.fecha <= A.hasta));
  const porRevisar = lineas.filter((l) => l.estado !== 'confirmada');
  return {
    id: 'transferencias',
    titulo: 'Transferencias',
    intro: 'Pagos por Bs, Zelle y Bancolombia, y si se verificó que el dinero llegó al banco.',
    bloques: [
      kpis([
        { label: 'Transferencias', valor: t.total, formato: 'int' },
        { label: 'Llegaron', valor: t.confirmadas, formato: 'int', tono: 'pos' },
        { label: 'Pendientes', valor: t.pendientes, formato: 'int', tono: t.pendientes ? 'warn' : undefined, detalle: t.pendientes ? usd(t.usdPendiente) : undefined },
        { label: 'No llegaron', valor: t.noLlegaron, formato: 'int', tono: t.noLlegaron ? 'neg' : undefined, detalle: t.noLlegaron ? usd(t.usdNoLlego) : undefined },
      ]),
      tabla('Por moneda', ['Moneda', 'Transferencias', 'Monto', 'Confirmado'], ['texto', 'int', 'num', 'num'],
        (['Bs', 'Zelle', 'Bancolombia'] as const).filter((m) => t.porMoneda[m].n)
          .map((m) => [m, t.porMoneda[m].n, t.porMoneda[m].monto, t.porMoneda[m].confirmado]),
        { vacio: 'Sin transferencias en el período.' }),
      ...(porRevisar.length ? [tabla('Por revisar', ['Fecha', 'Afiliado', 'Moneda', 'Monto', 'Referencia', 'Estado'],
        ['texto', 'texto', 'texto', 'num', 'texto', 'texto'],
        porRevisar.slice(0, 80).map((l) => [fmtFecha(l.fecha), l.afiliado, l.moneda, l.monto, l.referencia || '—', ETIQUETA_ESTADO[l.estado]]),
        { nota: porRevisar.length > 80 ? `Se muestran 80 de ${porRevisar.length}.` : undefined })] : []),
    ],
  };
}

function seccionCaja(A: ResumenPeriodo, datos: Datos): Seccion {
  const cuadres = datos.cuadres.filter((c) => c.fecha >= A.desde && c.fecha <= A.hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const c = A.cuadres;
  const faltaUSD = c.conDiferencia.reduce((s, x) => s + Math.min(0, x.diferencia.Dólares), 0);
  return {
    id: 'caja',
    titulo: 'Caja y cuadres',
    intro: 'Cada día la caja debe tener el fondo inicial más el efectivo cobrado, menos vueltos, gastos y retiros. '
      + 'El cuadre compara eso con lo contado.',
    bloques: [
      kpis([
        { label: 'Días con movimiento', valor: c.diasConMovimiento, formato: 'int' },
        { label: 'Días cuadrados', valor: c.diasCuadrados, formato: 'int', tono: c.diasCuadrados === c.diasConMovimiento ? 'pos' : 'warn' },
        { label: 'Días con diferencia', valor: c.conDiferencia.length, formato: 'int', tono: c.conDiferencia.length ? 'neg' : 'pos' },
        { label: 'Faltante en dólares', valor: r2(-faltaUSD), formato: 'usd', tono: faltaUSD < 0 ? 'neg' : undefined },
      ]),
      tabla(undefined,
        ['Fecha', 'Esperado USD', 'Contado USD', 'Dif. USD', 'Esperado COP', 'Contado COP', 'Dif. COP', 'Responsable'],
        ['texto', 'num', 'num', 'num', 'num', 'num', 'num', 'texto'],
        cuadres.map((q) => [fmtFecha(q.fecha), q.esperado.Dólares, q.contado.Dólares, q.diferencia.Dólares,
          q.esperado.Cop, q.contado.Cop, q.diferencia.Cop, q.responsable || '—']),
        { vacio: 'No se cuadró la caja en el período.' }),
    ],
  };
}

function seccionGastos(A: ResumenPeriodo): Seccion | null {
  if (!A.gastosUSD && !A.otrosIngresosUSD && !A.retirosUSD) {
    return { id: 'gastos', titulo: 'Gastos y movimientos de caja', bloques: [texto(['No hubo gastos, otros ingresos ni retiros en el período.'])] };
  }
  const bloques: Bloque[] = [
    kpis([
      { label: 'Gastos', valor: A.gastosUSD, formato: 'usd', tono: 'neg' },
      { label: 'Otros ingresos', valor: A.otrosIngresosUSD, formato: 'usd' },
      { label: 'Retiros / entregas', valor: A.retirosUSD, formato: 'usd', detalle: 'No es gasto: dinero que salió de la caja hacia gerencia o banco' },
    ]),
    tabla('Gastos por categoría', ['Categoría', 'Movimientos', 'USD', '% de los gastos'], ['texto', 'int', 'usd', 'pct'], [
      ...A.gastosPorCategoria.map((g) => [g.categoria, g.n, g.usd, A.gastosUSD ? r2((g.usd / A.gastosUSD) * 100) : 0]),
      total(['TOTAL', A.gastosPorCategoria.reduce((s, g) => s + g.n, 0), A.gastosUSD, A.gastosUSD ? 100 : 0]),
    ], { vacio: 'Sin gastos.' }),
  ];
  if (A.gastosPorCategoria.length > 1) {
    bloques.push(grafico('Gastos por categoría', {
      clase: 'barrasH', formato: 'usd', color: COLOR.egresos,
      items: A.gastosPorCategoria.map((g) => ({ label: g.categoria, valor: g.usd })),
    }));
  }
  return { id: 'gastos', titulo: 'Gastos y movimientos de caja', bloques };
}

function seccionDias(A: ResumenPeriodo): Seccion {
  return {
    id: 'dias',
    titulo: 'Detalle por día',
    bloques: [
      tabla(undefined, ['Fecha', 'Día', 'Afiliados', 'Ingreso USD', 'Otros ingresos', 'Gastos USD'],
        ['texto', 'texto', 'int', 'usd', 'usd', 'usd'], [
          ...A.porDia.map((d) => [fmtFecha(d.fecha), diaSemana(d.fecha), d.afiliados, d.usd, d.otrosIngresosUSD, d.gastosUSD]),
          total(['TOTAL', null, A.afiliados, A.ingresoUSD, A.otrosIngresosUSD, A.gastosUSD]),
        ], { vacio: 'Sin movimientos.' }),
    ],
  };
}

function seccionAlertas(A: ResumenPeriodo, B: ResumenPeriodo | null, p: Periodo, cerrados: string[]): Seccion {
  type Item = { texto: string; nivel?: 'ok' | 'aviso' | 'alerta' };
  const items: Item[] = [];
  const t = A.transferencias;
  if (t.noLlegaron) items.push({ nivel: 'alerta', texto: `${plural(t.noLlegaron, 'transferencia no llegó', 'transferencias no llegaron')} al banco (${usd(t.usdNoLlego)}). Hay que cobrarlas de nuevo.` });
  if (t.pendientes) items.push({ nivel: 'aviso', texto: `${plural(t.pendientes, 'transferencia sigue', 'transferencias siguen')} sin verificar (${usd(t.usdPendiente)}).` });
  for (const c of A.cuadres.conDiferencia.slice(0, 10)) {
    const partes = MONEDAS_EFECTIVO.filter((m) => Math.abs(c.diferencia[m]) > 0.009)
      .map((m) => `${c.diferencia[m] > 0 ? 'sobran' : 'faltan'} ${nf(Math.abs(c.diferencia[m]), m === 'Cop' ? 0 : 2)} ${m === 'Cop' ? 'COP' : 'USD'}`);
    items.push({ nivel: c.estado === 'faltante' ? 'alerta' : 'aviso', texto: `Caja del ${fmtFecha(c.fecha)}: ${partes.join(' y ')}.` });
  }
  if (A.cuadres.sinCuadre.length) {
    items.push({
      nivel: 'aviso',
      texto: `${plural(A.cuadres.sinCuadre.length, 'día con movimiento no tiene', 'días con movimiento no tienen')} cuadre de caja`
        + (A.cuadres.sinCuadre.length <= 6 ? ` (${A.cuadres.sinCuadre.map(fmtFecha).join(', ')}).` : '.'),
    });
  }
  if (A.incompletos.length) {
    items.push({
      nivel: 'aviso',
      texto: `${plural(A.incompletos.length, 'registro pagó', 'registros pagaron')} menos que el precio del plan: `
        + A.incompletos.slice(0, 5).map((x) => `${x.afiliado} (faltan ${usd(x.falta)})`).join(', ')
        + (A.incompletos.length > 5 ? '…' : '.'),
    });
  }
  if (B && B.ingresoUSD > 0) {
    const v = variacion(A.ingresoUSD, B.ingresoUSD) ?? 0;
    if (v <= -10) items.push({ nivel: 'alerta', texto: `El ingreso cayó ${nf(Math.abs(v), 1)}% frente al período anterior.` });
    else if (v >= 10) items.push({ nivel: 'ok', texto: `El ingreso creció ${nf(v, 1)}% frente al período anterior.` });
  }
  if (B && B.nuevos > 0 && A.nuevos < B.nuevos) {
    items.push({ nivel: 'aviso', texto: `Entraron menos afiliados nuevos que en el período anterior (${ent(A.nuevos)} frente a ${ent(B.nuevos)}).` });
  }
  const abiertos = p.meses.filter((m) => !cerrados.includes(m));
  if (cerrados.length || abiertos.length) {
    const c = p.meses.filter((m) => cerrados.includes(m));
    if (c.length) items.push({ nivel: 'ok', texto: `Meses cerrados (cifras definitivas): ${c.map(nombreMes).join(', ')}.` });
    if (abiertos.length) items.push({ nivel: 'aviso', texto: `Meses todavía abiertos (las cifras pueden cambiar): ${abiertos.map(nombreMes).join(', ')}.` });
  }
  if (!items.some((i) => i.nivel === 'alerta')) items.unshift({ nivel: 'ok', texto: 'No hay alertas graves en el período.' });
  return { id: 'alertas', titulo: 'Alertas y observaciones', bloques: [lista(undefined, items)] };
}
