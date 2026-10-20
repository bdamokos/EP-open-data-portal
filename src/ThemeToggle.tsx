import {useState} from 'react';
import {nextColourScheme,readColourScheme,saveColourScheme,type ColourScheme} from './colourScheme.mjs';

const names:Record<ColourScheme,string>={system:'System',light:'Light',dark:'Dark'};

function SchemeIcon({scheme}:{scheme:ColourScheme}) {
  if(scheme==='light')return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>;
  if(scheme==='dark')return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" fill="currentColor" stroke="none"/></svg>;
}

// Cycles System → Light → Dark. The label names the current choice and the next one.
export function ThemeToggle() {
  const [scheme,setScheme]=useState<ColourScheme>(readColourScheme);
  const next=nextColourScheme(scheme);
  const label=`Colour scheme: ${names[scheme]}. Switch to ${names[next].toLowerCase()}`;
  return <button type="button" className="explorer-scheme-toggle" lang="en" aria-label={label} title={label} onClick={()=>{saveColourScheme(next);setScheme(next);}}><SchemeIcon scheme={scheme}/></button>;
}
