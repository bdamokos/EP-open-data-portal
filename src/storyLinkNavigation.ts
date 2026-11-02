import type {MouseEvent} from 'react';
import {dossierLinkClick} from './dossierJourney';

export function storyLinkClick(event:MouseEvent<HTMLAnchorElement>,id:string){
 if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 history.replaceState({...history.state,storyLinkId:id,storyScroll:window.scrollY},'');
 dossierLinkClick(event);
}
export function focusStoryLink(){
 const id=history.state?.storyLinkId,link=id?document.getElementById(id):null;
 if(link){link.focus({preventScroll:true});window.scrollTo?.(0,history.state.storyScroll||0);}
}
