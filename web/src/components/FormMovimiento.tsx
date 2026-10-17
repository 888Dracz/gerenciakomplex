/** FormMovimiento.tsx — Gasto, otro ingreso o retiro de la caja. */
import { useState } from 'react';

import { enUSD, r2, tasaSugerida } from '@dominio/calculos';
import {
  ETIQUETA_MOVIMIENTO, INFO_MONEDA, MONEDAS, TIPOS_MOVIMIENTO, esTransferencia,
  type Moneda, type Movimiento, type Tasas, type TipoMovimiento,
} from '@dominio/tipos';
import { apiPost, apiPut, mensajeError } from '../lib/api';
import { fmtUSD, leerNumero } from '../lib/format';
import { Ico } from '../lib/icons';
import { useApp, useEstado, usePeriodos } from '../state/app';
import { useUI } from '../state/ui';
import { bloqueoEdicion } from '@dominio/periodos';
import { Segmentado } from './basicos';
import { Candado, useCierre, useGuardiaCierre } from './Cierre';

const AYUDA: Record<TipoMovimiento, string> = {
  gasto: 'Lo que se paga con dinero del gimnasio (limpieza, agua, reparaciones…). Resta del resultado.',
  ingreso: 'Otro cobro que no es una afiliación (venta de agua, toalla, casillero…).',
  retiro: 'Dinero que sale de la caja hacia la gerencia o el banco. No es gasto: solo cambia de lugar.',
};

export function FormMovimiento({ fecha, inicial, tasas, onListo }: {
  fecha: string;
  inicial?: Movimiento;
  tasas: Record<string, Tasas>;
  onListo?: () => void;
}) {
  const estado = useEstado();
  const { cambio } = useApp();
  const ui = useUI();
  const { manejarError } = useCierre();
  const periodos = usePeriodos();
  const [tipo, setTipo] = useState<TipoMovimiento>(inicial?.tipo ?? 'gasto');
  const [concepto, setConcepto] = useState(inicial?.concepto ?? '');
  const [categoria, setCategoria] = useState(inicial?.categoria ?? estado.config.categoriasGasto[0] ?? 'Otros');
  const [moneda, setMoneda] = useState<Moneda>(inicial?.moneda ?? 'Dólares');
  const [monto, setMonto] = useState(inicial ? String(inicial.monto) : '');
  const [tasa, setTasa] = useState(inicial && INFO_MONEDA[inicial.moneda].tasa ? String(inicial.tasa) : '');
  const [referencia, setReferencia] = useState(inicial?.referencia ?? '');
  const [notas, setNotas] = useState(inicial?.notas ?? '');
  const [f, setF] = useState(inicial?.fecha ?? fecha);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const guardiaNuevo = useGuardiaCierre(inicial ? '' : fecha, !inicial);
  const bloqueo = inicial ? bloqueoEdicion(periodos, inicial.fecha, f) : guardiaNuevo;
  const fechaUsar = inicial ? f : fecha;

  const cambiarMoneda = (m: Moneda) => {
    setMoneda(m);
    setTasa(INFO_MONEDA[m].tasa ? String(tasaSugerida(tasas, fechaUsar, m) ?? '') : '');
  };

  const usd = r2(enUSD({ moneda, monto: leerNumero(monto) || 0, tasa: leerNumero(tasa) || 0 }));

  const guardar = async () => {
    setMsg('');
    const cuerpo = {
      fecha: fechaUsar, tipo, concepto, categoria: tipo === 'gasto' ? categoria : '', moneda,
      monto: leerNumero(monto), tasa: INFO_MONEDA[moneda].tasa ? leerNumero(tasa) : 1, referencia, notas,
    };
    setGuardando(true);
    try {
      if (inicial) await apiPut(`/api/movimientos/${inicial.id}`, cuerpo);
      else await apiPost('/api/movimientos', cuerpo);
      cambio();
      ui.avisar(`${ETIQUETA_MOVIMIENTO[tipo]} guardado ✓`, 'ok');
      if (!inicial) { setConcepto(''); setMonto(''); setReferencia(''); setNotas(''); }
      onListo?.();
    } catch (e) {
      if (!manejarError(e, fechaUsar)) setMsg(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <Candado bloqueo={bloqueo} />
      <div className="field">
        <Segmentado
          block opciones={TIPOS_MOVIMIENTO.map((t) => ({ v: t, l: ETIQUETA_MOVIMIENTO[t] }))}
          valor={tipo} onCambiar={setTipo}
        />
        <small className="muted" style={{ display: 'block', marginTop: 5, fontSize: 11.5 }}>{AYUDA[tipo]}</small>
      </div>
      {inicial && (
        <div className="field">
          <label className="fl">Fecha</label>
          <input type="date" value={f} onChange={(e) => e.target.value && setF(e.target.value)} />
        </div>
      )}
      <div className="form-grid">
        <div className="field" style={{ gridColumn: tipo === 'gasto' ? undefined : '1 / -1' }}>
          <label className="fl">Concepto *</label>
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tipo === 'retiro' ? 'Entrega a gerencia' : tipo === 'gasto' ? 'Cloro, botellón…' : 'Venta de agua'} />
        </div>
        {tipo === 'gasto' && (
          <div className="field">
            <label className="fl">Categoría</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {[...estado.config.categoriasGasto, ...(categoria && !estado.config.categoriasGasto.includes(categoria) ? [categoria] : [])]
                .map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="field">
        <label className="fl">Moneda</label>
        <Segmentado opciones={MONEDAS} valor={moneda} onCambiar={cambiarMoneda} />
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="crece" style={{ maxWidth: 180 }}>
          <label className="fl">{`Monto (${INFO_MONEDA[moneda].unidad})`}</label>
          <input inputMode="decimal" className="num" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </div>
        {INFO_MONEDA[moneda].tasa && (
          <div className="crece" style={{ maxWidth: 160 }}>
            <label className="fl">Tasa</label>
            <input inputMode="decimal" className="num" value={tasa} onChange={(e) => setTasa(e.target.value)} />
          </div>
        )}
        {esTransferencia(moneda) && (
          <div className="crece">
            <label className="fl">Referencia</label>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
        )}
        <span className="muted num" style={{ alignSelf: 'flex-end', paddingBottom: 9, fontSize: 12 }}>{`= ${fmtUSD(usd)}`}</span>
      </div>
      <div className="field">
        <label className="fl">Notas</label>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" />
      </div>
      {msg && <p className="msg err">{msg}</p>}
      <button className="btn primary block" onClick={() => void guardar()} disabled={guardando || !!bloqueo}>
        <Ico name="check" />{guardando ? 'Guardando…' : inicial ? 'Guardar cambios' : `Registrar ${ETIQUETA_MOVIMIENTO[tipo].toLowerCase()}`}
      </button>
    </div>
  );
}
