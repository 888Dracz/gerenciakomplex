/**
 * Configuracion.tsx — Planes con su precio, bancos, categorías de gasto,
 * carpeta de datos, respaldos, clave de acceso, celular, apariencia y bitácora.
 */
import { useEffect, useRef, useState } from 'react';

import type { EntradaBitacora, Plan } from '@dominio/tipos';
import { apiGet, apiPost, apiPut, mensajeError } from '../lib/api';
import { fmtFechaHora, fmtUSD, leerNumero } from '../lib/format';
import { Ico } from '../lib/icons';
import { ACENTOS, guardarPrefs, leerPrefs, type Prefs } from '../lib/prefs';
import { descargarBinario } from '../lib/zip';
import { useApp, useEstado } from '../state/app';
import { useUI } from '../state/ui';
import { Pestanas, Segmentado, Tabla, Tarjeta } from '../components/basicos';
import { useCierre } from '../components/Cierre';

export function Configuracion() {
  return (
    <Pestanas tabs={[
      { label: 'Planes y listas', render: () => <><Planes /><Listas /></> },
      { label: 'Carpeta y respaldos', render: () => <><Carpeta /><Respaldos /></> },
      { label: 'Acceso y celular', render: () => <><Celular /><Clave /></> },
      { label: 'Apariencia', render: () => <Apariencia /> },
      { label: 'Bitácora', render: () => <Bitacora /> },
    ]}
    />
  );
}

function Planes() {
  const estado = useEstado();
  const { recargar } = useApp();
  const ui = useUI();
  const [planes, setPlanes] = useState<(Omit<Plan, 'precio'> & { precio: string })[]>(
    () => estado.config.planes.map((p) => ({ ...p, precio: String(p.precio) })),
  );
  const [negocio, setNegocio] = useState(estado.config.negocio);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      await apiPut('/api/config', { negocio, planes: planes.map((p) => ({ ...p, precio: leerNumero(p.precio) })) });
      await recargar();
      ui.avisar('Planes guardados ✓', 'ok');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); } finally { setGuardando(false); }
  };

  const cambiar = (i: number, c: Partial<(typeof planes)[number]>) => setPlanes((ps) => ps.map((p, k) => (k === i ? { ...p, ...c } : p)));

  return (
    <Tarjeta
      titulo="Planes y precios"
      sub="El precio se guarda en cada registro al cobrar: si lo cambias, los pagos anteriores no cambian. Desactiva un plan para que no salga en la Caja sin borrar su historia."
      acciones={<button className="btn sm primary" onClick={() => void guardar()} disabled={guardando}><Ico name="save" />Guardar</button>}
    >
      <div className="field" style={{ maxWidth: 320 }}>
        <label className="fl">Nombre del negocio</label>
        <input value={negocio} onChange={(e) => setNegocio(e.target.value)} />
      </div>
      <Tabla cols={[{ l: 'Plan' }, { l: 'Precio USD', n: true }, { l: 'Con convenio', n: true }, { l: 'Activo' }, { l: '' }]}>
        {planes.map((p, i) => (
          <tr key={i}>
            <td><input value={p.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} /></td>
            <td className="n"><input className="num" inputMode="decimal" style={{ maxWidth: 110 }} value={p.precio} onChange={(e) => cambiar(i, { precio: e.target.value })} /></td>
            <td className="n num muted">{fmtUSD((leerNumero(p.precio) || 0) / 2)}</td>
            <td><input type="checkbox" checked={p.activo} onChange={(e) => cambiar(i, { activo: e.target.checked })} aria-label="Activo" /></td>
            <td className="acc"><button className="btn sm danger" title="Quitar" onClick={() => setPlanes((ps) => ps.filter((_, k) => k !== i))}><Ico name="trash" /></button></td>
          </tr>
        ))}
      </Tabla>
      <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setPlanes((ps) => [...ps, { nombre: '', precio: '', activo: true }])}>
        <Ico name="plus" />Agregar plan
      </button>
    </Tarjeta>
  );
}

function Listas() {
  const estado = useEstado();
  const { recargar } = useApp();
  const ui = useUI();
  const [bancos, setBancos] = useState(estado.config.bancos.join('\n'));
  const [cats, setCats] = useState(estado.config.categoriasGasto.join('\n'));
  const guardar = async () => {
    try {
      await apiPut('/api/config', { bancos: bancos.split('\n'), categoriasGasto: cats.split('\n') });
      await recargar();
      ui.avisar('Listas guardadas ✓', 'ok');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };
  return (
    <Tarjeta titulo="Bancos y categorías de gasto" sub="Uno por línea." acciones={<button className="btn sm primary" onClick={() => void guardar()}><Ico name="save" />Guardar</button>}>
      <div className="grid g2">
        <div><label className="fl">Bancos (emisor y receptor de los pagos en Bs)</label><textarea rows={12} value={bancos} onChange={(e) => setBancos(e.target.value)} /></div>
        <div><label className="fl">Categorías de gasto</label><textarea rows={12} value={cats} onChange={(e) => setCats(e.target.value)} /></div>
      </div>
    </Tarjeta>
  );
}

function Carpeta() {
  const estado = useEstado();
  const ui = useUI();
  const [nueva, setNueva] = useState('');
  const [mover, setMover] = useState(true);

  const abrir = async () => {
    try { await apiPost('/api/carpeta/abrir'); } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };
  const elegir = async () => {
    try {
      const r = await apiPost<{ ruta: string | null }>('/api/carpeta/elegir', { inicial: estado.carpeta });
      if (r.ruta) setNueva(r.ruta);
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };
  const cambiar = async () => {
    try {
      const rev = await apiPost<{ ruta: string; tieneDatos: boolean; problema: string | null }>('/api/carpeta/revisar', { ruta: nueva });
      if (rev.problema) return ui.avisar(rev.problema, 'err');
      const txt = rev.tieneDatos
        ? `La carpeta ${rev.ruta} ya tiene datos de Komplex. El programa pasará a usar ESOS datos (los actuales se quedan donde están). ¿Continuar?`
        : mover
          ? `Se copiarán todos los datos a ${rev.ruta} y el programa seguirá guardando allí. ¿Continuar?`
          : `El programa empezará con datos vacíos en ${rev.ruta}. ¿Continuar?`;
      if (!await ui.confirmar(txt, { titulo: 'Cambiar carpeta de datos', ok: 'Sí, cambiar' })) return;
      await apiPost('/api/carpeta/configurar', { ruta: rev.ruta, mover: mover && !rev.tieneDatos });
      location.reload();
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };

  return (
    <Tarjeta titulo={<><Ico name="folder" /> Carpeta de datos</>} sub="Aquí se guarda todo automáticamente, separado del programa.">
      <div className="ruta" style={{ marginBottom: 10 }}>{estado.carpeta}</div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        {`Último guardado: ${fmtFechaHora(estado.ultimoGuardado) || '—'}. Dentro hay: datos (un archivo por mes), respaldos (copia diaria) y cierres (Excel e informe de cada mes cerrado).`}
      </p>
      {estado.local ? (
        <>
          <button className="btn sm" onClick={() => void abrir()}><Ico name="folder" />Abrir carpeta</button>
          <div className="cfg-div" style={{ borderTop: '1px solid var(--line)', margin: '14px 0' }} />
          <label className="fl">Cambiar a otra carpeta</label>
          <div className="row" style={{ marginBottom: 8 }}>
            <input className="crece" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Ruta de la carpeta nueva" />
            <button className="btn sm" onClick={() => void elegir()}>Elegir…</button>
          </div>
          <label className="chkline" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={mover} onChange={(e) => setMover(e.target.checked)} />
            Copiar los datos actuales a la carpeta nueva
          </label>
          <button className="btn sm primary" disabled={!nueva.trim()} onClick={() => void cambiar()}>Cambiar carpeta</button>
        </>
      ) : (
        <p className="msg info">La carpeta solo se puede abrir o cambiar desde la computadora donde corre el programa.</p>
      )}
    </Tarjeta>
  );
}

function Respaldos() {
  const ui = useUI();
  const { gerencial } = useApp();
  const { pedirGerencial } = useCierre();
  const [lista, setLista] = useState<{ carpeta: string; archivos: string[] } | null>(null);
  const archivo = useRef<HTMLInputElement | null>(null);
  useEffect(() => { apiGet<{ carpeta: string; archivos: string[] }>('/api/respaldos').then(setLista).catch(() => setLista(null)); }, []);

  const descargar = async () => {
    try {
      const r = await apiGet<unknown>('/api/respaldo');
      descargarBinario(`Respaldo Komplex ${new Date().toISOString().slice(0, 10)}.json`, new TextEncoder().encode(JSON.stringify(r)), 'application/json');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };

  const restaurar = async (f: File) => {
    try {
      const json = JSON.parse(await f.text());
      const meses = Array.isArray(json?.meses) ? json.meses.length : 0;
      if (!await ui.confirmar(`¿Reemplazar TODOS los datos actuales por los del respaldo "${f.name}" (${meses} mes(es))?\nAntes se guarda una copia de lo actual en la carpeta de respaldos.`, { peligro: true, ok: 'Restaurar' })) return;
      await apiPost('/api/respaldo/restaurar', json);
      location.reload();
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };

  return (
    <Tarjeta titulo={<><Ico name="history" /> Respaldos</>} sub="Cada día se guarda una copia completa en la carpeta de respaldos (se conservan las últimas 60).">
      {lista && <p className="muted" style={{ fontSize: 12.5 }}>{`${lista.archivos.length} copia(s) en ${lista.carpeta}${lista.archivos[0] ? ` · la más reciente: ${lista.archivos[0]}` : ''}`}</p>}
      <div className="row">
        <button className="btn sm" onClick={() => void descargar()}><Ico name="download" />Descargar respaldo</button>
        {gerencial ? (
          <>
            <button className="btn sm danger" onClick={() => archivo.current?.click()}><Ico name="upload" />Restaurar un respaldo…</button>
            <input ref={archivo} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restaurar(f); e.target.value = ''; }} />
          </>
        ) : (
          <button className="btn sm ghost" onClick={() => void pedirGerencial()}><Ico name="key" />Restaurar (requiere código gerencial)</button>
        )}
      </div>
    </Tarjeta>
  );
}

function Celular() {
  const estado = useEstado();
  return (
    <Tarjeta titulo="Usar desde el celular" sub="El celular debe estar conectado al mismo WiFi que esta computadora, y el programa abierto en ella.">
      {estado.direcciones.length ? (
        <>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>Abre en el navegador del celular:</p>
          {estado.direcciones.map((d) => <div className="ruta" key={d} style={{ marginBottom: 6, fontSize: 15 }}>{d}</div>)}
          <ol style={{ fontSize: 12.5, color: 'var(--ink2)', paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Entra con tu nombre y la clave de acceso.</li>
            <li>En el menú del navegador elige <b>«Agregar a pantalla de inicio»</b> (Android) o <b>Compartir → «Agregar a inicio»</b> (iPhone) para tenerlo como una app.</li>
            <li>Si no carga, en la PC ejecuta una vez <b>«Permitir en la red.bat»</b> (como administrador).</li>
          </ol>
        </>
      ) : <p className="muted">Esta computadora no está conectada a una red.</p>}
    </Tarjeta>
  );
}

function Clave() {
  const ui = useUI();
  const { gerencial } = useApp();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [nueva2, setNueva2] = useState('');
  const cambiar = async () => {
    if (nueva.length < 4) return ui.avisar('La clave nueva debe tener al menos 4 caracteres.', 'err');
    if (nueva !== nueva2) return ui.avisar('Las claves nuevas no coinciden.', 'err');
    try {
      await apiPut('/api/clave', { actual, nueva });
      setActual(''); setNueva(''); setNueva2('');
      ui.avisar('Clave cambiada. Los demás dispositivos tendrán que volver a entrar.', 'ok');
    } catch (e) { ui.avisar(mensajeError(e), 'err'); }
  };
  return (
    <Tarjeta titulo={<><Ico name="key" /> Clave de acceso</>} sub="La que se pide para entrar al programa. No es el código gerencial.">
      <div className="grid g3">
        {!gerencial && <div className="field"><label className="fl">Clave actual</label><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" /></div>}
        <div className="field"><label className="fl">Clave nueva</label><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" /></div>
        <div className="field"><label className="fl">Repite la nueva</label><input type="password" value={nueva2} onChange={(e) => setNueva2(e.target.value)} autoComplete="new-password" /></div>
      </div>
      <button className="btn sm primary" onClick={() => void cambiar()}>Cambiar clave</button>
    </Tarjeta>
  );
}

function Apariencia() {
  const [p, setP] = useState<Prefs>(leerPrefs);
  const cambiar = (c: Partial<Prefs>) => { const n = { ...p, ...c }; setP(n); guardarPrefs(n); };
  return (
    <Tarjeta titulo="Apariencia" sub="Se guarda en este dispositivo.">
      <div className="field">
        <label className="fl">Modo</label>
        <Segmentado opciones={[{ v: 'oscuro' as const, l: 'Oscuro' }, { v: 'claro' as const, l: 'Claro' }, { v: 'sistema' as const, l: 'Como el sistema' }]} valor={p.modo} onCambiar={(modo) => cambiar({ modo })} />
      </div>
      <div className="field">
        <label className="fl">Color de acento</label>
        <div className="row">
          {ACENTOS.map((a) => (
            <button key={a.id} className={'btn sm' + (p.acento === a.id ? ' primary' : '')} onClick={() => cambiar({ acento: a.id })}>
              <span style={{ width: 12, height: 12, borderRadius: 99, background: a.color, display: 'inline-block' }} />{a.nombre}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="fl">Tamaño de letra</label>
        <Segmentado opciones={[{ v: 'pequena', l: 'Pequeña' }, { v: 'normal', l: 'Normal' }, { v: 'grande', l: 'Grande' }]} valor={p.letra} onCambiar={(letra) => cambiar({ letra })} />
      </div>
    </Tarjeta>
  );
}

function Bitacora() {
  const [entradas, setEntradas] = useState<EntradaBitacora[] | null>(null);
  useEffect(() => { apiGet<{ entradas: EntradaBitacora[] }>('/api/bitacora').then((r) => setEntradas(r.entradas)).catch(() => setEntradas([])); }, []);
  return (
    <Tarjeta titulo={<><Ico name="history" /> Bitácora</>} sub="Cambios importantes: ediciones, borrados, cierres, código gerencial, transferencias que no llegaron.">
      <Tabla resp cols={[{ l: 'Fecha' }, { l: 'Quién' }, { l: 'Qué' }, { l: 'Detalle' }]} vacio={entradas ? 'Sin movimientos todavía.' : 'Cargando…'}>
        {(entradas ?? []).map((e, i) => (
          <tr key={i}>
            <td data-l="Fecha" className="nowrap">{fmtFechaHora(e.fecha)}</td>
            <td data-l="Quién">{e.usuario}</td>
            <td data-l="" className="titulo">{e.accion}</td>
            <td data-l="Detalle"><span className="muted" style={{ wordBreak: 'break-word' }}>{e.detalle}</span></td>
          </tr>
        ))}
      </Tabla>
    </Tarjeta>
  );
}
