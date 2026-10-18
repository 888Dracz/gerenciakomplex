/**
 * servidor.ts — El "servidor" de la versión web, dentro del navegador.
 *
 * La interfaz es la misma que en el programa de escritorio y llama a las
 * mismas direcciones (/api/…). En la versión web esas llamadas no salen a
 * internet: llegan aquí, se resuelven con las mismas operaciones
 * (`@dominio/operaciones`) y se guardan en el navegador y en la carpeta.
 */
import { esMes, hoyISO } from '@dominio/fechas';
import * as op from '@dominio/operaciones';
import { configInicial, type Configuracion, type DatosMes } from '@dominio/tipos';
import { ErrorValidacion } from '@dominio/validar';
import { AlmacenWeb, leerCarpeta, type ResultadoSincronizar } from './almacen';
import { elegirCarpeta, resolverCarpeta, soportaCarpetas, type Dir } from './carpeta';
import { persistenciaMemoria, persistenciaNavegador, type Persistencia } from './persistencia';
import {
  Sesiones, cifrarClave, claveCorrecta, codigoGerencialCorrecto, gerencialActivo, type SesionWeb,
} from './sesiones';

export const VERSION_WEB = '1.0.0';

/** Lo que devuelve un error al estilo del servidor (la interfaz lo entiende igual). */
export class ErrorLocal extends Error {
  constructor(public status: number, public payload: Record<string, unknown>) {
    super(String(payload.error ?? `Error ${status}`));
  }
}

interface Peticion {
  metodo: string;
  ruta: string;
  query: URLSearchParams;
  cuerpo: Record<string, unknown>;
  binario?: Uint8Array;
  token: string | null;
}

interface Estado {
  p: Persistencia;
  sesiones: Sesiones;
  almacen: AlmacenWeb | null;
  /** Carpeta elegida en la bienvenida, todavía sin confirmar. */
  pendiente: { dir: Dir; tieneDatos: boolean; config: Configuracion | null; meses: DatosMes[] } | null;
}

let estado: Promise<Estado> | null = null;
let canal: BroadcastChannel | null = null;
const oyentes = new Set<() => void>();
/** Las escrituras se atienden de a una, en orden. */
let cola: Promise<unknown> = Promise.resolve();

function iniciar(p?: Persistencia): Promise<Estado> {
  return (async () => {
    let pers = p;
    if (!pers) {
      try {
        pers = persistenciaNavegador();
        await pers.claves();
      } catch {
        pers = persistenciaMemoria();
      }
    }
    const e: Estado = { p: pers, sesiones: new Sesiones(pers), almacen: await AlmacenWeb.cargar(pers), pendiente: null };
    if (typeof BroadcastChannel !== 'undefined' && !p) {
      canal = new BroadcastChannel('gerencia-komplex');
      // Otra pestaña guardó algo: se vuelve a leer y se refresca la pantalla.
      canal.onmessage = async () => {
        e.sesiones.olvidarCache();
        if (e.almacen) await e.almacen.recargar();
        else e.almacen = await AlmacenWeb.cargar(e.p);
        oyentes.forEach((f) => f());
      };
    }
    return e;
  })();
}

/** Para las pruebas: empezar de cero con otra persistencia. */
export function reiniciarServidorLocal(p?: Persistencia): void {
  estado = iniciar(p ?? persistenciaMemoria());
  cola = Promise.resolve();
}

/** La pantalla se suscribe para enterarse de cambios hechos en otra pestaña. */
export function alCambiarFuera(f: () => void): () => void {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

const avisarOtrasPestanas = () => { try { canal?.postMessage('cambio'); } catch { /* sin canal */ } };

function falla(status: number, error: string, extra: Record<string, unknown> = {}): never {
  throw new ErrorLocal(status, { error, ...extra });
}

// ---------------------------------------------------------------- entrada
export async function servidorLocal(
  metodo: string, url: string, cuerpo: unknown, binario: Uint8Array | undefined, token: string | null,
): Promise<unknown> {
  estado ??= iniciar();
  const e = await estado;
  const u = new URL(url, 'http://local');
  const pet: Peticion = {
    metodo: metodo.toUpperCase(),
    ruta: u.pathname,
    query: u.searchParams,
    cuerpo: (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>,
    binario,
    token,
  };
  const escribe = pet.metodo !== 'GET';
  const atender = async () => {
    try {
      const r = await rutas(e, pet);
      if (escribe && e.almacen) {
        await e.almacen.persistir();
        avisarOtrasPestanas();
      }
      // Una copia: la pantalla nunca toca los objetos guardados.
      return r === undefined ? {} : structuredClone(r);
    } catch (err) {
      // Lo que alcanzó a cambiar en memoria antes del error también se guarda.
      if (escribe && e.almacen) await e.almacen.persistir().catch(() => { /* ya se avisa el error original */ });
      if (err instanceof ErrorLocal) throw err;
      if (err instanceof op.ApiError) throw new ErrorLocal(err.status, err.payload);
      if (err instanceof ErrorValidacion) throw new ErrorLocal(400, { error: err.message });
      throw new ErrorLocal(500, { error: (err as Error)?.message || 'Error inesperado' });
    }
  };
  if (!escribe) return atender();
  const turno = cola.then(atender, atender);
  cola = turno.catch(() => { /* la cola sigue */ });
  return turno;
}

// ---------------------------------------------------------------- rutas
const RUTAS_PUBLICAS = new Set(['/api/salud', '/api/inicio', '/api/login', '/api/logout', '/api/carpeta/elegir', '/api/carpeta/configurar']);

async function rutas(e: Estado, r: Peticion): Promise<unknown> {
  const { metodo: m, ruta, cuerpo: b } = r;
  const sesion = await e.sesiones.obtener(r.token);
  if (ruta.startsWith('/api') && !RUTAS_PUBLICAS.has(ruta) && !sesion) {
    falla(401, 'Inicia sesión para continuar.', { codigo: 'SIN_SESION' });
  }
  const s = sesion as SesionWeb;
  const a = () => e.almacen ?? falla(409, 'Todavía no se configuró el programa en este navegador.', { codigo: 'SIN_CARPETA' });
  const q = (): op.Quien => ({ nombre: s.nombre, gerencial: gerencialActivo(s) });
  const seg = ruta.split('/').filter(Boolean).slice(1); // sin "api"
  const es = (metodo: string, ...partes: string[]) =>
    m === metodo && seg.length === partes.length && partes.every((p, i) => p.startsWith(':') || p === seg[i]);

  // ---- inicio, carpeta y entrada
  if (es('GET', 'salud')) return { ok: true, app: 'gerencia-komplex', version: VERSION_WEB, web: true };
  if (es('GET', 'inicio')) {
    return {
      app: 'gerencia-komplex',
      version: VERSION_WEB,
      configurado: !!e.almacen,
      negocio: e.almacen?.config.negocio ?? 'Komplex Gym',
      local: true,
      windows: false,
      web: true,
      soportaCarpeta: soportaCarpetas(),
      sugerida: '',
      carpetaPerdida: null,
      sesion: sesion ? { nombre: sesion.nombre } : null,
    };
  }
  if (es('POST', 'carpeta', 'elegir')) return elegir(e, sesion);
  if (es('POST', 'carpeta', 'configurar')) return configurar(e, sesion, b);
  if (es('POST', 'carpeta', 'conectar')) return conectar(e, b.otra === true);
  if (es('POST', 'carpeta', 'resolver')) {
    await a().resolver(b.usar === 'carpeta' ? 'carpeta' : 'navegador');
    a().bitacora(s.nombre, 'Carpeta sincronizada', b.usar === 'carpeta' ? 'Se usaron los datos de la carpeta' : 'Se usaron los datos de este navegador');
    return { ok: true };
  }
  if (es('POST', 'carpeta', 'desconectar')) {
    await a().desconectar();
    a().bitacora(s.nombre, 'Carpeta desconectada', 'Los datos siguen en este navegador');
    return { ok: true };
  }
  if (es('POST', 'carpeta', 'abrir')) return { ok: false };
  if (es('POST', 'login')) {
    const al = a();
    const espera = e.sesiones.esperaPorIntentos();
    if (espera) falla(429, `Demasiados intentos. Espera ${espera} segundos.`);
    const nombre = String(b.nombre ?? '').trim().slice(0, 60);
    if (!nombre) falla(400, 'Escribe tu nombre (queda anotado en lo que registres).');
    if (!(await claveCorrecta(String(b.clave ?? ''), al.config.clave))) {
      e.sesiones.fallo();
      falla(401, 'La clave de acceso no es correcta.');
    }
    e.sesiones.acierto();
    const nueva = await e.sesiones.crear(nombre, b.recordar !== false);
    return { token: nueva.token, nombre: nueva.nombre };
  }
  if (es('POST', 'logout')) {
    if (sesion) await e.sesiones.cerrar(sesion.token);
    return { ok: true };
  }

  // ---- estado
  if (es('GET', 'estado')) {
    const al = a();
    return {
      version: VERSION_WEB,
      web: true,
      config: op.configPublica(al),
      mesesConDatos: al.mesesConDatos(),
      carpeta: al.nombreCarpeta ?? '',
      carpetaEstado: al.estadoCarpeta,
      carpetaError: al.errorCarpeta,
      soportaCarpeta: soportaCarpetas(),
      local: true,
      usuario: s.nombre,
      gerencialHasta: gerencialActivo(s) ? new Date(s.gerencialHasta).toISOString() : null,
      hoy: hoyISO(),
      ultimoGuardado: al.ultimoGuardado,
      ultimoRespaldo: al.ultimoRespaldo,
      direcciones: [],
      transferenciasPendientes: op.transferenciasPendientes(al),
    };
  }

  // ---- datos (mismas operaciones que el escritorio)
  if (es('GET', 'datos')) return op.leerDatos(a(), r.query.get('desde') || undefined, r.query.get('hasta') || undefined);
  if (es('GET', 'afiliados')) return op.afiliados(a());
  if (es('POST', 'registros')) return op.crearRegistro(a(), q(), b);
  if (es('PUT', 'registros', ':id')) return op.editarRegistro(a(), q(), seg[1], b);
  if (es('DELETE', 'registros', ':id')) return op.borrarRegistro(a(), q(), seg[1]);
  if (es('PUT', 'registros', ':id', 'pagos', ':idx', 'estado')) return op.marcarTransferencia(a(), q(), seg[1], seg[3], b);
  if (es('POST', 'movimientos')) return op.crearMovimiento(a(), q(), b);
  if (es('PUT', 'movimientos', ':id')) return op.editarMovimiento(a(), q(), seg[1], b);
  if (es('DELETE', 'movimientos', ':id')) return op.borrarMovimiento(a(), q(), seg[1]);
  if (es('PUT', 'aperturas', ':fecha')) return op.guardarApertura(a(), q(), seg[1], b);
  if (es('PUT', 'cuadres', ':fecha')) return op.guardarCuadre(a(), q(), seg[1], b);
  if (es('DELETE', 'cuadres', ':fecha')) return op.borrarCuadre(a(), q(), seg[1]);
  if (es('PUT', 'tasas', ':fecha')) return op.guardarTasas(a(), q(), seg[1], b);
  if (es('PUT', 'config')) return op.cambiarConfig(a(), q(), b);

  // ---- cierre de mes
  if (es('POST', 'cierres', ':mes')) {
    const al = a();
    const { cierre, datosMes } = op.cerrarMes(al, q(), seg[1], hoyISO());
    await al.persistir();
    const enCarpeta = await al.escribirCierre(seg[1], 'datos del mes.json', JSON.stringify({ cierre, datos: datosMes }, null, 1));
    await al.respaldoCarpeta(true).catch(() => { /* el cierre ya quedó guardado */ });
    return { cierre, carpeta: enCarpeta ? `${al.nombreCarpeta}/cierres/${op.carpetaDelCierre(seg[1])}` : null };
  }
  if (es('PUT', 'cierres', ':mes', 'archivos', ':nombre')) {
    const al = a();
    const nombre = op.nombreArchivoCierre(al, seg[1], seg[3]);
    if (!r.binario?.length) falla(400, 'Archivo vacío.');
    const guardado = await al.escribirCierre(seg[1], nombre, r.binario!);
    return { ok: true, guardado };
  }
  if (es('DELETE', 'cierres', ':mes')) return op.reabrirMes(a(), q(), seg[1]);

  // ---- código gerencial
  if (es('POST', 'gerencial')) {
    const al = a();
    const espera = e.sesiones.esperaPorIntentos();
    if (espera) falla(429, `Demasiados intentos. Espera ${espera} segundos.`);
    if (!codigoGerencialCorrecto(String(b.codigo ?? ''))) {
      e.sesiones.fallo();
      al.bitacora(s.nombre, 'Código gerencial incorrecto', 'versión web');
      falla(401, 'El código gerencial no es correcto.');
    }
    e.sesiones.acierto();
    const hasta = await e.sesiones.activarGerencial(s);
    al.bitacora(s.nombre, 'Modo gerencial activado (24 h)', `hasta ${new Date(hasta).toLocaleString('es-VE')}`);
    return { gerencialHasta: new Date(hasta).toISOString() };
  }
  if (es('DELETE', 'gerencial')) {
    if (gerencialActivo(s)) a().bitacora(s.nombre, 'Modo gerencial terminado', '');
    await e.sesiones.terminarGerencial(s);
    return { ok: true };
  }

  // ---- clave, bitácora y respaldos
  if (es('PUT', 'clave')) {
    const al = a();
    if (!gerencialActivo(s) && !(await claveCorrecta(String(b.actual ?? ''), al.config.clave))) {
      falla(401, 'La clave actual no es correcta.');
    }
    const nueva = String(b.nueva ?? '');
    op.validarClaveNueva(nueva);
    al.config.clave = await cifrarClave(nueva);
    al.guardarConfig();
    await e.sesiones.cerrarOtras(s.token);
    al.bitacora(s.nombre, 'Clave de acceso cambiada', 'Se cerraron las demás sesiones');
    return { ok: true };
  }
  if (es('GET', 'bitacora')) return op.leerBitacora(a());
  if (es('GET', 'respaldo')) return a().respaldo();
  if (es('GET', 'respaldos')) return a().listarRespaldos();
  if (es('POST', 'respaldo', 'restaurar')) {
    op.exigirGerencial(q());
    if (!op.esRespaldo(b)) falla(400, 'Ese archivo no es un respaldo de Gerencia Komplex.');
    await a().restaurar(b);
    a().bitacora(s.nombre, 'Respaldo restaurado (gerencial)', `creado ${b.creado} · ${b.meses.length} meses`);
    return { ok: true, meses: b.meses.length };
  }

  falla(404, 'No encontrado');
}

// ---------------------------------------------------------------- carpeta en la bienvenida y después
interface RevisionWeb {
  ruta: string;
  existe: boolean;
  tieneDatos: boolean;
  tieneClave: boolean;
  meses: string[];
  registros: number;
  problema: string | null;
  cancelado?: boolean;
}

/** Abre el selector de carpetas (debe venir de un toque en un botón). */
async function elegir(e: Estado, sesion: SesionWeb | null): Promise<RevisionWeb> {
  if (e.almacen && !sesion) falla(401, 'Inicia sesión para continuar.', { codigo: 'SIN_SESION' });
  if (!soportaCarpetas()) {
    return { ruta: '', existe: false, tieneDatos: false, tieneClave: false, meses: [], registros: 0, problema: 'Este navegador no permite elegir carpetas.' };
  }
  const elegida = await elegirCarpeta();
  if (!elegida) return { ruta: '', existe: false, tieneDatos: false, tieneClave: false, meses: [], registros: 0, problema: null, cancelado: true };
  const { dir, tieneDatos } = await resolverCarpeta(elegida);
  const leidos = tieneDatos ? await leerCarpeta(dir) : null;
  e.pendiente = { dir, tieneDatos, config: leidos?.config ?? null, meses: leidos?.meses ?? [] };
  return {
    ruta: dir.name,
    existe: true,
    tieneDatos,
    tieneClave: !!leidos?.config.clave,
    meses: (leidos?.meses ?? []).map((x) => x.mes),
    registros: (leidos?.meses ?? []).reduce((n, x) => n + x.registros.length, 0),
    problema: null,
  };
}

/**
 * Primera vez (o cambio de carpeta): deja listo el programa en este navegador.
 *  - con carpeta nueva → datos vacíos, se escriben en la carpeta;
 *  - con carpeta que ya tiene datos (del escritorio o de otro navegador) → se usan;
 *  - sin carpeta → todo queda en el navegador.
 */
async function configurar(e: Estado, sesion: SesionWeb | null, b: Record<string, unknown>) {
  if (e.almacen && !sesion) falla(401, 'Inicia sesión para continuar.', { codigo: 'SIN_SESION' });
  const nombre = String(b.nombre ?? '').trim().slice(0, 60) || sesion?.nombre || 'Administración';
  const usarCarpeta = b.sinCarpeta !== true && !!e.pendiente;
  const pend = usarCarpeta ? e.pendiente! : null;

  if (e.almacen) {
    // Ya configurado: solo se cambia de carpeta.
    if (!pend) falla(400, 'Elige primero la carpeta.');
    const res = await e.almacen.conectar(pend.dir);
    e.almacen.bitacora(nombre, 'Carpeta de datos cambiada', pend.dir.name);
    e.pendiente = null;
    return { ok: true, carpeta: pend.dir.name, sincronizacion: res, token: null, nombre };
  }

  const base: Configuracion = pend?.config ?? configInicial(new Date().toISOString());
  if (!base.clave) {
    const clave = String(b.clave ?? '');
    op.validarClaveNueva(clave);
    base.clave = await cifrarClave(clave);
  }
  const almacen = await AlmacenWeb.crear(e.p, base, pend?.meses ?? []);
  e.almacen = almacen;
  if (pend) {
    // Con datos: se acaban de leer de la carpeta. Sin datos: se escribe lo nuevo en ella.
    await almacen.conectar(pend.dir, pend.tieneDatos);
  }
  almacen.bitacora(nombre, pend ? (pend.tieneDatos ? 'Carpeta con datos abierta (web)' : 'Carpeta de datos creada (web)') : 'Programa iniciado solo en este navegador', pend?.dir.name ?? '');
  await almacen.persistir();
  e.pendiente = null;
  try { await navigator.storage?.persist?.(); } catch { /* el navegador decide */ }
  avisarOtrasPestanas();
  // Quien crea los datos queda dentro; si abrió una carpeta con clave, debe entrar con ella.
  const nueva = pend?.tieneDatos && pend.config?.clave ? null : await e.sesiones.crear(nombre, true);
  return { ok: true, carpeta: pend?.dir.name ?? null, recuperada: !!pend?.tieneDatos, token: nueva?.token ?? null, nombre };
}

/** Botón "Conectar carpeta": vuelve a pedir permiso (o elige otra) y sincroniza. */
async function conectar(e: Estado, otra: boolean): Promise<{ resultado: ResultadoSincronizar; carpeta: string | null; navegador?: unknown; carpetaDatos?: unknown }> {
  const al = e.almacen ?? falla(409, 'Todavía no se configuró el programa en este navegador.', { codigo: 'SIN_CARPETA' });
  let resultado: ResultadoSincronizar;
  if (otra || !al.carpeta) {
    const elegida = await elegirCarpeta();
    if (!elegida) return { resultado: 'igual', carpeta: al.nombreCarpeta };
    const { dir } = await resolverCarpeta(elegida);
    resultado = await al.conectar(dir);
  } else {
    resultado = await al.reconectar();
  }
  if (resultado === 'conflicto') {
    const enCarpeta = await leerCarpeta(al.carpeta!);
    const regs = (enCarpeta?.meses ?? []).flatMap((x) => x.registros);
    return {
      resultado,
      carpeta: al.nombreCarpeta,
      navegador: al.resumen(),
      carpetaDatos: {
        registros: regs.length,
        meses: (enCarpeta?.meses ?? []).filter((x) => esMes(x.mes)).length,
        ultimaFecha: regs.reduce<string | null>((mx, x) => (!mx || x.fecha > mx ? x.fecha : mx), null),
      },
    };
  }
  return { resultado, carpeta: al.nombreCarpeta };
}

