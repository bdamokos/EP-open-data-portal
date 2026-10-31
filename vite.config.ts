import { readdirSync,readFileSync } from "node:fs";
import {createHash} from 'node:crypto';
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const thirdPartyNotices = readFileSync(new URL("./THIRD_PARTY_JAVASCRIPT_LICENSES.txt", import.meta.url), "utf8").trim().replaceAll("*/", "* /");
const startupAssets = ['colour-scheme', 'initial-shell'].map(name => {
  const source = readFileSync(new URL(`./public/assets/${name}.js`, import.meta.url), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  return {name, source, fileName: `assets/${name}-${hash}.js`};
});

export default defineConfig({
  base: "./",
  plugins: [react(),{
    name: 'fingerprinted-startup-scripts',
    apply: 'build',
    transformIndexHtml: {order: 'post', handler(html) {
      for (const asset of startupAssets) html = html.replace(`./assets/${asset.name}.js`, `./${asset.fileName}`);
      return html;
    }},
    generateBundle() {
      for (const asset of startupAssets) this.emitFile({type: 'asset', name: `${asset.name}.js`, originalFileName: `public/assets/${asset.name}.js`, fileName: asset.fileName, source: asset.source});
    },
  },{name:'pdf-reader-assets',generateBundle(){
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
