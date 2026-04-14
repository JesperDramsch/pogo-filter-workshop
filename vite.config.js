import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT: set base to "/<repo-name>/" for GitHub Pages.
// E.g. if your repo is github.com/jesper/pogo-filter-workshop,
//   base: "/pogo-filter-workshop/"
// For a custom domain or username.github.io repo, use "/" instead.
export default defineConfig({
  plugins: [react()],
  base: "/pogo-filter-workshop/",
  build: {
    outDir: "dist",
    sourcemap: false,
    // The embedded Pokémon names + KMZ polygons make the bundle ~200KB before
    // gzip — well within reason but let's bump the chunk warning to skip noise.
    chunkSizeWarningLimit: 600,
  },
});
