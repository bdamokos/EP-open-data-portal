import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const thirdPartyNotices = readFileSync(new URL("./THIRD_PARTY_JAVASCRIPT_LICENSES.txt", import.meta.url), "utf8").trim();

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
    rolldownOptions: {
      output: {
        // postBanner preserves the full notices after minification and adjusts source maps.
        postBanner: `/*!\n${thirdPartyNotices}\n*/`,
      },
    },
  },
});
