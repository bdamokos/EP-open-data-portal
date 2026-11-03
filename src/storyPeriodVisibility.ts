// Reveal only the story's start: a long story need not fit in the viewport.
// Scrolling never transfers focus away from the chart control.
export function revealStoryPeriod(element:HTMLElement|null) {
 if(!element)return;
 const top=element.getBoundingClientRect().top;
 if(top>=0&&top<window.innerHeight)return;
 element.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
