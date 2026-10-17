/**
 * Transferencias.tsx — Verificar que cada pago por Bs, Zelle o Bancolombia
 * llegó al banco (la hoja "Transferencias" del Excel, con un botón en vez de
 * ir a buscar la casilla).
 */
import { useMemo, useState } from 'react';

import { lineasTransferencia, resumirTransferencias, type LineaTransferencia } from '@dominio/calculos';
import { bloqueoEscritura } from '@dominio/periodos';
import { MONEDAS_TRANSFERENCIA, type EstadoTransferencia } from '@dominio/tipos';
import { apiPut, mensajeError } from '../lib/api';
import { fmtFecha, fmtFechaHora, fmtNum, fmtUSD, hoyISO, sinTildes } from '../lib/format';
import { Ico } from '../lib/icons';
import { useApp, useDatos, usePeriodos } from '../state/app';
import { useUI } from '../state/ui';
import { BadgeEstado, Cargando, Kpi, MsgError, Segmentado, Tabla, Tarjeta } from '../components/basicos';
import { useCierre } from '../components/Cierre';

type Vista = 'dia' | 'pendientes';

export function Transferencias() {
  const [vista, setVista] = useState<Vista>('dia');
  const [dia, setDia] = useState(hoyISO());
  const [moneda, setMoneda] = useState<string>('Todas');
  const [filtroEstado, setFiltroEstado] = useState<'todas' | EstadoTransferencia>('todas');
  const [buscar, setBuscar] = useState('');
  const { datos, error } = useDatos(vista === 'dia' ? dia : undefined, vista === 'dia' ? dia : undefined);

  const todas = useMemo(() => (datos ? lineasTransferencia(datos.registros) : []), [datos]);
  const delaVista = useMemo(() => todas
    .filter((l) => vista === 'dia' || l.estado === 'pendiente')
    .filter((l) => moneda === 'Todas' || l.moneda === moneda), [todas, vista, moneda]);
  const filas = useMemo(() => {
    const q = sinTildes(buscar.trim());
    return delaVista
      .filter((l) => filtroEstado === 'todas' || l.estado === filtroEstado)
      .filter((l) => !q || sinTildes(`${l.afiliado} ${l.referencia} ${l.bancoEmisor}`).includes(q))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [delaVista, filtroEstado, buscar]);

  if (error) return <MsgError error={error} />;
  if (!datos) return <Cargando />;
  const r = resumirTransferencias(delaVista);

  return (
    <div>
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <Segmentado
          opciones={[{ v: 'dia' as Vista, l: 'Por día' }, { v: 'pendientes' as Vista, l: 'Todas las pendientes' }]}
          valor={vista} onCambiar={setVista}
        />
        {vista === 'dia' && (
          <>
            <input type="date" style={{ width: 160 }} value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Día" />
            {dia !== hoyISO() && <button className="btn sm" onClick={() => setDia(hoyISO())}>Hoy</button>}
          </>
        )}
        <Segmentado opciones={['Todas', ...MONEDAS_TRANSFERENCIA]} valor={moneda} onCambiar={setMoneda} />
      </div>

      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Kpi label="Transferencias" valor={r.total} onClick={() => setFiltroEstado('todas')} sel={filtroEstado === 'todas'} />
        <Kpi label="Llegaron" valor={r.confirmadas} cls="pos" onClick={() => setFiltroEstado('confirmada')} sel={filtroEstado === 'confirmada'} />
        <Kpi label="Pendientes" valor={r.pendientes} cls={r.pendientes ? 'warn' : ''} detalle={r.pendientes ? fmtUSD(r.usdPendiente) : undefined}
          onClick={() => setFiltroEstado('pendiente')} sel={filtroEstado === 'pendiente'} />
        <Kpi label="No llegaron" valor={r.noLlegaron} cls={r.noLlegaron ? 'neg' : ''} detalle={r.noLlegaron ? fmtUSD(r.usdNoLlego) : undefined}
          onClick={() => setFiltroEstado('no_llego')} sel={filtroEstado === 'no_llego'} />
      </div>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        {MONEDAS_TRANSFERENCIA.map((m) => (
          <Kpi
            key={m} label={`Total ${m}`}
            valor={`${m === 'Zelle' ? '$ ' : m === 'Bs' ? 'Bs ' : 'COP '}${fmtNum(r.porMoneda[m].monto, m === 'Bancolombia' ? 0 : 2)}`}
            detalle={`${r.porMoneda[m].n} transferencia(s) · confirmado ${fmtNum(r.porMoneda[m].confirmado, m === 'Bancolombia' ? 0 : 2)}`}
          />
        ))}
      </div>

      <Tarjeta
        titulo={vista === 'dia' ? `Transferencias del ${fmtFecha(dia)}` : 'Transferencias pendientes de verificar'}
        sub="Revisa en el banco y marca si llegó o no. Las que no llegaron no cuentan como ingreso."
        acciones={<input placeholder="Buscar nombre o referencia…" style={{ width: 230 }} value={buscar} onChange={(e) => setBuscar(e.target.value)} />}
      >
        <Tabla
          resp
          cols={[{ l: 'N°' }, { l: 'Fecha' }, { l: 'Afiliado' }, { l: 'Moneda' }, { l: 'Monto', n: true }, { l: 'Banco emisor' }, { l: 'Banco receptor' }, { l: 'Referencia' }, { l: 'Estado' }, { l: '', cls: 'noprint' }]}
          vacio={vista === 'dia' ? 'No hay transferencias ese día.' : 'No hay transferencias pendientes. ¡Todo verificado!'}
        >
          {filas.map((l, i) => <FilaTransferencia key={`${l.registroId}-${l.idx}`} l={l} n={i + 1} />)}
        </Tabla>
      </Tarjeta>
    </div>
  );
}

function FilaTransferencia({ l, n }: { l: LineaTransferencia; n: number }) {
  const { cambio } = useApp();
  const ui = useUI();
  const periodos = usePeriodos();
  const { manejarError } = useCierre();
  const [enviando, setEnviando] = useState(false);
  const bloqueado = !!bloqueoEscritura(periodos, l.fecha);

  const marcar = async (estado: EstadoTransferencia) => {
    setEnviando(true);
    try {
      await apiPut(`/api/registros/${l.registroId}/pagos/${l.idx}/estado`, { estado });
      cambio();
    } catch (e) {
      if (!manejarError(e, l.fecha)) ui.avisar(mensajeError(e), 'err');
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(l.referencia);
      ui.avisar(`Referencia ${l.referencia} copiada.`, 'info');
    } catch { /* sin portapapeles */ }
  };

  return (
    <tr className={bloqueado ? 'bloqueada' : ''}>
      <td data-l="N°" className="muted">{n}</td>
      <td data-l="Fecha" className="nowrap">{fmtFecha(l.fecha)}</td>
      <td data-l="" className="titulo">{l.afiliado}<small>{l.plan}</small></td>
      <td data-l="Moneda">{l.moneda}</td>
      <td data-l="Monto" className="n num">{`${fmtNum(l.monto, l.moneda === 'Bancolombia' ? 0 : 2)}`}<small>{fmtUSD(l.usd)}</small></td>
      <td data-l="Banco emisor">{l.bancoEmisor || '—'}</td>
      <td data-l="Banco receptor">{l.bancoReceptor || '—'}</td>
      <td data-l="Referencia">
        <button className="enlace num" style={{ color: 'var(--ink)', textDecoration: 'none' }} title="Copiar" onClick={() => void copiar()}>{l.referencia || '—'}</button>
      </td>
      <td data-l="Estado">
        <BadgeEstado estado={l.estado} />
        {l.verificadoPor && <small>{`${l.verificadoPor} · ${fmtFechaHora(l.verificadoEn)}`}</small>}
      </td>
      <td className="acc noprint" data-l="">
        <div className="rowbtns">
          {l.estado !== 'confirmada' && (
            <button className="btn sm ok" disabled={enviando || bloqueado} onClick={() => void marcar('confirmada')}><Ico name="check" />Llegó</button>
          )}
          {l.estado !== 'no_llego' && (
            <button className="btn sm danger" disabled={enviando || bloqueado} onClick={() => void marcar('no_llego')}><Ico name="x" />No llegó</button>
          )}
          {l.estado !== 'pendiente' && (
            <button className="btn sm" title="Volver a pendiente" disabled={enviando || bloqueado} onClick={() => void marcar('pendiente')}><Ico name="rotate" /></button>
          )}
        </div>
      </td>
    </tr>
  );
}
