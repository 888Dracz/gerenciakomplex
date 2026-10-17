/**
 * Autocomplete.tsx — Lista filtrable propia.
 *
 * Reemplaza al <datalist> nativo, que muchos navegadores no muestran al hacer
 * clic ni filtran bien. El valor visible es texto; `onElegir` devuelve además
 * el id resuelto ('' si el texto no coincide con ninguna opción).
 */
import { useMemo, useRef, useState } from 'react';

import { sinTildes } from '../lib/format';

export interface OpcionAuto { id: string | number; label: string }

export function Autocomplete({
  opciones, valor, onCambiar, placeholder, disabled, autoFocus,
}: {
  opciones: OpcionAuto[];
  valor: string;
  onCambiar: (texto: string, id: string | number | '') => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  const cerrarTimer = useRef<number | null>(null);

  const porLabel = useMemo(() => {
    const m = new Map<string, string | number>();
    for (const o of opciones) m.set(o.label, o.id);
    return m;
  }, [opciones]);

  const filtradas = useMemo(() => {
    const q = sinTildes(valor.trim());
    const base = q ? opciones.filter((o) => sinTildes(o.label).includes(q)) : opciones;
    return base.slice(0, 50);
  }, [opciones, valor]);

  const elegir = (o: OpcionAuto) => {
    onCambiar(o.label, o.id);
    setAbierto(false);
    setActivo(-1);
  };

  const marcar = (i: number) => {
    if (!filtradas.length) return;
    setActivo(((i % filtradas.length) + filtradas.length) % filtradas.length);
  };

  return (
    <div className="ac-wrap">
      <input
        type="text"
        autoComplete="off"
        placeholder={placeholder ?? 'Escribe o elige de la lista…'}
        value={valor}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          const txt = e.target.value;
          onCambiar(txt, porLabel.get(txt) ?? '');
          setAbierto(true);
          setActivo(-1);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => {
          // Un pequeño retardo deja que el clic en una opción llegue antes.
          cerrarTimer.current = window.setTimeout(() => setAbierto(false), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!abierto) setAbierto(true); else marcar(activo + 1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(activo - 1); }
          else if (e.key === 'Enter' && activo >= 0 && filtradas[activo]) { e.preventDefault(); elegir(filtradas[activo]); }
          else if (e.key === 'Escape' && abierto) { e.stopPropagation(); setAbierto(false); setActivo(-1); }
        }}
      />
      {abierto && (
        <div className="ac-menu">
          {filtradas.length ? filtradas.map((o, i) => (
            <div
              key={`${o.id}|${o.label}`}
              className={'ac-item' + (i === activo ? ' activo' : '')}
              onMouseDown={(e) => {
                e.preventDefault();
                if (cerrarTimer.current) window.clearTimeout(cerrarTimer.current);
                elegir(o);
              }}
            >
              {o.label}
            </div>
          )) : <div className="ac-vacio">Sin coincidencias</div>}
        </div>
      )}
    </div>
  );
}
