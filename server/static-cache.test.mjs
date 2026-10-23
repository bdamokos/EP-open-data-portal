import {loopback} from './test-support/loopback.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("missing or malformed build manifests safely fall back to five-minute caching", async () => {
  const script = `
    import { serveStatic } from ${JSON.stringify(new URL("./static-files.mjs", import.meta.url).href)};
    const headers = {};
    const response = { setHeader(name, value) { headers[name] = value; }, end() {} };
    const served = await serveStatic({ method: "HEAD", headers: {} }, response, new URL("http://localhost/assets/index-DZAb_0-x.js"));
    process.stdout.write(JSON.stringify({ served, status: response.statusCode, cacheControl: headers["Cache-Control"] }));
  `;
  for (const manifest of [undefined, "not valid JSON", "[]"]) {
    const directory = await mkdtemp(path.join(tmpdir(), "static-cache-fallback-"));
    try {
      await mkdir(path.join(directory, "assets"));
      await writeFile(path.join(directory, "assets", "index-DZAb_0-x.js"), "build asset");
      if (manifest !== undefined) {
        await mkdir(path.join(directory, ".vite"));
        await writeFile(path.join(directory, ".vite", "manifest.json"), manifest);
      }
      const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, EXPLORER_DIST_DIR: directory, EXPLORER_SERVE_STATIC: "true" },
      });
      assert.deepEqual(JSON.parse(stdout), { served: true, status: 200, cacheControl: "public, max-age=300" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("static caching follows emitted build assets and keeps HTML, ranges and failures fresh",loopback, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "static-cache-"));
  await mkdir(path.join(directory, "assets"));
  await mkdir(path.join(directory, ".vite"));
  const files = [
    "index.html",
    "assets/index-DZAb_0-x.js",
    "assets/index-DZAb_0-x.js.map",
    "assets/lazy-kR7-_o9A.js",
    "assets/index-B3oF-2_k.css",
    "assets/index-B3oF-2_k.css.map",
    "assets/image-DVx_y0-R.webp",
    "assets/index-NerR9_Zx.html",
    "assets/app.js",
    "assets/app-language.js",
    "assets/not-fingerprinted-file.js",
    "assets/legacy-aabbccdd.js",
    "assets/legacy-aabbccdd.js.map",
    "assets/unversioned.js",
    "assets/shared-nEstEd12.js",
    "assets/view-StYlE_12.css",
  ];
  const body = "public build file\n";
  await Promise.all(files.map((name) => writeFile(path.join(directory, name), body)));
  await writeFile(path.join(directory, ".vite", "manifest.json"), JSON.stringify({
    "index.html": {
      file: "assets/index-DZAb_0-x.js",
      isEntry: true,
      dynamicImports: ["src/lazy.ts"],
      css: ["assets/index-B3oF-2_k.css"],
      assets: ["assets/image-DVx_y0-R.webp"],
    },
    "src/lazy.ts": { file: "assets/lazy-kR7-_o9A.js", isDynamicEntry: true, imports: ["_shared.js"], css: ["assets/view-StYlE_12.css"] },
    "_shared.js": { file: "assets/shared-nEstEd12.js" },
    "page.html": { file: "assets/index-NerR9_Zx.html" },
    "unversioned.js": { file: "assets/unversioned.js" },
  }));
  const missingPath = path.join(directory, "assets", "removed-aabbccdd.js");
  await writeFile(missingPath, body);
  const missingMetadata = await stat(missingPath);
  await rm(missingPath);

  const previousDirectory = process.env.EXPLORER_DIST_DIR;
  process.env.EXPLORER_DIST_DIR = directory;
  const { serveStatic, sendResolvedFile } = await import("./static-files.mjs");
  const { sendError } = await import("./http-utils.mjs");
  if (previousDirectory === undefined) delete process.env.EXPLORER_DIST_DIR;
  else process.env.EXPLORER_DIST_DIR = previousDirectory;

  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/stream-error") {
        await sendResolvedFile(request, response, { path: missingPath, metadata: missingMetadata }, {
          cacheControl: "public, max-age=31536000, immutable",
        });
      } else if (!await serveStatic(request, response, new URL(request.url, "http://localhost"))) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end();
      }
    } catch (error) {
      sendError(request, response, error);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await t.test("Vite base64url hashes cache for one year while source maps revalidate", async () => {
      for (const name of [...files.slice(1, 7),...files.slice(-2)].filter(name=>!name.endsWith('.map'))) {
        const response = await fetch(`${base}/${name}`);
        assert.equal(response.status, 200, name);
        assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable", name);
        assert.equal(await response.text(), body);
      }
      // A source-only comment can change a map without changing its JS hash.
      for (const name of files.filter(name=>name.endsWith('.map'))) {
        const response = await fetch(`${base}/${name}`);
        assert.equal(response.headers.get('Cache-Control'), 'no-cache', name);
        await response.arrayBuffer();
      }
      const response = await fetch(`${base}/assets/index-DZAb_0-x.js`);
      const etag = response.headers.get("ETag");
      await response.arrayBuffer();
      const revalidated = await fetch(`${base}/assets/index-DZAb_0-x.js`, { headers: { "If-None-Match": etag } });
      assert.equal(revalidated.status, 304);
      assert.equal(revalidated.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
      const head = await fetch(`${base}/assets/index-DZAb_0-x.js`, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
      assert.equal(await head.text(), "");
    });

    await t.test("unversioned files and lookalike public filenames keep the short fallback", async () => {
      for (const name of files.slice(8,-2).filter(name=>!name.endsWith('.map'))) {
        const response = await fetch(`${base}/${name}`);
        assert.equal(response.status, 200, name);
        assert.equal(response.headers.get("Cache-Control"), "public, max-age=300", name);
        await response.arrayBuffer();
      }
    });

    await t.test("HTML always revalidates, including a fingerprinted manifest entry", async () => {
      for (const name of ["/", "/index.html", "/?view=questions", "/assets/index-NerR9_Zx.html"]) {
        const response = await fetch(`${base}${name}`);
        assert.equal(response.status, 200, name);
        assert.equal(response.headers.get("Cache-Control"), "no-cache", name);
        const etag = response.headers.get("ETag");
        await response.arrayBuffer();
        const revalidated = await fetch(`${base}${name}`, { headers: { "If-None-Match": etag } });
        assert.equal(revalidated.status, 304, name);
        assert.equal(revalidated.headers.get("Cache-Control"), "no-cache", name);
      }
    });

    await t.test("partial and invalid ranges never retain immutable caching", async () => {
      const partial = await fetch(`${base}/assets/index-DZAb_0-x.js`, { headers: { Range: "bytes=0-5" } });
      assert.equal(partial.status, 206);
      assert.equal(partial.headers.get("Cache-Control"), "no-store");
      assert.equal(partial.headers.get("Content-Range"), `bytes 0-5/${Buffer.byteLength(body)}`);
      assert.equal(await partial.text(), body.slice(0, 6));
      for (const range of ["bytes=1000-2000", "bytes=-0", "bytes=0-1,4-5", "invalid"]) {
        const response = await fetch(`${base}/assets/index-DZAb_0-x.js`, { headers: { Range: range } });
        assert.equal(response.status, 416, range);
        assert.equal(response.headers.get("Cache-Control"), "no-store", range);
        assert.equal(response.headers.get("Content-Range"), `bytes */${Buffer.byteLength(body)}`, range);
      }
      const asset = await fetch(`${base}/assets/index-DZAb_0-x.js`, { method: "HEAD" });
      const invalid = await fetch(`${base}/assets/index-DZAb_0-x.js`, {
        headers: { Range: "invalid", "If-None-Match": asset.headers.get("ETag") },
      });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get("Cache-Control"), "no-store");
    });

    await t.test("missing files and stream errors cannot inherit long-lived caching", async () => {
      const missing = await fetch(`${base}/assets/missing-aabbccdd.js`);
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get("Cache-Control"), "no-store");
      const failed = await fetch(`${base}/stream-error`);
      assert.equal(failed.status, 500);
      assert.equal(failed.headers.get("Cache-Control"), "no-store");
      assert.equal((await failed.json()).error.code, "internal_error");
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
