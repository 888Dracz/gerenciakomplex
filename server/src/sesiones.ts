/**
 * sesiones.ts — Clave de acceso, sesiones y código gerencial.
 *
 * - La clave de acceso se define al crear la carpeta de datos y se guarda
 *   cifrada (scrypt) en datos/configuracion.json: viaja con los datos.
 * - Cada dispositivo que entra recibe un token. Con "recordar" dura 30 días.
 * - El código gerencial abre el modo gerencial durante 24 horas en ESA sesión:
 *   sin bloqueos de cierre ni avisos, se puede modificar cualquier mes.
 *   El código no se guarda en claro: se compara su huella SHA-256.
 */
import crypto from 'node:crypto';

import { SESIONES, SESION_CORTA_MS, SESION_RECORDAR_MS } from './config.js';
import { escribirJson, leerJson } from './almacen/archivos.js';
import { GERENCIAL_HORAS } from './dominio/tipos.js';

/** SHA-256 del código gerencial. */
const HUELLA_CODIGO_GERENCIAL = 'd978342f31d4c9ca581081920f8f59fbb2e41c7ea5d84885d61696c0ee4c5d61';

export interface Sesion {
  token: string;
  nombre: string;
  creada: number;
  expira: number;
  recordar: boolean;
  /** Fin del modo gerencial (ms), o 0 si no está activo. */
  gerencialHasta: number;
}

// ---------------------------------------------------------------- clave
export function cifrarClave(clave: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clave, salt, 32).toString('hex');
  return { salt, hash };
}

export function claveCorrecta(clave: string, guardada: { salt: string; hash: string } | undefined): boolean {
  if (!guardada) return false;
  const a = crypto.scryptSync(clave, guardada.salt, 32);
  const b = Buffer.from(guardada.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function codigoGerencialCorrecto(codigo: string): boolean {
  const a = crypto.createHash('sha256').update(String(codigo).trim()).digest();
  const b = Buffer.from(HUELLA_CODIGO_GERENCIAL, 'hex');
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- sesiones
const sesiones = new Map<string, Sesion>();
let cargadas = false;

function cargar(): void {
  if (cargadas) return;
  cargadas = true;
  try {
    const lista = leerJson<Sesion[]>(SESIONES) ?? [];
    const ahora = Date.now();
    for (const s of lista) if (s && s.token && s.expira > ahora) sesiones.set(s.token, s);
  } catch { /* archivo dañado: todos vuelven a entrar */ }
}

function guardar(): void {
  try {
    escribirJson(SESIONES, [...sesiones.values()]);
  } catch (e) {
    console.error('[sesiones] No se pudieron guardar:', (e as Error).message);
  }
}

export function crearSesion(nombre: string, recordar: boolean): Sesion {
  cargar();
  const ahora = Date.now();
  const s: Sesion = {
    token: crypto.randomBytes(24).toString('base64url'),
    nombre,
    creada: ahora,
    expira: ahora + (recordar ? SESION_RECORDAR_MS : SESION_CORTA_MS),
    recordar,
    gerencialHasta: 0,
  };
  sesiones.set(s.token, s);
  guardar();
  return s;
}

export function obtenerSesion(token: string | null): Sesion | null {
  if (!token) return null;
  cargar();
  const s = sesiones.get(token);
  if (!s) return null;
  const ahora = Date.now();
  if (s.expira <= ahora) {
    sesiones.delete(token);
    guardar();
    return null;
  }
  // Sesión deslizante: mientras se use, no caduca.
  const duracion = s.recordar ? SESION_RECORDAR_MS : SESION_CORTA_MS;
  if (s.expira - ahora < duracion / 2) {
    s.expira = ahora + duracion;
    guardar();
  }
  return s;
}

export function cerrarSesion(token: string): void {
  cargar();
  if (sesiones.delete(token)) guardar();
}

/** Cierra todas las sesiones (al cambiar la clave), salvo la indicada. */
export function cerrarOtras(excepto: string): void {
  cargar();
  for (const k of [...sesiones.keys()]) if (k !== excepto) sesiones.delete(k);
  guardar();
}

export const gerencialActivo = (s: Sesion | null): boolean => !!s && s.gerencialHasta > Date.now();

export function activarGerencial(s: Sesion): number {
  s.gerencialHasta = Date.now() + GERENCIAL_HORAS * 60 * 60 * 1000;
  guardar();
  return s.gerencialHasta;
}

export function terminarGerencial(s: Sesion): void {
  s.gerencialHasta = 0;
  guardar();
}

// ---------------------------------------------------------------- intentos fallidos
/** Tras 8 claves o códigos equivocados seguidos desde un equipo, espera 2 minutos. */
const fallos = new Map<string, { n: number; hasta: number }>();

export function bloqueadoPorIntentos(ip: string): number {
  const f = fallos.get(ip);
  if (!f) return 0;
  const resta = f.hasta - Date.now();
  return resta > 0 ? Math.ceil(resta / 1000) : 0;
}

export function registrarFallo(ip: string): void {
  const f = fallos.get(ip) ?? { n: 0, hasta: 0 };
  f.n++;
  if (f.n >= 8) {
    f.hasta = Date.now() + 2 * 60 * 1000;
    f.n = 0;
  }
  fallos.set(ip, f);
}

export const limpiarFallos = (ip: string): void => { fallos.delete(ip); };
