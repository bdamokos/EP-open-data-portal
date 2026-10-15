import { createHash } from "node:crypto";

import { config } from "./config.mjs";

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function setCommonSecurityHeaders(response) {
  if(config.appRevision)response.setHeader('X-Parliament-Explorer-Revision',config.appRevision);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

export function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new HttpError(403, "origin_rejected", "The request origin is not allowed");
  }

  const forwardedHost = config.trustProxy
    ? String(request.headers["x-forwarded-host"] || "").split(",", 1)[0].trim()
    : "";
  const requestHost = forwardedHost || request.headers.host || "";
  const forwardedProtocol = config.trustProxy
    ? String(request.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim().toLowerCase()
    : "";
  const requestProtocol = forwardedProtocol || (request.socket?.encrypted ? "https" : "http");
  if (
    !requestHost ||
    originUrl.host.toLowerCase() !== requestHost.toLowerCase() ||
    originUrl.protocol !== `${requestProtocol}:`
  ) {
    throw new HttpError(403, "origin_rejected", "The request origin is not allowed");
  }
}

export function sendJson(request, response, status, payload, options = {}) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  if (body.byteLength > config.jsonResponseLimitBytes) {
    throw new HttpError(500, "response_too_large", "The generated response is too large");
  }

  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  response.statusCode = status;
  setCommonSecurityHeaders(response);
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", options.cacheControl || "no-store");
  response.setHeader("ETag", etag);
  response.setHeader("Vary", "Origin");

  if ((request.method === "GET" || request.method === "HEAD") && request.headers["if-none-match"] === etag) {
    response.statusCode = 304;
    response.removeHeader("Content-Type");
    response.removeHeader("Content-Length");
    response.end();
    return;
  }

  response.setHeader("Content-Length", body.byteLength);
  if (request.method === "HEAD") {
    response.end();
  } else {
    response.end(body);
  }
}

export function sendError(request, response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "internal_error";
  const message = error instanceof HttpError ? error.message : "The request could not be completed";
  sendJson(request, response, status, { error: { code, message } });
}
