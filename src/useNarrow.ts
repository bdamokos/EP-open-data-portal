import {useSyncExternalStore} from 'react';

const query='(max-width: 639px)';
const subscribe=(notify:()=>void)=>{const media=window.matchMedia(query);media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);};
// True below the 640 px breakpoint shared by the vote views.
export const useNarrow=()=>useSyncExternalStore(subscribe,()=>window.matchMedia(query).matches,()=>false);
