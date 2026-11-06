// A fresh deep link must not pull focus to the agenda detail: the focus ring would frame the whole
// section before the reader has done anything. Focus moves only after an in-page navigation.
export function createDetailLanding(topic) {
  let landed=topic||null;
  return {
    // Call whenever the selected topic changes; leaving the landing topic ends the landing.
    seen(next){if(landed&&next!==landed)landed=null;},
    movesFocus(next){return !landed||next!==landed;},
  };
}

// A fresh load on a vote agenda item is shown as the item's own page. The item id alone says it is a vote
// item (`…-OJ-ITM-V-<n>`); once the item has loaded without votes the page falls back to the agenda view.
export function landedOnVotePage(search) {
  return /-ITM-V-\d+$/.test(new URLSearchParams(search).get('agenda-topic')||'');
}
export function votePageActive({landed,hasTopic,loadedVoteCount}) {
  return Boolean(landed&&hasTopic&&!(loadedVoteCount===0));
}
