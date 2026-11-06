import { defineConfig } from "vite";

/**
 * Studio is also a normal Vite app for the Arkiv history feature. The library
 * build (`tsc`) still emits `dist/`; the app bundles into `dist-app/` so the
 * two outputs never overwrite each other.
 */
export default defineConfig({
  build: { outDir: "dist-app" },
  server: { port: 5178 },
  preview: { port: 5179 },
});
