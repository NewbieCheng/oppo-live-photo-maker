import { findExiftool } from "./exiftoolCli.js";
import { warmupExiv2 } from "./exiv2Module.js";

export const VERSION = "0.1.1";

export interface BackendHealthInfo {
  status: "ok" | "degraded";
  version: string;
  gexiv2: {
    available: boolean;
    backend: string | null;
    path: string | null;
  };
}

export async function getBackendHealth(): Promise<BackendHealthInfo> {
  const exiv2Ok = await warmupExiv2();
  const exiftool = findExiftool();
  const available = exiv2Ok || !!exiftool;
  let backend: string | null = null;
  let backendPath: string | null = null;

  if (exiv2Ok) {
    backend = "exiv2-wasm";
    backendPath = "exiv2-wasm";
  } else if (exiftool) {
    backend = "jpeg-segment-transplant";
    backendPath = exiftool;
  }

  return {
    status: available ? "ok" : "degraded",
    version: VERSION,
    gexiv2: {
      available,
      backend,
      path: backendPath,
    },
  };
}
