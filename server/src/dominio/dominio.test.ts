import { describe, expect, it } from 'vitest';

import {
  cajaDelDia, diferencias, estadoCuadre, lineasTransferencia, resumen, tasaSugerida, totalUSD,
} from './calculos.js';
import { etiquetaPeriodo, esFecha, rangoAnterior } from './fechas.js';
import { construirInforme, SECCIONES_INFORME } from './informe/komplex.js';
import { bloqueoEdicion, bloqueoEscritura, puedeCerrar } from './periodos.js';
import { configInicial, datosVacios, type Datos, type Registro } from './tipos.js';
import { ErrorValidacion, limpiarRegistro } from './validar.js';

const cfg = configInicial('2026-10-01T00:00:00Z');

function reg(p: Partial<Registro>): Registro {
  return {
    id: Math.random().toString(36).slice(2), fecha: '2026-10-13', afiliado: 'X', plan: 'Ilimitado',
    tipo: 'Nuevo', convenio: false, precioPlan: 50, pagos: [], vueltos: [], notas: '',
    creadoPor: 'prueba', creadoEn: '2026-10-13T10:00:00Z', ...p,
  };
}

/** Las filas de ejemplo del Excel "Komplex Gym - Registro de pagos". */
function ejemploExcel(): Datos {
  const d = datosVacios();
  d.registros = [
    reg({ fecha: '2026-10-12', afiliado: 'María Pérez', plan: 'Ilimitado', tipo: 'Renovación', precioPlan: 50,
      pagos: [{ moneda: 'Bs', monto: 39500, tasa: 790, bancoEmisor: 'Banesco', bancoReceptor: 'Mercantil', referencia: '00451236', estado: 'pendiente' }] }),
    reg({ afiliado: 'José Rodríguez', plan: 'Tarde', tipo: 'Nuevo', precioPlan: 40, pagos: [{ moneda: 'Dólares', monto: 40, tasa: 1 }] }),
    reg({ afiliado: 'Ana Gómez', plan: 'Diurno', tipo: 'Renovación', convenio: true, precioPlan: 20,
      pagos: [{ moneda: 'Zelle', monto: 20, tasa: 1, referencia: 'ZL88342019', estado: 'confirmada' }] }),
    // Carlos paga el Turista con dos monedas: un solo registro con dos líneas.
    reg({ afiliado: 'Carlos Díaz', plan: 'Turista', tipo: 'Nuevo', precioPlan: 25,
      pagos: [{ moneda: 'Cop', monto: 60000, tasa: 4000 }, { moneda: 'Dólares', monto: 10, tasa: 1 }] }),
    reg({ afiliado: 'Luisa Fernández', plan: 'Día de entrenamiento', tipo: 'Renovación', precioPlan: 5,
      pagos: [{ moneda: 'Bancolombia', monto: 20000, tasa: 4000, referencia: '73920144', estado: 'pendiente' }] }),
  ];
  return d;
}

describe('cálculos', () => {
  it('convierte a dólares como el Excel (monto / tasa; Dólares y Zelle sin tasa)', () => {
    const d = ejemploExcel();
    expect(d.registros.map(totalUSD)).toEqual([50, 40, 20, 25, 5]);
  });

  it('resume el período: afiliados, nuevos, renovaciones y monedas', () => {
    const r = resumen(ejemploExcel(), '2026-10-13', '2026-10-13');
    expect(r.afiliados).toBe(4);
    expect(r.nuevos).toBe(2);
    expect(r.renovaciones).toBe(2);
    expect(r.ingresoUSD).toBe(90);
    expect(r.porMoneda.find((m) => m.moneda === 'Dólares')).toMatchObject({ pagos: 2, monto: 50, usd: 50 });
    expect(r.porMoneda.find((m) => m.moneda === 'Cop')).toMatchObject({ pagos: 1, monto: 60000, usd: 15 });
    expect(r.planes[0]).toMatchObject({ plan: 'Tarde', pagados: 1, usd: 40 });
  });

  it('el pago mixto suma dinero pero no cuenta como afiliado', () => {
    const d = ejemploExcel();
    d.registros.push(reg({ afiliado: 'Carlos Díaz', plan: 'Turista', tipo: 'Pago mixto', precioPlan: 0,
      pagos: [{ moneda: 'Dólares', monto: 10, tasa: 1 }] }));
    const r = resumen(d, '2026-10-13', '2026-10-13');
    expect(r.afiliados).toBe(4);
    expect(r.pagosMixtos).toBe(1);
    expect(r.ingresoUSD).toBe(100);
  });

  it('una transferencia que no llegó no cuenta como ingreso', () => {
    const d = ejemploExcel();
    d.registros[0].pagos[0].estado = 'no_llego';
    const r = resumen(d, '2026-10-01', '2026-10-31');
    expect(r.ingresoUSD).toBe(90);
    expect(r.transferencias).toMatchObject({ total: 3, confirmadas: 1, pendientes: 1, noLlegaron: 1, usdNoLlego: 50 });
  });

  it('lista las transferencias con su estado', () => {
    const l = lineasTransferencia(ejemploExcel().registros);
    expect(l.map((x) => [x.moneda, x.estado])).toEqual([
      ['Bs', 'pendiente'], ['Zelle', 'confirmada'], ['Bancolombia', 'pendiente'],
    ]);
  });

  it('calcula la caja esperada del día con fondo, vueltos, gastos y retiros', () => {
    const d = ejemploExcel();
    d.aperturas.push({ fecha: '2026-10-13', fondo: { Dólares: 20, Cop: 10000 }, responsable: 'a', actualizadoEn: '' });
    d.registros[1].pagos[0].monto = 50;
    d.registros[1].vueltos = [{ moneda: 'Dólares', monto: 10, tasa: 1 }];
    d.movimientos.push(
      { id: 'g', fecha: '2026-10-13', tipo: 'gasto', concepto: 'Cloro', categoria: 'Limpieza', moneda: 'Dólares', monto: 12, tasa: 1, notas: '', creadoPor: '', creadoEn: '' },
      { id: 'r', fecha: '2026-10-13', tipo: 'retiro', concepto: 'Entrega', categoria: '', moneda: 'Cop', monto: 50000, tasa: 4000, notas: '', creadoPor: '', creadoEn: '' },
      { id: 'b', fecha: '2026-10-13', tipo: 'gasto', concepto: 'Pago móvil', categoria: 'Servicios', moneda: 'Bs', monto: 800, tasa: 800, notas: '', creadoPor: '', creadoEn: '' },
    );
    const c = cajaDelDia(d, '2026-10-13');
    // Dólares: 20 + (50 + 10) − 10 − 12 = 58 · Cop: 10000 + 60000 − 50000 = 20000
    expect(c.esperado).toEqual({ Dólares: 58, Cop: 20000 });
    expect(c.afiliaciones).toBe(4);
    const dif = diferencias({ Dólares: 55, Cop: 20000 }, c.esperado);
    expect(dif).toEqual({ Dólares: -3, Cop: 0 });
    expect(estadoCuadre(dif)).toBe('faltante');
    expect(estadoCuadre({ Dólares: 0, Cop: 0.5 })).toBe('cuadrada');
  });

  it('propone la tasa del día o la última anterior', () => {
    const tasas = { '2026-10-10': { Bs: 780, Cop: 4000 }, '2026-10-12': { Bs: 790 } };
    expect(tasaSugerida(tasas, '2026-10-12', 'Bs')).toBe(790);
    expect(tasaSugerida(tasas, '2026-10-13', 'Bancolombia')).toBe(4000);
    expect(tasaSugerida(tasas, '2026-10-13', 'Zelle')).toBe(1);
    expect(tasaSugerida({}, '2026-10-13', 'Bs')).toBeNull();
  });
});

describe('fechas', () => {
  it('valida fechas reales', () => {
    expect(esFecha('2026-02-28')).toBe(true);
    expect(esFecha('2026-02-30')).toBe(false);
    expect(esFecha('2026-13-01')).toBe(false);
  });
  it('nombra y compara períodos', () => {
    expect(etiquetaPeriodo('2026-10-01', '2026-10-31')).toBe('Octubre 2026');
    expect(rangoAnterior('2026-10-01', '2026-10-31')).toEqual(['2026-09-01', '2026-09-30']);
    expect(rangoAnterior('2026-03-01', '2026-03-31')).toEqual(['2026-02-01', '2026-02-28']);
    expect(rangoAnterior('2026-10-11', '2026-10-17')).toEqual(['2026-10-04', '2026-10-10']);
  });
});

describe('cierre de mes', () => {
  const base = { mesesConDatos: ['2026-09', '2026-10'], cierres: {}, gerencial: false };

  it('pide cerrar el mes anterior antes de registrar en el nuevo (desde el día 1)', () => {
    const b = bloqueoEscritura(base, '2026-10-01');
    expect(b?.tipo).toBe('cierre_pendiente');
    expect(b && b.tipo === 'cierre_pendiente' && b.meses).toEqual(['2026-09']);
    expect(bloqueoEscritura(base, '2026-09-30')).toBeNull();
  });

  it('un mes cerrado no se puede modificar', () => {
    const e = { ...base, cierres: { '2026-09': { mes: '2026-09', cerradoEn: '', cerradoPor: '', resumen: { registros: 0, afiliados: 0, ingresoUSD: 0, gastosUSD: 0, transferenciasPendientes: 0 } } } };
    expect(bloqueoEscritura(e, '2026-10-05')).toBeNull();
    expect(bloqueoEscritura(e, '2026-09-15')?.tipo).toBe('mes_cerrado');
    expect(bloqueoEdicion(e, '2026-10-02', '2026-09-30')?.tipo).toBe('mes_cerrado');
  });

  it('el modo gerencial salta todos los bloqueos', () => {
    expect(bloqueoEscritura({ ...base, gerencial: true }, '2026-10-01')).toBeNull();
  });

  it('solo se cierran meses terminados y en orden', () => {
    expect(puedeCerrar(base, '2026-10', '2026-10-17')).toMatch(/no ha terminado/);
    expect(puedeCerrar({ ...base, mesesConDatos: ['2026-08', '2026-09'] }, '2026-09', '2026-10-01')).toMatch(/Agosto/);
    expect(puedeCerrar(base, '2026-09', '2026-10-01')).toBeNull();
  });
});

describe('validación', () => {
  it('exige los datos de cada transferencia, como el Excel', () => {
    expect(() => limpiarRegistro({
      fecha: '2026-10-13', afiliado: 'Ana', plan: 'Ilimitado', tipo: 'Nuevo',
      pagos: [{ moneda: 'Bs', monto: 100, tasa: 800, bancoEmisor: 'Banesco' }],
    }, cfg)).toThrow(ErrorValidacion);
    expect(() => limpiarRegistro({
      fecha: '2026-10-13', afiliado: 'Ana', plan: 'Ilimitado', tipo: 'Nuevo',
      pagos: [{ moneda: 'Zelle', monto: 50 }],
    }, cfg)).toThrow(/confirmación/);
  });

  it('fija el precio del plan con el convenio al registrar', () => {
    const r = limpiarRegistro({
      fecha: '2026-10-13', afiliado: 'Ana', plan: 'Diurno', tipo: 'Renovación', convenio: true,
      pagos: [{ moneda: 'Dólares', monto: 20 }],
    }, cfg);
    expect(r.precioPlan).toBe(20);
    expect(r.pagos[0]).toEqual({ moneda: 'Dólares', monto: 20, tasa: 1 });
  });
});

describe('informe', () => {
  it('arma las secciones con datos', () => {
    const inf = construirInforme(ejemploExcel(), cfg, {
      desde: '2026-10-01', hasta: '2026-10-31', comparar: true, generado: 'hoy',
      secciones: SECCIONES_INFORME.map((s) => s.id),
    });
    expect(inf.periodo.label).toBe('Octubre 2026');
    expect(inf.comparados.anterior?.label).toBe('Septiembre 2026');
    expect(inf.secciones.map((s) => s.id)).toEqual(
      ['resumen', 'monedas', 'planes', 'transferencias', 'caja', 'gastos', 'dias', 'alertas'],
    );
  });
});
