import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.mjs";
import { HttpError, setCommonSecurityHeaders } from "./http-utils.mjs";

const contentTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".ogg", "audio/ogg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".srt", "application/x-subrip; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".vtt", "text/vtt; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

const buildAssetsByRoot = new Map();

function immutableBuildAssets(root) {
  if (!buildAssetsByRoot.has(root)) {
    // A production build is replaced as a unit when the process is deployed.
    // The manifest distinguishes emitted, fingerprinted files from public files
    // whose names happen to resemble Vite's base64url hashes.
    buildAssetsByRoot.set(root, (async () => {
      const assets = new Set();
      try {
        const manifest = JSON.parse(await readFile(path.join(root, ".vite", "manifest.json"), "utf8"));
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return assets;
        for (const entry of Object.values(manifest)) {
          if (!entry || typeof entry !== "object") continue;
          for (const name of [entry.file, ...(Array.isArray(entry.css) ? entry.css : []), ...(Array.isArray(entry.assets) ? entry.assets : [])]) {
            if (typeof name !== "string" || !name.startsWith("assets/") || !/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(name)) continue;
            const asset = path.resolve(root, name);
            if (!withinDirectory(asset, root)) continue;
            assets.add(asset);
            if (/\.(?:m?js|css)$/.test(name)) assets.add(`${asset}.map`);
          }
        }
      } catch {
        // Older builds without a manifest remain available with a short TTL.
      }
      return assets;
    })());
  }
  return buildAssetsByRoot.get(root);
}

function withinDirectory(candidate, directory) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

async function resolveFile(root, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "invalid_path", "The request path is invalid");
  }
  if (decodedPath.includes("\0") || decodedPath.split("/").some((segment) => segment.startsWith("."))) {
    throw new HttpError(404, "not_found", "The requested file does not exist");
  }

  const unresolved = path.resolve(root, `.${decodedPath === "/" ? "/index.html" : decodedPath}`);
  if (!withinDirectory(unresolved, root)) {
    throw new HttpError(404, "not_found", "The requested file does not exist");
  }

  try {
    const metadata = await stat(unresolved);
    const withIndex = metadata.isDirectory() ? path.join(unresolved, "index.html") : unresolved;
    const resolved = await realpath(withIndex);
    if (!withinDirectory(resolved, root)) {
      return null;
    }
    const fileMetadata = await stat(resolved);
    return fileMetadata.isFile() ? { path: resolved, metadata: fileMetadata } : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

function parseRange(header, size) {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) {
    return false;
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return false;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return false;
  }
  return { start, end: Math.min(end, size - 1) };
}

function staticSecurityHeaders(response) {
  setCommonSecurityHeaders(response);
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; frame-src https://webstreaming.europarl.europa.eu; frame-ancestors 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  );
}

export async function sendResolvedFile(request, response, file, options = {}) {
  const extension = path.extname(file.path).toLowerCase();
  const etag = `W/\"${file.metadata.size.toString(16)}-${Math.trunc(file.metadata.mtimeMs).toString(16)}\"`;
  const range = parseRange(request.headers.range, file.metadata.size);

  staticSecurityHeaders(response);
  response.setHeader("Content-Type", contentTypes.get(extension) || "application/octet-stream");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("ETag", etag);
  response.setHeader(
    "Cache-Control",
    range !== null
      ? "no-store"
      : extension === ".html"
        ? "no-cache"
        : options.cacheControl || "public, max-age=300",
  );

  if (range === null && request.headers["if-none-match"] === etag) {
    response.statusCode = 304;
    response.end();
    return;
  }
  if (range === false) {
    response.statusCode = 416;
    response.setHeader("Content-Range", `bytes */${file.metadata.size}`);
    response.setHeader("Content-Length", "0");
    response.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : file.metadata.size - 1;
  response.statusCode = range ? 206 : 200;
  response.setHeader("Content-Length", Math.max(end - start + 1, 0));
  if (range) {
    response.setHeader("Content-Range", `bytes ${start}-${end}/${file.metadata.size}`);
  }
  if (request.method === "HEAD" || file.metadata.size === 0) {
    response.end();
    return;
  }

  await new Promise((resolve, reject) => {
    const stream = createReadStream(file.path, { start, end });
    stream.on("error", (error) => {
      if (response.headersSent) response.destroy();
      else response.setHeader("Cache-Control", "no-store");
      reject(error);
    });
    response.on("close", () => {
      stream.destroy();
      resolve();
    });
    response.on("finish", resolve);
    stream.pipe(response);
  });
}

export async function serveStatic(request, response, url) {
  if (!config.serveStatic || (request.method !== "GET" && request.method !== "HEAD")) {
    return false;
  }
  // Navigation uses query parameters. Do not absorb another application's paths.
  if (url.pathname !== "/" && url.pathname !== "/index.html" && !url.pathname.startsWith("/assets/")) {
    return false;
  }

  let root;
  try {
    root = await realpath(config.distDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HttpError(503, "dist_missing", "The production frontend has not been built");
    }
    throw error;
  }

  let file = await resolveFile(root, url.pathname);
  if (!file) {
    return false;
  }

  const immutable = (await immutableBuildAssets(root)).has(file.path);
  await sendResolvedFile(request, response, file, immutable ? { cacheControl: "public, max-age=31536000, immutable" } : {});
  return true;
}
