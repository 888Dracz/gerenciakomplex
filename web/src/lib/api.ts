/**
 * api.ts — Cliente de la API.
 *
 * El token de la sesión vive en localStorage (lo borra "Salir"). Los errores
 * del servidor llegan como `ErrorApi` con el código que permite reaccionar:
 * CIERRE_PENDIENTE abre la pregunta obligatoria del cierre de mes.
 */
const CLAVE_TOKEN = 'kx_token';
let token: string | null = (() => {
  try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; }
})();

export const getToken = (): string | null => token;

export function setToken(t: string | null): void {
  token = t;
  try {
    if (t) localStorage.setItem(CLAVE_TOKEN, t);
    else localStorage.removeItem(CLAVE_TOKEN);
  } catch { /* sin almacenamiento: la sesión dura lo que la pestaña */ }
}

export class ErrorApi extends Error {
  status: number;
  codigo?: string;
  datos: Record<string, unknown>;
  constructor(status: number, mensaje: string, datos: Record<string, unknown> = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.codigo = typeof datos.codigo === 'string' ? datos.codigo : undefined;
    this.datos = datos;
  }
}

// ---- indicador de red (barra fina arriba)
let activas = 0;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());
export const suscribirRed = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };
export const hayRedActiva = () => activas > 0;

/** Lo que pasa cuando la sesión caduca (lo engancha state/app). */
let alCaducar: (() => void) | null = null;
export const onSesionCaducada = (f: () => void) => { alCaducar = f; };

async function pedir<T>(method: string, url: string, cuerpo?: unknown, binario?: Uint8Array): Promise<T> {
  const headers = new Headers();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  let body: BodyInit | undefined;
  if (binario) {
    headers.set('Content-Type', 'application/octet-stream');
    body = binario as unknown as BodyInit;
  } else if (cuerpo !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(cuerpo);
  }
  activas++;
  avisar();
  let r: Response;
  try {
    r = await fetch(url, { method, headers, body, cache: 'no-store' });
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el programa. Revisa que Gerencia Komplex siga abierto en la PC.');
  } finally {
    activas--;
    avisar();
  }
  const txt = await r.text();
  let json: Record<string, unknown> = {};
  try { json = txt ? JSON.parse(txt) : {}; } catch { /* respuesta vacía o no JSON */ }
  if (!r.ok) {
    if (r.status === 401 && json.codigo === 'SIN_SESION' && alCaducar) alCaducar();
    throw new ErrorApi(r.status, String(json.error ?? `Error ${r.status}`), json);
  }
  return json as T;
}

export const apiGet = <T>(url: string) => pedir<T>('GET', url);
export const apiPost = <T>(url: string, cuerpo?: unknown) => pedir<T>('POST', url, cuerpo ?? {});
export const apiPut = <T>(url: string, cuerpo?: unknown) => pedir<T>('PUT', url, cuerpo ?? {});
export const apiDelete = <T>(url: string) => pedir<T>('DELETE', url);
export const apiPutBinario = <T>(url: string, bytes: Uint8Array) => pedir<T>('PUT', url, undefined, bytes);

export const mensajeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));
