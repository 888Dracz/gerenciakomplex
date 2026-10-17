/** prefs.ts — Apariencia en este dispositivo: modo claro/oscuro, acento y letra. */
export interface Prefs { modo: 'oscuro' | 'claro' | 'sistema'; acento: string; letra: string }

export const PREFS_DEF: Prefs = { modo: 'oscuro', acento: 'komplex', letra: 'normal' };

export const ACENTOS = [
  { id: 'komplex', nombre: 'Rojo Komplex', color: '#e5383b' },
  { id: 'oro', nombre: 'Oro (Dorado Club)', color: '#e3c258' },
  { id: 'zafiro', nombre: 'Zafiro', color: '#5aa7ff' },
  { id: 'esmeralda', nombre: 'Esmeralda', color: '#3ecf8e' },
];

export function leerPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem('kx_prefs') || 'null');
    if (p && typeof p === 'object') return { ...PREFS_DEF, ...p };
  } catch { /* preferencia dañada: las de fábrica */ }
  return PREFS_DEF;
}

export function aplicarPrefs(p: Prefs): void {
  const el = document.documentElement;
  const claro = p.modo === 'claro' || (p.modo === 'sistema' && window.matchMedia('(prefers-color-scheme: light)').matches);
  el.dataset.theme = claro ? 'light' : '';
  el.dataset.palette = p.acento;
  el.dataset.fontsize = p.letra;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', claro ? '#ffffff' : '#08080b');
}

export function guardarPrefs(p: Prefs): void {
  try { localStorage.setItem('kx_prefs', JSON.stringify(p)); } catch { /* sin almacenamiento */ }
  aplicarPrefs(p);
}
