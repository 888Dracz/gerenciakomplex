/**
 * CarpetaWeb.tsx — Pantallas propias de la versión web (GitHub Pages):
 *  - Bienvenida: elegir/crear la carpeta de datos o usar solo el navegador.
 *  - Aviso para reconectar la carpeta (el navegador pide permiso de nuevo).
 *  - Qué datos conservar si la carpeta cambió desde otro lugar.
 *  - Tarjetas de Configuración: carpeta, guardar la página y celular.
 */
import { useState } from 'react';

import { fmtFecha } from '@dominio/fechas';
import { apiPost, mensajeError } from '../lib/api';
import { fmtFechaHora } from '../lib/format';
import { Ico, Monograma } from '../lib/icons';
import { descargarBinario } from '../lib/zip';
import { useApp, useEstado } from '../state/app';
import { ModalShell, useUI } from '../state/ui';
import { Tarjeta } from './basicos';

interface Revision {
  ruta: string; existe: boolean; tieneDatos: boolean; tieneClave: boolean;
  meses: string[]; registros: number; problema: string | null; cancelado?: boolean;
}

interface ResumenLado { registros: number; meses: number; ultimaFecha: string | null }
interface Conexion { resultado: 'igual' | 'subido' | 'bajado' | 'conflicto'; carpeta: string | null; navegador?: ResumenLado; carpetaDatos?: ResumenLado }

function Logo() {
  return (
    <div className="login-logo">
      <div className="sun"><Monograma size={54} /></div>
      <h1>KOMPLEX GYM</h1>
      <p>Gerencia · Caja, registro de pagos y cuadre</p>
    </div>
  );
}

// ---------------------------------------------------------------- bienvenida
export function BienvenidaWeb() {
  const { inicio, entrar } = useApp();
  const soporta = !!inicio?.soportaCarpeta;
  const [paso, setPaso] = useState<1 | 2>(1);
  const [rev, setRev] = useState<Revision | null>(null);
  const [sinCarpeta, setSinCarpeta] = useState(false);
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const elegir = async () => {
    setError('');
    try {
      const r = await apiPost<Revision>('/api/carpeta/elegir');
      if (r.cancelado) return;
      if (r.problema) { setError(r.problema); return; }
      setRev(r);
      setSinCarpeta(false);
      setPaso(2);
    } catch (e) { setError(mensajeError(e)); }
  };

  const soloNavegador = () => { setRev(null); setSinCarpeta(true); setPaso(2); setError(''); };

  const necesitaClave = sinCarpeta || !rev?.tieneClave;

  const crear = async () => {
    setError('');
    if (necesitaClave) {
      if (!nombre.trim()) return setError('Escribe tu nombre.');
      if (clave.length < 4) return setError('La clave debe tener al menos 4 caracteres.');
      if (clave !== clave2) return setError('Las dos claves no coinciden.');
    }
    setOcupado(true);
    try {
      const r = await apiPost<{ token: string | null }>('/api/carpeta/configurar', { sinCarpeta, clave, nombre });
      if (r.token) await entrar(r.token);
      else location.reload();
    } catch (e) { setError(mensajeError(e)); setOcupado(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card ancha">
        <Logo />
        <div className="pasos"><span className="on" /><span className={paso === 2 ? 'on' : ''} /></div>

        {paso === 1 && (
          <>
            <h3 style={{ color: 'var(--gold)' }}><Ico name="folder" /> ¿Dónde se guarda la información?</h3>
            {soporta ? (
              <>
                <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>
                  Elige o crea una carpeta en esta computadora (por ejemplo en <b>Documentos</b>). Todo lo que se
                  registre cada día se guardará <b>automáticamente</b> ahí, además de en el navegador: aunque se
                  borre el navegador o se pierda el enlace, los datos siguen en la carpeta. Si ya tienes una carpeta
                  de Komplex (del programa de escritorio o de otra computadora), elígela y se usarán sus datos.
                </p>
                <button className="btn primary block lg" onClick={() => void elegir()}><Ico name="folder" />Elegir o crear carpeta…</button>
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Si eliges una carpeta general (como Documentos), dentro se crea «Komplex Gerencia».
                </p>
                <button className="enlace" onClick={soloNavegador}>Prefiero guardar solo en este navegador</button>
              </>
            ) : (
              <>
                <p className="msg warn">
                  Este navegador no permite elegir una carpeta (pasa en iPhone, iPad y algunos navegadores). La información
                  se guardará <b>en este navegador</b>, en este dispositivo.
                </p>
                <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>
                  Para no perderla, descarga un respaldo de vez en cuando (Configuración → Carpeta y respaldos). En una
                  computadora con Chrome o Edge sí se puede usar una carpeta.
                </p>
                <button className="btn primary block lg" onClick={soloNavegador}>Continuar</button>
              </>
            )}
            {error && <p className="msg err">{error}</p>}
          </>
        )}

        {paso === 2 && (
          <>
            <h3 style={{ color: 'var(--gold)' }}>
              <Ico name={rev?.tieneDatos ? 'history' : 'key'} /> {rev?.tieneDatos ? 'Carpeta con datos encontrada' : 'Clave de acceso'}
            </h3>
            {rev && (
              <>
                <label className="fl">Los datos se guardarán en la carpeta</label>
                <div className="ruta" style={{ marginBottom: 12 }}>{rev.ruta}</div>
              </>
            )}
            {sinCarpeta && <p className="msg info">Los datos se guardarán solo en este navegador. Podrás elegir una carpeta después en Configuración.</p>}
            {rev?.tieneDatos && (
              <p className="msg ok">
                {`Esta carpeta ya tiene información de Komplex: ${rev.registros} registro(s) en ${rev.meses.length} mes(es). Se usará tal cual`}
                {rev.tieneClave ? ' y se entra con su misma clave.' : '.'}
              </p>
            )}
            {necesitaClave && (
              <>
                <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>Esta clave se pide para entrar al programa en este navegador.</p>
                <div className="field">
                  <label className="fl" htmlFor="w-nombre">Tu nombre</label>
                  <input id="w-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" />
                </div>
                <div className="grid g2">
                  <div className="field">
                    <label className="fl" htmlFor="w-clave">Clave de acceso</label>
                    <input id="w-clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" />
                  </div>
                  <div className="field">
                    <label className="fl" htmlFor="w-clave2">Repite la clave</label>
                    <input id="w-clave2" type="password" value={clave2} onChange={(e) => setClave2(e.target.value)} autoComplete="new-password" />
                  </div>
                </div>
              </>
            )}
            {error && <p className="msg err">{error}</p>}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn" onClick={() => { setPaso(1); setError(''); }}>Atrás</button>
              <button className="btn primary lg" onClick={() => void crear()} disabled={ocupado}>
                {ocupado ? 'Preparando…' : rev?.tieneDatos ? 'Usar esta carpeta' : 'Empezar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- conectar y sincronizar
const ladoTxt = (r?: ResumenLado) =>
  (r ? `${r.registros} registro(s) en ${r.meses} mes(es)${r.ultimaFecha ? ` · último: ${fmtFecha(r.ultimaFecha)}` : ''}` : '—');

export function useCarpetaWeb() {
  const ui = useUI();
  const { cambio, recargar } = useApp();

  const despues = async (r: Conexion) => {
    if (r.resultado === 'conflicto') {
      const usar = await new Promise<'carpeta' | 'navegador' | null>((resolve) => {
        ui.abrirModal((cerrar) => (
          <ModalShell
            titulo={<><Ico name="alert" /> La carpeta cambió desde otro lugar</>}
            obligatorio
            onCerrar={() => { cerrar(); resolve(null); }}
            pie={(
              <>
                <button className="btn" onClick={() => { cerrar(); resolve('navegador'); }}>Quedarme con los de este navegador</button>
                <button className="btn primary" onClick={() => { cerrar(); resolve('carpeta'); }}>Usar los de la carpeta</button>
              </>
            )}
          >
            <p className="confirm-txt">
              {`Mientras la carpeta «${r.carpeta}» no estaba conectada, se registraron datos en este navegador, y la carpeta también fue modificada (por el programa de escritorio u otro navegador). ¿Con cuáles te quedas? Los otros se guardan como respaldo.`}
            </p>
            <div className="grid g2" style={{ marginTop: 12 }}>
              <div className="kpi"><div className="l">En la carpeta</div><div className="d" style={{ fontSize: 13 }}>{ladoTxt(r.carpetaDatos)}</div></div>
              <div className="kpi"><div className="l">En este navegador</div><div className="d" style={{ fontSize: 13 }}>{ladoTxt(r.navegador)}</div></div>
            </div>
          </ModalShell>
        ));
      });
      if (!usar) return;
      await apiPost('/api/carpeta/resolver', { usar });
      ui.avisar(usar === 'carpeta' ? 'Se cargaron los datos de la carpeta.' : 'Los datos de este navegador se guardaron en la carpeta.', 'ok');
    } else if (r.resultado === 'bajado') {
      ui.avisar(`Se cargaron los datos de la carpeta «${r.carpeta}».`, 'ok');
    } else if (r.carpeta) {
      ui.avisar(`Carpeta «${r.carpeta}» conectada: todo se guarda ahí.`, 'ok');
    }
    cambio();
    await recargar();
  };

  const conectar = async (otra = false) => {
    try {
      await despues(await apiPost<Conexion>('/api/carpeta/conectar', { otra }));
    } catch (e) {
      ui.avisar(mensajeError(e), 'err');
      await recargar();
    }
  };

  const desconectar = async () => {
    if (!await ui.confirmar('¿Dejar de guardar en la carpeta? Los datos siguen en este navegador y lo que ya está en la carpeta no se borra.', { ok: 'Dejar de usarla' })) return;
    try {
      await apiPost('/api/carpeta/desconectar');
      cambio();
      await recargar();
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };

  return { conectar, desconectar };
}

/** Franja cuando la carpeta elegida no está conectada (el navegador pide permiso otra vez). */
export function AvisoCarpeta() {
  const { estado } = useApp();
  const { conectar } = useCarpetaWeb();
  if (!estado?.web) return null;
  if (estado.carpetaEstado === 'sin-permiso') {
    return (
      <div className="banner aviso noprint" role="status">
        <Ico name="folder" />
        <span>{`La carpeta «${estado.carpeta}» no está conectada: los cambios se guardan en el navegador y pasarán a la carpeta al conectarla.`}</span>
        <span className="sp" />
        <button className="btn sm primary" onClick={() => void conectar()}>Conectar carpeta</button>
      </div>
    );
  }
  if (estado.carpetaEstado === 'error') {
    return (
      <div className="banner aviso noprint" role="alert">
        <Ico name="alert" />
        <span>{estado.carpetaError ?? 'No se pudo guardar en la carpeta.'}</span>
        <span className="sp" />
        <button className="btn sm primary" onClick={() => void conectar(true)}>Elegir la carpeta</button>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------- configuración
export function CarpetaWebConfig() {
  const estado = useEstado();
  const { conectar, desconectar } = useCarpetaWeb();
  const conectada = estado.carpetaEstado === 'conectada';
  return (
    <Tarjeta titulo={<><Ico name="folder" /> Carpeta de datos</>} sub="La versión web guarda en este navegador y, si eliges una carpeta, también en ella (mismo formato que el programa de escritorio).">
      {estado.carpeta ? (
        <div className="ruta" style={{ marginBottom: 10 }}>
          {estado.carpeta}{' '}
          <span className={'badge ' + (conectada ? 'b-green' : estado.carpetaEstado === 'error' ? 'b-red' : 'b-amber')}>
            {conectada ? 'Conectada' : estado.carpetaEstado === 'error' ? 'Con problemas' : 'Sin conectar'}
          </span>
        </div>
      ) : (
        <p className="msg info">Los datos se guardan solo en este navegador.</p>
      )}
      <p className="muted" style={{ fontSize: 12.5 }}>
        {`Último guardado: ${fmtFechaHora(estado.ultimoGuardado)}`}
        {estado.carpeta && ' · Dentro de la carpeta: datos (un archivo por mes), respaldos (copia diaria) y cierres (Excel e informe de cada mes cerrado).'}
      </p>
      {estado.soportaCarpeta ? (
        <div className="row">
          {estado.carpeta && !conectada && <button className="btn sm primary" onClick={() => void conectar()}><Ico name="folder" />Conectar carpeta</button>}
          <button className="btn sm" onClick={() => void conectar(true)}><Ico name="folder" />{estado.carpeta ? 'Usar otra carpeta…' : 'Elegir carpeta…'}</button>
          {estado.carpeta && <button className="btn sm ghost" onClick={() => void desconectar()}>Dejar de usar la carpeta</button>}
        </div>
      ) : (
        <p className="msg warn">Este navegador no permite elegir carpetas: descarga un respaldo con regularidad (abajo).</p>
      )}
    </Tarjeta>
  );
}

/** Guardar el programa como página para usarlo sin internet. */
export function PaginaLocal() {
  const ui = useUI();
  const enLinea = typeof location !== 'undefined' && location.protocol.startsWith('http');
  const descargar = async () => {
    try {
      const r = await fetch('komplex-gerencia.html', { cache: 'no-store' });
      if (!r.ok) throw new Error('No se encontró la página para descargar.');
      descargarBinario('Gerencia Komplex.html', new Uint8Array(await r.arrayBuffer()), 'text/html');
      ui.avisar('Página descargada. Guárdala (por ejemplo en la carpeta de datos) y ábrela con doble clic.', 'ok');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };
  return (
    <Tarjeta titulo={<><Ico name="download" /> Tener el programa en esta computadora</>}>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6 }}>
        <li><b>Instalar como app:</b> en Chrome o Edge, botón <b>Instalar</b> de la barra de direcciones (o menú → «Instalar Gerencia Komplex»). Queda con su icono y funciona sin internet.</li>
        <li><b>En el celular:</b> menú del navegador → «Agregar a pantalla de inicio».</li>
        <li><b>Como página guardada:</b> descarga el programa en un solo archivo .html y ábrelo con doble clic, incluso sin internet. Elige ahí la misma carpeta de datos.</li>
      </ul>
      {enLinea ? (
        <button className="btn sm" onClick={() => void descargar()}><Ico name="download" />Descargar el programa (.html)</button>
      ) : (
        <p className="msg info">Ya estás usando la página guardada en esta computadora.</p>
      )}
    </Tarjeta>
  );
}

export function CelularWeb() {
  const url = typeof location !== 'undefined' && location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://888dracz.github.io/gerenciakomplex/';
  return (
    <Tarjeta titulo="Usar desde el celular" sub="Abre el mismo enlace en el navegador del celular.">
      <div className="ruta" style={{ marginBottom: 8, fontSize: 15 }}>{url}</div>
      <ol style={{ fontSize: 12.5, color: 'var(--ink2)', paddingLeft: 18, lineHeight: 1.6, margin: 0 }}>
        <li>En el celular, menú del navegador → <b>«Agregar a pantalla de inicio»</b> para tenerlo como una app.</li>
        <li>En la versión web <b>cada dispositivo guarda sus propios datos</b>. Para pasarlos de uno a otro: Configuración → «Descargar respaldo» en uno y «Restaurar» en el otro.</li>
        <li>Si quieres que el celular y la PC usen los mismos datos al mismo tiempo, usa el programa de escritorio (la PC hace de servidor por WiFi).</li>
      </ol>
    </Tarjeta>
  );
}
