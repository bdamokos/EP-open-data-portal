import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const apiPrefixes=Object.freeze(['/api']);
// These parsers read the environment when called; service factories use them lazily.
export function integerFromEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function booleanFromEnvironment(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (/^(1|true|yes|on)$/i.test(raw)) {
    return true;
  }
  if (/^(0|false|no|off)$/i.test(raw)) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}

export function absolutePathFromEnvironment(name, fallback) {
  const value = process.env[name] || fallback;
  if (value === undefined) return undefined;
  if (value.includes("\0")) throw new Error(`${name} must be a filesystem path`);
  return path.resolve(value);
}

const appRevision=process.env.APP_REVISION||'';
if(appRevision&&!/^[a-f0-9]{40}$/.test(appRevision))throw new Error('APP_REVISION must be a full commit SHA.');
export const config=Object.freeze({
 appRevision,
 host:process.env.HOST||'127.0.0.1',
 port:integerFromEnvironment('PORT',8790,1,65535),
 trustProxy:booleanFromEnvironment('TRUST_PROXY',false),
 distDirectory:absolutePathFromEnvironment('EXPLORER_DIST_DIR',path.join(projectRoot,'dist')),
 serveStatic:booleanFromEnvironment('EXPLORER_SERVE_STATIC',true),
 jsonResponseLimitBytes:integerFromEnvironment('JSON_RESPONSE_LIMIT_BYTES',5*1024*1024,64*1024,25*1024*1024),
 documentTextMaxDiskBytes:integerFromEnvironment('DOCUMENT_TEXT_MAX_DISK_MIB',256,16,8192)*1024*1024,
});
