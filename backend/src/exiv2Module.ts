import { createRequire } from "node:module";
import path from "node:path";
import type { Exiv2Module } from "exiv2-wasm";

const require = createRequire(import.meta.url);

let modulePromise: Promise<Exiv2Module> | null = null;

/** Singleton Exiv2 WASM module (Node.js). */
export async function getExiv2Module(): Promise<Exiv2Module> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const distDir = path.dirname(require.resolve("exiv2-wasm"));
      // Use the CJS entry: the ESM build resolves ./dist/exiv2.esm.js from dist/ (wrong path).
      const createExiv2Module = require("exiv2-wasm") as typeof import("exiv2-wasm").createExiv2Module;
      return createExiv2Module({
        locateFile: (file: string) => path.join(distDir, file),
      });
    })();
  }
  return modulePromise;
}

export async function warmupExiv2(): Promise<boolean> {
  try {
    await getExiv2Module();
    return true;
  } catch {
    return false;
  }
}
