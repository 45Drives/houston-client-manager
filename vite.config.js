const Path = require('path');
const vuePlugin = require('@vitejs/plugin-vue')
import { fileURLToPath, URL } from "node:url";

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
            "@45drives/houston-common-css": fileURLToPath(new URL("./houston-common/houston-common-css", import.meta.url)),
        },
    },
});

module.exports = config;
