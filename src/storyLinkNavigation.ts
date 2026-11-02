import type {MouseEvent} from 'react';
import {dossierLinkClick} from './dossierJourney';

function scrollParent(link:HTMLElement):HTMLElement|null{
 for(let node=link.parentElement;node;node=node.parentElement){
  if(node.matches('main.explorer-insights')||/auto|scroll/.test(window.getComputedStyle(node).overflowY))return node;
 }
 return null;
}
export function storyLinkClick(event:MouseEvent<HTMLAnchorElement>,id:string){
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const container=scrollParent(event.currentTarget);
 history.replaceState({...history.state,storyLinkId:id,storyScroll:container?.scrollTop||0},'');
 dossierLinkClick(event);
 if(event.defaultPrevented)history.replaceState({...history.state,storyReturn:true},'');
}
export function focusStoryLink(){
 const id=history.state?.storyLinkId,link=id?document.getElementById(id):null;
 if(!link)return;
 const container=scrollParent(link);
 link.focus({preventScroll:true});
 if(container)container.scrollTop=history.state.storyScroll||0;
 const rect=link.getBoundingClientRect(),bounds=container?.getBoundingClientRect();
 if(rect.top<Math.max(0,bounds?.top||0)||rect.bottom>Math.min(window.innerHeight,bounds?.bottom||window.innerHeight))link.scrollIntoView({block:'center'});
}
