import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API = process.env.KOMPLEX_API || 'http://127.0.0.1:3004';
const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Dos versiones con la misma interfaz:
 *  - escritorio (por defecto): la compila el servidor Node en server/public.
 *  - web (`--mode web`): página para GitHub Pages en dist-web; los datos se
 *    guardan en el navegador y en la carpeta que se elija.
 */
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    base: web ? (process.env.KOMPLEX_BASE || '/gerenciakomplex/') : '/',
    plugins: [react()],
    define: { __MODO_WEB__: JSON.stringify(web) },
    resolve: {
      alias: {
        // La lógica del negocio (cálculos, cierres, operaciones, informe) vive en
        // el servidor y la interfaz la importa tal cual: los números salen iguales.
        '@dominio': dir('../server/src/dominio'),
        '@backend': dir(web ? './src/local/servidor.ts' : './src/local/nulo.ts'),
      },
    },
    server: {
      port: 5175,
      strictPort: true,
      // En desarrollo el frontend vive en Vite y todo /api va al servidor Node.
      proxy: web ? undefined : { '/api': { target: API, changeOrigin: true } },
      fs: { allow: ['..'] },
    },
    build: {
      outDir: web ? '../dist-web' : '../server/public',
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
