/**
 * Cierres.tsx — Cierre de mes: qué meses están cerrados, cerrar el que toca y
 * el código gerencial.
 */
import { useMemo } from 'react';

import { resumenPorMes } from '@dominio/calculos';
import { mesDe, nombreMes, ultimoDiaMes } from '@dominio/fechas';
import { mesesPorCerrar, puedeCerrar } from '@dominio/periodos';
import { GERENCIAL_HORAS } from '@dominio/tipos';
import { apiDelete, mensajeError } from '../lib/api';
import { descargarExcel, guardarArchivosCierre } from '../lib/exportar';
import { fmtFechaHora, fmtUSD } from '../lib/format';
import { Ico } from '../lib/icons';
import { useApp, useDatos, useEstado } from '../state/app';
import { useUI } from '../state/ui';
import { Cargando, MsgError, Tabla, Tarjeta } from '../components/basicos';
import { useCierre } from '../components/Cierre';

export function Cierres() {
  const estado = useEstado();
  const { gerencial, cambio, recargar } = useApp();
  const ui = useUI();
  const { pedirCierre, pedirGerencial, terminarGerencial } = useCierre();
  const { datos, error } = useDatos();
  const mesHoy = mesDe(estado.hoy);
  const meses = useMemo(() => {
    const s = new Set([...estado.mesesConDatos, ...Object.keys(estado.config.cierres), mesHoy]);
    return [...s].sort().reverse();
  }, [estado, mesHoy]);
  const resumenes = useMemo(() => (datos ? new Map(resumenPorMes(datos, meses).map((r) => [r.mes, r])) : null), [datos, meses]);

  if (error) return <MsgError error={error} />;
  if (!datos || !resumenes) return <Cargando />;

  const periodos = { mesesConDatos: estado.mesesConDatos, cierres: estado.config.cierres };

  const cerrar = (mes: string) => {
    const antes = mesesPorCerrar(periodos, mes);
    void pedirCierre([...antes, mes], mes);
  };

  const reabrir = async (mes: string) => {
    if (!await ui.confirmar(`¿Reabrir ${nombreMes(mes)}? Se podrá volver a modificar y quedará anotado en la bitácora.`, { ok: 'Reabrir', peligro: true })) return;
    try {
      await apiDelete(`/api/cierres/${mes}`);
      cambio();
      await recargar();
      ui.avisar(`${nombreMes(mes)} reabierto.`, 'ok');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };

  const regenerar = async (mes: string) => {
    try {
      await guardarArchivosCierre(mes, estado.config);
      ui.avisar(`Excel e informe de ${nombreMes(mes)} guardados en la carpeta de datos.`, 'ok');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };

  return (
    <div>
      <Tarjeta titulo={<><Ico name="lock" /> Cómo funciona el cierre de mes</>}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6 }}>
          <li>Al empezar a registrar en un mes nuevo (desde el día 1), el programa pregunta obligatoriamente: <b>«¿Quieres cerrar el registro del mes anterior?»</b></li>
          <li><b>Sí:</b> el mes queda cerrado y ya no se puede crear, modificar ni borrar nada de él. Su Excel y su informe de Word se guardan en la carpeta de datos (<i>cierres</i>).</li>
          <li><b>No:</b> no se pueden hacer registros del mes nuevo hasta cerrarlo.</li>
          <li>Si hace falta corregir algo o saltarse esto, el <b>código gerencial</b> abre {GERENCIAL_HORAS} horas sin bloqueos ni avisos en ese dispositivo. Todo queda en la bitácora.</li>
        </ul>
      </Tarjeta>

      <Tarjeta
        titulo={<><Ico name="key" /> Código gerencial</>}
        acciones={gerencial
          ? <button className="btn sm" onClick={() => void terminarGerencial()}>Terminar ahora</button>
          : <button className="btn sm primary" onClick={() => void pedirGerencial()}><Ico name="key" />Usar código gerencial</button>}
      >
        <p className="sub" style={{ margin: 0 }}>
          {gerencial
            ? `Activo: se puede modificar cualquier mes y reabrir meses cerrados hasta el ${fmtFechaHora(estado.gerencialHasta)}`
            : 'Inactivo. Los meses cerrados están protegidos.'}
        </p>
      </Tarjeta>

      <Tarjeta titulo="Meses">
        <Tabla resp cols={[{ l: 'Mes' }, { l: 'Estado' }, { l: 'Registros', n: true }, { l: 'Afiliados', n: true }, { l: 'Ingreso', n: true }, { l: 'Por verificar', n: true }, { l: 'Cierre' }, { l: '', cls: 'noprint' }]}>
          {meses.map((mes) => {
            const r = resumenes.get(mes)!;
            const c = estado.config.cierres[mes];
            const motivo = puedeCerrar(periodos, mes, estado.hoy);
            const enCurso = mes === mesHoy;
            return (
              <tr key={mes}>
                <td data-l="" className="titulo">{nombreMes(mes)}</td>
                <td data-l="Estado">
                  {c ? <span className="badge b-green"><Ico name="lock" size={12} /> Cerrado</span>
                    : enCurso ? <span className="badge b-blue">En curso</span>
                      : <span className="badge b-amber">Abierto</span>}
                </td>
                <td data-l="Registros" className="n num">{r.registros}</td>
                <td data-l="Afiliados" className="n num">{r.afiliados}</td>
                <td data-l="Ingreso" className="n num">{fmtUSD(r.ingresoUSD)}</td>
                <td data-l="Por verificar" className={'n num ' + (r.transferencias.pendientes ? 'warn' : '')}>{r.transferencias.pendientes}</td>
                <td data-l="Cierre"><span className="muted">{c ? `${c.cerradoPor} · ${fmtFechaHora(c.cerradoEn)}` : '—'}</span></td>
                <td className="acc noprint" data-l="">
                  <div className="rowbtns">
                    <button className="btn sm" title="Excel del mes" onClick={() => descargarExcel(datos, estado.config, { desde: `${mes}-01`, hasta: ultimoDiaMes(mes) })}>
                      <Ico name="sheet" />
                    </button>
                    {!c && (!motivo || (gerencial && !mesesPorCerrar(periodos, mes).length)) && (
                      <button className="btn sm primary" onClick={() => cerrar(mes)}><Ico name="lock" />Cerrar mes</button>
                    )}
                    {c && <button className="btn sm" title="Volver a guardar su Excel e informe en la carpeta" onClick={() => void regenerar(mes)}><Ico name="save" /></button>}
                    {c && gerencial && <button className="btn sm danger" onClick={() => void reabrir(mes)}><Ico name="unlock" />Reabrir</button>}
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
