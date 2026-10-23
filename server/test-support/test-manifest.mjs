import {parseSync} from 'vite';

// Parse without running tests, so strings/comments and nested test callbacks
// cannot hide an unguarded listener or produce false positives.
export function listenerIssues(source) {
  const {program, errors} = parseSync('test.mjs', source);
  if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
  const nodes = [];
  function visit(node, ancestors = []) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') {
      nodes.push({node, ancestors});
      ancestors = [...ancestors, node];
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child, ancestors);
      else if (value && typeof value === 'object') visit(value, ancestors);
    }
  }
  visit(program);
  const importsHelper = program.body.some(node => node.type === 'ImportDeclaration'
    && /(?:^|\/)test-support\/loopback\.mjs$/.test(node.source.value)
    && node.specifiers.some(specifier => specifier.imported?.name === 'loopback' && specifier.local.name === 'loopback'));
  function isTest(node) {
    if (node.type !== 'CallExpression') return false;
    const callee = node.callee;
    if (callee.type === 'Identifier') return ['test', 'it', 'describe', 'suite'].includes(callee.name);
    return callee.type === 'MemberExpression' && (callee.property.name === 'test'
      || ['skip', 'only'].includes(callee.property.name) && ['test', 'it', 'describe', 'suite'].includes(callee.object.name));
  }
  function guarded(node) {
    const options = node.arguments[1];
    return options?.type === 'Identifier' && options.name === 'loopback'
      || options?.type === 'ObjectExpression' && options.properties.some(property =>
        property.type === 'SpreadElement' && property.argument.name === 'loopback');
  }
  const calls = nodes.filter(({node}) => isTest(node));
  const listeners = nodes.filter(({node}) => node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression' && node.callee.property.name === 'listen');
  const issues = [];
  if (listeners.length && !importsHelper) issues.push('must import loopback from the capability helper');
  for (const {node, ancestors} of listeners) {
    const enclosing = ancestors.filter(isTest);
    if (enclosing.some(guarded)) continue;
    if (enclosing.length) issues.push(`listener at offset ${node.start} must receive loopback test options`);
    // A listener in shared setup affects every test in the file. Fail closed for
    // helper-based setup too; move it into a guarded test/suite if only some use it.
    else if (!calls.length || calls.some(({node: call, ancestors: parents}) => !guarded(call) && !parents.filter(isTest).some(guarded))) {
      issues.push(`shared listener at offset ${node.start} requires loopback options on its tests or suite`);
    }
  }
  return issues;
}
