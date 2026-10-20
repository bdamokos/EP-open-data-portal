export type ColourScheme='system'|'light'|'dark';
export const COLOUR_SCHEME_KEY:string;
export const colourSchemes:readonly ColourScheme[];
export function readColourScheme():ColourScheme;
export function nextColourScheme(current:ColourScheme):ColourScheme;
export function applyColourScheme(scheme:ColourScheme,doc?:Document):void;
export function saveColourScheme(scheme:ColourScheme):void;
