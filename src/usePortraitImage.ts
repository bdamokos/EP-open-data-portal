import {useEffect, useRef, useState} from 'react';
import {isManagedPortrait, portraitLoader} from './portraitLoader.mjs';

type State = {url: string; src: string; phase: 'loading'|'ready'|'loaded'|'error'};

export function usePortraitImage(url: string, fallback: string, lazy = true) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<State>({url, src: fallback, phase: 'loading'});
  const managed = isManagedPortrait(url);
  const current = state.url === url ? state : {url, src: fallback, phase: 'loading' as const};

  useEffect(() => {
    if (!managed) return;
    const controller = new AbortController();
    let objectUrl = '', started = false;
    setState({url, src: fallback, phase: 'loading'});
    const start = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      portraitLoader.load(url, {signal: controller.signal}).then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({url, src: objectUrl, phase: 'ready'});
      }).catch(error => {
        if (error.name !== 'AbortError' && !controller.signal.aborted) setState({url, src: fallback, phase: 'error'});
      });
    };
    let observer: IntersectionObserver | undefined;
    if (!lazy || !('IntersectionObserver' in window)) start();
    else if (imageRef.current) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect();
          start();
        }
      }, {rootMargin: '200px'});
      observer.observe(imageRef.current);
    }
    return () => {
      observer?.disconnect();
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, fallback, lazy, managed]);

  return {
    imageRef,
    src: managed ? current.src : current.phase === 'error' ? fallback : url,
    status: managed ? current.phase === 'loaded' ? 'loaded' : current.phase === 'error' ? 'error' : 'loading' : current.phase === 'error' ? 'error' : 'loaded',
    onLoad: () => {if (managed && current.phase === 'ready') setState(value => value.url === url ? {...value, phase: 'loaded'} : value);},
    onError: () => setState({url, src: fallback, phase: 'error'}),
  } as const;
}
