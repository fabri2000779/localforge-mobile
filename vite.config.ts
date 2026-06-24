import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri mobile dev runs on a fixed port the native shell binds to. We
// also disable Vite's clear-screen so cargo output stays in scrollback
// when both run together.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      // Local IAP plugin's JS API. Lives under src-tauri/ (next to its
      // Rust + native code) rather than node_modules since it's not
      // published; the alias lets app code import it like a package.
      'tauri-plugin-iap-api': fileURLToPath(
        new URL('./src-tauri/plugins/tauri-plugin-iap/guest-js/index.ts', import.meta.url),
      ),
      // Local push plugin's JS API (APNs/FCM register + open-server event).
      'tauri-plugin-push-api': fileURLToPath(
        new URL('./src-tauri/plugins/tauri-plugin-push/guest-js/index.ts', import.meta.url),
      ),
    },
  },

  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 5174 }
      : undefined,
    watch: {
      // Tauri compiles Rust; we don't want Vite to rebuild every time
      // a .rs file changes under src-tauri.
      ignored: ['**/src-tauri/**'],
    },
  },

  // Mobile envs (iOS Safari, Android System WebView) target similar
  // baselines. ES2022 covers both without polyfills. Minifier left at
  // Vite's default (oxc) so we don't pull esbuild as an explicit dep
  // — Vite 8 + Rolldown handles minify natively.
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
