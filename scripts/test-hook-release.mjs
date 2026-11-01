import {beforeEach} from 'node:test';

// node:test keeps every finished Test and its hooks until the file exits, so a
// t.after callback keeps its whole closure alive: happy-dom windows, Vite module
// runners and React roots. Frontend files then grew by about 70 MB per harness
// until V8 hit its heap limit on 8 GB machines. Drop each t.after callback once it
// has run. Only processes that execute test files load this; the --test parent and
// plain Node subprocesses never import node:test from here.
const isolationNone = process.execArgv.some((arg, index, args) =>
  /^--(experimental-)?test-isolation=none$/.test(arg) ||
  (/^--(experimental-)?test-isolation$/.test(arg) && args[index + 1] === 'none'));

if (process.env.NODE_TEST_CONTEXT === 'child-v8' || isolationNone) {
  let patched = false;
  beforeEach(t => {
    if (patched) return;
    patched = true;
    const prototype = Object.getPrototypeOf(t);
    const after = prototype.after;
    prototype.after = function (fn, options) {
      if (typeof fn !== 'function') return Reflect.apply(after, this, [fn, options]);
      let pending = fn;
      const release = function (...args) {
        const callback = pending;
        pending = null;
        return Reflect.apply(callback, this, args);
      };
      // node:test detects callback-style hooks from the declared arity.
      Object.defineProperty(release, 'length', {value: fn.length});
      return Reflect.apply(after, this, [release, options]);
    };
  });
}
