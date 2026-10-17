/**
 * App.tsx — Bienvenida (crear la carpeta de datos), entrada con la clave y la
 * estructura del programa: menú lateral, barra superior, barra inferior en el
 * celular y el apartado activo.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { nombreMes, mesDe } from '@dominio/fechas';
import { mesesPorCerrar } from '@dominio/periodos';
import { apiGet, apiPost, hayRedActiva, mensajeError, suscribirRed } from './lib/api';
import { descargarExcel } from './lib/exportar';
import { fmtHora } from './lib/format';
import { Ico, Monograma } from './lib/icons';
import { guardarPrefs, leerPrefs } from './lib/prefs';
import { useSeccion, type Seccion } from './lib/router';
import { useApp, useEstado } from './state/app';
import { useUI } from './state/ui';
import { BannerGerencial, useCierre } from './components/Cierre';
import { DialogoInforme } from './components/Informe';
import { Caja } from './panels/Caja';
import { Registro } from './panels/Registro';
import { Transferencias } from './panels/Transferencias';
import { Cuadre } from './panels/Cuadre';
import { Resumen } from './panels/Resumen';
import { Cierres } from './panels/Cierres';
import { Configuracion } from './panels/Configuracion';
import type { Datos } from '@dominio/tipos';

export function App() {
  const { fase, error } = useApp();
  if (fase === 'cargando') return <div className="boot">Cargando Gerencia Komplex…</div>;
  if (fase === 'error') {
    return (
      <div className="boot">
        <div>
          <p>{error}</p>
          <button className="btn" onClick={() => location.reload()}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (fase === 'bienvenida') return <Bienvenida />;
  if (fase === 'login') return <Entrar />;
  return <Aplicacion />;
}

// ---------------------------------------------------------------- bienvenida
interface Revision {
  ruta: string; existe: boolean; tieneDatos: boolean; tieneClave: boolean;
  meses: string[]; registros: number; problema: string | null;
}

function Logo({ sub }: { sub: string }) {
  return (
    <div className="login-logo">
      <div className="sun"><Monograma size={54} /></div>
      <h1>KOMPLEX GYM</h1>
      <p>{sub}</p>
    </div>
  );
}

function Bienvenida() {
  const { inicio, entrar } = useApp();
  const [ruta, setRuta] = useState(inicio?.carpetaPerdida ?? inicio?.sugerida ?? '');
  const [rev, setRev] = useState<Revision | null>(null);
  const [paso, setPaso] = useState<1 | 2>(1);
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  if (!inicio?.local) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <Logo sub="Gerencia · Caja y registro de pagos" />
          <p className="msg info">
            El programa todavía no tiene su carpeta de datos. Ábrelo primero en la computadora donde está instalado
            (icono "Gerencia Komplex" del escritorio) para crearla; después podrás entrar desde aquí.
          </p>
          <button className="btn block" onClick={() => location.reload()}>Ya la creé, reintentar</button>
        </div>
      </div>
    );
  }

  const examinar = async () => {
    setError('');
    try {
      const r = await apiPost<{ ruta: string | null }>('/api/carpeta/elegir', { inicial: ruta });
      if (r.ruta) setRuta(r.ruta);
    } catch (e) { setError(mensajeError(e)); }
  };

  const revisar = async () => {
    setError('');
    setOcupado(true);
    try {
      const r = await apiPost<Revision>('/api/carpeta/revisar', { ruta });
      if (r.problema) { setError(r.problema); return; }
      setRev(r);
      setPaso(2);
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
  };

  const crear = async () => {
    setError('');
    if (!rev) return;
    if (!rev.tieneClave) {
      if (!nombre.trim()) return setError('Escribe tu nombre.');
      if (clave.length < 4) return setError('La clave debe tener al menos 4 caracteres.');
      if (clave !== clave2) return setError('Las dos claves no coinciden.');
    }
    setOcupado(true);
    try {
      const r = await apiPost<{ token: string | null }>('/api/carpeta/configurar', { ruta: rev.ruta, clave, nombre });
      if (r.token) await entrar(r.token);
      else location.reload();
    } catch (e) { setError(mensajeError(e)); setOcupado(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card ancha">
        <Logo sub="Gerencia · Caja, registro de pagos y cuadre" />
        <div className="pasos"><span className="on" /><span className={paso === 2 ? 'on' : ''} /></div>

        {paso === 1 && (
          <>
            <h3 style={{ color: 'var(--gold)' }}><Ico name="folder" /> Crea la carpeta de datos</h3>
            {inicio.carpetaPerdida ? (
              <p className="msg warn">
                {`No se encontró la carpeta de datos en ${inicio.carpetaPerdida}. Si la moviste, elige dónde está ahora; si no, crea una nueva.`}
              </p>
            ) : (
              <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>
                Toda la información que se registre cada día se guardará automáticamente en esta carpeta,
                <b> separada del programa</b>: si el programa se borra o se pierde, los datos siguen en tu computadora.
                Si ya tenías una carpeta de Komplex (por ejemplo, de otra PC), elígela y se usarán sus datos.
              </p>
            )}
            <label className="fl" htmlFor="ruta">Carpeta</label>
            <div className="row" style={{ marginBottom: 10 }}>
              <input id="ruta" className="crece" value={ruta} onChange={(e) => setRuta(e.target.value)} spellCheck={false} />
              {inicio.windows && <button className="btn" onClick={() => void examinar()}><Ico name="folder" />Elegir…</button>}
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Si eliges una carpeta general (como Documentos), dentro se crea "Komplex Gerencia".
            </p>
            {error && <p className="msg err">{error}</p>}
            <button className="btn primary block lg" onClick={() => void revisar()} disabled={ocupado || !ruta.trim()}>
              Continuar
            </button>
          </>
        )}

        {paso === 2 && rev && (
          <>
            <h3 style={{ color: 'var(--gold)' }}>
              <Ico name={rev.tieneDatos ? 'history' : 'key'} /> {rev.tieneDatos ? 'Carpeta con datos encontrada' : 'Clave de acceso'}
            </h3>
            <label className="fl">Los datos se guardarán en</label>
            <div className="ruta" style={{ marginBottom: 12 }}>{rev.ruta}</div>
            {rev.tieneDatos && (
              <p className="msg ok">
                {`Esta carpeta ya tiene información de Komplex: ${rev.registros} registro(s) en ${rev.meses.length} mes(es). Se usará tal cual.`}
              </p>
            )}
            {!rev.tieneClave && (
              <>
                <p className="sub" style={{ marginTop: 0, fontSize: 13 }}>
                  Esta clave se pide para entrar al programa (también desde el celular). Compártela solo con quien registre pagos.
                </p>
                <div className="field">
                  <label className="fl" htmlFor="b-nombre">Tu nombre</label>
                  <input id="b-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" />
                </div>
                <div className="grid g2">
                  <div className="field">
                    <label className="fl" htmlFor="b-clave">Clave de acceso</label>
                    <input id="b-clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" />
                  </div>
                  <div className="field">
                    <label className="fl" htmlFor="b-clave2">Repite la clave</label>
                    <input id="b-clave2" type="password" value={clave2} onChange={(e) => setClave2(e.target.value)} autoComplete="new-password" />
                  </div>
                </div>
              </>
            )}
            {error && <p className="msg err">{error}</p>}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn" onClick={() => { setPaso(1); setError(''); }}>Atrás</button>
              <button className="btn primary lg" onClick={() => void crear()} disabled={ocupado}>
                {ocupado ? 'Preparando…' : rev.tieneDatos ? 'Usar esta carpeta' : 'Crear carpeta y empezar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- entrar
function Entrar() {
  const { inicio, entrar } = useApp();
  const [nombre, setNombre] = useState(() => { try { return localStorage.getItem('kx_nombre') ?? ''; } catch { return ''; } });
  const [clave, setClave] = useState('');
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      const r = await apiPost<{ token: string }>('/api/login', { nombre, clave, recordar });
      try { localStorage.setItem('kx_nombre', nombre); } catch { /* sin almacenamiento */ }
      await entrar(r.token);
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Logo sub={`Gerencia · ${inicio?.negocio ?? 'Komplex Gym'}`} />
        <form onSubmit={enviar}>
          <div className="field">
            <label className="fl" htmlFor="l-nombre">Tu nombre</label>
            <input id="l-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" autoFocus={!nombre} />
          </div>
          <div className="field">
            <label className="fl" htmlFor="l-clave">Clave de acceso</label>
            <input id="l-clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" autoFocus={!!nombre} />
          </div>
          <label className="chkline" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
            Recordar en este dispositivo (30 días)
          </label>
          {error && <p className="msg err">{error}</p>}
          <button className="btn primary block lg" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- aplicación
const MENU: { s: Seccion; label: string; corto: string; ico: string }[] = [
  { s: 'caja', label: 'Caja', corto: 'Caja', ico: 'cash' },
  { s: 'registro', label: 'Registro', corto: 'Registro', ico: 'list' },
  { s: 'transferencias', label: 'Transferencias', corto: 'Transf.', ico: 'transfer' },
  { s: 'cuadre', label: 'Cuadre de caja', corto: 'Cuadre', ico: 'scale' },
  { s: 'resumen', label: 'Resumen', corto: 'Resumen', ico: 'chart' },
  { s: 'cierres', label: 'Cierre de mes', corto: 'Cierres', ico: 'lock' },
  { s: 'configuracion', label: 'Configuración', corto: 'Ajustes', ico: 'settings' },
];

const PANELES: Record<Seccion, () => ReactNode> = {
  caja: () => <Caja />,
  registro: () => <Registro />,
  transferencias: () => <Transferencias />,
  cuadre: () => <Cuadre />,
  resumen: () => <Resumen />,
  cierres: () => <Cierres />,
  configuracion: () => <Configuracion />,
};

function BarraRed() {
  const activo = useSyncExternalStore(suscribirRed, hayRedActiva);
  return activo ? <div className="netbar" /> : null;
}

function AvisoCierre() {
  const estado = useEstado();
  const { gerencial } = useApp();
  const { pedirCierre } = useCierre();
  const mesHoy = mesDe(estado.hoy);
  const pendientes = mesesPorCerrar({ mesesConDatos: estado.mesesConDatos, cierres: estado.config.cierres }, mesHoy);
  if (gerencial || !pendientes.length) return null;
  return (
    <div className="banner aviso noprint">
      <Ico name="lock" />
      <span>{`${pendientes.map(nombreMes).join(', ')} sigue${pendientes.length > 1 ? 'n' : ''} abierto${pendientes.length > 1 ? 's' : ''}. Para registrar en ${nombreMes(mesHoy)} hay que cerrar${pendientes.length > 1 ? 'los' : 'lo'}.`}</span>
      <span className="sp" />
      <button className="btn sm primary" onClick={() => void pedirCierre(pendientes, mesHoy)}>Cerrar ahora</button>
    </div>
  );
}

function Aplicacion() {
  const { salir } = useApp();
  const estado = useEstado();
  const ui = useUI();
  const seccion = useSeccion();
  const [navAbierta, setNavAbierta] = useState(false);
  const [colapsada, setColapsada] = useState(false);
  const [prefs, setPrefs] = useState(leerPrefs);
  const actual = MENU.find((m) => m.s === seccion) ?? MENU[0];

  useEffect(() => { document.title = `${actual.label} · Gerencia Komplex`; }, [actual]);

  const alternarNav = () => {
    if (window.matchMedia('(max-width: 820px)').matches) setNavAbierta((v) => !v);
    else setColapsada((v) => !v);
  };

  const alternarModo = () => {
    const p = { ...prefs, modo: prefs.modo === 'claro' ? 'oscuro' as const : 'claro' as const };
    setPrefs(p);
    guardarPrefs(p);
  };

  const excel = async () => {
    try {
      const d = await apiGet<Datos>('/api/datos');
      descargarExcel(d, estado.config);
      ui.avisar('Excel con todos los datos descargado.', 'ok');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };

  const informe = () => ui.abrirModal((cerrar) => <DialogoInforme onCerrar={cerrar} />);

  const pendientes = estado.transferenciasPendientes;
  const carpetaCorta = estado.carpeta.split(/[\\/]/).slice(-2).join('\\');

  return (
    <>
      <BarraRed />
      <div className={'layout' + (colapsada ? ' nav-collapsed' : '')}>
        <aside className={'sidebar' + (navAbierta ? ' open' : '')} aria-label="Menú">
          <div className="brand">
            <Monograma size={32} />
            <div>
              <b>KOMPLEX GYM</b>
              <small>Gerencia · Caja y pagos</small>
            </div>
          </div>
          <nav>
            {MENU.map((m, i) => (
              <div key={m.s}>
                {i === 5 && <div className="nav-sep" />}
                <a
                  href={`#/${m.s}`} className={'nav-item' + (m.s === seccion ? ' active' : '')}
                  aria-current={m.s === seccion ? 'page' : undefined} onClick={() => setNavAbierta(false)}
                >
                  <Ico name={m.ico} size={17} />
                  {m.label}
                  {m.s === 'transferencias' && pendientes > 0 && <span className="cuenta" title="Transferencias por verificar">{pendientes}</span>}
                </a>
              </div>
            ))}
          </nav>
          <div className="nav-pie">
            <div className="guardado">
              <Ico name="save" />
              <div>
                <div>{estado.ultimoGuardado ? `Guardado ${fmtHora(estado.ultimoGuardado)}` : 'Guardado automático'}</div>
                <div className="ruta-corta" title={estado.carpeta}>{carpetaCorta}</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}><Ico name="user" /> {estado.usuario}</div>
          </div>
        </aside>
        <div className="nav-scrim" onClick={() => setNavAbierta(false)} />

        <main className="main">
          <div className="topbar">
            <button className="btn sm" title="Menú" aria-label="Menú" onClick={alternarNav}><Ico name="menu" /></button>
            <span className="title">{actual.label}</span>
            <span className="sp" />
            <button className="btn sm" title="Descargar Excel con todos los datos" onClick={() => void excel()}>
              <Ico name="sheet" /><span className="solo-pc">Excel</span>
            </button>
            <button className="btn sm" title="Informe en Word" onClick={informe}>
              <Ico name="doc" /><span className="solo-pc">Informe</span>
            </button>
            <button className="btn sm" title={prefs.modo === 'claro' ? 'Modo oscuro' : 'Modo claro'} onClick={alternarModo}>
              <Ico name={prefs.modo === 'claro' ? 'moon' : 'sun'} />
            </button>
            <span className="topbar-user">{estado.usuario}</span>
            <button className="btn sm" title="Salir" onClick={() => void salir()}><Ico name="logout" /><span className="solo-pc">Salir</span></button>
          </div>
          <BannerGerencial />
          <AvisoCierre />
          <div className="content" id="content" key={seccion}>
            {PANELES[seccion]()}
          </div>
        </main>
      </div>

      <nav className="bottomnav noprint" aria-label="Accesos rápidos">
        {MENU.slice(0, 4).map((m) => (
          <a key={m.s} href={`#/${m.s}`} className={m.s === seccion ? 'active' : ''}>
            <Ico name={m.ico} size={19} />
            {m.corto}
            {m.s === 'transferencias' && pendientes > 0 && <span className="punto">{pendientes > 99 ? '99+' : pendientes}</span>}
          </a>
        ))}
        <a
          href={`#/${seccion}`} className={['resumen', 'cierres', 'configuracion'].includes(seccion) ? 'active' : ''}
          onClick={(e) => { e.preventDefault(); setNavAbierta(true); }}
        >
          <Ico name="dots" size={19} />
          Más
        </a>
      </nav>
    </>
  );
}
