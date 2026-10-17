/**
 * Caja.tsx — Lo del día a día: cobrar afiliaciones, tasa del día, fondo de
 * caja, gastos/otros ingresos/retiros y lo que va entrando.
 */
import { useEffect, useState } from 'react';

import { cajaDelDia, enUSD, fondoSugerido, r2, totalUSD } from '@dominio/calculos';
import { diaSemana, sumarDias } from '@dominio/fechas';
import { bloqueoEscritura } from '@dominio/periodos';
import { ETIQUETA_MOVIMIENTO, MONEDAS_EFECTIVO, type Movimiento, type Registro } from '@dominio/tipos';
import { apiDelete, apiPut, mensajeError } from '../lib/api';
import { fmtFecha, fmtMonto, fmtNum, fmtUSD, hoyISO, leerNumero } from '../lib/format';
import { Ico } from '../lib/icons';
import { ir } from '../lib/router';
import { useApp, useDatos, usePeriodos } from '../state/app';
import { ModalShell, useUI } from '../state/ui';
import { Cargando, Kpi, MsgError, Tarjeta } from '../components/basicos';
import { useCierre } from '../components/Cierre';
import { FormMovimiento } from '../components/FormMovimiento';
import { FormRegistro } from '../components/FormRegistro';

export function Caja() {
  const [dia, setDia] = useState(hoyISO());
  const { datos, error } = useDatos(sumarDias(dia, -45), dia);
  if (error) return <MsgError error={error} />;
  if (!datos) return <Cargando />;
  const caja = cajaDelDia(datos, dia);

  return (
    <div>
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <label className="fl" style={{ margin: 0 }} htmlFor="dia-caja">Día de caja</label>
        <input id="dia-caja" type="date" style={{ width: 160 }} value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} />
        {dia !== hoyISO() && <button className="btn sm" onClick={() => setDia(hoyISO())}>Hoy</button>}
        <span className="muted" style={{ fontSize: 12.5 }}>{`${diaSemana(dia)} ${fmtFecha(dia)}`}</span>
        {caja.cuadre && <span className="badge b-green"><Ico name="lock" /> Caja cerrada</span>}
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Cobrado del día" valor={fmtUSD(caja.totalUSD)} detalle={`${caja.afiliaciones} afiliación(es)`} />
        <Kpi label="Efectivo esperado $" valor={fmtUSD(caja.esperado.Dólares)} detalle="Fondo + cobros − vueltos − gastos − retiros" />
        <Kpi label="Efectivo esperado COP" valor={fmtNum(caja.esperado.Cop, 0)} detalle="Pesos en efectivo" />
        <Kpi
          label="Transferencias del día" valor={caja.transferencias.total}
          cls={caja.transferencias.pendientes ? 'warn' : ''}
          detalle={caja.transferencias.pendientes ? `${caja.transferencias.pendientes} por verificar` : 'Todas verificadas'}
          onClick={() => ir('transferencias')}
        />
      </div>

      <div className="pos-grid">
        <Tarjeta titulo={<><Ico name="cash" /> Cobrar afiliación</>}>
          <FormRegistro enCaja fechaInicial={dia} tasas={datos.tasas} />
        </Tarjeta>

        <div>
          <TasaDelDia dia={dia} tasas={datos.tasas[dia] ?? {}} />
          <Apertura dia={dia} fondo={caja.fondo} tieneApertura={!!caja.apertura} cerrada={!!caja.cuadre} sugerido={fondoSugerido(datos, dia)} />
          <Tarjeta titulo={<><Ico name="transfer" /> Movimiento de caja</>}>
            <FormMovimiento fecha={dia} tasas={datos.tasas} />
          </Tarjeta>
        </div>
      </div>

      <CobrosDelDia
        registros={datos.registros.filter((r) => r.fecha === dia)}
        movimientos={datos.movimientos.filter((m) => m.fecha === dia)}
        tasas={datos.tasas}
      />

      {!caja.cuadre && (caja.afiliaciones > 0 || datos.movimientos.some((m) => m.fecha === dia)) && (
        <div className="card informe-cta noprint">
          <div>
            <h3 style={{ margin: 0 }}>¿Terminó el día?</h3>
            <p className="sub" style={{ margin: '4px 0 0' }}>Cuenta el efectivo y cierra la caja en el cuadre del día.</p>
          </div>
          <button className="btn primary" onClick={() => ir('cuadre')}><Ico name="scale" />Ir al cuadre de caja</button>
        </div>
      )}
    </div>
  );
}

function TasaDelDia({ dia, tasas }: { dia: string; tasas: { Bs?: number; Cop?: number } }) {
  const { cambio } = useApp();
  const ui = useUI();
  const { manejarError } = useCierre();
  const periodos = usePeriodos();
  const [bs, setBs] = useState(tasas.Bs ? String(tasas.Bs) : '');
  const [cop, setCop] = useState(tasas.Cop ? String(tasas.Cop) : '');
  useEffect(() => { setBs(tasas.Bs ? String(tasas.Bs) : ''); setCop(tasas.Cop ? String(tasas.Cop) : ''); }, [tasas.Bs, tasas.Cop, dia]);
  const bloqueado = !!bloqueoEscritura(periodos, dia);

  const guardar = async () => {
    const nb = leerNumero(bs);
    const nc = leerNumero(cop);
    if ((nb || undefined) === tasas.Bs && (nc || undefined) === tasas.Cop) return;
    try {
      await apiPut(`/api/tasas/${dia}`, { Bs: nb > 0 ? nb : '', Cop: nc > 0 ? nc : '' });
      cambio();
      ui.avisar('Tasa del día guardada ✓', 'ok');
    } catch (e) {
      if (!manejarError(e, dia)) ui.avisar(mensajeError(e), 'err');
    }
  };

  return (
    <Tarjeta titulo={<><Ico name="chart" /> Tasa del día</>} sub="Se propone sola en cada pago en Bs, Cop o Bancolombia.">
      <div className="tasas">
        <div>
          <label className="fl" htmlFor="t-bs">Bs por $</label>
          <input id="t-bs" inputMode="decimal" className="num" value={bs} disabled={bloqueado}
            onChange={(e) => setBs(e.target.value)} onBlur={() => void guardar()} placeholder="0" />
        </div>
        <div>
          <label className="fl" htmlFor="t-cop">Pesos por $</label>
          <input id="t-cop" inputMode="decimal" className="num" value={cop} disabled={bloqueado}
            onChange={(e) => setCop(e.target.value)} onBlur={() => void guardar()} placeholder="0" />
        </div>
      </div>
    </Tarjeta>
  );
}

function Apertura({ dia, fondo, tieneApertura, cerrada, sugerido }: {
  dia: string; fondo: { Dólares: number; Cop: number }; tieneApertura: boolean; cerrada: boolean;
  sugerido: { Dólares: number; Cop: number } | null;
}) {
  const { cambio } = useApp();
  const ui = useUI();
  const { manejarError } = useCierre();
  const periodos = usePeriodos();
  const [usd, setUsd] = useState(String(fondo.Dólares || ''));
  const [cop, setCop] = useState(String(fondo.Cop || ''));
  useEffect(() => { setUsd(String(fondo.Dólares || '')); setCop(String(fondo.Cop || '')); }, [fondo.Dólares, fondo.Cop, dia]);
  const bloqueado = cerrada || !!bloqueoEscritura(periodos, dia);

  const guardar = async (f?: { Dólares: number; Cop: number }) => {
    try {
      await apiPut(`/api/aperturas/${dia}`, { fondo: f ?? { Dólares: leerNumero(usd) || 0, Cop: leerNumero(cop) || 0 } });
      cambio();
      ui.avisar('Fondo de caja guardado ✓', 'ok');
    } catch (e) {
      if (!manejarError(e, dia)) ui.avisar(mensajeError(e), 'err');
    }
  };

  return (
    <Tarjeta titulo={<><Ico name="cash" /> Fondo de caja (apertura)</>} sub="Efectivo con el que abre la caja este día.">
      <div className="tasas" style={{ marginBottom: 8 }}>
        <div>
          <label className="fl" htmlFor="ap-usd">Dólares</label>
          <input id="ap-usd" inputMode="decimal" className="num" value={usd} disabled={bloqueado} onChange={(e) => setUsd(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="fl" htmlFor="ap-cop">Pesos</label>
          <input id="ap-cop" inputMode="decimal" className="num" value={cop} disabled={bloqueado} onChange={(e) => setCop(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div className="row">
        <button className="btn sm primary" disabled={bloqueado} onClick={() => void guardar()}>
          <Ico name="check" />{tieneApertura ? 'Actualizar fondo' : 'Abrir caja'}
        </button>
        {!tieneApertura && sugerido && (sugerido.Dólares > 0 || sugerido.Cop > 0) && !bloqueado && (
          <button className="btn sm ghost" onClick={() => void guardar(sugerido)}>
            {`Usar lo contado ayer (${fmtUSD(sugerido.Dólares)} · COP ${fmtNum(sugerido.Cop, 0)})`}
          </button>
        )}
      </div>
    </Tarjeta>
  );
}

function CobrosDelDia({ registros, movimientos, tasas }: { registros: Registro[]; movimientos: Movimiento[]; tasas: Record<string, { Bs?: number; Cop?: number }> }) {
  const ui = useUI();
  const { cambio } = useApp();
  const { manejarError } = useCierre();
  if (!registros.length && !movimientos.length) return null;

  const editarRegistro = (r: Registro) => ui.abrirModal((cerrar) => (
    <ModalShell titulo="Editar registro" onCerrar={cerrar} ancho={640} pie={<></>}>
      <FormRegistro inicial={r} tasas={tasas} onGuardado={cerrar} onCancelar={cerrar} />
    </ModalShell>
  ));
  const editarMov = (m: Movimiento) => ui.abrirModal((cerrar) => (
    <ModalShell titulo="Editar movimiento de caja" onCerrar={cerrar} ancho={560} pie={<button className="btn" onClick={cerrar}>Cerrar</button>}>
      <FormMovimiento fecha={m.fecha} inicial={m} tasas={tasas} onListo={cerrar} />
    </ModalShell>
  ));
  const borrarMov = async (m: Movimiento) => {
    if (!await ui.confirmar(`¿Eliminar "${m.concepto}" (${fmtMonto(m.moneda, m.monto)})?`, { peligro: true, ok: 'Eliminar' })) return;
    try {
      await apiDelete(`/api/movimientos/${m.id}`);
      cambio();
    } catch (e) { if (!manejarError(e, m.fecha)) ui.avisar(mensajeError(e), 'err'); }
  };

  return (
    <div className="grid g2">
      <Tarjeta titulo={`Cobros del día (${registros.length})`}>
        <div className="mini-lista">
          {[...registros].reverse().map((r) => (
            <div className="mini-item" key={r.id}>
              <div className="crece">
                <b>{r.afiliado}</b>
                <small>{`${r.plan} · ${r.tipo} · ${r.pagos.map((p) => fmtMonto(p.moneda, p.monto)).join(' + ')}`}</small>
              </div>
              <b className="num">{fmtUSD(totalUSD(r))}</b>
              <button className="btn sm" title="Editar" onClick={() => editarRegistro(r)}><Ico name="pencil" /></button>
            </div>
          ))}
          {!registros.length && <p className="muted" style={{ margin: 0 }}>Todavía no hay cobros este día.</p>}
        </div>
      </Tarjeta>
      <Tarjeta titulo={`Movimientos de caja (${movimientos.length})`}>
        <div className="mini-lista">
          {movimientos.map((m) => (
            <div className="mini-item" key={m.id}>
              <div className="crece">
                <b>{m.concepto}</b>
                <small>{`${ETIQUETA_MOVIMIENTO[m.tipo]}${m.categoria ? ' · ' + m.categoria : ''} · ${fmtMonto(m.moneda, m.monto)}`}</small>
              </div>
              <b className={'num ' + (m.tipo === 'ingreso' ? 'pos' : 'neg')}>{`${m.tipo === 'ingreso' ? '+' : '−'} ${fmtUSD(r2(enUSD(m)))}`}</b>
              <button className="btn sm" title="Editar" onClick={() => editarMov(m)}><Ico name="pencil" /></button>
              <button className="btn sm danger" title="Eliminar" onClick={() => void borrarMov(m)}><Ico name="trash" /></button>
            </div>
          ))}
          {!movimientos.length && <p className="muted" style={{ margin: 0 }}>Sin gastos, otros ingresos ni retiros este día.</p>}
        </div>
        {movimientos.length > 0 && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            {`En efectivo: ${MONEDAS_EFECTIVO.map((mo) => `${mo} ${fmtNum(movimientos.filter((m) => m.moneda === mo).reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0))}`).join(' · ')}`}
          </p>
        )}
      </Tarjeta>
    </div>
  );
}
