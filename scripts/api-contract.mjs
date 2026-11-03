import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';

// Preserve the original inventory's file admission rule, including re-exports
// only when their file also contains a direct response-version declaration.
const admitted = /\bexport\s+(?:const|let|var)\s+\w+_VERSION\b/;

// Shared by server startup, the client build and inventory tests. Never execute
// endpoint modules: imports can have side effects or depend on API_VERSION.
export function contractDigest(root) {
  const modules = new Map();
  const failure = (file, key) => new Error(`${path.relative(root, file)}:${key} must resolve to a string or number literal response version constant`);
  const target = (file, source, key) => {
    if (!source.startsWith('.')) throw failure(file, key);
    return path.resolve(path.dirname(file), source);
  };
  function moduleInfo(file) {
    if (modules.has(file)) return modules.get(file);
    const source = readFileSync(file, 'utf8');
    const ast = parse(source, {ecmaVersion:'latest', sourceType:'module'});
    const info = {source, locals:new Map(), exports:new Map(), stars:[]};
    modules.set(file, info);
    function declaration(node, exported) {
      if (node.type === 'VariableDeclaration') {
        for (const item of node.declarations) {
          const names = [];
          function bindings(binding) {
            if (!binding) return;
            if (binding.type === 'Identifier') names.push(binding.name);
            else if (binding.type === 'ObjectPattern') for (const item of binding.properties) bindings(item.value ?? item.argument);
            else if (binding.type === 'ArrayPattern') for (const item of binding.elements) bindings(item);
            else bindings(binding.left ?? binding.argument);
          }
          bindings(item.id);
          for (const name of names) {
            info.locals.set(name, {literal:item.id.type === 'Identifier' ? item.init : null});
            if (exported) info.exports.set(name, {local:name});
          }
        }
      } else if (node.id) {
        info.locals.set(node.id.name, {literal:null});
        if (exported) info.exports.set(node.id.name, {local:node.id.name});
      }
    }
    for (const node of ast.body) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) declaration(node.declaration, true);
        for (const specifier of node.specifiers) {
          const key = specifier.exported.name ?? specifier.exported.value;
          const local = specifier.local.name ?? specifier.local.value;
          info.exports.set(key, node.source ? {source:node.source.value, key:local} : {local});
        }
      } else if (node.type === 'ExportAllDeclaration') {
        if (node.exported) info.exports.set(node.exported.name, {literal:null});
        else info.stars.push(node.source.value);
      } else if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers) info.locals.set(specifier.local.name,
          specifier.type === 'ImportSpecifier' ? {source:node.source.value, key:specifier.imported.name ?? specifier.imported.value} : {literal:null});
      } else declaration(node, false);
    }
    return info;
  }
  function exportsOf(file, seen = new Set()) {
    if (seen.has(file)) throw failure(file, '*_VERSION (cyclic re-export)');
    const info = moduleInfo(file), result = new Map(info.exports);
    for (const source of info.stars) {
      const destination = target(file, source, '*_VERSION');
      for (const key of exportsOf(destination, new Set([...seen, file])).keys()) {
        if (key === 'default' || info.exports.has(key)) continue;
        if (result.has(key)) throw failure(file, key);
        result.set(key, {source, key});
      }
    }
    return result;
  }
  function resolve(file, key, local = false, seen = new Set()) {
    const identity = `${file}:${local ? 'local:' : ''}${key}`;
    if (seen.has(identity)) throw failure(file, key);
    const next = new Set([...seen, identity]);
    const descriptor = (local ? moduleInfo(file).locals : exportsOf(file)).get(key);
    if (!descriptor) throw failure(file, key);
    if (descriptor.source) return resolve(target(file, descriptor.source, key), descriptor.key, false, next);
    if (descriptor.local) return resolve(file, descriptor.local, true, next);
    const node = descriptor.literal;
    if (node?.type === 'Literal' && ['string', 'number'].includes(typeof node.value) && !node.regex && (typeof node.value !== 'number' || Number.isFinite(node.value))) return node.value;
    if (node?.type === 'UnaryExpression' && ['+', '-'].includes(node.operator) && node.argument.type === 'Literal' && typeof node.argument.value === 'number' && Number.isFinite(node.argument.value)) return node.operator === '-' ? -node.argument.value : node.argument.value;
    throw failure(file, key);
  }
  const versions = [];
  const directory = path.join(root, 'server');
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs') || name === 'api-version.mjs') continue;
    const file = path.join(directory, name);
    if (!admitted.test(readFileSync(file, 'utf8'))) continue;
    for (const key of [...exportsOf(file).keys()].filter(key => key.endsWith('_VERSION')).sort()) versions.push([name, key, resolve(file, key)]);
  }
  if (!versions.length) throw new Error('The endpoint version inventory must not be empty');
  return {digest:createHash('sha256').update(JSON.stringify(versions)).digest('hex'), versions};
}
