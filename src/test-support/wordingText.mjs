// Read one lossless source projection without the screen-reader change announcements.
export function wordingText(container,side) {
  const columns=container.querySelector('.wording-diff__columns');
  const passage=(columns?columns.querySelectorAll('section')[side==='original'?0:1]:container)?.querySelector('.wording-diff__passage');
  if(!passage)return '';
  const copy=passage.cloneNode(true);
  for(const node of copy.querySelectorAll('.wording-diff__sr,'+(side==='original'?'ins':'del')))node.remove();
  return copy.textContent;
}

// Metadata/status assertions can ignore the visual layout and change announcements,
// while still checking that only the currently rendered source projections occur.
export function wordingViewText(container) {
  const copy=container.cloneNode(true);
  const diffs=copy.matches?.('.wording-diff')?[copy]:copy.querySelectorAll('.wording-diff');
  for(const diff of diffs) {
    if(!diff.querySelector('.wording-diff__columns')) {
      const passage=diff.querySelector('.wording-diff__passage');
      if(passage)passage.textContent=wordingText(diff,'original')+' '+wordingText(diff,'proposed');
    }
  }
  for(const node of copy.querySelectorAll('.wording-diff__sr'))node.remove();
  return copy.textContent;
}
