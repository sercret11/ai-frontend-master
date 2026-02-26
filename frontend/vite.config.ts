import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    server: {
      port: 5174,
      host: '0.0.0.0',
    },
    plugins: [react()],
    worker: {
      format: 'es' as const,
    },
    build: {
      target: 'esnext',
    },
    define: {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      exclude: ['@types/node'],
      include: ['react', 'react-dom', 'react-dom/client', 'zustand'],
    },
  };
});
