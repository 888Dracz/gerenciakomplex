import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API = process.env.KOMPLEX_API || 'http://127.0.0.1:3004';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // La lógica del negocio (cálculos, cierres, informe) vive en el servidor y
    // la interfaz la importa tal cual: los números salen iguales en los dos.
    alias: { '@dominio': fileURLToPath(new URL('../server/src/dominio', import.meta.url)) },
  },
  server: {
    port: 5175,
    strictPort: true,
    // En desarrollo el frontend vive en Vite y todo /api va al servidor Node.
    proxy: { '/api': { target: API, changeOrigin: true } },
    fs: { allow: ['..'] },
  },
  build: {
    // El servidor sirve esta carpeta como estáticos en producción.
    outDir: '../server/public',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
