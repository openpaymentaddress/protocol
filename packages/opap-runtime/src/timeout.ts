export function createTimeoutSignal(
  timeoutMs: number,
  outerSignal?: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const abortFromOuter = (): void => controller.abort(outerSignal?.reason);
  const timer = setTimeout(
    () => controller.abort(new DOMException("timeout", "TimeoutError")),
    timeoutMs,
  );

  if (outerSignal?.aborted === true) {
    abortFromOuter();
  } else {
    outerSignal?.addEventListener("abort", abortFromOuter, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", abortFromOuter);
    },
  };
}
