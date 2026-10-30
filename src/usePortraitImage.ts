import {useLayoutEffect, useRef, useState} from 'react';
import {isManagedPortrait, portraitLoader} from './portraitLoader.mjs';
import {versionedPortraitUrl} from '../server/portrait-version.mjs';

type State = {url: string; src: string; phase: 'loading'|'ready'|'loaded'|'retrying'|'error'};

export function usePortraitImage(url: string, fallback: string, lazy = true) {
  const imageRef = useRef<HTMLImageElement>(null);
  const managed = isManagedPortrait(url);
  const source = managed ? versionedPortraitUrl(url) : url;
  const [state, setState] = useState<State>({url, src: source, phase: 'loading'});
  const current = state.url === url ? state : {url, src: source, phase: 'loading' as const};
  const retryRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    let objectUrl = '', retried = false;
    // Native images can complete from the browser cache before effects run.
    const loaded = imageRef.current?.complete && (imageRef.current?.naturalWidth || 0) > 0;
    setState({url, src: source, phase: loaded ? 'loaded' : 'loading'});
    retryRef.current = () => {
      if (retried || !managed) {setState({url, src: fallback, phase: 'error'}); return;}
      retried = true;
      setState({url, src: source, phase: 'retrying'});
      // Normal loads use the real URL directly. Retain bounded Retry-After and
      // mismatch handling only when a native image request has failed.
      portraitLoader.load(url, {signal: controller.signal, priority: 'visible'}).then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({url, src: objectUrl, phase: 'ready'});
      }).catch(() => {
        if (!controller.signal.aborted) setState({url, src: fallback, phase: 'error'});
      });
    };
    return () => {
      retryRef.current = null;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, source, fallback, managed]);

  return {
    imageRef,
    src: current.src,
    loading: lazy ? 'lazy' : 'eager',
    status: current.phase === 'loaded' ? 'loaded' : current.phase === 'error' ? 'error' : 'loading',
    onLoad: () => {if (current.phase !== 'error' && current.phase !== 'retrying') setState({url, src: current.src, phase: 'loaded'});},
    onError: () => {if (current.phase !== 'error' && current.phase !== 'retrying') retryRef.current?.();},
  } as const;
}
