/**
 * Cuadre.tsx — Cierre de caja del día: lo que debería haber en efectivo frente
 * a lo contado, por moneda, más el estado de las transferencias del día.
 */
import { useEffect, useMemo, useState } from 'react';

import {
  cajaDelDia, cuadreDesactualizado, diferencias, enUSD, estadoCuadre, r2, totalUSD,
} from '@dominio/calculos';
import { diaSemana, sumarDias } from '@dominio/fechas';
import { bloqueoEscritura } from '@dominio/periodos';
import { MONEDAS, MONEDAS_EFECTIVO, type Datos, type Efectivo, type Moneda, type MonedaEfectivo } from '@dominio/tipos';
import { apiDelete, apiPut, mensajeError } from '../lib/api';
import { fmtFecha, fmtFechaHora, fmtHora, fmtNum, fmtUSD, hoyISO, leerNumero } from '../lib/format';
import { Ico } from '../lib/icons';
import { ir } from '../lib/router';
import { useApp, useDatos, useEstado, usePeriodos } from '../state/app';
import { useUI } from '../state/ui';
import { Cargando, Kpi, MsgError, SelloCuadre, Tabla, Tarjeta } from '../components/basicos';
import { Candado, useCierre, useGuardiaCierre } from '../components/Cierre';

const NOMBRE: Record<MonedaEfectivo, string> = { Dólares: 'Dólares', Cop: 'Pesos (COP)' };
const fmtEf = (m: MonedaEfectivo, n: number) => (m === 'Cop' ? `COP ${fmtNum(n, 0)}` : fmtUSD(n));
const BILLETES = [100, 50, 20, 10, 5, 2, 1];

export function Cuadre() {
  const [dia, setDia] = useState(hoyISO());
  const { datos, error } = useDatos(sumarDias(dia, -60), dia);
  if (error) return <MsgError error={error} />;
  if (!datos) return <Cargando />;
  return (
    <div>
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <label className="fl" style={{ margin: 0 }} htmlFor="dia-cuadre">Día</label>
        <input id="dia-cuadre" type="date" style={{ width: 160 }} value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} />
        <button className="btn sm" onClick={() => setDia(sumarDias(dia, -1))}>‹ Anterior</button>
        {dia !== hoyISO() && <button className="btn sm" onClick={() => setDia(hoyISO())}>Hoy</button>}
        <span className="muted" style={{ fontSize: 12.5 }}>{`${diaSemana(dia)} ${fmtFecha(dia)}`}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => window.print()}><Ico name="printer" />Imprimir</button>
      </div>
      <CuadreDia datos={datos} dia={dia} />
      <Historial datos={datos} hasta={dia} onElegir={setDia} />
    </div>
  );
}

function CuadreDia({ datos, dia }: { datos: Datos; dia: string }) {
  const estado = useEstado();
  const { cambio } = useApp();
  const ui = useUI();
  const periodos = usePeriodos();
  const { manejarError } = useCierre();
  const caja = useMemo(() => cajaDelDia(datos, dia), [datos, dia]);
  const cuadre = caja.cuadre;
  const [contado, setContado] = useState<Record<MonedaEfectivo, string>>({ Dólares: '', Cop: '' });
  const [obs, setObs] = useState('');
  const [responsable, setResponsable] = useState(estado.usuario);
  const [billetes, setBilletes] = useState<Record<number, string> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const guardia = useGuardiaCierre(cuadre ? '' : dia, !cuadre);
  const bloqueo = cuadre ? bloqueoEscritura(periodos, dia) : guardia;

  useEffect(() => {
    setContado({ Dólares: '', Cop: '' });
    setObs(cuadre?.observaciones ?? '');
    setResponsable(cuadre?.responsable ?? estado.usuario);
    setBilletes(null);
  }, [dia, cuadre, estado.usuario]);

  const contadoNum: Efectivo = { Dólares: leerNumero(contado.Dólares) || 0, Cop: leerNumero(contado.Cop) || 0 };
  const lleno = MONEDAS_EFECTIVO.every((m) => contado[m].trim() !== '');
  const dif = diferencias(contadoNum, caja.esperado);

  const sumarBilletes = (b: Record<number, string>) => {
    setBilletes(b);
    const total = BILLETES.reduce((s, d) => s + d * (Number(b[d]) || 0), 0);
    setContado((c) => ({ ...c, Dólares: String(total) }));
  };

  const cerrarCaja = async () => {
    if (!lleno) return ui.avisar('Escribe lo contado en Dólares y en Pesos (0 si no hay).', 'err');
    const est = estadoCuadre(dif);
    if (est !== 'cuadrada' && !obs.trim()) {
      const ok = await ui.confirmar(`La caja tiene ${est === 'faltante' ? 'un faltante' : 'un sobrante'}. ¿Cerrar sin escribir una observación?`, { ok: 'Cerrar igual' });
      if (!ok) return;
    }
    setGuardando(true);
    try {
      await apiPut(`/api/cuadres/${dia}`, { contado: contadoNum, observaciones: obs, responsable });
      cambio();
      ui.avisar(`Caja del ${fmtFecha(dia)} cerrada ✓`, 'ok');
    } catch (e) {
      if (!manejarError(e, dia)) ui.avisar(mensajeError(e), 'err');
    } finally {
      setGuardando(false);
    }
  };

  const reabrir = async () => {
    if (!await ui.confirmar(`¿Reabrir la caja del ${fmtFecha(dia)}? Se borra el cuadre para volver a contarla.`, { ok: 'Reabrir' })) return;
    try {
      await apiDelete(`/api/cuadres/${dia}`);
      cambio();
    } catch (e) { if (!manejarError(e, dia)) ui.avisar(mensajeError(e), 'err'); }
  };

  const filasHoja = (m: MonedaEfectivo): [string, number, string][] => [
    ['Fondo inicial (apertura)', caja.fondo[m], ''],
    ['Cobros en efectivo', caja.cobros[m], 'suma'],
    ['Vueltos entregados', caja.vueltos[m], 'resta'],
    ['Otros ingresos', caja.ingresos[m], 'suma'],
    ['Gastos', caja.gastos[m], 'resta'],
    ['Retiros / entregas', caja.retiros[m], 'resta'],
  ];

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Total cobrado del día" valor={fmtUSD(caja.totalUSD)} detalle={`${caja.afiliaciones} afiliación(es)`} />
        <Kpi label="Esperado en dólares" valor={fmtUSD(caja.esperado.Dólares)} />
        <Kpi label="Esperado en pesos" valor={`COP ${fmtNum(caja.esperado.Cop, 0)}`} />
        <Kpi
          label="Transferencias" valor={`${caja.transferencias.confirmadas}/${caja.transferencias.total}`}
          cls={caja.transferencias.pendientes ? 'warn' : caja.transferencias.noLlegaron ? 'neg' : 'pos'}
          detalle={caja.transferencias.total ? `${caja.transferencias.pendientes} pendiente(s) · ${caja.transferencias.noLlegaron} no llegaron` : 'Sin transferencias'}
          onClick={() => ir('transferencias')}
        />
      </div>

      <div className="grid g2">
        <Tarjeta titulo={<><Ico name="scale" /> Efectivo que debe haber</>}>
          {MONEDAS_EFECTIVO.map((m) => (
            <div key={m} style={{ marginBottom: 12 }}>
              <b style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{NOMBRE[m].toUpperCase()}</b>
              <table className="hoja">
                <tbody>
                  {filasHoja(m).map(([l, v, cls]) => (
                    <tr key={l} className={cls}><td>{l}</td><td className="n">{fmtEf(m, v)}</td></tr>
                  ))}
                  <tr className="total"><td>Debe haber</td><td className="n">{fmtEf(m, caja.esperado[m])}</td></tr>
                </tbody>
              </table>
            </div>
          ))}
          {!caja.apertura && <p className="muted" style={{ fontSize: 12, margin: 0 }}>No se registró fondo de caja este día (se toma 0). Se anota en Caja → Fondo de caja.</p>}
        </Tarjeta>

        <Tarjeta titulo={<><Ico name="cash" /> {cuadre ? 'Caja cerrada' : 'Conteo y cierre de caja'}</>}>
          {cuadre ? (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <SelloCuadre diferencia={cuadre.diferencia} />
                <span className="muted" style={{ fontSize: 12 }}>{`por ${cuadre.responsable} · ${fmtFechaHora(cuadre.cerradoEn)}`}</span>
              </div>
              <table className="hoja">
                <tbody>
                  {MONEDAS_EFECTIVO.map((m) => (
                    <tr key={m}>
                      <td>{`${NOMBRE[m]}: contado`}</td>
                      <td className="n">{fmtEf(m, cuadre.contado[m])}</td>
                      <td className={'n ' + (cuadre.diferencia[m] < 0 ? 'neg' : cuadre.diferencia[m] > 0 ? 'warn' : 'pos')}>
                        {cuadre.diferencia[m] === 0 ? 'cuadra' : `${cuadre.diferencia[m] > 0 ? '+' : '−'}${fmtEf(m, Math.abs(cuadre.diferencia[m]))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cuadre.observaciones && <p className="msg info">{cuadre.observaciones}</p>}
              {cuadreDesactualizado(cuadre, caja.esperado) && (
                <p className="msg warn">
                  {`Después del cierre (${fmtHora(cuadre.cerradoEn)}) se registraron o cambiaron movimientos: ahora deberían haber ${fmtUSD(caja.esperado.Dólares)} y COP ${fmtNum(caja.esperado.Cop, 0)}. Reabre la caja y vuelve a contarla.`}
                </p>
              )}
              <Candado bloqueo={bloqueo} />
              <button className="btn" onClick={() => void reabrir()} disabled={!!bloqueo}><Ico name="unlock" />Reabrir caja</button>
            </>
          ) : (
            <>
              <Candado bloqueo={bloqueo} />
              {MONEDAS_EFECTIVO.map((m) => (
                <div className="field" key={m}>
                  <label className="fl" htmlFor={`c-${m}`}>{`${NOMBRE[m]} contados`}</label>
                  <div className="row">
                    <input
                      id={`c-${m}`} inputMode="decimal" className="num crece" style={{ maxWidth: 200 }} placeholder="0"
                      value={contado[m]} onChange={(e) => setContado((c) => ({ ...c, [m]: e.target.value }))}
                    />
                    {contado[m].trim() !== '' && (
                      <span className={'num ' + (dif[m] < -0.009 ? 'neg' : dif[m] > 0.009 ? 'warn' : 'pos')} style={{ fontSize: 13 }}>
                        {Math.abs(dif[m]) < 0.01 ? '✓ cuadra' : `${dif[m] > 0 ? 'sobran' : 'faltan'} ${fmtEf(m, Math.abs(dif[m]))}`}
                      </span>
                    )}
                    {m === 'Dólares' && (
                      <button className="btn sm ghost" type="button" onClick={() => setBilletes(billetes ? null : {})}>
                        {billetes ? 'Ocultar billetes' : 'Contar billetes'}
                      </button>
                    )}
                  </div>
                  {m === 'Dólares' && billetes && (
                    <div className="ref-box" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))' }}>
                      {BILLETES.map((d) => (
                        <div key={d}>
                          <label className="fl">{`$${d} ×`}</label>
                          <input inputMode="numeric" className="num" value={billetes[d] ?? ''} placeholder="0"
                            onChange={(e) => sumarBilletes({ ...billetes, [d]: e.target.value })} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {lleno && <div style={{ marginBottom: 10 }}><SelloCuadre diferencia={dif} /></div>}
              <div className="form-grid">
                <div className="field">
                  <label className="fl" htmlFor="c-resp">Responsable</label>
                  <input id="c-resp" value={responsable} onChange={(e) => setResponsable(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label className="fl" htmlFor="c-obs">Observaciones</label>
                <textarea id="c-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Explica cualquier diferencia" />
              </div>
              <button className="btn primary block lg" disabled={guardando || !!bloqueo} onClick={() => void cerrarCaja()}>
                <Ico name="lock" />{guardando ? 'Cerrando…' : 'Cerrar caja del día'}
              </button>
            </>
          )}
        </Tarjeta>
      </div>

      <TablaDia datos={datos} dia={dia} />
    </>
  );
}

/** Concepto × moneda del día (como el "Cuadre del día" de Dorado Club). */
function TablaDia({ datos, dia }: { datos: Datos; dia: string }) {
  const registros = datos.registros.filter((r) => r.fecha === dia);
  const movimientos = datos.movimientos.filter((m) => m.fecha === dia);
  const cero = () => Object.fromEntries(MONEDAS.map((m) => [m, 0])) as Record<Moneda, number>;
  const porPlan = new Map<string, { n: number; mon: Record<Moneda, number>; usd: number }>();
  for (const r of registros) {
    const k = r.tipo === 'Pago mixto' ? `${r.plan} (pago mixto)` : r.plan;
    const x = porPlan.get(k) ?? { n: 0, mon: cero(), usd: 0 };
    x.n++;
    x.usd = r2(x.usd + totalUSD(r));
    for (const p of r.pagos) if (p.estado !== 'no_llego') x.mon[p.moneda] += p.monto;
    for (const v of r.vueltos) x.mon[v.moneda] -= v.monto;
    porPlan.set(k, x);
  }
  const mov = (tipo: string) => {
    const mon = cero();
    let usd = 0;
    for (const m of movimientos.filter((x) => x.tipo === tipo)) { mon[m.moneda] += m.monto; usd += enUSD(m); }
    return { mon, usd: r2(usd), n: movimientos.filter((x) => x.tipo === tipo).length };
  };
  const ing = mov('ingreso');
  const gas = mov('gasto');
  const ret = mov('retiro');
  const total = cero();
  let totalUsd = 0;
  for (const x of porPlan.values()) { for (const m of MONEDAS) total[m] += x.mon[m]; totalUsd += x.usd; }
  for (const m of MONEDAS) total[m] += ing.mon[m] - gas.mon[m] - ret.mon[m];
  totalUsd = r2(totalUsd + ing.usd - gas.usd - ret.usd);
  const celda = (v: number, m: Moneda) => (v ? fmtNum(v, m === 'Cop' || m === 'Bancolombia' ? 0 : 2) : '—');

  return (
    <Tarjeta titulo={`Movimiento del día por moneda — ${fmtFecha(dia)}`} sub="Las transferencias que no llegaron no se suman.">
      <Tabla cols={[{ l: 'Concepto' }, ...MONEDAS.map((m) => ({ l: m, n: true })), { l: 'USD', n: true }]} vacio="No hubo movimientos ese día."
        pie={porPlan.size || movimientos.length ? (
          <tr><td>TOTAL DEL DÍA</td>{MONEDAS.map((m) => <td key={m} className="n num">{celda(total[m], m)}</td>)}<td className="n num">{fmtUSD(totalUsd)}</td></tr>
        ) : undefined}
      >
        {[...porPlan.entries()].map(([k, x]) => (
          <tr key={k}><td>{`${k} (${x.n})`}</td>{MONEDAS.map((m) => <td key={m} className="n num">{celda(x.mon[m], m)}</td>)}<td className="n num">{fmtUSD(x.usd)}</td></tr>
        ))}
        {ing.n > 0 && <tr><td>{`Otros ingresos (${ing.n})`}</td>{MONEDAS.map((m) => <td key={m} className="n num">{celda(ing.mon[m], m)}</td>)}<td className="n num">{fmtUSD(ing.usd)}</td></tr>}
        {gas.n > 0 && <tr><td>{`Gastos (${gas.n})`}</td>{MONEDAS.map((m) => <td key={m} className="n num neg">{gas.mon[m] ? '−' + celda(gas.mon[m], m) : '—'}</td>)}<td className="n num neg">{'−' + fmtUSD(gas.usd)}</td></tr>}
        {ret.n > 0 && <tr><td>{`Retiros / entregas (${ret.n})`}</td>{MONEDAS.map((m) => <td key={m} className="n num">{ret.mon[m] ? '−' + celda(ret.mon[m], m) : '—'}</td>)}<td className="n num">{'−' + fmtUSD(ret.usd)}</td></tr>}
      </Tabla>
    </Tarjeta>
  );
}

function Historial({ datos, hasta, onElegir }: { datos: Datos; hasta: string; onElegir: (f: string) => void }) {
  const dias = useMemo(() => {
    const s = new Set<string>([...datos.registros.map((r) => r.fecha), ...datos.movimientos.map((m) => m.fecha), ...datos.cuadres.map((c) => c.fecha)]);
    return [...s].filter((f) => f <= hasta).sort().reverse().slice(0, 31);
  }, [datos, hasta]);
  if (!dias.length) return null;
  return (
    <Tarjeta titulo="Últimos días" sub="Toca un día para verlo.">
      <Tabla resp cols={[{ l: 'Fecha' }, { l: 'Cobrado', n: true }, { l: 'Esperado $', n: true }, { l: 'Contado $', n: true }, { l: 'Esperado COP', n: true }, { l: 'Contado COP', n: true }, { l: 'Estado' }, { l: 'Responsable' }]}>
        {dias.map((f) => {
          const c = cajaDelDia(datos, f);
          const q = c.cuadre;
          return (
            <tr key={f} onClick={() => onElegir(f)} style={{ cursor: 'pointer' }}>
              <td data-l="" className="titulo nowrap">{`${diaSemana(f).slice(0, 3)} ${fmtFecha(f)}`}</td>
              <td data-l="Cobrado" className="n num">{fmtUSD(c.totalUSD)}</td>
              <td data-l="Esperado $" className="n num">{fmtUSD(q?.esperado.Dólares ?? c.esperado.Dólares)}</td>
              <td data-l="Contado $" className="n num">{q ? fmtUSD(q.contado.Dólares) : '—'}</td>
              <td data-l="Esperado COP" className="n num">{fmtNum(q?.esperado.Cop ?? c.esperado.Cop, 0)}</td>
              <td data-l="Contado COP" className="n num">{q ? fmtNum(q.contado.Cop, 0) : '—'}</td>
              <td data-l="Estado">{q ? <SelloCuadre diferencia={q.diferencia} /> : <span className="badge b-gray">Sin cuadre</span>}</td>
              <td data-l="Responsable">{q?.responsable ?? '—'}</td>
            </tr>
          );
        })}
      </Tabla>
    </Tarjeta>
  );
}
