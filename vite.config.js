import { version } from './package.json';

const Path = require('path');
const vuePlugin = require('@vitejs/plugin-vue')
const { fileURLToPath, URL } = require("node:url");

const { defineConfig } = require('vite');

/**
 * https://vitejs.dev/config
 */
const config = defineConfig({
  root: Path.join(__dirname, 'src', 'renderer'),
  publicDir: 'public',
  server: {
    port: 8080,
  },
  open: false,
  build: {
    outDir: Path.join(__dirname, 'build', 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      external: ['vitest'], // Ensure vitest is not bundled
      assetFileNames: 'assets/[name][extname]', // Keeps original asset names
      entryFileNames: 'assets/[name].js',
      chunkFileNames: 'assets/[name].js',
    },
  },
  plugins: [vuePlugin({
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag === 'webview'
      }
    }
  })],
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@45drives/houston-common-lib": fileURLToPath(new URL("./node_modules/@45drives/houston-common-lib/dist", import.meta.url)),
      "@45drives/houston-common-ui": fileURLToPath(new URL("./node_modules/@45drives/houston-common-ui/dist", import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});

module.exports = config;
