// Fixture downloads bypass wall-clock pacing but keep the admission signal contract.
export async function unthrottledUpstream(operation,{signal}={}) {
  signal?.throwIfAborted();
  return operation(signal);
}
