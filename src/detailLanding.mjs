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
