/** Debug session 3d3364 — tracks concurrent ExifTool WASM calls. */
let wasmInFlight = 0;

export function wasmInFlightCount(): number {
  return wasmInFlight;
}

export function wasmInFlightEnter(op: string): number {
  wasmInFlight += 1;
  const ticket = wasmInFlight;
  // #region agent log
  fetch("http://127.0.0.1:7797/ingest/5d690944-32ab-4601-abda-19836ca0f9f1", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3d3364" },
    body: JSON.stringify({
      sessionId: "3d3364",
      hypothesisId: "A",
      location: "exiftoolDebug.ts:enter",
      message: "wasm enter",
      data: { op, inFlight: ticket },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return ticket;
}

export function wasmInFlightLeave(op: string, ok: boolean, err?: string): void {
  // #region agent log
  fetch("http://127.0.0.1:7797/ingest/5d690944-32ab-4601-abda-19836ca0f9f1", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3d3364" },
    body: JSON.stringify({
      sessionId: "3d3364",
      hypothesisId: "A",
      location: "exiftoolDebug.ts:leave",
      message: "wasm leave",
      data: { op, ok, err: err?.slice(0, 120), inFlight: wasmInFlight },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  wasmInFlight = Math.max(0, wasmInFlight - 1);
}

export function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  // #region agent log
  fetch("http://127.0.0.1:7797/ingest/5d690944-32ab-4601-abda-19836ca0f9f1", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3d3364" },
    body: JSON.stringify({
      sessionId: "3d3364",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}
