import {useEffect, useRef, useState} from 'react';
import {isManagedPortrait, portraitLoader} from './portraitLoader.mjs';

type State = {url: string; src: string; phase: 'loading'|'ready'|'loaded'|'error'};

export function usePortraitImage(url: string, fallback: string, lazy = true) {
  const imageRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<State>({url, src: fallback, phase: 'loading'});
  const managed = isManagedPortrait(url);
  const current = state.url === url ? state : {url, src: fallback, phase: 'loading' as const};

  useEffect(() => {
    if (!managed) return;
    const controller = new AbortController();
    let objectUrl = '', started = false;
    let observer: IntersectionObserver | undefined, viewportObserver: IntersectionObserver | undefined;
    let request: ReturnType<typeof portraitLoader.load> | undefined;
    let visible = false;
    setState({url, src: fallback, phase: 'loading'});
    const start = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      observer?.disconnect();
      request = portraitLoader.load(url, {signal: controller.signal, priority: visible ? 'visible' : 'background'});
      request.then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({url, src: objectUrl, phase: 'ready'});
      }).catch(error => {
        if (error.name !== 'AbortError' && !controller.signal.aborted) setState({url, src: fallback, phase: 'error'});
      }).finally(() => viewportObserver?.disconnect());
    };
    const foreground = () => {
      visible = true;
      request?.setPriority('visible');
      start();
    };
    startRef.current = foreground;
    if (!('IntersectionObserver' in window)) start();
    else if (imageRef.current) {
      // Expand the scrolling wall itself: viewport margins cannot extend past
      // an intervening overflow container's clip.
      const wall = imageRef.current.closest<HTMLElement>('[data-portrait-scroll-root]');
      let root = wall;
      while (root && !['auto', 'scroll'].includes(window.getComputedStyle(root).overflowY)) root = root.parentElement;
      const margin = wall ? Math.max(800, (root?.clientHeight || window.innerHeight) * 2) : 200;
      // A separate viewport observer respects clipping by the wall and window.
      // Keep it until the request settles so scrolling can promote queued work.
      viewportObserver = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        request?.setPriority(visible ? 'visible' : 'background');
        if (visible) start();
      });
      viewportObserver.observe(imageRef.current);
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          start();
        }
      }, {root, rootMargin: `${margin}px 0px`});
      observer.observe(imageRef.current);
    }
    return () => {
      startRef.current = null;
      observer?.disconnect();
      viewportObserver?.disconnect();
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, fallback, managed]);

  // Priority changes may start a waiting request, but must not discard an
  // existing request or blob when filtering moves a card within the wall.
  useEffect(() => {
    if (!lazy && managed) startRef.current?.();
  }, [lazy, url, fallback, managed]);

  return {
    imageRef,
    src: managed ? current.src : current.phase === 'error' ? fallback : url,
    status: managed ? current.phase === 'loaded' ? 'loaded' : current.phase === 'error' ? 'error' : 'loading' : current.phase === 'error' ? 'error' : 'loaded',
    onLoad: () => {if (managed && current.phase === 'ready') setState(value => value.url === url ? {...value, phase: 'loaded'} : value);},
    onError: () => setState({url, src: fallback, phase: 'error'}),
  } as const;
}
