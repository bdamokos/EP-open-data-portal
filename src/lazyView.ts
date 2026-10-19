import {lazy,type ComponentType} from 'react';

export class LazyViewError extends Error {
  constructor(cause:unknown) {
    super('Unable to load this view.',{cause});
    this.name='LazyViewError';
  }
}

// React caches rejected loaders, and the browser can also cache failed modules.
// Recover with an explicit document reload, preserving the selected URL and
// ordinary asset caching, rather than remounting or changing import URLs.
export function lazyView<Props extends object>(load:()=>Promise<{default:ComponentType<Props>}>) {
  return lazy(async()=>{
    try{return await load();}
    catch(cause){throw new LazyViewError(cause);}
  });
}
