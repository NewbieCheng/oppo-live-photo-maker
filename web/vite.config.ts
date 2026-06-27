import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GitHub Pages will serve from /oppo-live-photo-maker/.
const base = process.env.GITHUB_PAGES === "1" ? "/oppo-live-photo-maker/" : "/";

export default defineConfig({
  base,
  plugins: [vue()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared/metadata"),
    },
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@uswriting/exiftool") || id.includes("@6over3/zeroperl-ts")) {
            return "exiftool";
          }
          if (id.includes("/src/assets/exiftool")) {
            return "exiftool";
          }
        },
      },
    },
  },
});
