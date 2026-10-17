/**
 * Registro.tsx — Todos los pagos registrados (la hoja "Registro" del Excel):
 * filtrar, corregir, borrar y agregar con fecha pasada.
 */
import { useMemo, useState } from 'react';

import { diferenciaPlan, estadoDe, r2, totalUSD } from '@dominio/calculos';
import { bloqueoEscritura } from '@dominio/periodos';
import { MONEDAS, TIPOS_REGISTRO, type Moneda, type Registro as Reg } from '@dominio/tipos';
import { apiDelete, mensajeError } from '../lib/api';
import { descargarExcel } from '../lib/exportar';
import { fmtFecha, fmtMonto, fmtUSD, sinTildes } from '../lib/format';
import { Ico } from '../lib/icons';
import { useApp, useDatos, useEstado, usePeriodos } from '../state/app';
import { ModalShell, useUI } from '../state/ui';
import { BadgeEstado, BadgeTipo, Cargando, MsgError, Tabla, Tarjeta, usePeriodo } from '../components/basicos';
import { useCierre } from '../components/Cierre';
import { FormRegistro } from '../components/FormRegistro';

export function Registro() {
  const estado = useEstado();
  const { cambio } = useApp();
  const ui = useUI();
  const periodos = usePeriodos();
  const { manejarError } = useCierre();
  const { rango, barra } = usePeriodo('mes');
  const { datos, error } = useDatos(rango.desde, rango.hasta);
  const [buscar, setBuscar] = useState('');
  const [tipo, setTipo] = useState('');
  const [moneda, setMoneda] = useState('');

  const filas = useMemo(() => {
    if (!datos) return [];
    const q = sinTildes(buscar.trim());
    return datos.registros
      .filter((r) => !tipo || r.tipo === tipo)
      .filter((r) => !moneda || r.pagos.some((p) => p.moneda === moneda))
      .filter((r) => !q || sinTildes(`${r.afiliado} ${r.plan} ${r.notas} ${r.pagos.map((p) => p.referencia ?? '').join(' ')}`).includes(q))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn.localeCompare(a.creadoEn));
  }, [datos, buscar, tipo, moneda]);

  if (error) return <MsgError error={error} />;
  if (!datos) return <Cargando />;

  const total = r2(filas.reduce((s, r) => s + totalUSD(r), 0));
  const afiliados = filas.filter((r) => r.tipo !== 'Pago mixto').length;

  const nuevo = () => ui.abrirModal((cerrar) => (
    <ModalShell titulo="Nuevo registro de pago" onCerrar={cerrar} ancho={660} pie={<></>}>
      <FormRegistro tasas={datos.tasas} onGuardado={cerrar} onCancelar={cerrar} />
    </ModalShell>
  ));
  const editar = (r: Reg) => ui.abrirModal((cerrar) => (
    <ModalShell titulo="Editar registro" onCerrar={cerrar} ancho={660} pie={<></>}>
      <FormRegistro inicial={r} tasas={datos.tasas} onGuardado={cerrar} onCancelar={cerrar} />
    </ModalShell>
  ));
  const borrar = async (r: Reg) => {
    const ok = await ui.confirmar(
      `¿Eliminar el pago de ${r.afiliado} del ${fmtFecha(r.fecha)} (${fmtUSD(totalUSD(r))})?\nQueda anotado en la bitácora.`,
      { titulo: 'Eliminar registro', peligro: true, ok: 'Eliminar' },
    );
    if (!ok) return;
    try {
      await apiDelete(`/api/registros/${r.id}`);
      cambio();
      ui.avisar('Registro eliminado.', 'ok');
    } catch (e) { if (!manejarError(e, r.fecha)) ui.avisar(mensajeError(e), 'err'); }
  };

  return (
    <div>
      {barra}
      <Tarjeta
        titulo={`Registro de pagos (${filas.length})`}
        acciones={(
          <>
            <button className="btn sm" onClick={() => descargarExcel(datos, estado.config, rango)}><Ico name="sheet" />Excel del período</button>
            <button className="btn sm primary" onClick={nuevo}><Ico name="plus" />Agregar</button>
          </>
        )}
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="crece" placeholder="Buscar afiliado, plan o referencia…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          <select style={{ width: 150 }} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            <option value="">Todos los tipos</option>
            {TIPOS_REGISTRO.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select style={{ width: 150 }} value={moneda} onChange={(e) => setMoneda(e.target.value)} aria-label="Moneda">
            <option value="">Todas las monedas</option>
            {MONEDAS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <Tabla
          resp
          cols={[{ l: 'Fecha' }, { l: 'Afiliado' }, { l: 'Plan' }, { l: 'Tipo' }, { l: 'Pago' }, { l: 'Total USD', n: true }, { l: 'Registró' }, { l: '', cls: 'noprint' }]}
          vacio="No hay registros con esos filtros."
          pie={filas.length ? (
            <tr>
              <td colSpan={5} data-l="">{`${afiliados} afiliado(s) · ${filas.length - afiliados} pago(s) mixto(s)`}</td>
              <td className="n num" data-l="Total">{fmtUSD(total)}</td>
              <td colSpan={2} data-l="" />
            </tr>
          ) : undefined}
        >
          {filas.map((r) => {
            const bloqueado = !!bloqueoEscritura(periodos, r.fecha);
            const dif = diferenciaPlan(r);
            return (
              <tr key={r.id} className={bloqueado ? 'bloqueada' : ''}>
                <td data-l="Fecha" className="nowrap">{bloqueado && <Ico name="lock" size={12} />} {fmtFecha(r.fecha)}</td>
                <td data-l="" className="titulo">{r.afiliado}</td>
                <td data-l="Plan">
                  {r.plan}{r.convenio && <small>Convenio 50%</small>}
                </td>
                <td data-l="Tipo"><BadgeTipo tipo={r.tipo} /></td>
                <td data-l="Pago">
                  {r.pagos.map((p, i) => {
                    const est = estadoDe(p);
                    return (
                      <div key={i} className="nowrap">
                        {fmtMonto(p.moneda as Moneda, p.monto)}{' '}
                        <small style={{ display: 'inline' }}>{p.moneda}{p.referencia ? ` · ${p.referencia}` : ''}</small>{' '}
                        {est && <BadgeEstado estado={est} />}
                      </div>
                    );
                  })}
                  {r.vueltos.map((v, i) => <small key={`v${i}`}>{`Vuelto ${fmtMonto(v.moneda, v.monto)}`}</small>)}
                  {r.notas && <small>{r.notas}</small>}
                </td>
                <td data-l="Total" className="n num">
                  {fmtUSD(totalUSD(r))}
                  {dif !== null && Math.abs(dif) > 0.01 && <small className={dif < 0 ? 'neg' : 'warn'}>{dif < 0 ? `faltan ${fmtUSD(-dif)}` : `sobran ${fmtUSD(dif)}`}</small>}
                </td>
                <td data-l="Registró"><span className="muted">{r.editadoPor ? `${r.creadoPor} (editó ${r.editadoPor})` : r.creadoPor}</span></td>
                <td className="acc noprint" data-l="">
                  <div className="rowbtns">
                    <button className="btn sm" title={bloqueado ? 'Mes cerrado' : 'Editar'} onClick={() => editar(r)}><Ico name="pencil" /></button>
                    <button className="btn sm danger" title="Eliminar" disabled={bloqueado} onClick={() => void borrar(r)}><Ico name="trash" /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </Tabla>
      </Tarjeta>
    </div>
  );
}
