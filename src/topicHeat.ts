import {useSyncExternalStore} from 'react';

const narrow='(max-width: 620px)';
const subscribe=(notify:()=>void)=>{const query=window.matchMedia?.(narrow);query?.addEventListener?.('change',notify);return()=>query?.removeEventListener?.('change',notify);};
export const useNarrowScreen=()=>useSyncExternalStore(subscribe,()=>Boolean(window.matchMedia?.(narrow).matches),()=>false);
