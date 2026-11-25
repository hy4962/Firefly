/** Reset only on actual progress. A long but progressing transfer is not a timeout. */
export function idleWatchdog(controller, timeoutMs = 45_000) {
  let timer;
  const stop = () => clearTimeout(timer);
  const touch = () => {
    stop();
    timer = setTimeout(() => controller.abort(new Error('audio transfer idle')), timeoutMs);
    timer.unref?.();
  };
  touch();
  return { touch, stop };
}

export async function waitBounded(task, timeoutMs, signal) {
  if (signal?.aborted) return;
  let timer;
  let abort;
  try {
    await Promise.race([
      task,
      new Promise(resolve => {
        timer = setTimeout(resolve, timeoutMs);
        abort = resolve;
        signal?.addEventListener('abort', abort, { once: true });
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
