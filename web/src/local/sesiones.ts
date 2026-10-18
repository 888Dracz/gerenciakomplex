/**
 * sesiones.ts (web) — Clave de acceso, sesiones y código gerencial dentro del
 * navegador.
 *
 * La clave se cifra con scrypt y los MISMOS parámetros que el programa de
 * escritorio (Node `scryptSync(clave, salt, 32)`), así una carpeta creada en
 * cualquiera de las dos versiones abre en la otra con la misma clave.
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { GERENCIAL_HORAS, HUELLA_CODIGO_GERENCIAL } from '@dominio/tipos';
import type { Persistencia } from './persistencia';

const SESION_RECORDAR_MS = 30 * 24 * 60 * 60 * 1000;
const SESION_CORTA_MS = 12 * 60 * 60 * 1000;

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function aleatorio(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function scryptHex(clave: string, salt: string): Promise<string> {
  return hex(await scryptAsync(clave, salt, { N: 16384, r: 8, p: 1, dkLen: 32 }));
}

export async function cifrarClave(clave: string): Promise<{ salt: string; hash: string }> {
  const salt = hex(aleatorio(16));
  return { salt, hash: await scryptHex(clave, salt) };
}

export async function claveCorrecta(clave: string, guardada: { salt: string; hash: string } | undefined): Promise<boolean> {
  if (!guardada) return false;
  return iguales(await scryptHex(clave, guardada.salt), guardada.hash);
}

export function codigoGerencialCorrecto(codigo: string): boolean {
  return iguales(hex(sha256(new TextEncoder().encode(String(codigo).trim()))), HUELLA_CODIGO_GERENCIAL);
}

// ---------------------------------------------------------------- sesiones
export interface SesionWeb {
  token: string;
  nombre: string;
  expira: number;
  recordar: boolean;
  gerencialHasta: number;
}

export class Sesiones {
  private lista: Record<string, SesionWeb> | null = null;
  private fallos = { n: 0, hasta: 0 };

  constructor(private p: Persistencia) {}

  private async todas(): Promise<Record<string, SesionWeb>> {
    if (!this.lista) this.lista = (await this.p.leer<Record<string, SesionWeb>>('sesiones')) ?? {};
    return this.lista;
  }

  private async guardar(): Promise<void> {
    await this.p.escribir('sesiones', this.lista ?? {});
  }

  async crear(nombre: string, recordar: boolean): Promise<SesionWeb> {
    const l = await this.todas();
    const s: SesionWeb = {
      token: hex(aleatorio(24)),
      nombre,
      expira: Date.now() + (recordar ? SESION_RECORDAR_MS : SESION_CORTA_MS),
      recordar,
      gerencialHasta: 0,
    };
    // Solo un puñado de sesiones por navegador.
    for (const [k, v] of Object.entries(l)) if (v.expira <= Date.now()) delete l[k];
    l[s.token] = s;
    await this.guardar();
    return s;
  }

  async obtener(token: string | null): Promise<SesionWeb | null> {
    if (!token) return null;
    const l = await this.todas();
    const s = l[token];
    if (!s) return null;
    const ahora = Date.now();
    if (s.expira <= ahora) {
      delete l[token];
      await this.guardar();
      return null;
    }
    const duracion = s.recordar ? SESION_RECORDAR_MS : SESION_CORTA_MS;
    if (s.expira - ahora < duracion / 2) {
      s.expira = ahora + duracion;
      await this.guardar();
    }
    return s;
  }

  async cerrar(token: string): Promise<void> {
    const l = await this.todas();
    delete l[token];
    await this.guardar();
  }

  async cerrarOtras(excepto: string): Promise<void> {
    const l = await this.todas();
    for (const k of Object.keys(l)) if (k !== excepto) delete l[k];
    await this.guardar();
  }

  async activarGerencial(s: SesionWeb): Promise<number> {
    s.gerencialHasta = Date.now() + GERENCIAL_HORAS * 60 * 60 * 1000;
    await this.guardar();
    return s.gerencialHasta;
  }

  async terminarGerencial(s: SesionWeb): Promise<void> {
    s.gerencialHasta = 0;
    await this.guardar();
  }

  /** Vuelve a leer las sesiones (otra pestaña entró o salió). */
  olvidarCache(): void { this.lista = null; }

  // Tras 8 claves o códigos equivocados seguidos, 2 minutos de espera.
  esperaPorIntentos(): number {
    const resta = this.fallos.hasta - Date.now();
    return resta > 0 ? Math.ceil(resta / 1000) : 0;
  }

  fallo(): void {
    this.fallos.n++;
    if (this.fallos.n >= 8) { this.fallos = { n: 0, hasta: Date.now() + 2 * 60 * 1000 }; }
  }

  acierto(): void { this.fallos = { n: 0, hasta: 0 }; }
}

export const gerencialActivo = (s: SesionWeb | null): boolean => !!s && s.gerencialHasta > Date.now();
