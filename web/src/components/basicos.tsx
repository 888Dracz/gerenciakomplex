/** basicos.tsx — Piezas pequeñas y repetidas: KPI, tarjeta, tabla, estados, período. */
import { useMemo, useState, type ReactNode } from 'react';

import { ETIQUETA_ESTADO, type EstadoTransferencia } from '@dominio/tipos';
import { estadoCuadre, type EstadoCuadre } from '@dominio/calculos';
import type { Efectivo } from '@dominio/tipos';
import { iso, MESES_LARGO, ultimoDiaMes } from '@dominio/fechas';
import { Ico } from '../lib/icons';

export const usdCls = (v: number | null | undefined): string =>
  (v ?? 0) > 0.004 ? 'pos' : (v ?? 0) < -0.004 ? 'neg' : '';

export function Kpi({ label, valor, cls, detalle, onClick, sel }: {
  label: ReactNode; valor: ReactNode; cls?: string; detalle?: ReactNode; onClick?: () => void; sel?: boolean;
}) {
  return (
    <div
      className={'kpi' + (onClick ? ' clic' : '') + (sel ? ' sel' : '')} onClick={onClick}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="l">{label}</div>
      <div className={'v num ' + (cls ?? '')}>{valor}</div>
      {detalle ? <div className="d">{detalle}</div> : null}
    </div>
  );
}

export function Tarjeta({ titulo, sub, children, className, acciones }: {
  titulo?: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string; acciones?: ReactNode;
}) {
  return (
    <div className={'card ' + (className ?? '')}>
      {(titulo || acciones) && (
        <div className="card-head">
          {titulo ? <h3>{titulo}</h3> : <span />}
          {acciones ? <div className="row noprint">{acciones}</div> : null}
        </div>
      )}
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </div>
  );
}

export interface ColTabla { l: ReactNode; n?: boolean; cls?: string }

/** Tabla con fila de "sin datos". Con `resp`, en el celular cada fila es una ficha. */
export function Tabla({ cols, children, vacio = 'Sin datos.', pie, resp }: {
  cols: ColTabla[];
  children: ReactNode;
  vacio?: string;
  pie?: ReactNode;
  resp?: boolean;
}) {
  const hayFilas = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : !!children;
  return (
    <div className={'tablebox' + (resp ? ' resp' : '')}>
      <table className={'t' + (resp ? ' resp' : '')}>
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className={(c.n ? 'n ' : '') + (c.cls ?? '')}>{c.l}</th>)}</tr>
        </thead>
        <tbody>
          {hayFilas ? children : (
            <tr><td className="empty" colSpan={cols.length}>{vacio}</td></tr>
          )}
        </tbody>
        {pie ? <tfoot>{pie}</tfoot> : null}
      </table>
    </div>
  );
}

export const Cargando = ({ texto = 'Cargando…' }: { texto?: string }) =>
  <div className="cargando" role="status">{texto}</div>;

export const MsgError = ({ error }: { error: unknown }) => (
  <p className="msg err">{error instanceof Error ? error.message : String(error)}</p>
);

const CLS_ESTADO: Record<EstadoTransferencia, string> = { pendiente: 'b-amber', confirmada: 'b-green', no_llego: 'b-red' };

export function BadgeEstado({ estado }: { estado: EstadoTransferencia }) {
  return <span className={'badge ' + CLS_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</span>;
}

export const BadgeTipo = ({ tipo }: { tipo: string }) => (
  <span className={'badge ' + (tipo === 'Nuevo' ? 'b-blue' : tipo === 'Renovación' ? 'b-gold' : 'b-gray')}>{tipo}</span>
);

const SELLO: Record<EstadoCuadre, [string, string, string]> = {
  cuadrada: ['b-green', 'check', 'Caja cuadrada'],
  sobrante: ['b-amber', 'alert', 'Sobrante'],
  faltante: ['b-red', 'alert', 'Faltante'],
};

export function SelloCuadre({ diferencia }: { diferencia: Efectivo }) {
  const [cls, ico, txt] = SELLO[estadoCuadre(diferencia)];
  return <span className={'sello ' + cls}><Ico name={ico} />{txt}</span>;
}

/** Control segmentado (tipo, moneda, filtros). */
export function Segmentado<T extends string>({ opciones, valor, onCambiar, block }: {
  opciones: readonly (T | { v: T; l: ReactNode })[];
  valor: T;
  onCambiar: (v: T) => void;
  block?: boolean;
}) {
  return (
    <div className={'seg' + (block ? ' block' : '')} role="radiogroup">
      {opciones.map((o) => {
        const v = typeof o === 'string' ? o : o.v;
        const l = typeof o === 'string' ? o : o.l;
        return (
          <button
            key={v} type="button" role="radio" aria-checked={v === valor}
            className={v === valor ? 'active' : ''} onClick={() => onCambiar(v)}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

/** Barras horizontales sencillas (pantalla). */
export function Barras({ items, fmt }: { items: { label: string; valor: number }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.valor));
  if (!items.length) return <p className="muted" style={{ margin: 0 }}>Sin datos en el período.</p>;
  return (
    <div className="barras">
      {items.map((i) => (
        <div className="barra" key={i.label}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
          <div className="pista"><div className="relleno" style={{ width: `${(Math.max(0, i.valor) / max) * 100}%` }} /></div>
          <span className="num">{fmt(i.valor)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- selector de período ----------------
export interface Rango { desde: string; hasta: string }

function rangoMes(a: number, m: number): Rango {
  const mes = `${a}-${String(m).padStart(2, '0')}`;
  return { desde: `${mes}-01`, hasta: ultimoDiaMes(mes) };
}

/** Botones rápidos + mes + rango manual. */
export function usePeriodo(inicial: 'hoy' | 'mes' = 'mes') {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const presets = useMemo(() => {
    const d = new Date();
    const anterior = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return [
      { label: 'Hoy', v: { desde: iso(d), hasta: iso(d) } },
      { label: 'Este mes', v: rangoMes(d.getFullYear(), d.getMonth() + 1) },
      { label: 'Mes pasado', v: rangoMes(anterior.getFullYear(), anterior.getMonth() + 1) },
      { label: 'Este año', v: { desde: `${d.getFullYear()}-01-01`, hasta: `${d.getFullYear()}-12-31` } },
    ];
  }, []);
  const ini = inicial === 'hoy' ? 0 : 1;
  const [activo, setActivo] = useState(ini);
  const [rango, setRango] = useState<Rango>(presets[ini].v);
  const [mes, setMes] = useState(0);
  const [anio, setAnio] = useState(y);

  const elegirMes = (m: number, a: number) => {
    setMes(m); setAnio(a);
    if (!m) return;
    setActivo(-1);
    setRango(rangoMes(a, m));
  };

  const barra = (
    <div className="row noprint" style={{ marginBottom: 12 }}>
      {presets.map((p, i) => (
        <button
          key={p.label} className={'ptab' + (i === activo ? ' active' : '')}
          onClick={() => { setActivo(i); setMes(0); setRango(p.v); }}
        >
          {p.label}
        </button>
      ))}
      <select style={{ width: 130 }} aria-label="Mes" value={mes} onChange={(e) => elegirMes(Number(e.target.value), anio)}>
        <option value={0}>Mes…</option>
        {MESES_LARGO.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select style={{ width: 90 }} aria-label="Año" value={anio} onChange={(e) => elegirMes(mes, Number(e.target.value))}>
        {[y, y - 1, y - 2, y - 3].map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <span className="muted solo-pc" style={{ fontSize: 12 }}>o</span>
      <input
        type="date" style={{ width: 150 }} value={rango.desde} aria-label="Desde"
        onChange={(e) => { if (e.target.value) { setActivo(-1); setMes(0); setRango((r) => ({ desde: e.target.value, hasta: r.hasta < e.target.value ? e.target.value : r.hasta })); } }}
      />
      <input
        type="date" style={{ width: 150 }} value={rango.hasta} aria-label="Hasta"
        onChange={(e) => { if (e.target.value) { setActivo(-1); setMes(0); setRango((r) => ({ desde: r.desde > e.target.value ? e.target.value : r.desde, hasta: e.target.value })); } }}
      />
    </div>
  );
  return { rango, barra };
}

/** Pestañas internas de un apartado. */
export function Pestanas({ tabs, inicial = 0 }: { tabs: { label: ReactNode; render: () => ReactNode }[]; inicial?: number }) {
  const [activo, setActivo] = useState(inicial);
  const actual = tabs[Math.min(activo, tabs.length - 1)];
  return (
    <div>
      <div className="row noprint" style={{ marginBottom: 12 }} role="tablist">
        {tabs.map((t, i) => (
          <button
            key={i} role="tab" aria-selected={i === activo}
            className={'ptab' + (i === activo ? ' active' : '')} onClick={() => setActivo(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{actual ? actual.render() : null}</div>
    </div>
  );
}
