/**
 * ui.tsx — Ventanas modales, avisos flotantes y confirmaciones.
 *
 * Sustituye a los `alert()` y `confirm()` del navegador por diálogos propios:
 * se ven igual que el resto de la aplicación y no bloquean la pestaña.
 * (Tomado de Dorado Club; se añadió el modal obligatorio del cierre de mes.)
 */
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

type RenderModal = (cerrar: () => void) => ReactNode;

interface Aviso { id: number; texto: string; tipo: 'ok' | 'err' | 'info' }
interface ModalAbierto { id: number; render: RenderModal }

export interface ConfirmOpts {
  titulo?: string;
  ok?: string;
  cancelar?: string;
  peligro?: boolean;
}

interface UIApi {
  abrirModal: (render: RenderModal) => () => void;
  confirmar: (mensaje: string, opts?: ConfirmOpts) => Promise<boolean>;
  avisar: (texto: string, tipo?: 'ok' | 'err' | 'info') => void;
}

const Ctx = createContext<UIApi | null>(null);

export function useUI(): UIApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useUI necesita <UIProvider>');
  return api;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [modales, setModales] = useState<ModalAbierto[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguienteId = useRef(1);

  const cerrarModal = useCallback((id: number) => {
    setModales((m) => m.filter((x) => x.id !== id));
  }, []);

  const abrirModal = useCallback((render: RenderModal) => {
    const id = siguienteId.current++;
    setModales((m) => [...m, { id, render }]);
    return () => cerrarModal(id);
  }, [cerrarModal]);

  const avisar = useCallback((texto: string, tipo: 'ok' | 'err' | 'info' = 'info') => {
    const id = siguienteId.current++;
    // Como mucho tres a la vez: los más viejos se van al llegar uno nuevo.
    setAvisos((a) => [...a.slice(-2), { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'err' ? 8000 : 4500);
  }, []);

  const confirmar = useCallback((mensaje: string, opts: ConfirmOpts = {}) =>
    new Promise<boolean>((resolve) => {
      let resuelto = false;
      const responder = (v: boolean, cerrar: () => void) => {
        if (resuelto) return;
        resuelto = true;
        resolve(v);
        cerrar();
      };
      abrirModal((cerrar) => (
        <ModalShell
          titulo={opts.titulo ?? 'Confirmar'}
          onCerrar={() => responder(false, cerrar)}
          pie={(
            <>
              <button className="btn" onClick={() => responder(false, cerrar)}>
                {opts.cancelar ?? 'Cancelar'}
              </button>
              <button
                className={'btn ' + (opts.peligro ? 'danger' : 'primary')}
                onClick={() => responder(true, cerrar)}
                autoFocus
              >
                {opts.ok ?? 'Sí, continuar'}
              </button>
            </>
          )}
        >
          <p className="confirm-txt">{mensaje}</p>
        </ModalShell>
      ));
    }), [abrirModal]);

  const api = useMemo<UIApi>(() => ({ abrirModal, confirmar, avisar }), [abrirModal, confirmar, avisar]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {modales.map((m) => (
        <div key={m.id}>{m.render(() => cerrarModal(m.id))}</div>
      ))}
      {/*
        `aria-live` va en el contenedor, que existe siempre: si apareciera a la
        vez que el aviso, el lector de pantalla no llegaría a anunciarlo. Los
        errores interrumpen (`assertive`); el resto espera turno.
      */}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {avisos.map((a) => (
          <div key={a.id} className={'toast ' + a.tipo} role={a.tipo === 'err' ? 'alert' : 'status'}>
            <span>{a.texto}</span>
            <button
              className="x" aria-label="Cerrar aviso"
              onClick={() => setAvisos((v) => v.filter((x) => x.id !== a.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/**
 * Envoltura visual de un modal: fondo oscuro, tarjeta, título y pie. Cierra al
 * pulsar Escape o al hacer clic fuera de la tarjeta.
 */
/** Elementos que pueden recibir el foco dentro de un contenedor. */
const FOCUSABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focosDe(raiz: HTMLElement | null): HTMLElement[] {
  if (!raiz) return [];
  return [...raiz.querySelectorAll<HTMLElement>(FOCUSABLES)]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function ModalShell({
  titulo, children, pie, onCerrar, ancho, obligatorio,
}: {
  titulo: ReactNode;
  children: ReactNode;
  pie?: ReactNode;
  onCerrar: () => void;
  ancho?: number;
  /** Pregunta que hay que responder: no se cierra con Escape ni tocando fuera. */
  obligatorio?: boolean;
}) {
  const caja = useRef<HTMLDivElement | null>(null);
  const tituloId = useId();

  /*
   * Foco: al abrir se lleva al primer control del modal (salvo que algo dentro
   * pida `autoFocus`), Tab y Shift+Tab dan la vuelta sin salirse, y al cerrar
   * vuelve a donde estaba. Sin esto, con el teclado te vas "por detrás" del
   * modal y navegas la pantalla que quedó tapada.
   */
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    // Si algo dentro traía `autoFocus`, React ya lo enfocó al montar: no se le
    // quita el sitio. Si no, va al primer control (o a la propia tarjeta).
    if (!caja.current?.contains(document.activeElement)) {
      (focosDe(caja.current)[0] ?? caja.current)?.focus();
    }
    return () => previo?.focus?.();
  }, []);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (!obligatorio) onCerrar(); return; }
      if (e.key !== 'Tab' || !caja.current) return;
      const items = focosDe(caja.current);
      if (!items.length) return;
      const primero = items[0];
      const ultimo = items[items.length - 1];
      const activo = document.activeElement;
      // Fuera del modal (o en el borde): se reengancha al extremo que toca.
      if (e.shiftKey && (activo === primero || !caja.current.contains(activo))) {
        e.preventDefault(); ultimo.focus();
      } else if (!e.shiftKey && (activo === ultimo || !caja.current.contains(activo))) {
        e.preventDefault(); primero.focus();
      }
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [onCerrar, obligatorio]);

  return (
    <div
      className="modal-back"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !obligatorio) onCerrar(); }}
    >
      <div
        className={'modal' + (obligatorio ? ' obligatorio' : '')}
        style={ancho ? { width: ancho } : undefined}
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <h3 id={tituloId}>{titulo}</h3>
        {children}
        <div className="foot">{pie ?? <button className="btn" onClick={onCerrar}>Cerrar</button>}</div>
      </div>
    </div>
  );
}

/**
 * Modal con botón Guardar. `onGuardar` devuelve `false` para dejarlo abierto
 * (por ejemplo si el servidor rechazó los datos).
 */
export function ModalFormulario({
  titulo, children, onCerrar, onGuardar, etiquetaGuardar = 'Guardar', ancho,
}: {
  titulo: ReactNode;
  children: ReactNode;
  onCerrar: () => void;
  onGuardar: () => Promise<boolean | void> | boolean | void;
  etiquetaGuardar?: string;
  ancho?: number;
}) {
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    setGuardando(true);
    try {
      if (await onGuardar() !== false) onCerrar();
    } finally {
      setGuardando(false);
    }
  };
  return (
    <ModalShell
      titulo={titulo}
      onCerrar={onCerrar}
      ancho={ancho}
      pie={(
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : etiquetaGuardar}
          </button>
        </>
      )}
    >
      {children}
    </ModalShell>
  );
}
