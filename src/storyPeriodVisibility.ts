// Keep the story's start and roughly three lines visible; the whole story need not fit.
// Scrolling never transfers focus away from the chart control.
export function revealStoryPeriod(element:HTMLElement|null) {
 if(!element)return;
 const top=element.getBoundingClientRect().top;
 if(top>=0&&top+64<=window.innerHeight)return;
 element.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
