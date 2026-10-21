export type ColourScheme='system'|'light'|'dark';
export const COLOUR_SCHEME_KEY:string;
export const colourSchemes:readonly ColourScheme[];
export function readColourScheme():ColourScheme;
export function readActiveColourScheme(doc?:Document):ColourScheme;
export function systemColourScheme(win?:Window):'light'|'dark';
export function nextColourScheme(current:ColourScheme,system?:'light'|'dark'):ColourScheme;
export function applyColourScheme(scheme:ColourScheme,doc?:Document):void;
export function saveColourScheme(scheme:ColourScheme):void;
