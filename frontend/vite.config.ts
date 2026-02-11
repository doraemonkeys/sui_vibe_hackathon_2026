/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Logic layers: api, lib, hooks, config - require high coverage
      // View layers: components - medium coverage
      // Assembly layers: pages - excluded from thresholds
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/main.tsx',
        'src/test-setup.ts',
        'src/pages/**',
      ],
      thresholds: {
        // Phase 1: Establishing quality baseline
        // branches is harder to achieve but more meaningful for logic coverage
        lines: 40,
        functions: 50,
        statements: 40,
        branches: 40,
      },
    },
  },
});
