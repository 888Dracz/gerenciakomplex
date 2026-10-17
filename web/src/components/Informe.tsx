/**
 * Informe.tsx — Diálogo "Generar informe" (como en Dorado Club): período,
 * comparación y secciones. El documento se arma aquí mismo y se descarga en Word.
 */
import { useMemo, useState } from 'react';

import { iso, ultimoDiaMes } from '@dominio/fechas';
import { SECCIONES_INFORME } from '@dominio/informe/komplex';
import { mensajeError } from '../lib/api';
import { datosParaInforme, descargarWord } from '../lib/exportar';
import { fmtFecha } from '../lib/format';
import { useEstado } from '../state/app';
import { ModalShell, useUI } from '../state/ui';
import type { Rango } from './basicos';

function presets(): { label: string; desde: string; hasta: string }[] {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const mes = (a: number, mm: number) => `${a}-${String(mm + 1).padStart(2, '0')}`;
  const ant = new Date(y, m - 1, 1);
  return [
    { label: 'Este mes', desde: `${mes(y, m)}-01`, hasta: ultimoDiaMes(mes(y, m)) },
    { label: 'Mes pasado', desde: `${mes(ant.getFullYear(), ant.getMonth())}-01`, hasta: ultimoDiaMes(mes(ant.getFullYear(), ant.getMonth())) },
    { label: 'Hoy', desde: iso(hoy), hasta: iso(hoy) },
    { label: 'Este año', desde: `${y}-01-01`, hasta: `${y}-12-31` },
  ];
}

export function DialogoInforme({ onCerrar, inicial }: { onCerrar: () => void; inicial?: Rango }) {
  const estado = useEstado();
  const ui = useUI();
  const rangos = useMemo(presets, []);
  const [desde, setDesde] = useState(inicial?.desde ?? rangos[0].desde);
  const [hasta, setHasta] = useState(inicial?.hasta ?? rangos[0].hasta);
  const [comparar, setComparar] = useState(true);
  const [marcadas, setMarcadas] = useState(() => new Set(SECCIONES_INFORME.filter((s) => s.base).map((s) => s.id)));
  const [generando, setGenerando] = useState(false);

  const alternar = (id: string) => setMarcadas((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const generar = async () => {
    if (!marcadas.size) return ui.avisar('Marca al menos una sección.', 'err');
    if (desde > hasta) return ui.avisar('La fecha "desde" es posterior a "hasta".', 'err');
    setGenerando(true);
    try {
      const datos = await datosParaInforme(desde, hasta);
      // Deja pintar el "Generando…" antes de dibujar los gráficos.
      await new Promise((r) => setTimeout(r, 30));
      const ok = descargarWord(datos, estado.config, { desde, hasta, comparar, secciones: SECCIONES_INFORME.map((s) => s.id).filter((id) => marcadas.has(id)) });
      if (!ok) { ui.avisar('No hay datos en ese período para las secciones elegidas.', 'err'); return; }
      ui.avisar('Informe generado. Revisa tus descargas.', 'ok');
      onCerrar();
    } catch (e) {
      ui.avisar(mensajeError(e), 'err');
    } finally {
      setGenerando(false);
    }
  };

  return (
    <ModalShell
      titulo="Informe para Gerencia (Word)"
      ancho={720}
      onCerrar={onCerrar}
      pie={(
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary" onClick={() => void generar()} disabled={generando}>{generando ? 'Generando…' : 'Generar Word'}</button>
        </>
      )}
    >
      <div className="informe-dlg">
        <section>
          <h4>1 · Período</h4>
          <div className="row" style={{ marginBottom: 8 }}>
            {rangos.map((p) => (
              <button key={p.label} className={'ptab' + (p.desde === desde && p.hasta === hasta ? ' active' : '')}
                onClick={() => { setDesde(p.desde); setHasta(p.hasta); }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="row">
            <div><label className="fl">Desde</label><input type="date" style={{ width: 160 }} value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} /></div>
            <div><label className="fl">Hasta</label><input type="date" style={{ width: 160 }} value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} /></div>
            <span className="sub" style={{ alignSelf: 'flex-end', paddingBottom: 6 }}>{`${fmtFecha(desde)} — ${fmtFecha(hasta)}`}</span>
          </div>
        </section>
        <section>
          <h4>2 · Comparar</h4>
          <label className={'chk' + (comparar ? ' on' : '')}>
            <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} />
            <span><b>Con el período anterior</b><small>El mes anterior si es un mes completo; si no, los días previos de igual duración.</small></span>
          </label>
        </section>
        <section>
          <h4>3 · Secciones</h4>
          <div className="informe-secs">
            {SECCIONES_INFORME.map((s) => (
              <label key={s.id} className={'chk' + (marcadas.has(s.id) ? ' on' : '')}>
                <input type="checkbox" checked={marcadas.has(s.id)} onChange={() => alternar(s.id)} />
                <span><b>{s.titulo}</b><small>{s.desc}</small></span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
