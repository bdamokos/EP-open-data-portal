import {useLayoutEffect, useRef, useState} from 'react';
import {versionedPortraitUrl} from '../server/portrait-version.mjs';

type State = {url: string; phase: 'loading'|'loaded'|'error'};

export function usePortraitImage(url: string, fallback: string, lazy = true) {
  const imageRef = useRef<HTMLImageElement>(null);
  const source = versionedPortraitUrl(url);
  const [state, setState] = useState<State>({url, phase: 'loading'});
  const phase = state.url === url ? state.phase : 'loading';

  useLayoutEffect(() => {
    // Native images can complete from the browser cache before effects run.
    const loaded = imageRef.current?.complete && (imageRef.current?.naturalWidth || 0) > 0;
    setState({url, phase: loaded ? 'loaded' : 'loading'});
  }, [url, source]);

  return {
    imageRef,
    src: phase === 'error' ? fallback : source,
    loading: lazy ? 'lazy' : 'eager',
    status: phase,
    onLoad: () => {if (phase !== 'error') setState({url, phase: 'loaded'});},
    // Native errors do not expose Retry-After. Do not automatically re-request
    // a failed image and risk ignoring an upstream admission cooldown.
    onError: () => {if (phase !== 'error') setState({url, phase: 'error'});},
  } as const;
}
