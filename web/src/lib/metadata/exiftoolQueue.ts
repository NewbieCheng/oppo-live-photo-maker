/** Serialize all @uswriting/exiftool WASM calls (single-threaded ZeroPerl runtime). */
let chain: Promise<unknown> = Promise.resolve();

export function withExiftoolLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
