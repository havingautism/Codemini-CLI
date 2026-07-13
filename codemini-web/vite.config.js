import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const apiPort = process.env.CODEMINI_API_PORT || '3210';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@core': path.resolve(__dirname, '../src/core'),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1300,
    rolldownOptions: {
      output: {
        codeSplitting: true
      }
    }
  },
  optimizeDeps: {
    include: ['@lottiefiles/dotlottie-react'],
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`
    }
  }
});
