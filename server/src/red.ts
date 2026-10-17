/** red.ts — Direcciones de esta PC en la red local (para entrar desde el celular). */
import os from 'node:os';

import { PORT } from './config.js';

export function ipsLocales(): string[] {
  const out: string[] = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal && !out.includes(i.address)) out.push(i.address);
    }
  }
  return out;
}

export const direccionesRed = (): string[] => ipsLocales().map((ip) => `http://${ip}:${PORT}`);
