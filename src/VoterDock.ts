import {createContext} from 'react';
// The element at the right of the agenda content where the voter panel docks on wide screens.
export const VoterDockContext=createContext<HTMLElement|null>(null);
