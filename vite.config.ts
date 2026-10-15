import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8790",
    },
  },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:8790",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
