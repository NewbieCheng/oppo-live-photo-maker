import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Exiv2Module } from "exiv2-wasm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let modulePromise: Promise<Exiv2Module> | null = null;

/** Singleton Exiv2 WASM module (Node.js). */
export async function getExiv2Module(): Promise<Exiv2Module> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { createExiv2Module } = await import("exiv2-wasm");
      const pkgDir = path.dirname(require.resolve("exiv2-wasm/package.json"));
      const distDir = path.join(pkgDir, "dist");
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
