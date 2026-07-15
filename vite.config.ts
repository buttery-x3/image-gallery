import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  base: "./",
  build: {
    outDir: "../../dist/public",
    emptyOutDir: false,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/media": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
    },
  },
});
