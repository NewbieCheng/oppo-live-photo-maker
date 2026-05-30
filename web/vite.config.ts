import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// GitHub Pages will serve from /oppo-live-photo-maker/.
const base = process.env.GITHUB_PAGES === "1" ? "/oppo-live-photo-maker/" : "/";

export default defineConfig({
  base,
  plugins: [vue()],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 2000,
  },
});
