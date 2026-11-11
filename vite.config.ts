import { readdirSync,readFileSync } from "node:fs";
import {createHash} from 'node:crypto';
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";
import {API_VERSION, versionedApiUrl} from "./server/api-version.mjs";

import {browserNotices} from "./scripts/browser-notices.mjs";
let thirdPartyNotices = "";
const startupAssets = ['colour-scheme', 'interface-language', 'initial-shell'].map(name => {
  const source = readFileSync(new URL(`./public/assets/${name}.js`, import.meta.url), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  return {name, source, fileName: `assets/${name}-${hash}.js`};
});

export default defineConfig({
  base: "./",
  plugins: [{
    name: "browser-dependency-notices",
    renderStart() {
      thirdPartyNotices = browserNotices(this.getModuleIds(), fileURLToPath(new URL("./", import.meta.url))).trim();
    },
    generateBundle() {
      this.emitFile({type: "asset", fileName: "THIRD_PARTY_JAVASCRIPT_LICENSES.txt", source: thirdPartyNotices + "\n"});
    },
  },{
    name: 'api-contract-version',
    enforce: 'pre',
    load(id) {
      if (id === fileURLToPath(new URL('./server/api-version.mjs', import.meta.url))) {
        return `export const API_VERSION = ${JSON.stringify(API_VERSION)};\nexport ${versionedApiUrl.toString()}`;
      }
    },
  },react(),{
    name: 'fingerprinted-startup-scripts',
    apply: 'build',
    transformIndexHtml: {order: 'post', handler(html) {
      for (const asset of startupAssets) html = html.replace(`./assets/${asset.name}.js`, `./${asset.fileName}`);
      return html;
    }},
    generateBundle() {
      for (const asset of startupAssets) this.emitFile({type: 'asset', name: `${asset.name}.js`, originalFileName: `public/assets/${asset.name}.js`, fileName: asset.fileName, source: asset.source});
    },
  },{
    // The plenary views share one lazy chunk group. Name it in the page so the
    // startup script can fetch it with the entry, instead of after the entry runs.
    name: 'view-preload',
    apply: 'build',
    transformIndexHtml: {order: 'post', handler(html, context) {
      const chunks = Object.values(context.bundle || {}).filter(item => item.type === 'chunk');
      const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
      const closure = (start: string) => {
        const seen = new Set<string>();
        const walk = (file: string) => {if (seen.has(file)) return; seen.add(file); for (const next of byFile.get(file)?.imports || []) walk(next);};
        walk(start);
        return seen;
      };
      const entry = chunks.find(chunk => chunk.isEntry), view = chunks.find(chunk => chunk.facadeModuleId?.endsWith('/src/Legislation.tsx'));
      if (!entry || !view) throw new Error('view-preload: the entry or the Legislation chunk is missing.');
      const loaded = closure(entry.fileName), files = [...closure(view.fileName)].filter(file => !loaded.has(file));
      const css = (file: string): string[] => [...(byFile.get(file)?.viteMetadata?.importedCss || [])];
      const loadedCss = new Set([...loaded].flatMap(css)), styles = [...new Set(files.flatMap(css))].filter(file => !loadedCss.has(file));
      const hrefs = [...files, ...styles].map(file => './' + file).join(' ');
      return html.replace('</head>', `<meta name="view-preload" data-view="legislation" content="${hrefs}"></head>`);
    }},
  },{name:'pdf-reader-assets',generateBundle(){
    for(const directory of ['cmaps','standard_fonts','wasm'])for(const name of readdirSync(new URL('./node_modules/pdfjs-dist/'+directory+'/',import.meta.url))){
      this.emitFile({type:'asset',fileName:'assets/pdfjs-6.5.438/'+directory+'/'+name,source:readFileSync(new URL('./node_modules/pdfjs-dist/'+directory+'/'+name,import.meta.url))});
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
        postBanner: () => `/*!\n${thirdPartyNotices}\n*/`,
      },
    },
  },
});
