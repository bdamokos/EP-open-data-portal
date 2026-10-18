import {monitorEventLoopDelay} from 'node:perf_hooks';

// A fixed histogram and one unreferenced timer per HTTP process. Values are ms
// for the current 30-second window, not lifetime maxima.
export function measureEventLoopDelay({
  histogram = monitorEventLoopDelay({resolution:20}),
  intervalMs = 30_000,
  warn = line => console.warn(line),
  schedule = setInterval,
  cancel = clearInterval,
} = {}) {
  const snapshot = () => ({p99Ms:Math.round(histogram.percentile(99)/1e6),maxMs:Math.round(histogram.max/1e6)});
  histogram.enable();
  const timer = schedule(() => {
    const delay = snapshot();
    if (delay.p99Ms >= 100 || delay.maxMs >= 250) warn(`[event-loop-delay] ${JSON.stringify({...delay,windowMs:intervalMs})}`);
    histogram.reset();
  }, intervalMs);
  timer.unref?.();
  return {snapshot,stop() {cancel(timer);histogram.disable();}};
}
