/**
 * app.tsx — Estado global: primer arranque, sesión, configuración, cierres y
 * los datos que piden los apartados.
 *
 * Cada vez que algo se guarda se llama a `cambio()`: sube un contador que hace
 * que los apartados vuelvan a pedir sus datos, y se refresca el estado (meses
 * con datos, transferencias pendientes, hora del último guardado).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';

import type { ConfigPublica, Datos } from '@dominio/tipos';
import type { EstadoPeriodos } from '@dominio/periodos';
import { apiGet, apiPost, getToken, mensajeError, onSesionCaducada, setToken, suscribirCambiosExternos } from '../lib/api';

export interface Inicio {
  configurado: boolean;
  negocio: string;
  local: boolean;
  windows: boolean;
  sugerida: string;
  carpetaPerdida: string | null;
  sesion: { nombre: string } | null;
  /** Versión web (GitHub Pages): sin servidor, datos en el navegador y la carpeta. */
  web?: boolean;
  soportaCarpeta?: boolean;
}

export interface Estado {
  version: string;
  config: ConfigPublica;
  mesesConDatos: string[];
  carpeta: string;
  local: boolean;
  usuario: string;
  gerencialHasta: string | null;
  hoy: string;
  ultimoGuardado: string | null;
  ultimoRespaldo: string | null;
  transferenciasPendientes: number;
  /** Direcciones para entrar desde el celular (misma red WiFi). */
  direcciones: string[];
  web?: boolean;
  carpetaEstado?: 'sin-soporte' | 'sin-carpeta' | 'conectada' | 'sin-permiso' | 'error';
  carpetaError?: string | null;
  soportaCarpeta?: boolean;
}

type Fase = 'cargando' | 'bienvenida' | 'login' | 'app' | 'error';

interface AppApi {
  fase: Fase;
  error: string;
  inicio: Inicio | null;
  estado: Estado | null;
  /** Contador de cambios: los datos se vuelven a pedir cuando sube. */
  version: number;
  gerencial: boolean;
  entrar: (token: string) => Promise<void>;
  salir: () => Promise<void>;
  recargar: () => Promise<void>;
  cambio: () => void;
}

const Ctx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp necesita <AppProvider>');
  return v;
}

/** Atajo: el estado ya cargado (solo dentro de la aplicación). */
export function useEstado(): Estado {
  const { estado } = useApp();
  if (!estado) throw new Error('Estado no cargado');
  return estado;
}

/** Lo que necesitan las reglas de cierre de `@dominio/periodos`. */
export function usePeriodos(): EstadoPeriodos {
  const { estado, gerencial } = useApp();
  return useMemo(() => ({
    mesesConDatos: estado?.mesesConDatos ?? [],
    cierres: estado?.config.cierres ?? {},
    gerencial,
  }), [estado, gerencial]);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>('cargando');
  const [error, setError] = useState('');
  const [inicio, setInicio] = useState<Inicio | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [version, setVersion] = useState(0);
  const [ahora, setAhora] = useState(Date.now());

  const cargarInicio = useCallback(async () => {
    try {
      const i = await apiGet<Inicio>('/api/inicio');
      setInicio(i);
      if (!i.configurado) { setFase('bienvenida'); return; }
      if (!getToken() || !i.sesion) {
        if (getToken()) setToken(null);
        setFase('login');
        return;
      }
      setEstado(await apiGet<Estado>('/api/estado'));
      setFase('app');
    } catch (e) {
      setError(mensajeError(e));
      setFase('error');
    }
  }, []);

  useEffect(() => { void cargarInicio(); }, [cargarInicio]);

  useEffect(() => {
    onSesionCaducada(() => {
      setToken(null);
      setEstado(null);
      setFase('login');
    });
  }, []);

  // El modo gerencial caduca solo: se revisa cada 30 s.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const recargar = useCallback(async () => {
    try {
      setEstado(await apiGet<Estado>('/api/estado'));
    } catch { /* el error se verá en la próxima acción */ }
  }, []);

  const pendiente = useRef<number | null>(null);
  const cambio = useCallback(() => {
    setVersion((v) => v + 1);
    if (pendiente.current) window.clearTimeout(pendiente.current);
    pendiente.current = window.setTimeout(() => { void recargar(); }, 50);
  }, [recargar]);

  // Versión web: otra pestaña guardó algo → se vuelven a pedir los datos.
  useEffect(() => suscribirCambiosExternos(() => cambio()), [cambio]);

  const entrar = useCallback(async (token: string) => {
    setToken(token);
    await cargarInicio();
  }, [cargarInicio]);

  const salir = useCallback(async () => {
    try { await apiPost('/api/logout'); } catch { /* da igual */ }
    setToken(null);
    setEstado(null);
    await cargarInicio();
  }, [cargarInicio]);

  const gerencial = !!estado?.gerencialHasta && Date.parse(estado.gerencialHasta) > ahora;

  const api = useMemo<AppApi>(() => ({
    fase, error, inicio, estado, version, gerencial, entrar, salir, recargar, cambio,
  }), [fase, error, inicio, estado, version, gerencial, entrar, salir, recargar, cambio]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

// ---------------------------------------------------------------- datos
/** Datos de un rango (o todos). Se vuelven a pedir tras cada cambio. */
export function useDatos(desde?: string, hasta?: string): {
  datos: Datos | null; error: string; recargar: () => void;
} {
  const { version } = useApp();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    const qs = desde && hasta ? `?desde=${desde}&hasta=${hasta}` : '';
    apiGet<Datos>(`/api/datos${qs}`)
      .then((d) => { if (vivo) { setDatos(d); setError(''); } })
      .catch((e) => { if (vivo) setError(mensajeError(e)); });
    return () => { vivo = false; };
  }, [desde, hasta, version, n]);
  return { datos, error, recargar: () => setN((x) => x + 1) };
}

export interface AfiliadoConocido { nombre: string; ultimoPlan: string; ultimaFecha: string; registros: number }

export function useAfiliados(): AfiliadoConocido[] {
  const { version } = useApp();
  const [lista, setLista] = useState<AfiliadoConocido[]>([]);
  useEffect(() => {
    let vivo = true;
    apiGet<{ afiliados: AfiliadoConocido[] }>('/api/afiliados')
      .then((r) => { if (vivo) setLista(r.afiliados); })
      .catch(() => { /* sin sugerencias */ });
    return () => { vivo = false; };
  }, [version]);
  return lista;
}
