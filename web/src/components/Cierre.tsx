/**
 * Cierre.tsx — La pregunta obligatoria del cierre de mes y el código gerencial.
 *
 * Cuando alguien empieza a registrar en un mes nuevo (desde el día 1) y el mes
 * anterior sigue abierto, aparece sola la pregunta "¿Quieres cerrar el registro
 * del mes X?". No se puede cerrar tocando fuera ni con Escape: hay que
 * responder.
 *  - Sí → el mes queda cerrado (no se puede modificar) y se guardan su Excel y
 *    su informe en la carpeta de datos.
 *  - No → no se puede registrar en el mes nuevo.
 * Si hace falta saltarse esto, "Código gerencial" abre 24 horas sin bloqueos.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { resumen } from '@dominio/calculos';
import { nombreMes, nombreMesMinuscula, ultimoDiaMes, mesDe } from '@dominio/fechas';
import { bloqueoEscritura, type Bloqueo } from '@dominio/periodos';
import type { Datos } from '@dominio/tipos';
import { apiDelete, apiGet, apiPost, ErrorApi, mensajeError } from '../lib/api';
import { guardarArchivosCierre } from '../lib/exportar';
import { fmtFechaHora, fmtUSD } from '../lib/format';
import { Ico } from '../lib/icons';
import { useApp, usePeriodos } from '../state/app';
import { ModalShell, useUI } from '../state/ui';

// Evita dos preguntas iguales a la vez (dos formularios en la misma pantalla).
let preguntando = false;

function ResumenMes({ mes }: { mes: string }) {
  const [d, setD] = useState<Datos | null>(null);
  useEffect(() => {
    let vivo = true;
    apiGet<Datos>(`/api/datos?desde=${mes}-01&hasta=${ultimoDiaMes(mes)}`).then((x) => { if (vivo) setD(x); }).catch(() => { /* sin resumen */ });
    return () => { vivo = false; };
  }, [mes]);
  if (!d) return <p className="muted" style={{ fontSize: 12.5 }}>Cargando cifras del mes…</p>;
  const r = resumen(d, `${mes}-01`, ultimoDiaMes(mes));
  return (
    <>
      <div className="grid g3" style={{ marginBottom: 10 }}>
        <div className="kpi"><div className="l">Ingreso</div><div className="v num">{fmtUSD(r.ingresoUSD)}</div></div>
        <div className="kpi"><div className="l">Afiliados</div><div className="v num">{r.afiliados}</div></div>
        <div className="kpi"><div className="l">Registros</div><div className="v num">{r.registros}</div></div>
      </div>
      {r.transferencias.pendientes > 0 && (
        <p className="msg warn">
          {`Hay ${r.transferencias.pendientes} transferencia(s) sin verificar (${fmtUSD(r.transferencias.usdPendiente)}). Si cierras, quedarán como pendientes.`}
        </p>
      )}
      {r.cuadres.sinCuadre.length > 0 && (
        <p className="msg warn">{`${r.cuadres.sinCuadre.length} día(s) con movimiento no tienen cuadre de caja.`}</p>
      )}
    </>
  );
}

export function DialogoGerencial({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const { recargar } = useApp();
  const ui = useUI();
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const activar = async () => {
    if (!codigo.trim()) return;
    setEnviando(true);
    setError('');
    try {
      await apiPost('/api/gerencial', { codigo });
      await recargar();
      ui.avisar('Modo gerencial activo por 24 horas: sin bloqueos ni avisos de cierre.', 'ok');
      onListo();
      onCerrar();
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };
  return (
    <ModalShell
      titulo={<><Ico name="key" /> Código gerencial</>}
      onCerrar={onCerrar}
      ancho={440}
      pie={(
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary" onClick={activar} disabled={enviando || !codigo.trim()}>
            {enviando ? 'Verificando…' : 'Activar 24 horas'}
          </button>
        </>
      )}
    >
      <p className="confirm-txt" style={{ marginBottom: 12 }}>
        Con el código gerencial se puede modificar cualquier mes (también los cerrados) y no aparecen los avisos
        de cierre, durante 24 horas en este dispositivo. Todo lo que se cambie queda anotado en la bitácora.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void activar(); }}>
        <label className="fl" htmlFor="codigo-ger">Código</label>
        <input
          id="codigo-ger" type="password" autoFocus autoComplete="off" value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
      </form>
      {error && <p className="msg err">{error}</p>}
    </ModalShell>
  );
}

function PreguntaCierre({ mes, mesNuevo, onRespuesta }: {
  mes: string; mesNuevo: string; onRespuesta: (r: 'si' | 'no' | 'gerencial') => void;
}) {
  const { estado } = useApp();
  const ui = useUI();
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState('');
  const mesTxt = nombreMesMinuscula(mes);

  const cerrar = async () => {
    setCerrando(true);
    setError('');
    try {
      await apiPost(`/api/cierres/${mes}`);
      ui.avisar(`${nombreMes(mes)} quedó cerrado. Guardando su Excel e informe en la carpeta…`, 'ok');
      if (estado) {
        guardarArchivosCierre(mes, estado.config)
          .then(() => ui.avisar(`Excel e informe de ${nombreMes(mes)} guardados en la carpeta de datos (cierres).`, 'ok'))
          .catch((e) => ui.avisar(`El mes quedó cerrado, pero no se pudieron guardar sus archivos: ${mensajeError(e)}`, 'err'));
      }
      onRespuesta('si');
    } catch (e) {
      setError(mensajeError(e));
      setCerrando(false);
    }
  };

  return (
    <ModalShell
      titulo={<><Ico name="lock" /> Cierre de mes</>}
      obligatorio
      ancho={540}
      onCerrar={() => onRespuesta('no')}
      pie={(
        <>
          <button className="enlace" style={{ marginRight: 'auto' }} onClick={() => onRespuesta('gerencial')}>
            Código gerencial
          </button>
          <button className="btn" onClick={() => onRespuesta('no')} disabled={cerrando}>No</button>
          <button className="btn primary" onClick={cerrar} disabled={cerrando} autoFocus>
            {cerrando ? 'Cerrando…' : `Sí, cerrar ${mesTxt}`}
          </button>
        </>
      )}
    >
      {mesNuevo !== mes && (
        <p className="muted" style={{ margin: '0 0 4px', fontSize: 13 }}>
          {`Estás empezando a registrar en ${nombreMes(mesNuevo)}.`}
        </p>
      )}
      <p className="pregunta">{`¿Quieres cerrar el registro del mes de ${nombreMes(mes)}?`}</p>
      <ResumenMes mes={mes} />
      <p className="confirm-txt" style={{ fontSize: 13 }}>
        {`Si respondes que sí, ya no se podrá crear, modificar ni borrar nada de ${mesTxt}, y se guardarán su Excel `
          + `y su informe de Word en la carpeta de datos. Si respondes que no, no se podrán hacer registros de `
          + `${nombreMesMinuscula(mesNuevo)} hasta cerrarlo.`}
      </p>
      {error && <p className="msg err">{error}</p>}
    </ModalShell>
  );
}

/** Acciones de cierre que usan los apartados. */
export function useCierre() {
  const ui = useUI();
  const { cambio, recargar } = useApp();

  const pedirGerencial = useCallback(() => new Promise<boolean>((resolve) => {
    let ok = false;
    ui.abrirModal((cerrar) => (
      <DialogoGerencial onCerrar={() => { cerrar(); resolve(ok); }} onListo={() => { ok = true; }} />
    ));
  }), [ui]);

  /** Pregunta por cada mes pendiente, del más viejo al más nuevo. true = todos cerrados. */
  const pedirCierre = useCallback(async (meses: string[], mesNuevo: string): Promise<boolean> => {
    if (preguntando) return false;
    preguntando = true;
    try {
      for (const mes of meses) {
        const r = await new Promise<'si' | 'no' | 'gerencial'>((resolve) => {
          ui.abrirModal((cerrar) => (
            <PreguntaCierre mes={mes} mesNuevo={mesNuevo} onRespuesta={(x) => { cerrar(); resolve(x); }} />
          ));
        });
        if (r === 'gerencial') {
          const ok = await pedirGerencial();
          if (ok) return true;
          return false;
        }
        if (r === 'no') {
          if (mesNuevo !== mes) ui.avisar(`No se puede registrar en ${nombreMes(mesNuevo)} mientras ${nombreMes(mes)} siga abierto.`, 'err');
          return false;
        }
        cambio();
      }
      await recargar();
      return true;
    } finally {
      preguntando = false;
    }
  }, [ui, cambio, recargar, pedirGerencial]);

  /**
   * Reacción común a un error al guardar: si fue por el cierre de mes, abre la
   * pregunta (o el código gerencial). Devuelve true si se encargó del error.
   */
  const manejarError = useCallback((e: unknown, fecha?: string): boolean => {
    if (!(e instanceof ErrorApi)) return false;
    if (e.codigo === 'CIERRE_PENDIENTE') {
      const meses = (e.datos.meses as string[]) ?? [];
      void pedirCierre(meses, (e.datos.mes as string) ?? (fecha ? mesDe(fecha) : meses[0]));
      return true;
    }
    if (e.codigo === 'MES_CERRADO') {
      void ui.confirmar(`${e.message}\n\n¿Quieres usar el código gerencial?`, { titulo: 'Mes cerrado', ok: 'Código gerencial', cancelar: 'Cerrar' })
        .then((si) => { if (si) void pedirGerencial(); });
      return true;
    }
    return false;
  }, [pedirCierre, pedirGerencial, ui]);

  const terminarGerencial = useCallback(async () => {
    try { await apiDelete('/api/gerencial'); } catch { /* da igual */ }
    await recargar();
    ui.avisar('Modo gerencial terminado.', 'info');
  }, [recargar, ui]);

  return { pedirCierre, pedirGerencial, manejarError, terminarGerencial };
}

/**
 * Guardia de un formulario: dice si se puede escribir en esa fecha y, si el
 * mes anterior está abierto, abre sola la pregunta del cierre (una vez por mes
 * mientras el formulario esté en pantalla).
 */
export function useGuardiaCierre(fecha: string, auto = true): Bloqueo | null {
  const periodos = usePeriodos();
  const { pedirCierre } = useCierre();
  const bloqueo = fecha ? bloqueoEscritura(periodos, fecha) : null;
  const yaPreguntado = useRef<string>('');
  const clave = bloqueo?.tipo === 'cierre_pendiente' ? `${bloqueo.meses.join(',')}>${bloqueo.mes}` : '';
  useEffect(() => {
    if (!auto || !clave || yaPreguntado.current === clave || !bloqueo || bloqueo.tipo !== 'cierre_pendiente') return;
    yaPreguntado.current = clave;
    void pedirCierre(bloqueo.meses, bloqueo.mes);
  }, [auto, clave, bloqueo, pedirCierre]);
  return bloqueo;
}

/** Aviso dentro del formulario cuando no se puede registrar en esa fecha. */
export function Candado({ bloqueo }: { bloqueo: Bloqueo | null }) {
  const { pedirCierre, pedirGerencial } = useCierre();
  if (!bloqueo) return null;
  return (
    <div className="candado">
      <b><Ico name="lock" /> {bloqueo.tipo === 'mes_cerrado' ? `${nombreMes(bloqueo.mes)} está cerrado` : 'Falta cerrar el mes anterior'}</b>
      <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 8 }}>{bloqueo.mensaje}</div>
      <div className="row">
        {bloqueo.tipo === 'cierre_pendiente' && (
          <button className="btn sm primary" onClick={() => void pedirCierre(bloqueo.meses, bloqueo.mes)}>
            {`Cerrar ${nombreMesMinuscula(bloqueo.meses[0])}`}
          </button>
        )}
        <button className="btn sm" onClick={() => void pedirGerencial()}><Ico name="key" />Código gerencial</button>
      </div>
    </div>
  );
}

/** Franja superior mientras el modo gerencial está activo. */
export function BannerGerencial() {
  const { estado, gerencial } = useApp();
  const { terminarGerencial } = useCierre();
  if (!gerencial || !estado?.gerencialHasta) return null;
  return (
    <div className="banner gerencial noprint" role="status">
      <Ico name="key" />
      <b>MODO GERENCIAL</b>
      <span>{`Sin bloqueos de cierre ni avisos hasta el ${fmtFechaHora(estado.gerencialHasta)}`}</span>
      <span className="sp" />
      <button className="btn sm" onClick={() => void terminarGerencial()}>Terminar ahora</button>
    </div>
  );
}
