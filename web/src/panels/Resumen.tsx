/**
 * Resumen.tsx — Las cifras de un período (la hoja "Resumen" del Excel): ingreso,
 * afiliados, monedas, planes, transferencias, gastos y caja.
 */
import { useMemo } from 'react';

import { resumen } from '@dominio/calculos';
import { etiquetaPeriodo, fmtFecha } from '@dominio/fechas';
import { MONEDAS_EFECTIVO } from '@dominio/tipos';
import { descargarExcel } from '../lib/exportar';
import { fmtNum, fmtUSD } from '../lib/format';
import { Ico } from '../lib/icons';
import { useDatos, useEstado } from '../state/app';
import { useUI } from '../state/ui';
import { Barras, Cargando, Kpi, MsgError, Tabla, Tarjeta, usdCls, usePeriodo } from '../components/basicos';
import { DialogoInforme } from '../components/Informe';

export function Resumen() {
  const estado = useEstado();
  const ui = useUI();
  const { rango, barra } = usePeriodo('mes');
  const { datos, error } = useDatos(rango.desde, rango.hasta);
  const R = useMemo(() => (datos ? resumen(datos, rango.desde, rango.hasta) : null), [datos, rango]);
  if (error) return <MsgError error={error} />;
  if (!datos || !R) return <Cargando />;

  const maxDia = Math.max(1, ...R.porDia.map((d) => d.usd));
  const t = R.transferencias;

  return (
    <div>
      {barra}
      <p className="muted" style={{ margin: '-4px 0 12px', fontSize: 12.5 }}>
        {`${etiquetaPeriodo(rango.desde, rango.hasta)} · ${fmtFecha(rango.desde)} al ${fmtFecha(rango.hasta)}`}
      </p>

      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Kpi label="Ingreso total (USD)" valor={fmtUSD(R.ingresoUSD)} detalle={`${R.registros} registro(s)`} />
        <Kpi label="Total afiliados" valor={R.afiliados} detalle={`${R.nuevos} nuevos · ${R.renovaciones} renovaciones`} />
        <Kpi label="Promedio por afiliado" valor={fmtUSD(R.promedioPorAfiliado)} detalle={R.pagosMixtos ? `${R.pagosMixtos} pago(s) mixto(s)` : undefined} />
        <Kpi label="Resultado neto" valor={fmtUSD(R.netoUSD)} cls={usdCls(R.netoUSD)} detalle={`Gastos ${fmtUSD(R.gastosUSD)}${R.otrosIngresosUSD ? ` · otros ingresos ${fmtUSD(R.otrosIngresosUSD)}` : ''}`} />
      </div>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Nuevos contratos" valor={R.nuevos} />
        <Kpi label="Renovaciones" valor={R.renovaciones} />
        <Kpi label="Transferencias por verificar" valor={t.pendientes} cls={t.pendientes ? 'warn' : ''} detalle={t.pendientes ? fmtUSD(t.usdPendiente) : 'Todo verificado'} />
        <Kpi label="No llegaron" valor={t.noLlegaron} cls={t.noLlegaron ? 'neg' : ''} detalle={t.noLlegaron ? `${fmtUSD(t.usdNoLlego)} (no cuentan)` : undefined} />
      </div>

      <div className="grid g2">
        <Tarjeta titulo="Ingresos por moneda">
          <Tabla
            resp cols={[{ l: 'Moneda' }, { l: 'Pagos', n: true }, { l: 'Recibido (en su moneda)', n: true }, { l: 'Equivalente USD', n: true }, { l: '% del total', n: true }]}
            pie={<tr><td data-l="">TOTAL</td><td className="n num" data-l="Pagos">{R.porMoneda.reduce((s, m) => s + m.pagos, 0)}</td><td data-l="" /><td className="n num" data-l="USD">{fmtUSD(R.ingresoUSD)}</td><td className="n num" data-l="%">{R.ingresoUSD ? '100%' : '—'}</td></tr>}
          >
            {R.porMoneda.map((m) => (
              <tr key={m.moneda}>
                <td data-l="" className="titulo">{m.moneda}</td>
                <td data-l="Pagos" className="n num">{m.pagos}</td>
                <td data-l="Recibido" className="n num">{fmtNum(m.monto, m.moneda === 'Cop' || m.moneda === 'Bancolombia' ? 0 : 2)}</td>
                <td data-l="USD" className="n num">{fmtUSD(m.usd)}</td>
                <td data-l="%" className="n num">{`${fmtNum(m.pct, 1)}%`}</td>
              </tr>
            ))}
          </Tabla>
          <div style={{ marginTop: 12 }}>
            <Barras items={R.porMoneda.filter((m) => m.usd > 0).map((m) => ({ label: m.moneda, valor: m.usd }))} fmt={fmtUSD} />
          </div>
        </Tarjeta>

        <Tarjeta titulo="Planes pagados">
          <Tabla
            resp cols={[{ l: 'Plan' }, { l: 'Pagados', n: true }, { l: 'Nuevos', n: true }, { l: 'Renovaciones', n: true }, { l: 'Ingreso USD', n: true }]}
            vacio="Sin planes pagados en el período."
            pie={R.planes.length ? <tr><td data-l="">TOTAL</td><td className="n num" data-l="Pagados">{R.afiliados}</td><td className="n num" data-l="Nuevos">{R.nuevos}</td><td className="n num" data-l="Renov.">{R.renovaciones}</td><td className="n num" data-l="USD">{fmtUSD(R.ingresoUSD)}</td></tr> : undefined}
          >
            {R.planes.map((p) => (
              <tr key={p.plan}>
                <td data-l="" className="titulo">{p.plan}{p.convenios > 0 && <small>{`${p.convenios} con convenio`}</small>}</td>
                <td data-l="Pagados" className="n num">{p.pagados}</td>
                <td data-l="Nuevos" className="n num">{p.nuevos}</td>
                <td data-l="Renovaciones" className="n num">{p.renovaciones}</td>
                <td data-l="Ingreso USD" className="n num">{fmtUSD(p.usd)}</td>
              </tr>
            ))}
          </Tabla>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            Total afiliados = Nuevo + Renovación. El pago mixto suma dinero pero no cuenta como otro afiliado. Ingreso USD incluye los pagos mixtos.
          </p>
        </Tarjeta>
      </div>

      {R.porDia.length > 1 && (
        <Tarjeta titulo="Ingreso por día">
          <div className="columnas" role="img" aria-label="Ingreso por día">
            {R.porDia.map((d) => (
              <div className="col" key={d.fecha} title={`${fmtFecha(d.fecha)}: ${fmtUSD(d.usd)} · ${d.afiliados} afiliado(s)`}>
                <i style={{ height: `${(d.usd / maxDia) * 100}%` }} />
                <span>{d.fecha.slice(8, 10)}</span>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      <div className="grid g2">
        <Tarjeta titulo="Gastos y movimientos de caja">
          <div className="grid g3" style={{ marginBottom: 10 }}>
            <Kpi label="Gastos" valor={fmtUSD(R.gastosUSD)} cls={R.gastosUSD ? 'neg' : ''} />
            <Kpi label="Otros ingresos" valor={fmtUSD(R.otrosIngresosUSD)} />
            <Kpi label="Retiros" valor={fmtUSD(R.retirosUSD)} detalle="No es gasto" />
          </div>
          <Barras items={R.gastosPorCategoria.map((g) => ({ label: g.categoria, valor: g.usd }))} fmt={fmtUSD} />
        </Tarjeta>

        <Tarjeta titulo="Caja y cuadres">
          <div className="grid g2" style={{ marginBottom: 10 }}>
            <Kpi label="Días cuadrados" valor={`${R.cuadres.diasCuadrados}/${R.cuadres.diasConMovimiento}`} cls={R.cuadres.diasCuadrados === R.cuadres.diasConMovimiento ? 'pos' : 'warn'} />
            <Kpi label="Días con diferencia" valor={R.cuadres.conDiferencia.length} cls={R.cuadres.conDiferencia.length ? 'neg' : 'pos'} />
          </div>
          {R.cuadres.conDiferencia.length > 0 && (
            <div className="mini-lista">
              {R.cuadres.conDiferencia.slice(0, 8).map((c) => (
                <div className="mini-item" key={c.fecha}>
                  <span className="crece">{fmtFecha(c.fecha)}</span>
                  {MONEDAS_EFECTIVO.filter((m) => Math.abs(c.diferencia[m]) > 0.009).map((m) => (
                    <span key={m} className={'num ' + (c.diferencia[m] < 0 ? 'neg' : 'warn')}>
                      {`${c.diferencia[m] > 0 ? '+' : '−'}${m === 'Cop' ? 'COP ' + fmtNum(Math.abs(c.diferencia[m]), 0) : fmtUSD(Math.abs(c.diferencia[m]))}`}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          {R.cuadres.sinCuadre.length > 0 && (
            <p className="msg warn" style={{ marginBottom: 0 }}>
              {`Sin cuadre: ${R.cuadres.sinCuadre.slice(0, 8).map(fmtFecha).join(', ')}${R.cuadres.sinCuadre.length > 8 ? '…' : ''}`}
            </p>
          )}
        </Tarjeta>
      </div>

      <div className="card informe-cta noprint">
        <div>
          <h3 style={{ margin: 0 }}><Ico name="doc" /> Informe para Gerencia</h3>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            Documento de Word con las cifras del período, gráficos, comparación con el período anterior y alertas.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => descargarExcel(datos, estado.config, rango)}><Ico name="sheet" />Excel del período</button>
          <button className="btn primary" onClick={() => ui.abrirModal((cerrar) => <DialogoInforme onCerrar={cerrar} inicial={rango} />)}>
            <Ico name="doc" />Generar informe
          </button>
        </div>
      </div>
    </div>
  );
}
