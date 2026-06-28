/** Debug session 267ab2 — tracks concurrent ExifTool WASM calls. */
let wasmInFlight = 0;

const DEBUG_SESSION = "267ab2";
const DEBUG_INGEST =
  "http://127.0.0.1:7797/ingest/5d690944-32ab-4601-abda-19836ca0f9f1";

export function agentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
  runId = "pre-fix",
): void {
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION,
      hypothesisId,
      location,
      message,
      data,
      runId,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export function wasmInFlightCount(): number {
  return wasmInFlight;
}

export function wasmInFlightEnter(op: string): number {
  wasmInFlight += 1;
  const ticket = wasmInFlight;
  agentLog("A", "exiftoolDebug.ts:enter", "wasm enter", { op, inFlight: ticket });
  return ticket;
}

export function wasmInFlightLeave(op: string, ok: boolean, err?: string): void {
  agentLog("A", "exiftoolDebug.ts:leave", "wasm leave", {
    op,
    ok,
    err: err?.slice(0, 120),
    inFlight: wasmInFlight,
  });
  wasmInFlight = Math.max(0, wasmInFlight - 1);
}

export function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  agentLog(hypothesisId, location, message, data);
}
