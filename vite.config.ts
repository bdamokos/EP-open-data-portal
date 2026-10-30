import { readdirSync,readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const thirdPartyNotices = readFileSync(new URL("./THIRD_PARTY_JAVASCRIPT_LICENSES.txt", import.meta.url), "utf8").trim().replaceAll("*/", "* /");

export default defineConfig({
  base: "./",
  plugins: [react(),{name:'pdf-reader-assets',generateBundle(){
    for(const directory of ['cmaps','standard_fonts','wasm'])for(const name of readdirSync(new URL('./node_modules/pdfjs-dist/'+directory+'/',import.meta.url))){
      this.emitFile({type:'asset',fileName:'assets/pdfjs-6.4.299/'+directory+'/'+name,source:readFileSync(new URL('./node_modules/pdfjs-dist/'+directory+'/'+name,import.meta.url))});
    }
  }}],
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
    manifest: true,
    rolldownOptions: {
      output: {
        // postBanner preserves the full notices after minification and adjusts source maps.
        postBanner: `/*!\n${thirdPartyNotices}\n*/`,
      },
    },
  },
});
